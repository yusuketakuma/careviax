import { z } from 'zod';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, forbidden } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { prisma } from '@/lib/db/client';
import { hasPermission } from '@/lib/auth/permissions';

const createConsentSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  consent_type: z.enum([
    'visit_medication_management',
    'personal_info_handling',
    'external_sharing',
    'photo_capture',
  ]),
  method: z.enum(['paper_scan', 'digital']),
  obtained_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  document_url: z.string().url().optional(),
});

async function getMembership(userId: string, orgId: string) {
  return prisma.membership.findFirst({
    where: { user_id: userId, org_id: orgId, is_active: true },
    select: { role: true },
  });
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const membership = await getMembership(req.userId, req.orgId);
  if (!membership || !hasPermission(membership.role, 'canVisit')) {
    return forbidden('同意記録の閲覧には訪問権限が必要です');
  }

  const searchParams = req.nextUrl.searchParams;
  const patientId = searchParams.get('patient_id');
  if (!patientId) {
    return validationError('patient_idは必須です');
  }

  const consentType = searchParams.get('consent_type') ?? undefined;
  const isActiveParam = searchParams.get('is_active');
  const isActive = isActiveParam === 'false' ? false : true;

  const { cursor, limit } = parsePaginationParams(searchParams);

  const where = {
    org_id: req.orgId,
    patient_id: patientId,
    is_active: isActive,
    ...(consentType ? { consent_type: consentType as any } : {}),
  };

  const [records, totalCount] = await Promise.all([
    prisma.consentRecord.findMany({
      where,
      orderBy: { obtained_date: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.consentRecord.count({ where }),
  ]);

  const hasMore = records.length > limit;
  const data = hasMore ? records.slice(0, limit) : records;
  const nextCursor = hasMore ? data[data.length - 1].id : undefined;

  return success({ data, nextCursor, hasMore, totalCount });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const membership = await getMembership(req.userId, req.orgId);
  if (!membership || !hasPermission(membership.role, 'canVisit')) {
    return forbidden('同意記録の作成には訪問権限が必要です');
  }

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createConsentSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { patient_id, case_id, consent_type, method, obtained_date, expiry_date, document_url } =
    parsed.data;

  // Validate patient and optional case belong to this org
  const refResult = await validateOrgReferences(req.orgId, {
    patient_id,
    ...(case_id ? { case_id } : {}),
  });
  if (!refResult.ok) return refResult.response;

  // Check for active duplicate
  const duplicate = await prisma.consentRecord.findFirst({
    where: {
      org_id: req.orgId,
      patient_id,
      consent_type: consent_type as any,
      is_active: true,
    },
    select: { id: true },
  });
  if (duplicate) {
    return validationError(
      'この患者にはすでに有効な同意記録が存在します',
      { consent_type: ['同一種別の有効な同意がすでに存在します'] }
    );
  }

  const record = await withOrgContext(req.orgId, async (tx) => {
    return tx.consentRecord.create({
      data: {
        org_id: req.orgId,
        patient_id,
        case_id: case_id ?? null,
        consent_type: consent_type as any,
        method: method as any,
        obtained_date: new Date(obtained_date),
        expiry_date: expiry_date ? new Date(expiry_date) : null,
        document_url: document_url ?? null,
        is_active: true,
        access_restricted: false,
      },
    });
  });

  return success(record, 201);
});
