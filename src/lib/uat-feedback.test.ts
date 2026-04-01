import { describe, expect, it } from 'vitest';
import {
  createUatFeedbackDraft,
  isUatFeedbackDraftDirty,
  isUnresolvedUatBlocker,
  mergeUatFeedbackDraft,
} from './uat-feedback';

describe('uat-feedback helpers', () => {
  it('preserves the current item status when seeding a new draft from a non-status edit', () => {
    const item = {
      status: 'resolved',
      owner_user_id: 'user_1',
      linked_work_item: 'CVX-101',
      due_date: '2026-04-05T00:00:00.000Z',
    } as const;

    const draft = mergeUatFeedbackDraft({
      item,
      patch: {
        linked_work_item: 'CVX-102',
      },
    });

    expect(draft).toEqual({
      status: 'resolved',
      owner_user_id: 'user_1',
      linked_work_item: 'CVX-102',
      due_date: '2026-04-05',
    });
  });

  it('detects draft dirtiness against the current item state', () => {
    const item = {
      status: 'triaged',
      owner_user_id: null,
      linked_work_item: null,
      due_date: null,
    };

    expect(
      isUatFeedbackDraftDirty({
        item,
        draft: createUatFeedbackDraft(item),
      })
    ).toBe(false);

    expect(
      isUatFeedbackDraftDirty({
        item,
        draft: {
          ...createUatFeedbackDraft(item),
          owner_user_id: 'user_2',
        },
      })
    ).toBe(true);
  });

  it('treats only unresolved critical/high feedback as blockers', () => {
    expect(isUnresolvedUatBlocker({ priority: 'critical', status: 'open' })).toBe(true);
    expect(isUnresolvedUatBlocker({ priority: 'high', status: 'triaged' })).toBe(true);
    expect(isUnresolvedUatBlocker({ priority: 'critical', status: 'resolved' })).toBe(false);
    expect(isUnresolvedUatBlocker({ priority: 'high', status: 'deferred' })).toBe(false);
    expect(isUnresolvedUatBlocker({ priority: 'medium', status: 'open' })).toBe(false);
  });
});
