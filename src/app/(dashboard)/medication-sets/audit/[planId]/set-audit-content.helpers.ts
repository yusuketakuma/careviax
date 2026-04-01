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

const DEFAULT_REJECT_REASON = '差戻し理由未記入';

function parseDayNumber(slotKey: string) {
  const [dayToken] = slotKey.split('-', 1);
  const dayNumber = Number.parseInt(dayToken ?? '', 10);
  return Number.isNaN(dayNumber) ? null : dayNumber;
}

function buildApprovedScope(slotKeys: string[]) {
  return Object.fromEntries(slotKeys.map((slotKey) => [slotKey, true] as const));
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
