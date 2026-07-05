import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import {
  buildVisitHandoffConfirmationWhere,
  canAccessVisitScheduleAssignment,
  canConfirmVisitHandoff,
  canOverrideVisitHandoffConfirmation,
} from '@/lib/auth/visit-schedule-access';
import {
  conflict,
  success,
  validationError,
  notFound,
  error,
  forbiddenResponse,
  internalError,
} from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import {
  confirmHandoff,
  readConfirmableHandoffData,
  VisitHandoffInvalidDataError,
  VisitHandoffMissingDataError,
  VisitHandoffStaleRecordError,
  VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE,
} from '@/server/services/visit-handoff';
import type { StructuredSoap } from '@/types/structured-soap';

const confirmHandoffSchema = z.object({
  confirmed: z.literal(true),
  expected_visit_record_version: z
    .number()
    .int('訪問記録の版情報が不正です')
    .positive('訪問記録の版情報が不正です'),
  override_reason: z.string().trim().min(8, '上書き理由を入力してください').max(500).optional(),
  edits: z
    .object({
      next_check_items: z.array(z.string()).optional(),
      ongoing_monitoring: z.array(z.string()).optional(),
      decision_rationale: z.string().optional(),
    })
    .optional(),
});

const visitRecordHandoffSelect = {
  id: true,
  version: true,
  updated_at: true,
  structured_soap: true,
  schedule: {
    select: {
      pharmacist_id: true,
      case_: {
        select: {
          primary_pharmacist_id: true,
          backup_pharmacist_id: true,
        },
      },
    },
  },
} as const;

async function authenticatedPUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の更新権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('訪問記録IDが不正です'));

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

  const parsed = confirmHandoffSchema.safeParse(payload);
  if (!parsed.success) {
    return withSensitiveNoStore(
      validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
    );
  }

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: visitRecordHandoffSelect,
  });
  if (!record) return withSensitiveNoStore(notFound('訪問記録が見つかりません'));

  const canConfirmDirectly = canConfirmVisitHandoff(ctx, record.schedule);
  const canOverride = canOverrideVisitHandoffConfirmation(ctx);
  if (!canConfirmDirectly && !canOverride) {
    return withSensitiveNoStore(await forbiddenResponse('この訪問記録を更新する権限がありません'));
  }

  const { edits, override_reason: overrideReason } = parsed.data;
  const isOverrideConfirmation = !canConfirmDirectly && canOverride;
  if (isOverrideConfirmation && !overrideReason) {
    return withSensitiveNoStore(await forbiddenResponse('この訪問記録を更新する権限がありません'));
  }

  const confirmationWhere = isOverrideConfirmation
    ? undefined
    : buildVisitHandoffConfirmationWhere(ctx);
  if (!isOverrideConfirmation && !confirmationWhere) {
    return withSensitiveNoStore(await forbiddenResponse('この訪問記録を更新する権限がありません'));
  }

  if (record.version !== parsed.data.expected_visit_record_version) {
    return withSensitiveNoStore(conflict('訪問記録が同時に更新されました。再読み込みしてください'));
  }

  try {
    const handoff = await confirmHandoff(prisma, {
      orgId: ctx.orgId,
      visitRecordId: id,
      confirmedBy: ctx.userId,
      expectedVersion: parsed.data.expected_visit_record_version,
      edits,
      requestContext: ctx,
      confirmationWhere: confirmationWhere ?? undefined,
      confirmationBasis: isOverrideConfirmation
        ? 'admin_emergency_override'
        : record.schedule?.pharmacist_id === ctx.userId
          ? 'assigned_schedule'
          : 'case_primary_or_backup',
      ...(isOverrideConfirmation ? { overrideReason } : {}),
    });
    return withSensitiveNoStore(success(handoff));
  } catch (cause) {
    if (cause instanceof VisitHandoffMissingDataError) {
      return withSensitiveNoStore(
        notFound('引継ぎデータが見つかりません。AI抽出が完了していない可能性があります'),
      );
    }
    if (cause instanceof VisitHandoffInvalidDataError) {
      return withSensitiveNoStore(
        conflict('引継ぎデータの形式が不正です。AI抽出を再実行してから確定してください'),
      );
    }
    if (cause instanceof VisitHandoffStaleRecordError) {
      return withSensitiveNoStore(
        conflict('訪問記録が同時に更新されました。再読み込みしてください'),
      );
    }
    return withSensitiveNoStore(error('internal_error', '引継ぎの確定処理に失敗しました', 500));
  }
}

export async function PUT(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedPUT(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の閲覧権限がありません',
  });
  if ('response' in authResult) return withSensitiveNoStore(authResult.response);
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return withSensitiveNoStore(validationError('訪問記録IDが不正です'));
  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    select: visitRecordHandoffSelect,
  });
  if (!record) return withSensitiveNoStore(notFound('訪問記録が見つかりません'));
  if (!canAccessVisitScheduleAssignment(ctx, record.schedule)) {
    return withSensitiveNoStore(await forbiddenResponse('この訪問記録を閲覧する権限がありません'));
  }

  const handoffExtraction = await prisma.visitHandoffExtraction.findUnique({
    where: { visit_record_id: id },
    select: {
      status: true,
      retry_count: true,
      last_attempted_at: true,
      last_succeeded_at: true,
      last_failed_at: true,
      error_message: true,
      retryable: true,
      source_visit_record_version: true,
      source_visit_record_updated_at: true,
    },
  });

  const structuredSoap =
    record.structured_soap &&
    typeof record.structured_soap === 'object' &&
    !Array.isArray(record.structured_soap)
      ? (record.structured_soap as StructuredSoap)
      : null;
  const handoffResult = readConfirmableHandoffData(structuredSoap?.handoff);
  if (handoffResult.status === 'invalid') {
    return withSensitiveNoStore(
      conflict('引継ぎデータの形式が不正です。AI抽出を再実行してから確定してください'),
    );
  }
  const handoff = handoffResult.status === 'valid' ? handoffResult.handoff : null;
  const canConfirmDirectly = canConfirmVisitHandoff(ctx, record.schedule);
  const extraction = handoffExtraction
    ? {
        status: handoffExtraction.status,
        retry_count: handoffExtraction.retry_count,
        last_attempted_at: handoffExtraction.last_attempted_at?.toISOString() ?? null,
        last_succeeded_at: handoffExtraction.last_succeeded_at?.toISOString() ?? null,
        last_failed_at: handoffExtraction.last_failed_at?.toISOString() ?? null,
        error_message:
          handoffExtraction.status === 'failed' ? VISIT_HANDOFF_EXTRACTION_FAILED_MESSAGE : null,
        retryable: handoffExtraction.retryable,
        source_visit_record_version: handoffExtraction.source_visit_record_version,
        source_visit_record_updated_at:
          handoffExtraction.source_visit_record_updated_at.toISOString(),
      }
    : null;
  if (!handoff && !extraction) {
    return withSensitiveNoStore(notFound('引継ぎデータが見つかりません'));
  }

  return withSensitiveNoStore(
    success({
      data: handoff,
      extraction,
      visit_record_version: record.version,
      visit_record_updated_at: record.updated_at.toISOString(),
      confirmation_policy: {
        can_confirm: canConfirmDirectly,
        requires_override_reason:
          !canConfirmDirectly && canOverrideVisitHandoffConfirmation(ctx) && Boolean(handoff),
        authorized_basis: canConfirmDirectly
          ? record.schedule?.pharmacist_id === ctx.userId
            ? 'assigned_schedule'
            : 'case_primary_or_backup'
          : canOverrideVisitHandoffConfirmation(ctx) && Boolean(handoff)
            ? 'admin_emergency_override'
            : null,
        override_reason_max_length: 500,
      },
    }),
  );
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
