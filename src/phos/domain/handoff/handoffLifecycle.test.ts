import { describe, expect, it } from 'vitest';
import { ActionCode, HandoffStatus, HandoffUrgency } from '@/phos/contracts/phos_contracts';
import type { HandoffView } from '@/phos/contracts/phos_contracts';
import {
  openHandoffForReview,
  resolveHandoff,
  returnHandoff,
  sortHandoffQueue,
} from './handoffLifecycle';

function handoff(overrides: Partial<HandoffView> = {}): HandoffView {
  return {
    handoff_id: 'handoff_1',
    card_id: 'card_1',
    status: HandoffStatus.OPEN,
    reason_code: 'DIFF_REVIEW',
    summary: '薬剤師確認が必要です。',
    source_refs: [],
    requested_action: ActionCode.CONFIRM_PRESCRIPTION_DIFF,
    urgency: HandoffUrgency.NORMAL,
    created_by_user_id: 'user_clerk',
    created_at: '2026-06-09T00:00:00.000Z',
    updated_at: '2026-06-09T00:00:00.000Z',
    server_version: 1,
    patient_name: '患者 山田太郎',
    age_minutes: 10,
    ...overrides,
  };
}

describe('handoffLifecycle', () => {
  it('sorts pharmacist queue by urgency desc then age desc', () => {
    expect(
      sortHandoffQueue([
        handoff({ handoff_id: 'normal_old', urgency: HandoffUrgency.NORMAL, age_minutes: 90 }),
        handoff({ handoff_id: 'urgent_new', urgency: HandoffUrgency.URGENT, age_minutes: 5 }),
        handoff({ handoff_id: 'urgent_old', urgency: HandoffUrgency.URGENT, age_minutes: 20 }),
      ]).map((entry) => entry.handoff_id),
    ).toEqual(['urgent_old', 'urgent_new', 'normal_old']);
  });

  it('opens only OPEN handoffs for review', () => {
    expect(openHandoffForReview(handoff()).status).toBe(HandoffStatus.IN_REVIEW);
    expect(() => openHandoffForReview(handoff({ status: HandoffStatus.RETURNED }))).toThrow(
      'Only OPEN handoffs can move to review.',
    );
  });

  it('resolves IN_REVIEW handoffs and emits BLOCKER_RESOLVED when related', () => {
    expect(
      resolveHandoff({
        handoff: handoff({ status: HandoffStatus.IN_REVIEW }),
        resolved_action_code: ActionCode.RESOLVE_CLERK_BLOCKER,
        related_blocker_code: 'MISSING_CONTACT',
      }),
    ).toEqual({
      status: HandoffStatus.RESOLVED,
      resolved_action_code: ActionCode.RESOLVE_CLERK_BLOCKER,
      side_effects: [{ type: 'BLOCKER_RESOLVED', blocker_code: 'MISSING_CONTACT' }],
    });
  });

  it('requires reason and note when returning an IN_REVIEW handoff', () => {
    expect(() =>
      returnHandoff({
        handoff: handoff({ status: HandoffStatus.IN_REVIEW }),
        return_reason_code: 'NEED_MORE_INFO',
        return_note: '',
      }),
    ).toThrow('Return reason and note are required.');

    expect(
      returnHandoff({
        handoff: handoff({ status: HandoffStatus.IN_REVIEW }),
        return_reason_code: 'NEED_MORE_INFO',
        return_note: '情報が不足しています。',
      }),
    ).toMatchObject({
      status: HandoffStatus.RETURNED,
      return_reason_code: 'NEED_MORE_INFO',
      return_note: '情報が不足しています。',
    });
  });
});
