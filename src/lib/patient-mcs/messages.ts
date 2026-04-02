import type { PatientMcsViewMessage } from './dto';

export type PatientMcsMessageOrder = 'asc' | 'desc';
export type PatientMcsMessageGroup = {
  dayLabel: string;
  messages: PatientMcsViewMessage[];
};

function getSortableTimestamp(message: PatientMcsViewMessage) {
  const raw = message.postedAt ?? message.syncedAt;
  const parsed = raw ? new Date(raw).getTime() : Number.NaN;
  return Number.isNaN(parsed) ? null : parsed;
}

function compareMessageIds(leftId: string, rightId: string) {
  const leftNumber = Number(leftId);
  const rightNumber = Number(rightId);

  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return leftId.localeCompare(rightId);
}

export function orderPatientMcsMessages(
  messages: PatientMcsViewMessage[],
  order: PatientMcsMessageOrder
) {
  const direction = order === 'asc' ? 1 : -1;

  return [...messages].sort((left, right) => {
    const leftTime = getSortableTimestamp(left);
    const rightTime = getSortableTimestamp(right);
    if (leftTime === null && rightTime === null) {
      return compareMessageIds(left.sourceMessageId, right.sourceMessageId) * direction;
    }
    if (leftTime === null) return 1;
    if (rightTime === null) return -1;
    if (leftTime !== rightTime) {
      return (leftTime - rightTime) * direction;
    }

    const leftOrder = left.sortOrder ?? 0;
    const rightOrder = right.sortOrder ?? 0;
    if (leftOrder !== rightOrder) {
      return (leftOrder - rightOrder) * direction;
    }

    return compareMessageIds(left.sourceMessageId, right.sourceMessageId) * direction;
  });
}

export function groupPatientMcsMessagesByDay(
  messages: PatientMcsViewMessage[]
): PatientMcsMessageGroup[] {
  const groups: PatientMcsMessageGroup[] = [];

  for (const message of messages) {
    const raw = message.postedAt ?? message.syncedAt;
    const parsed = raw ? new Date(raw) : null;
    const dayLabel =
      parsed && !Number.isNaN(parsed.getTime())
        ? new Intl.DateTimeFormat('ja-JP', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(parsed)
        : '日時不明';
    const current = groups.at(-1);

    if (!current || current.dayLabel !== dayLabel) {
      groups.push({
        dayLabel,
        messages: [message],
      });
      continue;
    }

    current.messages.push(message);
  }

  return groups;
}
