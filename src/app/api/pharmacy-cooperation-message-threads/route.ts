import {
  Prisma,
  type PharmacyCooperationMessage,
  type PharmacyCooperationMessageThread,
} from '@prisma/client';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parseBoundedInteger, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { withOrgContext } from '@/lib/db/rls';
import {
  buildActivePatientShareCaseMutationWhere,
  buildActivePatientShareCaseReadWhere,
  buildPatientShareCaseConsentLockKey,
  PATIENT_SHARE_CASE_CONSENT_LOCK_NAMESPACE,
} from '@/server/services/patient-share-access';
import { dispatchNotificationEvent } from '@/server/services/notifications';

const MAX_MESSAGE_BODY_LENGTH = 4000;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const COOPERATION_MESSAGE_EVENT_TYPE = 'pharmacy_cooperation_message_created';
const viewContextSchema = z
  .enum(['pharmacy_cooperation_workflow', 'pharmacy_cooperation_message_threads_api'])
  .default('pharmacy_cooperation_message_threads_api');

const messageSelect = {
  id: true,
  org_id: true,
  thread_id: true,
  sender_user_id: true,
  sender_side: true,
  body: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.PharmacyCooperationMessageSelect;

type MessageThreadWithMessages = PharmacyCooperationMessageThread & {
  messages: Array<Pick<PharmacyCooperationMessage, keyof typeof messageSelect>>;
  _count: { messages: number };
};

const createMessageSchema = z
  .object({
    share_case_id: z.string().trim().min(1, '患者共有ケースIDは必須です'),
    visit_request_id: z.string().trim().min(1, '訪問依頼IDが不正です').optional(),
    body: z
      .string()
      .trim()
      .min(1, 'メッセージ本文は必須です')
      .max(MAX_MESSAGE_BODY_LENGTH, `メッセージ本文は${MAX_MESSAGE_BODY_LENGTH}文字以内です`),
  })
  .strict();

type MessageContext = {
  shareCaseId: string;
  visitRequestId: string | null;
  contextType: 'patient_share_case' | 'visit_request';
  patientId: string;
  requestedBy: string | null;
};

type ResponseResult = { response: NextResponse };

function hasResponse(result: unknown): result is ResponseResult {
  return typeof result === 'object' && result !== null && 'response' in result;
}

function jsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return toPrismaJsonInput(value) as Prisma.InputJsonValue;
}

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
      response: withSensitiveNoStore(validationError('検索条件が不正です', { [name]: [message] })),
    };
  }
  return { ok: true as const, value };
}

function buildMessageThreadInclude(messageLimit: number) {
  return {
    messages: {
      orderBy: [{ created_at: 'desc' as const }, { id: 'desc' as const }],
      take: messageLimit,
      select: messageSelect,
    },
    _count: { select: { messages: true } },
  } satisfies Prisma.PharmacyCooperationMessageThreadInclude;
}

function toMessageThreadResponse(row: MessageThreadWithMessages) {
  const { _count, messages, ...thread } = row;
  return {
    ...thread,
    messages: [...messages].reverse(),
    message_returned_count: messages.length,
    message_total_count: _count.messages,
    message_scope_complete: messages.length === _count.messages,
  };
}

function buildMessageLink(context: MessageContext) {
  const params = new URLSearchParams({ share_case_id: context.shareCaseId });
  if (context.visitRequestId) params.set('visit_request_id', context.visitRequestId);
  return `/workflow/pharmacy-cooperation?${params.toString()}`;
}

async function resolveMessageContext(args: {
  tx: Prisma.TransactionClient;
  ctx: AuthContext;
  shareCaseId?: string;
  visitRequestId?: string;
  now: Date;
  accessMode?: 'read' | 'mutation';
}): Promise<{ context: MessageContext } | { response: NextResponse }> {
  const activeShareCaseWhere =
    args.accessMode === 'mutation'
      ? buildActivePatientShareCaseMutationWhere({
          orgId: args.ctx.orgId,
          asOf: args.now,
        })
      : buildActivePatientShareCaseReadWhere({
          orgId: args.ctx.orgId,
          asOf: args.now,
        });

  if (args.visitRequestId) {
    const visitRequest = await args.tx.pharmacyVisitRequest.findFirst({
      where: {
        id: args.visitRequestId,
        org_id: args.ctx.orgId,
        ...(args.shareCaseId ? { share_case_id: args.shareCaseId } : {}),
        share_case: { is: activeShareCaseWhere },
      },
      select: {
        id: true,
        share_case_id: true,
        requested_by: true,
        share_case: {
          select: {
            id: true,
            base_patient_id: true,
          },
        },
      },
    });

    if (!visitRequest) {
      return {
        response: notFound('訪問依頼または患者共有ケースが見つかりません'),
      };
    }

    return {
      context: {
        shareCaseId: visitRequest.share_case_id,
        visitRequestId: visitRequest.id,
        contextType: 'visit_request',
        patientId: visitRequest.share_case.base_patient_id,
        requestedBy: visitRequest.requested_by,
      },
    };
  }

  if (!args.shareCaseId) {
    return {
      response: validationError('患者共有ケースIDまたは訪問依頼IDが必要です'),
    };
  }

  const shareCase = await args.tx.patientShareCase.findFirst({
    where: {
      id: args.shareCaseId,
      ...activeShareCaseWhere,
    },
    select: {
      id: true,
      base_patient_id: true,
    },
  });

  if (!shareCase) {
    return {
      response: notFound('患者共有ケースが見つかりません'),
    };
  }

  return {
    context: {
      shareCaseId: shareCase.id,
      visitRequestId: null,
      contextType: 'patient_share_case',
      patientId: shareCase.base_patient_id,
      requestedBy: null,
    },
  };
}

async function findExistingThread(args: {
  tx: Prisma.TransactionClient;
  orgId: string;
  context: MessageContext;
}) {
  return args.tx.pharmacyCooperationMessageThread.findFirst({
    where: {
      org_id: args.orgId,
      share_case_id: args.context.shareCaseId,
      visit_request_id: args.context.visitRequestId,
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
  });
}

async function getOrCreateOpenThread(args: {
  tx: Prisma.TransactionClient;
  orgId: string;
  userId: string;
  context: MessageContext;
}): Promise<{ thread: PharmacyCooperationMessageThread } | ResponseResult> {
  const existing = await findExistingThread(args);
  if (existing) {
    if (existing.status !== 'open') {
      return { response: conflict('このメッセージスレッドは終了しています') };
    }
    return { thread: existing };
  }

  try {
    const thread = await args.tx.pharmacyCooperationMessageThread.create({
      data: {
        org_id: args.orgId,
        share_case_id: args.context.shareCaseId,
        visit_request_id: args.context.visitRequestId,
        context_type: args.context.contextType,
        status: 'open',
        created_by: args.userId,
      },
    });
    return { thread };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        response: conflict('メッセージスレッドが同時に作成されました。再読み込みしてください'),
      };
    }
    throw error;
  }
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const messageLimit = parseBoundedInteger(
      searchParams.get('message_limit'),
      DEFAULT_MESSAGE_LIMIT,
      1,
      MAX_MESSAGE_LIMIT,
    );
    const shareCaseIdResult = readPresentOptionalSearchParam(
      searchParams,
      'share_case_id',
      '患者共有ケースIDを指定してください',
    );
    if (!shareCaseIdResult.ok) return shareCaseIdResult.response;
    const visitRequestIdResult = readPresentOptionalSearchParam(
      searchParams,
      'visit_request_id',
      '訪問依頼IDを指定してください',
    );
    if (!visitRequestIdResult.ok) return visitRequestIdResult.response;
    const rawViewContextResult = readPresentOptionalSearchParam(
      searchParams,
      'view_context',
      '閲覧画面を指定してください',
    );
    if (!rawViewContextResult.ok) return rawViewContextResult.response;
    const shareCaseId = shareCaseIdResult.value;
    const visitRequestId = visitRequestIdResult.value;
    const viewContext = viewContextSchema.safeParse(rawViewContextResult.value ?? undefined);
    if (!viewContext.success) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', {
          view_context: ['対応していない閲覧画面です'],
        }),
      );
    }
    const shouldExposeWorkflowMeta = viewContext.data === 'pharmacy_cooperation_workflow';
    const now = new Date();

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const resolved = await resolveMessageContext({
          tx,
          ctx,
          shareCaseId,
          visitRequestId,
          now,
        });
        if (hasResponse(resolved)) return resolved;

        const threadWhere = {
          org_id: ctx.orgId,
          share_case_id: resolved.context.shareCaseId,
          visit_request_id: resolved.context.visitRequestId,
        } satisfies Prisma.PharmacyCooperationMessageThreadWhereInput;
        const rows = await tx.pharmacyCooperationMessageThread.findMany({
          where: threadWhere,
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
          include: buildMessageThreadInclude(messageLimit),
        });

        const page = buildCursorPage(rows, limit, (row) => row.id);
        const totalCount = shouldExposeWorkflowMeta
          ? await tx.pharmacyCooperationMessageThread.count({ where: threadWhere })
          : null;
        const responseRows = page.data.map(toMessageThreadResponse);
        const messageCount = responseRows.reduce((sum, row) => sum + row.message_returned_count, 0);
        await createAuditLogEntry(tx, ctx, {
          action: 'pharmacy_cooperation_messages_viewed',
          targetType: 'PharmacyCooperationMessageThread',
          targetId:
            page.data[0]?.id ?? resolved.context.visitRequestId ?? resolved.context.shareCaseId,
          patientId: resolved.context.patientId,
          changes: jsonInput({
            share_case_id: resolved.context.shareCaseId,
            visit_request_id: resolved.context.visitRequestId,
            context_type: resolved.context.contextType,
            thread_count: page.data.length,
            message_count: messageCount,
          }),
        });

        return {
          data: {
            data: responseRows,
            meta: {
              has_more: page.hasMore,
              next_cursor: page.nextCursor ?? null,
              ...(totalCount !== null
                ? {
                    returned_count: responseRows.length,
                    total_count: totalCount,
                    count_basis: 'filtered_query_exact' as const,
                    filters_applied: {
                      share_case_id: resolved.context.shareCaseId,
                      visit_request_id: resolved.context.visitRequestId,
                    },
                    request_cursor: cursor ?? null,
                  }
                : {}),
            },
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    if (hasResponse(result)) return withSensitiveNoStore(result.response);
    return withSensitiveNoStore(
      success({
        data: result.data.data,
        meta: result.data.meta,
      }),
    );
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間連携メッセージの閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = createMessageSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const now = new Date();
    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const initialResolved = await resolveMessageContext({
          tx,
          ctx,
          shareCaseId: parsed.data.share_case_id,
          visitRequestId: parsed.data.visit_request_id,
          now,
          accessMode: 'mutation',
        });
        if (hasResponse(initialResolved)) return initialResolved;

        await acquireAdvisoryTxLock(
          tx,
          PATIENT_SHARE_CASE_CONSENT_LOCK_NAMESPACE,
          buildPatientShareCaseConsentLockKey({
            orgId: ctx.orgId,
            shareCaseId: initialResolved.context.shareCaseId,
          }),
        );

        const resolved = await resolveMessageContext({
          tx,
          ctx,
          shareCaseId: parsed.data.share_case_id,
          visitRequestId: parsed.data.visit_request_id,
          now,
          accessMode: 'mutation',
        });
        if (hasResponse(resolved)) {
          return { response: conflict('患者共有の同意状態が更新されています') };
        }

        const threadResult = await getOrCreateOpenThread({
          tx,
          orgId: ctx.orgId,
          userId: ctx.userId,
          context: resolved.context,
        });
        if (hasResponse(threadResult)) return threadResult;

        const message = await tx.pharmacyCooperationMessage.create({
          data: {
            org_id: ctx.orgId,
            thread_id: threadResult.thread.id,
            sender_user_id: ctx.userId,
            sender_side: 'base_pharmacy',
            body: parsed.data.body,
          },
          select: {
            id: true,
            org_id: true,
            thread_id: true,
            sender_user_id: true,
            sender_side: true,
            body: true,
            created_at: true,
            updated_at: true,
          },
        });

        const thread = await tx.pharmacyCooperationMessageThread.update({
          where: { id_org_id: { id: threadResult.thread.id, org_id: ctx.orgId } },
          data: { last_message_at: message.created_at },
          include: buildMessageThreadInclude(DEFAULT_MESSAGE_LIMIT),
        });

        await createAuditLogEntry(tx, ctx, {
          action: COOPERATION_MESSAGE_EVENT_TYPE,
          targetType: 'PharmacyCooperationMessage',
          targetId: message.id,
          patientId: resolved.context.patientId,
          changes: jsonInput({
            thread_id: thread.id,
            share_case_id: resolved.context.shareCaseId,
            visit_request_id: resolved.context.visitRequestId,
            context_type: resolved.context.contextType,
            sender_side: message.sender_side,
            body_length: parsed.data.body.length,
          }),
        });

        const explicitUserIds =
          resolved.context.requestedBy && resolved.context.requestedBy !== ctx.userId
            ? [resolved.context.requestedBy]
            : undefined;
        const notifications = await dispatchNotificationEvent(tx, {
          orgId: ctx.orgId,
          eventType: COOPERATION_MESSAGE_EVENT_TYPE,
          type: 'business',
          title: '薬局間連携メッセージ',
          message: 'アプリで詳細を確認してください',
          link: buildMessageLink(resolved.context),
          explicitUserIds,
          metadata: jsonInput({
            thread_id: thread.id,
            message_id: message.id,
            share_case_id: resolved.context.shareCaseId,
            visit_request_id: resolved.context.visitRequestId,
            context_type: resolved.context.contextType,
          }),
          dedupeKey: `${COOPERATION_MESSAGE_EVENT_TYPE}:${message.id}`,
        });

        return {
          data: {
            thread: toMessageThreadResponse(thread),
            notification_count: notifications.length,
          },
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (hasResponse(result)) return withSensitiveNoStore(result.response);
    return withSensitiveNoStore(success({ data: result.data }, 201));
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間連携メッセージの作成権限がありません',
  },
);
