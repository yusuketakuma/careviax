import { Prisma, type PharmacyCooperationMessageThread } from '@prisma/client';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parseBoundedInteger, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { toPrismaJsonInput } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { buildActivePatientShareCaseReadWhere } from '@/server/services/patient-share-access';
import { dispatchNotificationEvent } from '@/server/services/notifications';

const MAX_MESSAGE_BODY_LENGTH = 4000;
const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 100;
const COOPERATION_MESSAGE_EVENT_TYPE = 'pharmacy_cooperation_message_created';

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
}): Promise<{ context: MessageContext } | { response: NextResponse }> {
  const activeShareCaseWhere = buildActivePatientShareCaseReadWhere({
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
      const thread = await findExistingThread(args);
      if (thread?.status === 'open') return { thread };
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
    const shareCaseId = optionalSearchParam(searchParams.get('share_case_id'));
    const visitRequestId = optionalSearchParam(searchParams.get('visit_request_id'));
    const now = new Date();

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const resolved = await resolveMessageContext({
        tx,
        ctx,
        shareCaseId,
        visitRequestId,
        now,
      });
      if (hasResponse(resolved)) return resolved;

      const rows = await tx.pharmacyCooperationMessageThread.findMany({
        where: {
          org_id: ctx.orgId,
          share_case_id: resolved.context.shareCaseId,
          visit_request_id: resolved.context.visitRequestId,
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        include: {
          messages: {
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: messageLimit,
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
          },
        },
      });

      const page = buildCursorPage(rows, limit, (row) => row.id);
      const messageCount = page.data.reduce((sum, row) => sum + row.messages.length, 0);
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
          ...page,
          data: page.data,
        },
      };
    });

    if (hasResponse(result)) return withSensitiveNoStore(result.response);
    return withSensitiveNoStore(success(result.data));
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
    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const resolved = await resolveMessageContext({
        tx,
        ctx,
        shareCaseId: parsed.data.share_case_id,
        visitRequestId: parsed.data.visit_request_id,
        now,
      });
      if (hasResponse(resolved)) return resolved;

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
        include: {
          messages: {
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            take: DEFAULT_MESSAGE_LIMIT,
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
          },
        },
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
          thread,
          notification_count: notifications.length,
        },
      };
    });

    if (hasResponse(result)) return withSensitiveNoStore(result.response);
    return withSensitiveNoStore(success(result.data, 201));
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間連携メッセージの作成権限がありません',
  },
);
