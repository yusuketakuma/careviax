import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const externalProfessionalSchema = z.object({
  profession_type: z.enum([
    'physician',
    'nurse',
    'care_manager',
    'medical_social_worker',
    'physical_therapist',
    'occupational_therapist',
    'speech_therapist',
    'registered_dietitian',
    'dentist',
    'dental_hygienist',
    'home_helper',
    'care_staff',
    'other',
  ]),
  name: z.string().trim().min(1, '氏名は必須です'),
  organization_name: z.string().trim().optional(),
  department: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().email('メール形式が不正です').optional().or(z.literal('')),
  fax: z.string().trim().optional(),
  address: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

function toResponse(item: {
  id: string;
  profession_type: string;
  name: string;
  organization_name: string | null;
  department: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  address: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}) {
  return {
    ...item,
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const query = req.nextUrl.searchParams.get('q')?.trim();

  const items = await prisma.externalProfessional.findMany({
    where: {
      org_id: req.orgId,
      ...(query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { organization_name: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ profession_type: 'asc' }, { name: 'asc' }],
  });

  return success({ data: items.map(toResponse) });
}, {
  permission: 'canReport',
  message: '他職種マスターの閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = externalProfessionalSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const created = await withOrgContext(req.orgId, async (tx) =>
    tx.externalProfessional.create({
      data: {
        org_id: req.orgId,
        profession_type: parsed.data.profession_type,
        name: parsed.data.name,
        organization_name: parsed.data.organization_name || null,
        department: parsed.data.department || null,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        fax: parsed.data.fax || null,
        address: parsed.data.address || null,
        notes: parsed.data.notes || null,
      },
    }),
  );

  return success({ data: toResponse(created) }, 201);
}, {
  permission: 'canAdmin',
  message: '他職種マスターの更新権限がありません',
});
