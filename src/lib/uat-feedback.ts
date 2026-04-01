export type UatPriority = 'critical' | 'high' | 'medium' | 'low';
export type UatStatus = 'open' | 'triaged' | 'in_progress' | 'resolved' | 'deferred';

export type UatFeedbackDraft = {
  status: string;
  owner_user_id: string;
  linked_work_item: string;
  due_date: string;
};

export type UatFeedbackDraftSource = {
  status: string;
  owner_user_id: string | null;
  linked_work_item: string | null;
  due_date: string | null;
};

export type UatBlockerLike = {
  priority: string;
  status?: string | null;
};

function toDraftDueDate(value: string | null) {
  return value ? value.slice(0, 10) : '';
}

export function createUatFeedbackDraft(item: UatFeedbackDraftSource): UatFeedbackDraft {
  return {
    status: item.status,
    owner_user_id: item.owner_user_id ?? '',
    linked_work_item: item.linked_work_item ?? '',
    due_date: toDraftDueDate(item.due_date),
  };
}

export function mergeUatFeedbackDraft(args: {
  item: UatFeedbackDraftSource;
  currentDraft?: UatFeedbackDraft;
  patch: Partial<UatFeedbackDraft>;
}): UatFeedbackDraft {
  return {
    ...(args.currentDraft ?? createUatFeedbackDraft(args.item)),
    ...args.patch,
  };
}

export function isUatFeedbackDraftDirty(args: {
  item: UatFeedbackDraftSource;
  draft: UatFeedbackDraft;
}) {
  const baseline = createUatFeedbackDraft(args.item);
  return (
    args.draft.status !== baseline.status ||
    args.draft.owner_user_id !== baseline.owner_user_id ||
    args.draft.linked_work_item !== baseline.linked_work_item ||
    args.draft.due_date !== baseline.due_date
  );
}

export function isUnresolvedUatBlocker(item: UatBlockerLike) {
  const isPriorityBlocker = item.priority === 'critical' || item.priority === 'high';
  const isResolved = item.status === 'resolved' || item.status === 'deferred';
  return isPriorityBlocker && !isResolved;
}
