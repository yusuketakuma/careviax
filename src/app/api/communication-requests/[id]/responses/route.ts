import { NextRequest } from 'next/server';
import { unstable_rethrow } from 'next/navigation';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import {
  success,
  validationError,
  notFound,
  conflict,
  forbidden,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { z } from 'zod';
import {
  canAccessCareReportCommunication,
  canAccessCommunicationRequestRecord,
  isCareReportCommunicationRequest,
  requireWritableCommunicationRequestPatient,
} from '@/server/services/communication-request-access';
import {
  communicationResponseContentSchema,
  requiredTrimmedStringSchema,
  trimStringOrUndefined,
} from '@/lib/validations/communication-request';
import { buildCommunicationResponseContentDigest } from '@/lib/communication-response-idempotency';
import {
  findCommunicationResponseByIntent,
  upsertCommunicationResponseByIntent,
} from '@/server/services/communication-response-upsert';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/communication-requests/[id]/responses';

type RouteContext = { params: Promise<{ id: string }> };

const createResponseSchema = z.object({
  expected_updated_at: z.string().datetime('版情報が不正です'),
  responder_name: requiredTrimmedStringSchema('回答者名は必須です'),
  content: communicationResponseContentSchema,
  responded_at: z.preprocess(trimStringOrUndefined, z.string().datetime('日付形式が不正です')),
});

async function authenticatedGET(req: NextRequest, { params }: RouteContext) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '連携依頼の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('連携依頼IDが不正です');

    const request = await prisma.communicationRequest.findFirst({
      where: { id, org_id: ctx.orgId },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        related_entity_type: true,
        updated_at: true,
      },
    });
    if (!request) return notFound('依頼が見つかりません');
    if (
      !(await canAccessCommunicationRequestRecord({
        db: prisma,
        orgId: ctx.orgId,
        patientId: request.patient_id,
        caseId: request.case_id,
        accessContext: ctx,
      }))
    ) {
      return notFound('依頼が見つかりません');
    }
    if (
      isCareReportCommunicationRequest(request.related_entity_type) &&
      !canAccessCareReportCommunication(ctx.role)
    ) {
      return forbidden('報告書共有の閲覧権限がありません');
    }

    const responses = await prisma.communicationResponse.findMany({
      where: { request_id: id, org_id: ctx.orgId },
      orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
    });

    return success({ data: responses, request_updated_at: request.updated_at.toISOString() });
  });
}

export async function GET(req: NextRequest, routeContext: RouteContext) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'communication_request_responses_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedPOST(req: NextRequest, { params }: RouteContext) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '連携依頼の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('連携依頼IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createResponseSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existingRequest = await prisma.communicationRequest.findFirst({
      where: { id, org_id: ctx.orgId },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        status: true,
        updated_at: true,
        related_entity_type: true,
      },
    });
    if (!existingRequest) return notFound('依頼が見つかりません');
    if (
      !(await canAccessCommunicationRequestRecord({
        db: prisma,
        orgId: ctx.orgId,
        patientId: existingRequest.patient_id,
        caseId: existingRequest.case_id,
        accessContext: ctx,
      }))
    ) {
      return notFound('依頼が見つかりません');
    }
    if (
      isCareReportCommunicationRequest(existingRequest.related_entity_type) &&
      !canAccessCareReportCommunication(ctx.role)
    ) {
      return forbidden('報告書共有の更新権限がありません');
    }
    if (['closed', 'cancelled', 'expired'].includes(existingRequest.status)) {
      return validationError('完了・取消・期限切れの依頼には返信を追加できません');
    }
    const expectedUpdatedAt = new Date(parsed.data.expected_updated_at);
    const respondedAt = new Date(parsed.data.responded_at);
    if (existingRequest.updated_at.getTime() !== expectedUpdatedAt.getTime()) {
      const existingResponse = await findCommunicationResponseByIntent({
        db: prisma,
        orgId: ctx.orgId,
        requestId: id,
        responderName: parsed.data.responder_name,
        content: parsed.data.content,
        respondedAt,
      });
      if (existingResponse.response) {
        return success({
          data: existingResponse.response,
          request_updated_at: existingRequest.updated_at.toISOString(),
        });
      }
      return conflict('連携依頼が同時に更新されました。再読み込みしてください');
    }

    const writable = await requireWritableCommunicationRequestPatient({
      db: prisma,
      ctx,
      scope: existingRequest,
    });
    if (writable && 'response' in writable) return writable.response;

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        let responseResult: Awaited<ReturnType<typeof upsertCommunicationResponseByIntent>> | null =
          null;
        if (existingRequest.status !== 'responded') {
          const claim = await tx.communicationRequest.updateMany({
            where: {
              id,
              org_id: ctx.orgId,
              status: existingRequest.status,
              updated_at: expectedUpdatedAt,
            },
            data: { status: 'responded' },
          });
          if (claim.count !== 1) {
            return { error: 'state_changed' as const };
          }
        } else {
          const existingResponse = await findCommunicationResponseByIntent({
            db: tx,
            orgId: ctx.orgId,
            requestId: id,
            responderName: parsed.data.responder_name,
            content: parsed.data.content,
            respondedAt,
          });
          if (existingResponse.response) {
            responseResult = {
              response: existingResponse.response,
              created: false,
              responseIntentKey: existingResponse.responseIntentKey,
            };
          } else {
            const claim = await tx.communicationRequest.updateMany({
              where: {
                id,
                org_id: ctx.orgId,
                status: existingRequest.status,
                updated_at: expectedUpdatedAt,
              },
              data: { updated_at: new Date() },
            });
            if (claim.count !== 1) {
              return { error: 'state_changed' as const };
            }
          }
        }

        responseResult ??= await upsertCommunicationResponseByIntent({
          db: tx,
          orgId: ctx.orgId,
          requestId: id,
          responderName: parsed.data.responder_name,
          content: parsed.data.content,
          respondedAt,
        });
        const updatedRequest = await tx.communicationRequest.findFirst({
          where: { id, org_id: ctx.orgId },
          select: { updated_at: true },
        });
        if (!updatedRequest) {
          return { error: 'state_changed' as const };
        }
        if (responseResult.created || existingRequest.status !== 'responded') {
          await createAuditLogEntry(tx, ctx, {
            action: 'communication_response_recorded',
            targetType: 'communication_request',
            targetId: id,
            changes: {
              from_status: existingRequest.status,
              to_status: 'responded',
              response_id: responseResult.response.id,
              response_created: responseResult.created,
              response_intent_key: responseResult.responseIntentKey,
              responder_name: parsed.data.responder_name,
              response_content_digest: buildCommunicationResponseContentDigest({
                requestId: id,
                responseId: responseResult.response.id,
                content: parsed.data.content,
              }),
              response_content_length: parsed.data.content.length,
              responded_at: respondedAt.toISOString(),
              actor_id: ctx.userId,
            },
          });
        }
        return { ...responseResult, requestUpdatedAt: updatedRequest.updated_at };
      },
      { requestContext: ctx },
    );

    if ('error' in result) {
      return conflict('連携依頼が同時に更新されました。再読み込みしてください');
    }

    return success(
      {
        data: result.response,
        request_updated_at: result.requestUpdatedAt.toISOString(),
      },
      result.created ? 201 : 200,
    );
  });
}

export async function POST(req: NextRequest, routeContext: RouteContext) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'communication_request_responses_post_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
