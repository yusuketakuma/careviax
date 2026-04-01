import { describe, expect, it } from 'vitest';
import { buildUatFeedbackSummary } from './uat-feedback-summary';

describe('buildUatFeedbackSummary', () => {
  it('prioritizes critical/high items and aggregates checklist coverage', () => {
    const summary = buildUatFeedbackSummary({
      now: new Date('2026-03-31T00:00:00.000Z'),
      feedback: [
        {
          id: 'f1',
          priority: 'critical',
          status: 'open',
          feedback: '訪問記録保存時に固まる',
          checklist_progress: '6/8',
          checked_items: ['flow_patient_to_report', 'flow_inquiry'],
          source: 'pilot',
          created_at: new Date('2026-03-30T10:00:00.000Z'),
        },
        {
          id: 'f2',
          priority: 'medium',
          status: 'resolved',
          feedback: '文字サイズを少し上げたい',
          checklist_progress: '7/8',
          checked_items: ['flow_patient_to_report'],
          source: 'pilot',
          created_at: new Date('2026-03-30T11:00:00.000Z'),
        },
      ],
    });

    expect(summary.blocker_count).toBe(1);
    expect(summary.action_items).toHaveLength(1);
    expect(summary.action_items[0]).toMatchObject({
      id: 'f1',
      priority: 'critical',
    });
    expect(summary.checklist_coverage.find((item) => item.item_id === 'flow_patient_to_report'))
      .toMatchObject({ checked_count: 2 });
    expect(summary.recommendations[0]).toContain('blocker');
  });

  it('tells operators to collect pilot feedback when nothing is recorded', () => {
    const summary = buildUatFeedbackSummary({ feedback: [] });

    expect(summary.total_feedback).toBe(0);
    expect(summary.blocker_count).toBe(0);
    expect(summary.recommendations.some((item) => item.includes('まだ UAT フィードバックがありません'))).toBe(true);
  });
});
