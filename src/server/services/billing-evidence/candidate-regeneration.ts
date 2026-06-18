import type { Prisma } from '@prisma/client';
import { readBillingCandidateWorkflowState } from './core';

export type RegeneratedBillingCandidateRecord = {
  id: string;
  dedupe_key: string | null;
  status: string;
  updated_at: Date;
  source_snapshot: Prisma.JsonValue | null;
};

export type RegeneratedBillingCandidateTx = {
  billingCandidate: {
    upsert(args: unknown): Promise<unknown>;
    updateMany?(args: unknown): Promise<{ count: number }>;
    findFirst?(
      args: unknown,
    ): Promise<{ status: string; source_snapshot?: Prisma.JsonValue | null } | null>;
  };
};

export function resolveRegeneratedCandidateStatus(
  existing: RegeneratedBillingCandidateRecord | undefined,
  proposedStatus: string,
): string {
  if (!existing) return proposedStatus;

  const workflow = readBillingCandidateWorkflowState(existing.source_snapshot);
  if (existing.status === 'exported' || workflow.closed_at) return 'exported';
  if (workflow.review_state === 'reviewed' && workflow.resolution_state === 'confirmed') {
    return 'confirmed';
  }
  if (workflow.review_state === 'reviewed' && workflow.resolution_state === 'excluded') {
    return 'excluded';
  }
  return proposedStatus;
}

function isRegenerationLocked(existing: RegeneratedBillingCandidateRecord): boolean {
  const workflow = readBillingCandidateWorkflowState(existing.source_snapshot);
  return (
    existing.status === 'exported' ||
    Boolean(workflow.closed_at) ||
    workflow.review_state === 'reviewed'
  );
}

function readStatus(result: unknown, fallbackStatus: string): { status: string } {
  return typeof result === 'object' &&
    result !== null &&
    'status' in result &&
    typeof (result as { status?: unknown }).status === 'string'
    ? { status: (result as { status: string }).status }
    : { status: fallbackStatus };
}

export async function persistRegeneratedBillingCandidate(
  tx: RegeneratedBillingCandidateTx,
  args: {
    orgId: string;
    dedupeKey: string;
    existing: RegeneratedBillingCandidateRecord | undefined;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
    updateScope?: Record<string, unknown>;
  },
): Promise<{ status: string }> {
  if (!args.existing) {
    const result = await tx.billingCandidate.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: args.orgId,
          dedupe_key: args.dedupeKey,
        },
      },
      create: args.create,
      update: {},
    });
    return readStatus(
      result,
      typeof args.create.status === 'string' ? args.create.status : 'candidate',
    );
  }

  if (isRegenerationLocked(args.existing)) {
    return { status: args.existing.status };
  }

  if (!tx.billingCandidate.updateMany) {
    throw new Error('BILLING_CANDIDATE_REGENERATION_UPDATE_UNAVAILABLE');
  }

  const updateResult = await tx.billingCandidate.updateMany({
    where: {
      id: args.existing.id,
      org_id: args.orgId,
      dedupe_key: args.dedupeKey,
      updated_at: args.existing.updated_at,
      ...(args.updateScope ?? {}),
    },
    data: args.update,
  });

  if (updateResult.count === 1) {
    return {
      status: typeof args.update.status === 'string' ? args.update.status : args.existing.status,
    };
  }

  const current = await tx.billingCandidate.findFirst?.({
    where: {
      id: args.existing.id,
      org_id: args.orgId,
    },
    select: {
      status: true,
      source_snapshot: true,
    },
  });
  return readStatus(current, args.existing.status);
}
