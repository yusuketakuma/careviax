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

// ── p0_15 セット監査 3ペイン再構築 ──

/** 監査チェックの6項目(右ペイン)。キーは checklist Json に保存される。 */
export const SET_AUDIT_CHECKLIST_ITEMS = [
  { key: 'date_match', label: '日付が合っている' },
  { key: 'timing_match', label: '服用時点が合っている' },
  { key: 'quantity_match', label: '数量が合っている' },
  { key: 'no_discontinued', label: '中止薬が入っていない' },
  { key: 'residual_usage_ok', label: '残薬の使い方が合っている' },
  { key: 'cold_storage_separated', label: '冷所品が分かれている' },
] as const;

export type SetAuditChecklistKey = (typeof SET_AUDIT_CHECKLIST_ITEMS)[number]['key'];

/** 写真・実物確認(中央ペイン)のスロット定義。photo_asset_ids にまとめて保存する。 */
export const SET_AUDIT_PHOTO_SLOTS = [
  { key: 'before', label: 'セット前' },
  { key: 'after', label: 'セット後' },
  { key: 'placement', label: '設置予定' },
] as const;

export type SetAuditPhotoSlotKey = (typeof SET_AUDIT_PHOTO_SLOTS)[number]['key'];

const SET_METHOD_LABELS: Record<string, string> = {
  facility_calendar: 'お薬カレンダー',
  four_times_daily: '4回／日(朝昼夕眠前)',
  bedtime_only: '眠前のみ',
  custom: 'カスタム',
};

export type SetInstructionPlan = {
  set_method: string | null;
  target_period_start: string | null;
  target_period_end: string | null;
  notes: string | null;
  packaging_method_ref: { name: string | null } | null;
};

/** セット指示(左ペイン)の箇条書きを SetPlan から組み立てる。 */
export function buildSetInstructionLines(plan: SetInstructionPlan | null): string[] {
  if (!plan) return [];
  const lines: string[] = [];

  const methodLabel = plan.set_method ? (SET_METHOD_LABELS[plan.set_method] ?? plan.set_method) : null;
  if (methodLabel) {
    lines.push(`セット方法：${methodLabel}`);
  }
  if (plan.packaging_method_ref?.name) {
    lines.push(`配薬方法：${plan.packaging_method_ref.name}`);
  }
  if (plan.target_period_start && plan.target_period_end) {
    lines.push(`期間：${plan.target_period_start}〜${plan.target_period_end}`);
  }
  const notes = plan.notes?.trim();
  if (notes) {
    for (const note of notes.split('\n').map((line) => line.trim()).filter(Boolean)) {
      lines.push(note);
    }
  }
  return lines;
}

export type SetAuditPaneSubmission =
  | {
      kind: 'ready';
      payload: {
        result: 'approved' | 'rejected';
        reject_reason?: string;
        checklist: Record<string, boolean>;
        photo_asset_ids: string[];
      };
    }
  | { kind: 'incomplete'; message: string };

/**
 * 3ペイン(監査OK / 差し戻す)の送信ペイロードを組み立てる。
 * 監査OK は6項目すべてチェック済みを要求。差し戻すは理由必須。
 */
export function buildSetAuditPaneSubmission(args: {
  decision: 'approved' | 'rejected';
  checklist: Record<string, boolean>;
  photoAssetIds: string[];
  rejectReason?: string;
}): SetAuditPaneSubmission {
  const checklist = Object.fromEntries(
    SET_AUDIT_CHECKLIST_ITEMS.map((item) => [item.key, args.checklist[item.key] === true] as const),
  );

  if (args.decision === 'approved') {
    const allChecked = SET_AUDIT_CHECKLIST_ITEMS.every((item) => checklist[item.key] === true);
    if (!allChecked) {
      return { kind: 'incomplete', message: '監査OKには全6項目のチェックが必要です' };
    }
    return {
      kind: 'ready',
      payload: {
        result: 'approved',
        checklist,
        photo_asset_ids: args.photoAssetIds,
      },
    };
  }

  const rejectReason = args.rejectReason?.trim();
  if (!rejectReason) {
    return { kind: 'incomplete', message: '差し戻しには理由が必要です' };
  }
  return {
    kind: 'ready',
    payload: {
      result: 'rejected',
      reject_reason: rejectReason,
      checklist,
      photo_asset_ids: args.photoAssetIds,
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
