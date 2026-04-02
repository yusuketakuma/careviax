export type SetAuditSubmission =
  | {
      kind: 'ready';
      payload:
        | {
            result: 'approved';
            approved_scope: Record<string, true>;
            reject_reason?: string;
          }
        | {
            result: 'partial_approved';
            approved_scope: Record<string, true>;
            reject_reason?: string;
          }
        | {
            result: 'rejected';
            reject_reason: string;
          };
    }
  | { kind: 'empty'; message: string }
  | { kind: 'pending'; message: string };

export type SetAuditSnapshot = {
  result: 'approved' | 'partial_approved' | 'rejected' | string;
  approved_scope: Record<string, unknown> | null;
  reject_reason: string | null;
};

export type SetBatchGroupInput = {
  id: string;
  slot: string;
  day_number: number;
};

export type SlotGroup<TBatch extends SetBatchGroupInput = SetBatchGroupInput> = {
  slot: string;
  slotLabel: string;
  batches: TBatch[];
};

export type DayGroup<TBatch extends SetBatchGroupInput = SetBatchGroupInput> = {
  dayNumber: number;
  slots: Array<SlotGroup<TBatch>>;
};

const DEFAULT_REJECT_REASON = '差戻し理由未記入';
const SLOT_LABELS: Record<string, string> = {
  morning: '朝食後',
  noon: '昼食後',
  evening: '夕食後',
  bedtime: '眠前',
  prn: '頓用',
};
const SLOT_ORDER = ['morning', 'noon', 'evening', 'bedtime', 'prn'];

function parseDayNumber(slotKey: string) {
  const [dayToken] = slotKey.split('-', 1);
  const dayNumber = Number.parseInt(dayToken ?? '', 10);
  return Number.isNaN(dayNumber) ? null : dayNumber;
}

function buildApprovedScope(slotKeys: string[]) {
  return Object.fromEntries(slotKeys.map((slotKey) => [slotKey, true] as const));
}

function extractApprovedSlotKeys(
  approvedScope: Record<string, unknown> | null,
  allSlotKeys: string[],
) {
  const validKeys = new Set(allSlotKeys);
  return Object.entries(approvedScope ?? {})
    .filter(([slotKey, isApproved]) => validKeys.has(slotKey) && isApproved === true)
    .map(([slotKey]) => slotKey);
}

function buildRejectReasonMap(slotKeys: string[], rejectReason: string | null) {
  const normalizedReason = rejectReason?.trim();
  if (!normalizedReason) return new Map<number, string>();

  const dayNumbers = Array.from(
    new Set(
      slotKeys
        .map((slotKey) => parseDayNumber(slotKey))
        .filter((dayNumber): dayNumber is number => dayNumber != null),
    ),
  );

  return new Map(dayNumbers.map((dayNumber) => [dayNumber, normalizedReason] as const));
}

function buildRejectReason(args: {
  rejectedSlotKeys: string[];
  rejectReasonsByDay: Map<number, string>;
}) {
  const dayNumbers = Array.from(
    new Set(
      args.rejectedSlotKeys
        .map((slotKey) => parseDayNumber(slotKey))
        .filter((dayNumber): dayNumber is number => dayNumber != null),
    ),
  ).sort((left, right) => left - right);

  const reasons = dayNumbers
    .map((dayNumber) => args.rejectReasonsByDay.get(dayNumber)?.trim())
    .filter((reason): reason is string => Boolean(reason));

  return reasons.length > 0 ? reasons.join(' / ') : DEFAULT_REJECT_REASON;
}

export function groupBatchesByDayAndSlot<TBatch extends SetBatchGroupInput>(
  batches: TBatch[],
): Array<DayGroup<TBatch>> {
  const dayMap = new Map<number, Map<string, TBatch[]>>();

  for (const batch of batches) {
    if (!dayMap.has(batch.day_number)) {
      dayMap.set(batch.day_number, new Map());
    }
    const slotMap = dayMap.get(batch.day_number)!;
    if (!slotMap.has(batch.slot)) {
      slotMap.set(batch.slot, []);
    }
    slotMap.get(batch.slot)!.push(batch);
  }

  return Array.from(dayMap.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([dayNumber, slotMap]) => ({
      dayNumber,
      slots: Array.from(slotMap.entries())
        .sort((left, right) => {
          const leftIndex = SLOT_ORDER.indexOf(left[0]);
          const rightIndex = SLOT_ORDER.indexOf(right[0]);
          return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
        })
        .map(([slot, slotBatches]) => ({
          slot,
          slotLabel: SLOT_LABELS[slot] ?? slot,
          batches: slotBatches,
        })),
    }));
}

export function buildSetAuditSubmission(args: {
  allSlotKeys: string[];
  localApproval: Map<string, boolean | null>;
  rejectReasonsByDay: Map<number, string>;
}): SetAuditSubmission {
  if (args.allSlotKeys.length === 0) {
    return { kind: 'empty', message: 'セットバッチが存在しません' };
  }

  const approvedSlotKeys = args.allSlotKeys.filter(
    (slotKey) => args.localApproval.get(slotKey) === true,
  );
  const rejectedSlotKeys = args.allSlotKeys.filter(
    (slotKey) => args.localApproval.get(slotKey) === false,
  );
  const reviewedCount = approvedSlotKeys.length + rejectedSlotKeys.length;

  if (reviewedCount === 0) {
    return { kind: 'empty', message: '鑑査対象がまだ選択されていません' };
  }

  if (reviewedCount !== args.allSlotKeys.length) {
    return { kind: 'pending', message: '未鑑査のスロットがあります' };
  }

  if (rejectedSlotKeys.length === 0) {
    return {
      kind: 'ready',
      payload: {
        result: 'approved',
        approved_scope: buildApprovedScope(approvedSlotKeys),
      },
    };
  }

  const rejectReason = buildRejectReason({
    rejectedSlotKeys,
    rejectReasonsByDay: args.rejectReasonsByDay,
  });

  if (approvedSlotKeys.length === 0) {
    return {
      kind: 'ready',
      payload: {
        result: 'rejected',
        reject_reason: rejectReason,
      },
    };
  }

  return {
    kind: 'ready',
    payload: {
      result: 'partial_approved',
      approved_scope: buildApprovedScope(approvedSlotKeys),
      reject_reason: rejectReason,
    },
  };
}

export function buildSetAuditHydrationState(args: {
  allSlotKeys: string[];
  latestAudit: SetAuditSnapshot | null;
  allowHydration?: boolean;
}) {
  const localApproval = new Map<string, boolean | null>();
  const rejectReasonsByDay = new Map<number, string>();
  const latestAudit = args.latestAudit;

  if (!latestAudit || args.allSlotKeys.length === 0 || args.allowHydration === false) {
    return { localApproval, rejectReasonsByDay };
  }

  const approvedSlotKeys = extractApprovedSlotKeys(
    latestAudit.approved_scope,
    args.allSlotKeys,
  );
  const approvedKeySet = new Set(approvedSlotKeys);
  const rejectedSlotKeys =
    latestAudit.result === 'rejected'
      ? [...args.allSlotKeys]
      : latestAudit.result === 'partial_approved'
        ? args.allSlotKeys.filter((slotKey) => !approvedKeySet.has(slotKey))
        : [];

  if (latestAudit.result === 'approved') {
    for (const slotKey of args.allSlotKeys) {
      localApproval.set(slotKey, true);
    }
  } else {
    for (const slotKey of approvedSlotKeys) {
      localApproval.set(slotKey, true);
    }
    for (const slotKey of rejectedSlotKeys) {
      localApproval.set(slotKey, false);
    }
  }

  for (const [dayNumber, reason] of buildRejectReasonMap(
    rejectedSlotKeys,
    latestAudit.reject_reason,
  )) {
    rejectReasonsByDay.set(dayNumber, reason);
  }

  return { localApproval, rejectReasonsByDay };
}
