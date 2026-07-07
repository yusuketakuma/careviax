import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import {
  extractInboundCommunicationSignals,
  type InboundSignalCandidate,
} from '@/core/interprofessional/inbound/domain/inbound-signal-classifier';
import type { InboundCommunicationInput } from '@/core/interprofessional/inbound/domain/inbound-communication';
import { stageInboundMedicationStockSignalForReview } from '@/modules/pharmacy/medication-stock/application/medication-stock-signal-adapter';
import { buildInboundCommunicationEventAssignmentWhere } from '@/server/services/communication-request-access';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import type { TaskPriority } from '@/lib/tasks/task-registry';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/communications/inbound/signals/tasks';
const CLASSIFIER_VERSION = 'inbound_signal_classifier_v1';
const CANDIDATE_KEY_PATTERN = /^inbound_event:([A-Za-z0-9_-]{1,128}):candidate:(\d{1,3})$/;
const SIGNAL_KEY_PATTERN = /^inbound_signal:([A-Za-z0-9_-]{1,128})$/;

const createSignalTaskSchema = z.object({
  candidate_key: z.string().trim().min(1).max(200),
});

type InboundSourceChannel = 'phone' | 'fax' | 'email' | 'mcs';

type SignalSourceRow = {
  readonly id: string;
  readonly patient_id: string | null;
  readonly case_id: string | null;
  readonly source_channel: InboundSourceChannel;
  readonly raw_text: string;
  readonly received_at: Date;
};

type PersistedSignalSourceRow = {
  readonly id: string;
  readonly signal_index: number;
  readonly inbound_event: SignalSourceRow;
};

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

type TaskRow = {
  readonly id: string;
  readonly status: TaskStatus;
};

type StockReviewSummary = {
  readonly action:
    | 'stage_for_pharmacist_review'
    | 'ignore_non_stock_signal'
    | 'reject_unsafe_payload';
  readonly observation_kind:
    | 'remaining_quantity'
    | 'patient_held_stock'
    | 'prn_usage_report'
    | 'topical_remaining_report'
    | 'no_stock_observed'
    | 'unknown'
    | null;
  readonly review_priority: 'low' | 'medium' | 'high' | null;
  readonly warning_codes: string[];
  readonly has_medication_identity: boolean | null;
  readonly has_observed_quantity: boolean | null;
  readonly has_usage_quantity: boolean | null;
};

function parseCandidateKey(candidateKey: string) {
  const signalMatch = candidateKey.match(SIGNAL_KEY_PATTERN);
  if (signalMatch) {
    return {
      kind: 'signal' as const,
      signalId: signalMatch[1] ?? '',
    };
  }

  const match = candidateKey.match(CANDIDATE_KEY_PATTERN);
  if (!match) return null;

  const candidateIndex = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isSafeInteger(candidateIndex) || candidateIndex < 0) return null;

  return {
    kind: 'event_candidate' as const,
    inboundEventId: match[1] ?? '',
    candidateIndex,
  };
}

function toCommunicationInput(row: SignalSourceRow): InboundCommunicationInput {
  return {
    sourceChannel: row.source_channel,
    rawText: row.raw_text,
    normalizedSummary: null,
    patientLinked: row.patient_id != null,
    caseLinked: row.case_id != null,
  };
}

function toDateKey(date: Date): `${number}-${number}-${number}` {
  return date.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
}

const PUBLIC_STOCK_WARNING_CODES = new Set([
  'medication_identity_missing',
  'medication_equivalence_review_required',
  'medication_name_only_identity',
  'package_identity_without_clinical_code',
  'raw_phi_key_present',
  'no_stock_signal',
  'unknown_source',
]);

function toPublicStockWarningCodes(warnings: readonly string[]) {
  const publicCodes = warnings.map((warning) => {
    if (PUBLIC_STOCK_WARNING_CODES.has(warning)) return warning;
    if (warning.startsWith('ignored_signal:medication_stock:')) return warning;
    return 'review_required';
  });

  return [...new Set(publicCodes)].sort();
}

function toStockReviewSummary(
  row: SignalSourceRow,
  candidate: InboundSignalCandidate,
): StockReviewSummary | null {
  if (candidate.signalDomain !== 'medication_stock') return null;

  const staging = stageInboundMedicationStockSignalForReview({
    communication: {
      sourceChannel: row.source_channel,
      senderRole: 'unknown',
      occurredAtDateKey: toDateKey(row.received_at),
    },
    signal: candidate,
    sourceRecordId: row.id,
    medication: null,
  });

  if (staging.action !== 'stage_for_pharmacist_review') {
    return {
      action: staging.action,
      observation_kind: null,
      review_priority: null,
      warning_codes: toPublicStockWarningCodes(staging.warnings),
      has_medication_identity: null,
      has_observed_quantity: null,
      has_usage_quantity: null,
    };
  }

  const publicSummary = staging.decision.publicSummary;
  return {
    action: staging.action,
    observation_kind: publicSummary.observationKind,
    review_priority: staging.decision.reviewPriority,
    warning_codes: toPublicStockWarningCodes(staging.warnings),
    has_medication_identity: publicSummary.hasMedicationIdentity,
    has_observed_quantity: publicSummary.hasObservedQuantity,
    has_usage_quantity: publicSummary.hasUsageQuantity,
  };
}

function resolveTaskType(row: SignalSourceRow, candidate: InboundSignalCandidate) {
  if (candidate.signalDomain === 'medication_stock') {
    if (!row.patient_id) return 'core.inbound_communication_review_required';
    if (
      candidate.extractedQuantity == null &&
      ['low_stock_text', 'out_of_stock_text', 'refill_request'].includes(candidate.signalType)
    ) {
      return 'pharmacy.inbound_low_stock_unquantified_report';
    }
    return 'pharmacy.inbound_medication_stock_signal_review_required';
  }

  if (candidate.signalDomain === 'medication_safety' || candidate.signalDomain === 'urgent') {
    return 'pharmacy.inbound_medication_safety_review_required';
  }

  if (candidate.signalDomain === 'schedule') {
    return 'pharmacy.inbound_schedule_request_review_required';
  }

  return 'core.inbound_communication_review_required';
}

function resolveTaskPriority(
  candidate: InboundSignalCandidate,
  stockReview: StockReviewSummary | null,
): TaskPriority {
  if (candidate.signalDomain === 'urgent' || candidate.signalDomain === 'medication_safety') {
    return 'urgent';
  }
  if (stockReview?.review_priority === 'high') return 'urgent';
  if (candidate.signalDomain === 'medication_stock' || candidate.signalDomain === 'schedule') {
    return 'high';
  }
  return 'normal';
}

function resolveTaskTitle(taskType: string) {
  switch (taskType) {
    case 'pharmacy.inbound_medication_stock_signal_review_required':
      return '他職種からの残数シグナルを確認';
    case 'pharmacy.inbound_low_stock_unquantified_report':
      return '数量不明の不足報告を確認';
    case 'pharmacy.inbound_medication_safety_review_required':
      return '他職種からの薬剤安全情報を確認';
    case 'pharmacy.inbound_schedule_request_review_required':
      return '他職種からの訪問調整依頼を確認';
    default:
      return '他職種からの受信情報を確認';
  }
}

function resolveRelatedEntity(row: SignalSourceRow, taskType: string, signalId: string | null) {
  if (
    signalId &&
    (taskType === 'pharmacy.inbound_medication_stock_signal_review_required' ||
      taskType === 'pharmacy.inbound_low_stock_unquantified_report')
  ) {
    return {
      relatedEntityType: 'inbound_medication_stock_signal',
      relatedEntityId: signalId,
    };
  }

  if (row.patient_id) {
    return {
      relatedEntityType: 'patient',
      relatedEntityId: row.patient_id,
    };
  }
  if (taskType === 'pharmacy.inbound_medication_stock_signal_review_required') {
    return {
      relatedEntityType: null,
      relatedEntityId: null,
    };
  }
  return {
    relatedEntityType: 'inbound_communication',
    relatedEntityId: row.id,
  };
}

function buildActionHref(taskType: string, patientId: string | null) {
  if (!patientId) return `/tasks?status=&task_type=${encodeURIComponent(taskType)}`;
  const anchor =
    taskType === 'pharmacy.inbound_medication_stock_signal_review_required' ||
    taskType === 'pharmacy.inbound_low_stock_unquantified_report'
      ? '#medication-stock-events'
      : '#inbound-communications';
  return `/patients/${encodeURIComponent(patientId)}${anchor}`;
}

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationError('リクエストボディが不正です'));
    }

    const parsed = createSignalTaskSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const parsedKey = parseCandidateKey(parsed.data.candidate_key);
    if (!parsedKey) {
      return withSensitiveNoStore(
        validationError('シグナル候補の指定が不正です', {
          candidate_key: [
            'candidate_key は inbound_signal:<id> または inbound_event:<id>:candidate:<index> 形式です',
          ],
        }),
      );
    }

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const assignmentWhere = await buildInboundCommunicationEventAssignmentWhere({
          db: tx,
          orgId: ctx.orgId,
          accessContext: ctx,
        });

        const source =
          parsedKey.kind === 'signal'
            ? await tx.inboundCommunicationSignal.findFirst({
                where: {
                  AND: [
                    {
                      id: parsedKey.signalId,
                      org_id: ctx.orgId,
                      inbound_event: {
                        is: {
                          org_id: ctx.orgId,
                          source_channel: { in: ['phone', 'fax', 'email', 'mcs'] },
                        },
                      },
                    },
                    ...(assignmentWhere
                      ? [
                          {
                            inbound_event: {
                              is: assignmentWhere,
                            },
                          },
                        ]
                      : []),
                  ],
                },
                select: {
                  id: true,
                  signal_index: true,
                  inbound_event: {
                    select: {
                      id: true,
                      patient_id: true,
                      case_id: true,
                      source_channel: true,
                      raw_text: true,
                      received_at: true,
                    },
                  },
                },
              })
            : null;

        const fallbackEvent =
          parsedKey.kind === 'event_candidate'
            ? await tx.inboundCommunicationEvent.findFirst({
                where: {
                  AND: [
                    {
                      id: parsedKey.inboundEventId,
                      org_id: ctx.orgId,
                      source_channel: { in: ['phone', 'fax', 'email', 'mcs'] },
                    },
                    ...(assignmentWhere ? [assignmentWhere] : []),
                  ],
                },
                select: {
                  id: true,
                  patient_id: true,
                  case_id: true,
                  source_channel: true,
                  raw_text: true,
                  received_at: true,
                },
              })
            : null;

        const signalSource = source as PersistedSignalSourceRow | null;
        const row =
          signalSource?.inbound_event ?? (fallbackEvent as SignalSourceRow | null) ?? null;
        const signalId = signalSource?.id ?? null;
        const candidateIndex =
          signalSource?.signal_index ??
          (parsedKey.kind === 'event_candidate' ? parsedKey.candidateIndex : null);

        if (!row || candidateIndex == null) {
          return {
            ok: false as const,
            response: notFound('シグナル候補が見つかりません'),
          };
        }

        const extraction = extractInboundCommunicationSignals({
          communication: toCommunicationInput(row),
        });
        const candidate = extraction.signals[candidateIndex];
        if (!candidate) {
          return {
            ok: false as const,
            response: validationError('シグナル候補が見つかりません', {
              candidate_key: ['指定された候補番号は現在の抽出結果に存在しません'],
            }),
          };
        }

        const stockReview = toStockReviewSummary(row, candidate);
        const taskType = resolveTaskType(row, candidate);
        const priority = resolveTaskPriority(candidate, stockReview);
        const relatedEntity = resolveRelatedEntity(row, taskType, signalId);
        const dedupeKey = signalId
          ? ['inbound', signalId, taskType].join(':')
          : ['inbound-signal-task', row.id, candidateIndex, taskType].join(':');

        const existingTask = (await tx.task.findFirst({
          where: {
            org_id: ctx.orgId,
            dedupe_key: dedupeKey,
          },
          select: {
            id: true,
            status: true,
          },
        })) as TaskRow | null;

        if (existingTask) {
          return {
            ok: true as const,
            task: existingTask,
            taskType,
            actionHref: buildActionHref(taskType, row.patient_id),
          };
        }

        const task = (await upsertOperationalTask(tx, {
          orgId: ctx.orgId,
          taskType,
          title: resolveTaskTitle(taskType),
          description:
            '他職種受信から抽出された確認候補です。原文は権限確認後の受信詳細で確認してください。',
          priority,
          dedupeKey,
          relatedEntityType: relatedEntity.relatedEntityType,
          relatedEntityId: relatedEntity.relatedEntityId,
          metadata: {
            source: signalId ? 'inbound_communication_signal' : 'inbound_communication_event',
            inbound_event_id: row.id,
            inbound_signal_id: signalId,
            candidate_index: candidateIndex,
            signal_domain: candidate.signalDomain,
            signal_type: candidate.signalType,
            source_channel: row.source_channel,
            classifier_version: CLASSIFIER_VERSION,
            patient_linked: row.patient_id != null,
            case_linked: row.case_id != null,
            stock_review: stockReview
              ? {
                  action: stockReview.action,
                  observation_kind: stockReview.observation_kind,
                  review_priority: stockReview.review_priority,
                  warning_codes: stockReview.warning_codes,
                  has_medication_identity: stockReview.has_medication_identity,
                  has_observed_quantity: stockReview.has_observed_quantity,
                  has_usage_quantity: stockReview.has_usage_quantity,
                }
              : null,
          },
        })) as { id: string };

        if (signalId) {
          await tx.inboundCommunicationSignal.updateMany({
            where: {
              id: signalId,
              org_id: ctx.orgId,
              action_status: 'not_linked',
            },
            data: {
              action_status: 'linked_to_task',
            },
          });
        }

        return {
          ok: true as const,
          task: {
            id: task.id,
            status: 'pending' as const,
          },
          taskType,
          actionHref: buildActionHref(taskType, row.patient_id),
        };
      },
      { requestContext: ctx },
    );

    if (!result.ok) return withSensitiveNoStore(result.response);

    return withSensitiveNoStore(
      success(
        {
          data: {
            task_id: result.task.id,
            task_type: result.taskType,
            status: result.task.status,
            action_href: result.actionHref,
          },
          meta: {
            generated_at: new Date().toISOString(),
          },
        },
        201,
      ),
    );
  },
  {
    permission: 'canReport',
    message: '他職種受信シグナルのタスク化権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return await authenticatedPOST(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_signal_task_post_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
