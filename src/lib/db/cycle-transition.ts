/**
 * MedicationCycle 状態遷移の一元管理
 *
 * Status-only 契約:
 * - ALLOWED_TRANSITIONS に基づく遷移検証
 * - version increment（楽観的ロック）
 * - CycleTransitionLog 記録
 *
 * 副作用（通知、WorkflowException、タスク作成等）はcaller側で実行すること。
 */

type CycleStatus =
  | 'intake_received'
  | 'structuring'
  | 'inquiry_pending'
  | 'inquiry_resolved'
  | 'ready_to_dispense'
  | 'dispensing'
  | 'dispensed'
  | 'audit_pending'
  | 'audited'
  | 'setting'
  | 'set_audited'
  | 'visit_ready'
  | 'visit_completed'
  | 'reported'
  | 'on_hold'
  | 'cancelled';

// Allowed status transitions: from -> set of valid next statuses
export const ALLOWED_TRANSITIONS: Record<CycleStatus, CycleStatus[]> = {
  intake_received: ['structuring', 'inquiry_pending', 'on_hold', 'cancelled'],
  structuring: ['ready_to_dispense', 'inquiry_pending', 'on_hold', 'cancelled'],
  inquiry_pending: ['inquiry_resolved', 'on_hold', 'cancelled'],
  inquiry_resolved: ['ready_to_dispense', 'on_hold', 'cancelled'],
  ready_to_dispense: ['dispensing', 'on_hold', 'cancelled'],
  dispensing: ['dispensed', 'audit_pending', 'on_hold', 'cancelled'],
  dispensed: ['audit_pending', 'on_hold', 'cancelled'],
  audit_pending: ['audited', 'dispensing', 'on_hold', 'cancelled'],
  audited: ['setting', 'visit_ready', 'on_hold', 'cancelled'],
  setting: ['set_audited', 'on_hold', 'cancelled'],
  set_audited: ['visit_ready', 'setting', 'on_hold', 'cancelled'],
  visit_ready: ['visit_completed', 'on_hold', 'cancelled'],
  visit_completed: ['reported', 'on_hold'],
  reported: ['on_hold'],
  on_hold: ['intake_received', 'structuring', 'ready_to_dispense', 'cancelled'],
  cancelled: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`Invalid transition: ${fromStatus} → ${toStatus}`);
    this.name = 'InvalidTransitionError';
  }
}

export class VersionConflictError extends Error {
  constructor() {
    super('他のユーザーによって更新されています。再読み込みしてください');
    this.name = 'VersionConflictError';
  }
}

interface TransitionOptions {
  exceptionStatus?: string | null;
  note?: string;
}

type TransitionCycleRow = {
  id: string;
  overall_status: string;
  version: number;
  patient_id: string | null;
};

export type TransitionCycleDb = {
  medicationCycle: {
    findFirst(args: unknown): Promise<TransitionCycleRow | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  cycleTransitionLog: {
    create(args: unknown): Promise<unknown>;
  };
};

export type PreHoldStatusDb = {
  cycleTransitionLog: {
    findFirst(args: unknown): Promise<{ from_status: string | null } | null>;
  };
};

/**
 * MedicationCycle の状態を遷移させる。
 * 遷移検証 + version increment + CycleTransitionLog 記録を一括で実行。
 */
export async function transitionCycleStatus(
  tx: TransitionCycleDb,
  cycleId: string,
  orgId: string,
  newStatus: string,
  userId: string,
  options?: TransitionOptions,
) {
  // 1. Fetch current cycle
  const cycle = await tx.medicationCycle.findFirst({
    where: { id: cycleId, org_id: orgId },
    select: { id: true, overall_status: true, version: true, patient_id: true },
  });

  if (!cycle) {
    throw new Error(`MedicationCycle not found: ${cycleId}`);
  }

  // 2. Validate transition
  const allowed = ALLOWED_TRANSITIONS[cycle.overall_status as CycleStatus] ?? [];
  if (!allowed.includes(newStatus as CycleStatus)) {
    throw new InvalidTransitionError(cycle.overall_status, newStatus);
  }

  // 3. Update with version increment (optimistic lock)
  const updated = await tx.medicationCycle.updateMany({
    where: { id: cycleId, version: cycle.version },
    data: {
      overall_status: newStatus as CycleStatus,
      version: { increment: 1 },
      ...(options?.exceptionStatus !== undefined
        ? { exception_status: options.exceptionStatus }
        : {}),
    },
  });

  if (updated.count === 0) {
    throw new VersionConflictError();
  }

  // 4. Create CycleTransitionLog
  await tx.cycleTransitionLog.create({
    data: {
      org_id: orgId,
      cycle_id: cycleId,
      from_status: cycle.overall_status,
      to_status: newStatus,
      actor_id: userId,
      note: options?.note,
    },
  });

  // 5. Return minimal updated state (avoid extra re-fetch)
  return {
    id: cycleId,
    patient_id: cycle.patient_id,
    overall_status: newStatus,
    version: cycle.version + 1,
  };
}

/**
 * on_hold 遷移前の状態を CycleTransitionLog から導出する。
 * on_hold に遷移した記録がない場合は null を返す。
 */
export async function getPreHoldStatus(
  tx: PreHoldStatusDb,
  cycleId: string,
): Promise<string | null> {
  const log = await tx.cycleTransitionLog.findFirst({
    where: {
      cycle_id: cycleId,
      to_status: 'on_hold',
    },
    orderBy: { created_at: 'desc' },
    select: { from_status: true },
  });

  return log?.from_status ?? null;
}

/**
 * Display-only phase grouping for UI labels and logging.
 * NOT a transition gate. ALLOWED_TRANSITIONS is the sole SSOT for valid transitions.
 * Do NOT use getCyclePhase() or CYCLE_PHASES to block or gate state transitions.
 */
export const CYCLE_PHASES = {
  intake: ['intake_received', 'structuring', 'inquiry_pending', 'inquiry_resolved'],
  dispensing: ['ready_to_dispense', 'dispensing', 'dispensed'],
  audit: ['audit_pending', 'audited'],
  setting: ['setting', 'set_audited'],
  delivery: ['visit_ready', 'visit_completed', 'reported'],
  terminal: ['on_hold', 'cancelled'],
} as const;

export type CyclePhase = keyof typeof CYCLE_PHASES;

const STATUS_TO_PHASE = new Map<string, CyclePhase>();
for (const [phase, statuses] of Object.entries(CYCLE_PHASES)) {
  for (const status of statuses) {
    STATUS_TO_PHASE.set(status, phase as CyclePhase);
  }
}

/**
 * Resolve the phase for a given MedicationCycle status.
 * @remarks Display/logging only. Not a transition gate.
 */
export function getCyclePhase(status: string): CyclePhase | null {
  return STATUS_TO_PHASE.get(status) ?? null;
}
