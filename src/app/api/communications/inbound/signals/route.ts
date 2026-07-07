import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { successWithMeasuredJsonPayload, validationError, internalError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import {
  extractInboundCommunicationSignals,
  toPublicInboundSignalSummary,
  type InboundSignalDomain,
  type InboundSignalCandidate,
  type InboundSignalType,
} from '@/core/interprofessional/inbound/domain/inbound-signal-classifier';
import type { InboundCommunicationInput } from '@/core/interprofessional/inbound/domain/inbound-communication';
import { stageInboundMedicationStockSignalForReview } from '@/modules/pharmacy/medication-stock/application/medication-stock-signal-adapter';
import { buildInboundCommunicationEventAssignmentWhere } from '@/server/services/communication-request-access';
import { logger } from '@/lib/utils/logger';

const ROUTE = '/api/communications/inbound/signals';
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 50;
const CLASSIFIER_VERSION = 'inbound_signal_classifier_v1';

const CHANNELS = ['phone', 'fax', 'email', 'mcs'] as const;
const SIGNAL_DOMAINS = [
  'medication_stock',
  'medication_safety',
  'adherence',
  'symptom',
  'schedule',
  'report',
  'care_coordination',
  'urgent',
  'other',
] as const satisfies readonly InboundSignalDomain[];
const SIGNAL_TYPES = [
  'observed_quantity',
  'usage_delta',
  'usage_frequency',
  'low_stock_text',
  'out_of_stock_text',
  'refill_request',
  'side_effect_suspected',
  'medication_not_taken',
  'medication_overuse',
  'medication_lost',
  'storage_issue',
  'schedule_change_request',
  'visit_request',
  'urgent_review_required',
  'unknown',
] as const satisfies readonly InboundSignalType[];

type InboundChannel = (typeof CHANNELS)[number];

type SignalSourceRow = {
  readonly id: string;
  readonly patient_id: string | null;
  readonly case_id: string | null;
  readonly source_channel: InboundChannel;
  readonly raw_text: string;
  readonly received_at: Date;
};

type PersistedSignalRow = {
  readonly id: string;
  readonly review_status:
    | 'needs_review'
    | 'auto_accepted'
    | 'accepted'
    | 'rejected'
    | 'record_only'
    | 'superseded';
  readonly action_status:
    | 'not_linked'
    | 'linked_to_stock_event'
    | 'linked_to_task'
    | 'linked_to_schedule'
    | 'linked_to_report'
    | 'linked_to_visit_brief'
    | 'ignored';
};

type MaterializedSignalCandidate = {
  readonly row: SignalSourceRow;
  readonly candidate: InboundSignalCandidate;
  readonly signalIndex: number;
  readonly signal: PersistedSignalRow;
};

type PublicStockReviewSummary = {
  readonly action:
    | 'stage_for_pharmacist_review'
    | 'ignore_non_stock_signal'
    | 'reject_unsafe_payload';
  readonly target_label: '残数レビュー' | '記録確認' | '安全確認';
  readonly observation_kind:
    | 'remaining_quantity'
    | 'patient_held_stock'
    | 'prn_usage_report'
    | 'topical_remaining_report'
    | 'no_stock_observed'
    | 'unknown'
    | null;
  readonly ledger_write_policy:
    | 'never_direct_from_external'
    | 'allowed_only_after_pharmacist_review'
    | 'not_applicable'
    | null;
  readonly review_priority: 'low' | 'medium' | 'high' | null;
  readonly warning_codes: string[];
  readonly has_medication_identity: boolean | null;
  readonly has_observed_quantity: boolean | null;
  readonly has_usage_quantity: boolean | null;
  readonly direct_ledger_write_allowed: false;
};

function parseEnumParam<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: readonly T[],
) {
  const raw = searchParams.get(key);
  if (raw === null || raw === '') return { ok: true as const, value: null };
  if (allowed.includes(raw as T)) return { ok: true as const, value: raw as T };
  return {
    ok: false as const,
    response: validationError('検索条件が不正です', { [key]: ['指定できない値です'] }),
  };
}

function parseLimit(searchParams: URLSearchParams) {
  const raw = searchParams.get('limit');
  if (raw === null || raw === '') return { ok: true as const, value: DEFAULT_LIMIT };

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', {
        limit: ['limit は整数で指定してください'],
      }),
    };
  }

  return { ok: true as const, value: Math.min(Math.max(parsed, 1), MAX_LIMIT) };
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

function toStockReviewTargetLabel(action: PublicStockReviewSummary['action']) {
  if (action === 'stage_for_pharmacist_review') return '残数レビュー';
  if (action === 'reject_unsafe_payload') return '安全確認';
  return '記録確認';
}

function toStockReviewDto(
  row: SignalSourceRow,
  candidate: InboundSignalCandidate,
): PublicStockReviewSummary | null {
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
      target_label: toStockReviewTargetLabel(staging.action),
      observation_kind: null,
      ledger_write_policy: null,
      review_priority: null,
      warning_codes: toPublicStockWarningCodes(staging.warnings),
      has_medication_identity: null,
      has_observed_quantity: null,
      has_usage_quantity: null,
      direct_ledger_write_allowed: false,
    };
  }

  const publicSummary = staging.decision.publicSummary;

  return {
    action: staging.action,
    target_label: '残数レビュー',
    observation_kind: publicSummary.observationKind,
    ledger_write_policy: staging.decision.ledgerWritePolicy,
    review_priority: staging.decision.reviewPriority,
    warning_codes: toPublicStockWarningCodes(staging.warnings),
    has_medication_identity: publicSummary.hasMedicationIdentity,
    has_observed_quantity: publicSummary.hasObservedQuantity,
    has_usage_quantity: publicSummary.hasUsageQuantity,
    direct_ledger_write_allowed: false,
  };
}

function toSignalDto(row: SignalSourceRow, candidate: InboundSignalCandidate) {
  const signal = toPublicInboundSignalSummary(candidate);

  return {
    domain: signal.signalDomain,
    type: signal.signalType,
    has_quantity: signal.hasQuantity,
    unit: signal.unit ?? null,
    quantity_effect: signal.quantityEffect ?? null,
    source_confidence: signal.sourceConfidence,
    review_status: signal.reviewStatus,
    action_status: signal.actionStatus,
    evidence_code: signal.evidenceCode,
    requires_pharmacist_review: signal.requiresPharmacistReview,
    stock_review: toStockReviewDto(row, candidate),
  };
}

type PublicSignalDto = Omit<ReturnType<typeof toSignalDto>, 'review_status' | 'action_status'> &
  Pick<PersistedSignalRow, 'review_status' | 'action_status'>;

function buildSignalStructuredPayload(candidate: InboundSignalCandidate) {
  return {
    classifier_version: CLASSIFIER_VERSION,
    evidence_code: candidate.evidenceCode,
    quantity_effect: candidate.quantityEffect ?? null,
    requires_pharmacist_review: candidate.requiresPharmacistReview,
  };
}

const emptyDomainCounts = () =>
  ({
    medication_stock: 0,
    medication_safety: 0,
    schedule: 0,
    urgent: 0,
  }) satisfies Record<'medication_stock' | 'medication_safety' | 'schedule' | 'urgent', number>;

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    try {
      const { searchParams } = req.nextUrl;
      const limitResult = parseLimit(searchParams);
      if (!limitResult.ok) return withSensitiveNoStore(limitResult.response);

      const channelResult = parseEnumParam(searchParams, 'channel', CHANNELS);
      if (!channelResult.ok) return withSensitiveNoStore(channelResult.response);

      const domainResult = parseEnumParam(searchParams, 'domain', SIGNAL_DOMAINS);
      if (!domainResult.ok) return withSensitiveNoStore(domainResult.response);

      const typeResult = parseEnumParam(searchParams, 'type', SIGNAL_TYPES);
      if (!typeResult.ok) return withSensitiveNoStore(typeResult.response);

      const channel = channelResult.value as InboundChannel | null;
      const domain = domainResult.value as InboundSignalDomain | null;
      const type = typeResult.value as InboundSignalType | null;

      const materialization = await withOrgContext(
        ctx.orgId,
        async (tx) => {
          const assignmentWhere = await buildInboundCommunicationEventAssignmentWhere({
            db: tx,
            orgId: ctx.orgId,
            accessContext: ctx,
          });

          const rows = (await tx.inboundCommunicationEvent.findMany({
            where: {
              AND: [
                {
                  org_id: ctx.orgId,
                  source_channel: channel
                    ? { equals: channel }
                    : { in: ['phone', 'fax', 'email', 'mcs'] },
                },
                ...(assignmentWhere ? [assignmentWhere] : []),
              ],
            },
            orderBy: [{ received_at: 'desc' }, { created_at: 'desc' }],
            take: limitResult.value,
            select: {
              id: true,
              patient_id: true,
              case_id: true,
              source_channel: true,
              raw_text: true,
              received_at: true,
            },
          })) as SignalSourceRow[];

          const candidates: MaterializedSignalCandidate[] = [];
          const eventIdsWithSignals = new Set<string>();

          for (const row of rows) {
            const extraction = extractInboundCommunicationSignals({
              communication: toCommunicationInput(row),
            });

            for (const [index, candidate] of extraction.signals.entries()) {
              eventIdsWithSignals.add(row.id);
              const signal = (await tx.inboundCommunicationSignal.upsert({
                where: {
                  org_id_inbound_event_id_signal_index: {
                    org_id: ctx.orgId,
                    inbound_event_id: row.id,
                    signal_index: index,
                  },
                },
                create: {
                  org_id: ctx.orgId,
                  patient_id: row.patient_id,
                  case_id: row.case_id,
                  inbound_event_id: row.id,
                  signal_index: index,
                  signal_domain: candidate.signalDomain,
                  signal_type: candidate.signalType,
                  extracted_quantity: candidate.extractedQuantity ?? null,
                  extracted_unit: candidate.extractedUnit ?? null,
                  structured_payload: buildSignalStructuredPayload(candidate),
                  source_confidence: candidate.sourceConfidence,
                  review_status: candidate.reviewStatus,
                  action_status: candidate.actionStatus,
                },
                update: {
                  patient_id: row.patient_id,
                  case_id: row.case_id,
                  signal_domain: candidate.signalDomain,
                  signal_type: candidate.signalType,
                  extracted_quantity: candidate.extractedQuantity ?? null,
                  extracted_unit: candidate.extractedUnit ?? null,
                  structured_payload: buildSignalStructuredPayload(candidate),
                  source_confidence: candidate.sourceConfidence,
                },
                select: {
                  id: true,
                  review_status: true,
                  action_status: true,
                },
              })) as PersistedSignalRow;

              candidates.push({
                row,
                candidate,
                signalIndex: index,
                signal,
              });
            }
          }

          if (eventIdsWithSignals.size > 0) {
            await tx.inboundCommunicationEvent.updateMany({
              where: {
                org_id: ctx.orgId,
                id: { in: [...eventIdsWithSignals] },
                processing_status: 'unprocessed',
              },
              data: {
                processing_status: 'signals_extracted',
              },
            });
          }

          return {
            sourceEventCount: rows.length,
            candidates,
          };
        },
        { requestContext: ctx },
      );

      const domainCounts = emptyDomainCounts();
      let signalCount = 0;
      let urgentCount = 0;
      const items: Array<{
        candidate_key: string;
        inbound_event_id: string;
        signal_id: string;
        channel: InboundChannel;
        occurred_at: string;
        patient_linked: boolean;
        case_linked: boolean;
        signal: PublicSignalDto;
      }> = [];

      for (const item of materialization.candidates) {
        const { row, candidate, signal } = item;
        if (domain && candidate.signalDomain !== domain) continue;
        if (type && candidate.signalType !== type) continue;

        signalCount += 1;
        if (candidate.signalDomain in domainCounts) {
          domainCounts[candidate.signalDomain as keyof typeof domainCounts] += 1;
        }
        if (candidate.signalDomain === 'urgent') urgentCount += 1;

        items.push({
          candidate_key: `inbound_signal:${signal.id}`,
          inbound_event_id: row.id,
          signal_id: signal.id,
          channel: row.source_channel,
          occurred_at: row.received_at.toISOString(),
          patient_linked: row.patient_id != null,
          case_linked: row.case_id != null,
          signal: {
            ...toSignalDto(row, candidate),
            review_status: signal.review_status,
            action_status: signal.action_status,
          },
        });
      }

      const eventsWithSignals = new Set(items.map((item) => item.inbound_event_id));

      return withSensitiveNoStore(
        successWithMeasuredJsonPayload({
          data: {
            summary: {
              source_event_count: materialization.sourceEventCount,
              events_with_signals_count: eventsWithSignals.size,
              signal_count: signalCount,
              urgent_count: urgentCount,
              domain_counts: domainCounts,
            },
            items,
            filters: {
              channel,
              domain,
              type,
            },
          },
          meta: {
            generated_at: new Date().toISOString(),
            limit: limitResult.value,
            visible_count: items.length,
            hidden_count: Math.max(materialization.candidates.length - items.length, 0),
            count_basis: 'visible_window',
            partial_failures: [],
            source: 'inbound_communication_event',
            classifier_version: CLASSIFIER_VERSION,
          },
        }),
      );
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'inbound_signal_candidates_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  },
  {
    permission: 'canReport',
    message: '他職種受信シグナルの閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return await authenticatedGET(req, routeContext);
  } catch (err) {
    unstable_rethrow(err);
    logger.error(
      {
        event: 'inbound_signal_candidates_get_unhandled_error',
        route: ROUTE,
        method: req.method,
        status: 500,
      },
      err,
    );
    return withSensitiveNoStore(internalError());
  }
};
