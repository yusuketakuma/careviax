import {
  BlockerSeverity,
  ActionCode,
  UserRole,
  VisitArrivalOutcome,
  VisitStatus,
  VisitStep,
  type BlockerView,
  type VisitModeView,
  type VisitStepMutationRequest,
} from '@/phos/contracts/phos_contracts';
import { canCompleteVisit } from '@/phos/domain/visit/resolveVisitMode';
import { hashTenantId } from './observability';
import { PhosDomainError } from './cards-repository';
import type { TenantContext } from './tenant-context';
import type { PhosVisitModeRepository } from './visit-mode-repository';

export type IdempotentVisitStepLookup =
  | { status: 'MISS' }
  | { status: 'MATCH'; response: VisitModeView }
  | { status: 'CONFLICT'; existing_request_fingerprint: string };

export type VisitStepCommitInput = {
  packet_id: string;
  step: VisitStep;
  mutation_key: string;
  command: VisitStepMutationRequest;
  request_fingerprint: string;
  previous_visit: VisitModeView;
  response: VisitModeView;
  verified_evidence?: VerifiedEvidenceUpload;
};

export type EvidenceUploadVerificationInput = {
  packet_id: string;
  step: typeof VisitStep.EVIDENCE_UPLOAD;
  visit: VisitModeView;
  evidence_key: string;
};

export type VerifiedEvidenceUpload = {
  evidence_id: string;
  card_id: string;
  s3_key: string;
};

export type VisitModeLifecycleStore = {
  getIdempotentVisitStep(
    ctx: TenantContext,
    mutation_key: string,
    idempotency_key: string,
    request_fingerprint: string,
  ): Promise<IdempotentVisitStepLookup>;
  loadVisitMode(ctx: TenantContext, packet_id: string): Promise<VisitModeView | null>;
  verifyEvidenceUpload(
    ctx: TenantContext,
    input: EvidenceUploadVerificationInput,
  ): Promise<VerifiedEvidenceUpload>;
  commitVisitStep(ctx: TenantContext, input: VisitStepCommitInput): Promise<VisitModeView>;
};

function domainError(
  status: number,
  error_code: PhosDomainError['error_code'],
  message_key: string,
  details?: Record<string, unknown>,
): PhosDomainError {
  return new PhosDomainError({ status, error_code, message_key, details });
}

function guardFailed(details: Record<string, unknown>): PhosDomainError {
  return domainError(422, 'ACTION_GUARD_FAILED', 'api.error.visit_mode_guard_failed', details);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function mutationKey(packet_id: string, step: VisitStep): string {
  return `VISIT_STEP:${packet_id}:${step}`;
}

function assertFreshVersion(visit: VisitModeView, command: VisitStepMutationRequest) {
  if (visit.server_version !== command.client_version) {
    throw domainError(409, 'STALE_VERSION', 'api.error.stale_version', {
      packet_id: visit.packet_id,
      client_version: command.client_version,
      server_version: visit.server_version,
    });
  }
}

async function assertIdempotent(input: {
  store: VisitModeLifecycleStore;
  ctx: TenantContext;
  mutation_key: string;
  idempotency_key: string;
  request_fingerprint: string;
}): Promise<VisitModeView | null> {
  const idempotent = await input.store.getIdempotentVisitStep(
    input.ctx,
    input.mutation_key,
    input.idempotency_key,
    input.request_fingerprint,
  );
  if (idempotent.status === 'MATCH') return idempotent.response;
  if (idempotent.status === 'CONFLICT') {
    throw domainError(409, 'IDEMPOTENCY_CONFLICT', 'api.error.idempotency_conflict', {
      idempotency_key: input.idempotency_key,
    });
  }
  return null;
}

async function replayIdempotentAfterCommitConflict(input: {
  error: unknown;
  store: VisitModeLifecycleStore;
  ctx: TenantContext;
  mutation_key: string;
  idempotency_key: string;
  request_fingerprint: string;
}): Promise<VisitModeView> {
  if (!(input.error instanceof PhosDomainError) || input.error.error_code !== 'STALE_VERSION') {
    throw input.error;
  }
  const matched = await assertIdempotent(input);
  if (matched) return matched;
  throw input.error;
}

const ABSENT_FOLLOWUP_BLOCKER_CODE = 'VISIT_ABSENT_FOLLOWUP';
const VISIT_STEP_ROUTE_KEY = 'POST /visit-packets/{packet_id}/visit-steps/{step}';

function upsertAbsentFollowupBlocker(visit: VisitModeView): BlockerView[] {
  const existing = visit.blockers ?? [];
  if (
    existing.some(
      (blocker) => blocker.active && blocker.blocker_code === ABSENT_FOLLOWUP_BLOCKER_CODE,
    )
  ) {
    return existing;
  }
  return [
    ...existing,
    {
      blocker_code: ABSENT_FOLLOWUP_BLOCKER_CODE,
      severity: BlockerSeverity.WARNING,
      owner_role: UserRole.PHARMACY_CLERK,
      message_key: 'blocker.visit_absent_followup',
      required_action_code: ActionCode.RESOLVE_CLERK_BLOCKER,
      active: true,
    },
  ];
}

function applyArrivalOutcome(
  visit: VisitModeView,
  command: VisitStepMutationRequest,
): Pick<VisitModeView, 'visit_status' | 'step_completed' | 'blockers'> {
  const outcome = command.payload?.arrival_outcome;
  if (outcome === VisitArrivalOutcome.PRESENT) {
    return {
      visit_status: VisitStatus.IN_PROGRESS,
      step_completed: { ...visit.step_completed, [VisitStep.ARRIVAL_CONFIRM]: true },
    };
  }
  if (outcome === VisitArrivalOutcome.ABSENT) {
    return {
      visit_status: VisitStatus.POST_VISIT_PENDING,
      step_completed: { ...visit.step_completed, [VisitStep.ARRIVAL_CONFIRM]: true },
      blockers: upsertAbsentFollowupBlocker(visit),
    };
  }
  if (outcome === VisitArrivalOutcome.POSTPONED) {
    return {
      visit_status: VisitStatus.SCHEDULED,
      step_completed: { ...visit.step_completed, [VisitStep.ARRIVAL_CONFIRM]: false },
    };
  }
  if (outcome === VisitArrivalOutcome.CANCELED) {
    if (!command.payload?.reason_code && !command.payload?.reason_note) {
      throw guardFailed({
        step: VisitStep.ARRIVAL_CONFIRM,
        outcome,
        reason: 'missing_cancel_reason',
      });
    }
    return {
      visit_status: VisitStatus.CANCELED,
      step_completed: { ...visit.step_completed, [VisitStep.ARRIVAL_CONFIRM]: false },
    };
  }
  throw guardFailed({ step: VisitStep.ARRIVAL_CONFIRM, reason: 'missing_arrival_outcome' });
}

function applyVerifiedEvidenceUpload(
  visit: VisitModeView,
): Pick<VisitModeView, 'step_completed' | 'evidence_sync'> {
  return {
    step_completed: { ...visit.step_completed, [VisitStep.EVIDENCE_UPLOAD]: true },
    evidence_sync: {
      ...visit.evidence_sync,
      blocking_unsynced_count: Math.max(0, visit.evidence_sync.blocking_unsynced_count - 1),
    },
  };
}

function projectVisitStepResponse(
  ctx: TenantContext,
  visit: VisitModeView,
  step: VisitStep,
  command: VisitStepMutationRequest,
  verified_evidence?: VerifiedEvidenceUpload,
): VisitModeView {
  if (!visit.applicable_steps.includes(step)) {
    throw guardFailed({
      packet_id: visit.packet_id,
      step,
      applicable_steps: visit.applicable_steps,
    });
  }

  const nextVersion = visit.server_version + 1;
  const base: VisitModeView =
    step === VisitStep.ARRIVAL_CONFIRM
      ? {
          ...visit,
          ...applyArrivalOutcome(visit, command),
          last_opened_step: step,
          server_version: nextVersion,
        }
      : step === VisitStep.EVIDENCE_UPLOAD
        ? {
            ...visit,
            ...applyVerifiedEvidenceUpload(visit),
            last_opened_step: step,
            server_version: nextVersion,
          }
        : {
            ...visit,
            step_completed: { ...visit.step_completed, [step]: true },
            last_opened_step: step,
            server_version: nextVersion,
          };

  if (step === VisitStep.EVIDENCE_UPLOAD && !verified_evidence) {
    throw guardFailed({
      packet_id: visit.packet_id,
      step,
      reason: 'unverified_evidence',
    });
  }

  if (step !== VisitStep.COMPLETE_CHECK) return base;

  if (
    !canCompleteVisit({
      applicable_steps: base.applicable_steps,
      required_steps: base.required_steps,
      step_completed: base.step_completed,
      blocking_unsynced_count: base.evidence_sync.blocking_unsynced_count,
      visit_status: base.visit_status,
    })
  ) {
    ctx.observability?.emitMetric({
      name: 'VisitCompleteGuardBlockedCount',
      value: 1,
      unit: 'Count',
      route_key: VISIT_STEP_ROUTE_KEY,
      tenant_id: ctx.tenant_id,
      user_id: ctx.user_id,
      request_id: ctx.request_id,
      correlation_id: ctx.correlation_id,
      error_code: 'ACTION_GUARD_FAILED',
    });
    ctx.observability?.annotateTrace({
      route_key: VISIT_STEP_ROUTE_KEY,
      tenant_id_hash: hashTenantId(ctx.tenant_id),
      error_code: 'ACTION_GUARD_FAILED',
    });
    throw guardFailed({
      packet_id: visit.packet_id,
      step,
      required_steps: base.required_steps,
      blocking_unsynced_count: base.evidence_sync.blocking_unsynced_count,
      visit_status: base.visit_status,
    });
  }

  return { ...base, visit_status: VisitStatus.COMPLETED };
}

export function createVisitModeLifecycleRepository(
  store: VisitModeLifecycleStore,
): PhosVisitModeRepository {
  return {
    getVisitMode(ctx, packet_id) {
      return store.loadVisitMode(ctx, packet_id);
    },

    async updateVisitStep(ctx, packet_id, step, command) {
      const mutation_key = mutationKey(packet_id, step);
      const request_fingerprint = stableStringify({ packet_id, step, command });
      const matched = await assertIdempotent({
        store,
        ctx,
        mutation_key,
        idempotency_key: command.idempotency_key,
        request_fingerprint,
      });
      if (matched) return matched;

      const visit = await store.loadVisitMode(ctx, packet_id);
      if (!visit) {
        throw domainError(404, 'NOT_FOUND', 'api.error.visit_packet_not_found', { packet_id });
      }
      assertFreshVersion(visit, command);

      const verified_evidence =
        step === VisitStep.EVIDENCE_UPLOAD
          ? await store.verifyEvidenceUpload(ctx, {
              packet_id,
              step,
              visit,
              evidence_key: command.payload?.evidence_key ?? '',
            })
          : undefined;
      const response = projectVisitStepResponse(ctx, visit, step, command, verified_evidence);
      try {
        return await store.commitVisitStep(ctx, {
          packet_id,
          step,
          mutation_key,
          command,
          request_fingerprint,
          previous_visit: visit,
          response,
          verified_evidence,
        });
      } catch (error) {
        return replayIdempotentAfterCommitConflict({
          error,
          store,
          ctx,
          mutation_key,
          idempotency_key: command.idempotency_key,
          request_fingerprint,
        });
      }
    },
  };
}
