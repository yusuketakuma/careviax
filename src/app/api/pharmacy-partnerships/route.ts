import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { dateKeySchema } from '@/lib/validations/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';

const partnershipStatusSchema = z.enum(['draft', 'active', 'suspended', 'ended']);
const dateOnlySchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');

const createPharmacyPartnershipSchema = z
  .object({
    base_site_id: z.string().trim().min(1, '基準薬局店舗IDは必須です'),
    partner_pharmacy_id: z.string().trim().min(1, '協力薬局IDは必須です'),
    available_services: z.array(z.string().trim().min(1)).default([]),
    contact_snapshot: z.record(z.string(), z.unknown()).optional(),
    effective_from: dateOnlySchema.optional().nullable(),
    effective_to: dateOnlySchema.optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.effective_from && value.effective_to && value.effective_to < value.effective_from) {
      ctx.addIssue({
        code: 'custom',
        path: ['effective_to'],
        message: '終了日は開始日以降を指定してください',
      });
    }
  });

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const value = optionalSearchParam(searchParams.get(name));
  if (searchParams.has(name) && !value) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', { [name]: [message] }),
    };
  }
  return { ok: true as const, value };
}

function optionalDate(value: string | null | undefined) {
  return value ? utcDateFromLocalKey(value) : null;
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const rawStatusResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!rawStatusResult.ok) return rawStatusResult.response;
    const rawStatus = rawStatusResult.value;
    const status = rawStatus ? partnershipStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return validationError('検索条件が不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const baseSiteIdResult = readPresentOptionalSearchParam(
      searchParams,
      'base_site_id',
      '基準薬局店舗IDを指定してください',
    );
    if (!baseSiteIdResult.ok) return baseSiteIdResult.response;
    const partnerPharmacyIdResult = readPresentOptionalSearchParam(
      searchParams,
      'partner_pharmacy_id',
      '協力薬局IDを指定してください',
    );
    if (!partnerPharmacyIdResult.ok) return partnerPharmacyIdResult.response;
    const baseSiteId = baseSiteIdResult.value;
    const partnerPharmacyId = partnerPharmacyIdResult.value;

    const rows = await withOrgContext(ctx.orgId, (tx) =>
      tx.pharmacyPartnership.findMany({
        where: {
          org_id: ctx.orgId,
          ...(status ? { status: status.data } : {}),
          ...(baseSiteId ? { base_site_id: baseSiteId } : {}),
          ...(partnerPharmacyId ? { partner_pharmacy_id: partnerPharmacyId } : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        include: {
          base_site: { select: { id: true, name: true } },
          partner_pharmacy: { select: { id: true, name: true, status: true } },
        },
      }),
    );

    return success(buildCursorPage(rows, limit, (row) => row.id));
  },
  {
    permission: 'canVisit',
    message: '薬局間連携の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createPharmacyPartnershipSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const [baseSite, partnerPharmacy] = await Promise.all([
        tx.pharmacySite.findFirst({
          where: { id: parsed.data.base_site_id, org_id: ctx.orgId },
          select: { id: true },
        }),
        tx.partnerPharmacy.findFirst({
          where: { id: parsed.data.partner_pharmacy_id, org_id: ctx.orgId },
          select: { id: true, status: true },
        }),
      ]);

      if (!baseSite) return { response: notFound('基準薬局店舗が見つかりません') };
      if (!partnerPharmacy) return { response: notFound('協力薬局が見つかりません') };
      if (partnerPharmacy.status === 'archived') {
        return {
          response: validationError('入力値が不正です', {
            partner_pharmacy_id: ['アーカイブ済み協力薬局は連携先に指定できません'],
          }),
        };
      }

      const partnership = await tx.pharmacyPartnership.create({
        data: {
          org_id: ctx.orgId,
          base_site_id: parsed.data.base_site_id,
          partner_pharmacy_id: parsed.data.partner_pharmacy_id,
          status: 'draft',
          available_services: toPrismaJsonInput(parsed.data.available_services),
          contact_snapshot:
            parsed.data.contact_snapshot === undefined
              ? undefined
              : toPrismaJsonInput(parsed.data.contact_snapshot),
          effective_from: optionalDate(parsed.data.effective_from),
          effective_to: optionalDate(parsed.data.effective_to),
          created_by: ctx.userId,
          updated_by: ctx.userId,
        },
        include: {
          base_site: { select: { id: true, name: true } },
          partner_pharmacy: { select: { id: true, name: true, status: true } },
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'pharmacy_partnership_created',
        targetType: 'PharmacyPartnership',
        targetId: partnership.id,
        changes: {
          base_site_id: parsed.data.base_site_id,
          partner_pharmacy_id: parsed.data.partner_pharmacy_id,
          status: partnership.status,
          available_service_count: parsed.data.available_services.length,
          effective_from: parsed.data.effective_from ?? null,
          effective_to: parsed.data.effective_to ?? null,
        },
      });

      return { partnership };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result.partnership, 201);
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間連携の作成権限がありません',
  },
);
