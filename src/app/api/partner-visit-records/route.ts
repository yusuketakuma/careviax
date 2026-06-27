import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { buildActivePatientShareCaseReadWhere } from '@/server/services/patient-share-access';
import { canEditPharmacyOwnedData } from '@/server/services/pharmacy-partnerships';

const partnerVisitRecordStatusSchema = z.enum([
  'draft',
  'submitted',
  'confirmed',
  'returned',
  'superseded',
]);

const recordContentSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length > 0, {
    message: '訪問記録の内容は必須です',
  });

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional();

const savePartnerVisitRecordSchema = z.object({
  visit_request_id: z.string().trim().min(1, '訪問依頼IDは必須です'),
  pharmacist_id: optionalTrimmedString(128),
  pharmacist_name: optionalTrimmedString(120),
  visit_at: z
    .string()
    .datetime('訪問日時の形式が不正です')
    .transform((value) => new Date(value)),
  record_content: recordContentSchema,
  attachments: z.unknown().optional(),
  source_visit_record_id: optionalTrimmedString(128),
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

function optionalJson(value: unknown) {
  return value === undefined ? undefined : toPrismaJsonInput(value);
}

function attachmentCount(value: unknown) {
  return Array.isArray(value) ? value.length : value === undefined || value === null ? 0 : 1;
}

function toSafePartnerVisitRecord<T extends object>(row: T) {
  const source = row as T & {
    record_content?: unknown;
    attachments?: unknown;
    returned_reason?: unknown;
    base_confirmation_snapshot?: unknown;
  };
  const {
    record_content: recordContent,
    attachments,
    returned_reason: returnedReason,
    base_confirmation_snapshot: baseConfirmationSnapshot,
    ...safe
  } = source;

  return {
    ...safe,
    has_record_content: recordContent !== undefined && recordContent !== null,
    attachment_count: attachmentCount(attachments),
    has_returned_reason: returnedReason !== undefined && returnedReason !== null,
    has_base_confirmation_snapshot:
      baseConfirmationSnapshot !== undefined && baseConfirmationSnapshot !== null,
  };
}

const authenticatedGET = withAuthContext(
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
    const status = rawStatus ? partnerVisitRecordStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return validationError('検索条件が不正です', {
        status: ['対応していないステータスです'],
      });
    }

    const visitRequestIdResult = readPresentOptionalSearchParam(
      searchParams,
      'visit_request_id',
      '訪問依頼IDを指定してください',
    );
    if (!visitRequestIdResult.ok) return visitRequestIdResult.response;
    const shareCaseIdResult = readPresentOptionalSearchParam(
      searchParams,
      'share_case_id',
      '患者共有ケースIDを指定してください',
    );
    if (!shareCaseIdResult.ok) return shareCaseIdResult.response;
    const visitRequestId = visitRequestIdResult.value;
    const shareCaseId = shareCaseIdResult.value;
    const now = new Date();

    const rows = await withOrgContext(ctx.orgId, (tx) =>
      tx.partnerVisitRecord.findMany({
        where: {
          org_id: ctx.orgId,
          ...(status ? { status: status.data } : {}),
          ...(visitRequestId ? { visit_request_id: visitRequestId } : {}),
          ...(shareCaseId ? { share_case_id: shareCaseId } : {}),
          share_case: { is: buildActivePatientShareCaseReadWhere({ orgId: ctx.orgId, asOf: now }) },
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          org_id: true,
          visit_request_id: true,
          share_case_id: true,
          owner_partner_pharmacy_id: true,
          source_visit_record_id: true,
          revision_no: true,
          status: true,
          pharmacist_id: true,
          pharmacist_name: true,
          visit_at: true,
          submitted_at: true,
          confirmed_at: true,
          confirmed_by: true,
          returned_at: true,
          returned_by: true,
          created_at: true,
          updated_at: true,
          owner_partner_pharmacy: { select: { id: true, name: true, status: true } },
          visit_request: { select: { id: true, status: true, urgency: true } },
          claim_note: {
            select: {
              id: true,
              claim_status: true,
              visit_date: true,
              partner_pharmacy_name: true,
              prescription_received_by: true,
              dispensing_pharmacy_name: true,
            },
          },
        },
      }),
    );

    const page = buildCursorPage(rows, limit, (row) => row.id);
    return success({
      ...page,
      data: page.data.map(toSafePartnerVisitRecord),
    });
  },
  {
    permission: 'canManagePatientSharing',
    message: '協力訪問記録の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (error) {
    unstable_rethrow(error);
    return withSensitiveNoStore(internalError());
  }
};

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = savePartnerVisitRecordSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const visitRequest = await tx.pharmacyVisitRequest.findFirst({
        where: { id: parsed.data.visit_request_id, org_id: ctx.orgId },
        select: {
          id: true,
          status: true,
          share_case_id: true,
          partner_pharmacy_id: true,
          share_case: {
            select: {
              status: true,
              base_patient_id: true,
            },
          },
          partnership: {
            select: {
              status: true,
              partner_pharmacy: { select: { status: true } },
            },
          },
        },
      });

      if (!visitRequest) return { response: notFound('訪問依頼が見つかりません') };
      if (visitRequest.share_case.status !== 'active') {
        return { response: conflict('共有中の患者共有ケースに紐づく訪問依頼のみ記録できます') };
      }
      if (
        visitRequest.partnership.status !== 'active' ||
        visitRequest.partnership.partner_pharmacy.status !== 'active'
      ) {
        return { response: conflict('有効な薬局間連携と協力薬局に紐づく訪問依頼のみ記録できます') };
      }
      if (
        visitRequest.status !== 'accepted' &&
        visitRequest.status !== 'recording' &&
        visitRequest.status !== 'returned'
      ) {
        return { response: conflict('受諾済みの訪問依頼にのみ訪問記録を保存できます') };
      }

      if (parsed.data.source_visit_record_id) {
        const sourceVisitRecord = await tx.visitRecord.findFirst({
          where: {
            id: parsed.data.source_visit_record_id,
            org_id: ctx.orgId,
            patient_id: visitRequest.share_case.base_patient_id,
          },
          select: { id: true },
        });
        if (!sourceVisitRecord) {
          return {
            response: validationError('入力値が不正です', {
              source_visit_record_id: ['元訪問記録が患者共有ケースの患者に紐づいていません'],
            }),
          };
        }
      }

      const latestRecord = await tx.partnerVisitRecord.findFirst({
        where: { org_id: ctx.orgId, visit_request_id: visitRequest.id },
        orderBy: { revision_no: 'desc' },
        select: {
          id: true,
          status: true,
          revision_no: true,
          owner_partner_pharmacy_id: true,
        },
      });

      if (
        latestRecord &&
        !canEditPharmacyOwnedData({
          actorOwner: 'partner_pharmacy',
          targetOwner: 'partner_pharmacy',
          recordStatus: latestRecord.status,
        })
      ) {
        return { response: conflict('提出済みまたは確認済みの訪問記録は通常保存できません') };
      }

      const recordData = {
        pharmacist_id: parsed.data.pharmacist_id,
        pharmacist_name: parsed.data.pharmacist_name,
        visit_at: parsed.data.visit_at,
        record_content: toPrismaJsonInput(parsed.data.record_content),
        attachments: optionalJson(parsed.data.attachments),
        source_visit_record_id: parsed.data.source_visit_record_id,
      };

      const isCreate = !latestRecord;
      const partnerVisitRecord = latestRecord
        ? await (async () => {
            const updatedCount = await tx.partnerVisitRecord.updateMany({
              where: {
                id: latestRecord.id,
                org_id: ctx.orgId,
                status: { in: ['draft', 'returned'] },
              },
              data: {
                ...recordData,
                status: 'draft',
                returned_at: null,
                returned_by: null,
                returned_reason: null,
              },
            });
            if (updatedCount.count !== 1) {
              return null;
            }
            return tx.partnerVisitRecord.findUniqueOrThrow({
              where: { id_org_id: { id: latestRecord.id, org_id: ctx.orgId } },
              include: {
                owner_partner_pharmacy: { select: { id: true, name: true, status: true } },
                visit_request: { select: { id: true, status: true, urgency: true } },
                claim_note: true,
              },
            });
          })()
        : await tx.partnerVisitRecord.create({
            data: {
              org_id: ctx.orgId,
              visit_request_id: visitRequest.id,
              share_case_id: visitRequest.share_case_id,
              owner_partner_pharmacy_id: visitRequest.partner_pharmacy_id,
              revision_no: 1,
              status: 'draft',
              ...recordData,
            },
            include: {
              owner_partner_pharmacy: { select: { id: true, name: true, status: true } },
              visit_request: { select: { id: true, status: true, urgency: true } },
              claim_note: true,
            },
          });

      if (!partnerVisitRecord) {
        return { response: conflict('訪問記録はすでに更新されています') };
      }

      const nextVisitRequestStatus =
        visitRequest.status === 'accepted' || visitRequest.status === 'returned'
          ? 'recording'
          : visitRequest.status;
      if (nextVisitRequestStatus !== visitRequest.status) {
        await tx.pharmacyVisitRequest.updateMany({
          where: {
            id: visitRequest.id,
            org_id: ctx.orgId,
            status: { in: ['accepted', 'returned'] },
          },
          data: { status: nextVisitRequestStatus },
        });
      }

      await createAuditLogEntry(tx, ctx, {
        action: latestRecord
          ? 'partner_visit_record_draft_updated'
          : 'partner_visit_record_created',
        targetType: 'PartnerVisitRecord',
        targetId: partnerVisitRecord.id,
        changes: {
          visit_request_id: visitRequest.id,
          share_case_id: visitRequest.share_case_id,
          partner_pharmacy_id: visitRequest.partner_pharmacy_id,
          revision_no: partnerVisitRecord.revision_no,
          previous_status: latestRecord?.status ?? null,
          status: partnerVisitRecord.status,
          visit_request_status_before: visitRequest.status,
          visit_request_status_after: nextVisitRequestStatus,
          visit_at: partnerVisitRecord.visit_at.toISOString(),
          record_content_keys: Object.keys(parsed.data.record_content).sort(),
          attachment_count: attachmentCount(parsed.data.attachments),
          has_source_visit_record: Boolean(parsed.data.source_visit_record_id),
        },
      });

      return { partnerVisitRecord: toSafePartnerVisitRecord(partnerVisitRecord), isCreate };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success(result.partnerVisitRecord, result.isCreate ? 201 : 200);
  },
  {
    permission: 'canManagePatientSharing',
    message: '協力訪問記録の保存権限がありません',
  },
);
