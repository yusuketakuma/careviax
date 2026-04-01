import { describe, expect, it } from 'vitest';
import {
  compareDispenseWorkflowOrder,
  getDispenseWorkflowPriorityWeight,
} from './workflow-order';

describe('dispensing workflow order', () => {
  it('sorts by priority first', () => {
    expect(getDispenseWorkflowPriorityWeight('emergency')).toBeLessThan(
      getDispenseWorkflowPriorityWeight('urgent'),
    );
    expect(getDispenseWorkflowPriorityWeight('urgent')).toBeLessThan(
      getDispenseWorkflowPriorityWeight('normal'),
    );
  });

  it('prefers overdue items when requested before fallback timestamps', () => {
    const left = {
      priority: 'normal',
      due_date: '2026-04-02T09:00:00.000Z',
      created_at: '2026-04-01T09:00:00.000Z',
      is_overdue: true,
    };
    const right = {
      priority: 'normal',
      due_date: '2026-04-02T09:00:00.000Z',
      created_at: '2026-04-01T08:00:00.000Z',
      is_overdue: false,
    };

    expect(
      compareDispenseWorkflowOrder(left, right, {
        includeOverdue: true,
      }),
    ).toBeLessThan(0);
  });
});
