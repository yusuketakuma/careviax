export const COMMUNICATION_REQUEST_STATUSES = [
  'draft',
  'sent',
  'received',
  'in_progress',
  'responded',
  'closed',
  'escalated',
  'cancelled',
  'expired',
] as const;

export type CommunicationRequestStatus = (typeof COMMUNICATION_REQUEST_STATUSES)[number];

/** Statuses that participate in reply-request deduplication on the provider. */
export const ACTIVE_REPLY_REQUEST_STATUSES = [
  'draft',
  'sent',
  'received',
  'in_progress',
  'responded',
  'escalated',
] as const satisfies readonly CommunicationRequestStatus[];

const activeReplyRequestStatusSet = new Set<CommunicationRequestStatus>(
  ACTIVE_REPLY_REQUEST_STATUSES,
);
const communicationRequestStatusSet = new Set<CommunicationRequestStatus>(
  COMMUNICATION_REQUEST_STATUSES,
);

export function isActiveReplyRequestStatus(status: string): boolean {
  const candidate = status as CommunicationRequestStatus;
  // Unknown statuses should prevent a duplicate write even though the response
  // schema normally rejects them before this helper is reached.
  return (
    !communicationRequestStatusSet.has(candidate) || activeReplyRequestStatusSet.has(candidate)
  );
}
