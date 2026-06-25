import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';

const optionalTrimmedString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : undefined))
  .optional();

const partnerPharmacyStatusSchema = z.enum(['active', 'inactive', 'archived']);

const createPartnerPharmacySchema = z.object({
  pharmacy_code: optionalTrimmedString,
  name: z.string().trim().min(1, '薬局名は必須です'),
  address: optionalTrimmedString,
  tel: optionalTrimmedString,
  fax: optionalTrimmedString,
  emergency_tel: optionalTrimmedString,
  on_call_tel: optionalTrimmedString,
  contact_name: optionalTrimmedString,
  contact_channels: z.unknown().optional(),
  available_services: z.array(z.string().trim().min(1)).default([]),
  service_hours: z.unknown().optional(),
  status: partnerPharmacyStatusSchema.default('active'),
});

function optionalJson(value: unknown) {
  return value === undefined ? undefined : toPrismaJsonInput(value);
}

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const q = optionalSearchParam(searchParams.get('q'));
    const rawStatusParam = searchParams.get('status');
    const rawStatus = optionalSearchParam(rawStatusParam);
    if (searchParams.has('status') && !rawStatus) {
      return validationError('検索条件が不正です', {
        status: ['ステータスを指定してください'],
      });
    }
    const status = rawStatus ? partnerPharmacyStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return validationError('検索条件が不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const rows = await withOrgContext(ctx.orgId, (tx) =>
      tx.partnerPharmacy.findMany({
        where: {
          org_id: ctx.orgId,
          ...(status ? { status: status.data } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q } },
                  { pharmacy_code: { contains: q } },
                  { address: { contains: q } },
                ],
              }
            : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      }),
    );

    return success(buildCursorPage(rows, limit, (row) => row.id));
  },
  {
    permission: 'canVisit',
    message: '協力薬局マスタの閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPartnerPharmacySchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { available_services, contact_channels, service_hours, ...rest } = parsed.data;
    const partnerPharmacy = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await tx.partnerPharmacy.create({
        data: {
          org_id: ctx.orgId,
          ...rest,
          available_services: toPrismaJsonInput(available_services),
          contact_channels: optionalJson(contact_channels),
          service_hours: optionalJson(service_hours),
          created_by: ctx.userId,
          updated_by: ctx.userId,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'partner_pharmacy_created',
        targetType: 'PartnerPharmacy',
        targetId: created.id,
        changes: {
          status: created.status,
          pharmacy_code: created.pharmacy_code ?? null,
          available_service_count: available_services.length,
        },
      });

      return created;
    });

    return success(partnerPharmacy, 201);
  },
  {
    permission: 'canManagePatientSharing',
    message: '協力薬局マスタの作成権限がありません',
  },
);
