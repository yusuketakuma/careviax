import { describe, expect, it } from 'vitest';
import {
  ACTIVE_REPLY_REQUEST_STATUSES,
  COMMUNICATION_REQUEST_STATUSES,
  isActiveReplyRequestStatus,
} from './request-status';

describe('reply request status semantics', () => {
  it('matches provider deduplication semantics for every request status', () => {
    expect(ACTIVE_REPLY_REQUEST_STATUSES).toEqual([
      'draft',
      'sent',
      'received',
      'in_progress',
      'responded',
      'escalated',
    ]);
    expect(
      Object.fromEntries(
        COMMUNICATION_REQUEST_STATUSES.map((status) => [
          status,
          isActiveReplyRequestStatus(status),
        ]),
      ),
    ).toEqual({
      draft: true,
      sent: true,
      received: true,
      in_progress: true,
      responded: true,
      closed: false,
      escalated: true,
      cancelled: false,
      expired: false,
    });
  });

  it('fails closed for unknown provider statuses', () => {
    expect(isActiveReplyRequestStatus('unknown')).toBe(true);
  });
});
