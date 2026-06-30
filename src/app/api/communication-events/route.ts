import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { z } from 'zod';
import { learnContactProfileFromCommunication } from '@/lib/contact-profiles';
import { externalCommunicationChannelSchema } from '@/lib/validations/communication-channel';
import {
  buildCommunicationEventAssignmentWhere,
  canAccessCommunicationRequestRecord,
} from '@/server/services/communication-request-access';
import type { Prisma } from '@prisma/client';

const communicationEventAttachmentRefSchema = z.object({
  file_id: z.string().uuid('file_id の形式が不正です'),
});

const createCommunicationEventSchema = z.object({
  patient_id: z.string().optional(),
  case_id: z.string().optional(),
  event_type: z.string().min(1, 'イベントタイプは必須です'),
  channel: externalCommunicationChannelSchema,
  direction: z.enum(['outbound', 'inbound']),
  counterpart_name: z.string().optional(),
  counterpart_contact: z.string().optional(),
  subject: z.string().optional(),
  content: z.string().optional(),
  attachments: z
    .array(communicationEventAttachmentRefSchema)
    .max(10, '添付は10件までです')
    .optional(),
  occurred_at: z.string().datetime().optional(),
});

type CommunicationEventAttachmentRef = z.infer<typeof communicationEventAttachmentRefSchema>;

type CommunicationEventAttachmentSummary = {
  file_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_at: string | null;
  purpose: string;
};

type AttachmentValidationFailure = {
  ok: false;
  response: ReturnType<typeof validationError>;
};

type AttachmentValidationSuccess = {
  ok: true;
  attachments: CommunicationEventAttachmentSummary[];
};

const COMMUNICATION_ATTACHMENT_PURPOSES = new Set(['prescription', 'report', 'visit-photo']);

function readStrictOptionalCommunicationEventFilter(
  searchParams: URLSearchParams,
  name: 'patient_id' | 'event_type',
  messages: { blank: string; invalid: string },
) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [`${name} は1つだけ指定してください`] },
    };
  }

  const value = values[0];
  if (value.trim().length === 0) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.blank] },
    };
  }

  if (value !== value.trim() || value.length > 100) {
    return {
      ok: false as const,
      fieldErrors: { [name]: [messages.invalid] },
    };
  }

  return { ok: true as const, value };
}

function parseCommunicationEventListFilters(searchParams: URLSearchParams) {
  const patientResult = readStrictOptionalCommunicationEventFilter(searchParams, 'patient_id', {
    blank: '患者IDを指定してください',
    invalid: '患者IDの形式が不正です',
  });
  if (!patientResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', patientResult.fieldErrors),
      ),
    };
  }

  const eventTypeResult = readStrictOptionalCommunicationEventFilter(searchParams, 'event_type', {
    blank: 'イベントタイプを指定してください',
    invalid: 'イベントタイプの形式が不正です',
  });
  if (!eventTypeResult.ok) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(
        validationError('検索条件が不正です', eventTypeResult.fieldErrors),
      ),
    };
  }

  return {
    ok: true as const,
    patientId: patientResult.value,
    eventType: eventTypeResult.value,
  };
}

function uniqueAttachmentRefs(refs: CommunicationEventAttachmentRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.file_id)) return false;
    seen.add(ref.file_id);
    return true;
  });
}

function attachmentValidationError(message: string): AttachmentValidationFailure {
  return {
    ok: false,
    response: validationError(message, {
      attachments: [message],
    }),
  };
}

async function resolveCommunicationEventAttachments(args: {
  tx: Prisma.TransactionClient;
  orgId: string;
  patientId?: string | null;
  caseId?: string | null;
  refs: CommunicationEventAttachmentRef[];
}): Promise<AttachmentValidationFailure | AttachmentValidationSuccess> {
  const refs = uniqueAttachmentRefs(args.refs);
  if (refs.length === 0) return { ok: true, attachments: [] };

  let eventPatientId = args.patientId ?? null;
  if (args.caseId) {
    const careCase = await args.tx.careCase.findFirst({
      where: {
        id: args.caseId,
        org_id: args.orgId,
      },
      select: {
        patient_id: true,
      },
    });

    if (!careCase) {
      return attachmentValidationError('添付先のケースが見つかりません');
    }

    if (eventPatientId && eventPatientId !== careCase.patient_id) {
      return attachmentValidationError('添付先の患者とケースが一致しません');
    }
    eventPatientId = careCase.patient_id;
  }

  if (!eventPatientId) {
    return attachmentValidationError('添付には患者またはケースの指定が必要です');
  }

  const fileIds = refs.map((ref) => ref.file_id);
  const assets = await args.tx.fileAsset.findMany({
    where: {
      id: { in: fileIds },
      org_id: args.orgId,
    },
    select: {
      id: true,
      purpose: true,
      original_name: true,
      mime_type: true,
      size_bytes: true,
      status: true,
      patient_id: true,
      visit_record_id: true,
      report_id: true,
      completed_at: true,
    },
  });

  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  if (assets.length !== fileIds.length) {
    return attachmentValidationError('添付ファイルが見つかりません');
  }

  const reportIds = assets
    .map((asset) => asset.report_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const visitRecordIds = assets
    .map((asset) => asset.visit_record_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const [reports, visitRecords] = await Promise.all([
    reportIds.length === 0
      ? []
      : args.tx.careReport.findMany({
          where: {
            id: { in: reportIds },
            org_id: args.orgId,
          },
          select: {
            id: true,
            patient_id: true,
            case_id: true,
          },
        }),
    visitRecordIds.length === 0
      ? []
      : args.tx.visitRecord.findMany({
          where: {
            id: { in: visitRecordIds },
            org_id: args.orgId,
          },
          select: {
            id: true,
            patient_id: true,
            schedule: {
              select: {
                case_id: true,
              },
            },
          },
        }),
  ]);

  const reportById = new Map(reports.map((report) => [report.id, report]));
  const visitRecordById = new Map(visitRecords.map((record) => [record.id, record]));

  const summaries: CommunicationEventAttachmentSummary[] = [];
  for (const ref of refs) {
    const asset = assetById.get(ref.file_id);
    if (!asset || asset.status !== 'uploaded') {
      return attachmentValidationError('添付ファイルがアップロード完了していません');
    }

    if (!COMMUNICATION_ATTACHMENT_PURPOSES.has(asset.purpose)) {
      return attachmentValidationError('通信イベントに添付できないファイル種別です');
    }

    const directPatientMatches = asset.patient_id === eventPatientId;
    const report = asset.report_id ? reportById.get(asset.report_id) : null;
    const reportMatches =
      !!report &&
      report.patient_id === eventPatientId &&
      (!args.caseId || !report.case_id || report.case_id === args.caseId);
    const visitRecord = asset.visit_record_id ? visitRecordById.get(asset.visit_record_id) : null;
    const visitRecordMatches =
      !!visitRecord &&
      visitRecord.patient_id === eventPatientId &&
      (!args.caseId || visitRecord.schedule.case_id === args.caseId);

    if (!directPatientMatches && !reportMatches && !visitRecordMatches) {
      return attachmentValidationError('添付ファイルが患者またはケースに紐づいていません');
    }

    summaries.push({
      file_id: asset.id,
      file_name: asset.original_name,
      mime_type: asset.mime_type,
      size_bytes: asset.size_bytes,
      uploaded_at: asset.completed_at?.toISOString() ?? null,
      purpose: asset.purpose,
    });
  }

  return { ok: true, attachments: summaries };
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const filters = parseCommunicationEventListFilters(searchParams);
    if (!filters.ok) return filters.response;

    const { patientId, eventType } = filters;

    const assignmentWhere = await buildCommunicationEventAssignmentWhere({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });

    const where: Prisma.CommunicationEventWhereInput = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(eventType ? { event_type: eventType } : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };

    const events = await prisma.communicationEvent.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        event_type: true,
        channel: true,
        direction: true,
        counterpart_name: true,
        counterpart_contact: true,
        subject: true,
        content: true,
        attachments: true,
        occurred_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    return withSensitiveNoStore(success(buildCursorPage(events, limit, (event) => event.id)));
  },
  {
    permission: 'canReport',
    message: '連携イベントの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCommunicationEventSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { attachments, occurred_at, ...rest } = parsed.data;

    const eventResult = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        if (
          !(await canAccessCommunicationRequestRecord({
            db: tx,
            orgId: ctx.orgId,
            patientId: rest.patient_id,
            caseId: rest.case_id,
            accessContext: ctx,
          }))
        ) {
          return {
            ok: false as const,
            response: validationError('患者またはケースの割当権限がありません'),
          };
        }

        const attachmentResult = await resolveCommunicationEventAttachments({
          tx,
          orgId: ctx.orgId,
          patientId: rest.patient_id,
          caseId: rest.case_id,
          refs: attachments ?? [],
        });
        if (!attachmentResult.ok) {
          return { ok: false as const, response: attachmentResult.response };
        }

        const created = await tx.communicationEvent.create({
          data: {
            org_id: ctx.orgId,
            ...(occurred_at ? { occurred_at: new Date(occurred_at) } : {}),
            ...(attachments ? { attachments: attachmentResult.attachments } : {}),
            ...rest,
          },
        });

        await learnContactProfileFromCommunication(tx, {
          orgId: ctx.orgId,
          counterpartName: created.counterpart_name,
          counterpartContact: created.counterpart_contact,
          channel: created.channel,
          occurredAt: created.occurred_at,
          markSuccess: created.direction === 'outbound',
        });

        return { ok: true as const, event: created };
      },
      { requestContext: ctx },
    );

    if (!eventResult.ok) return eventResult.response;

    return success({ data: eventResult.event }, 201);
  },
  {
    permission: 'canReport',
    message: '連携イベントの作成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
