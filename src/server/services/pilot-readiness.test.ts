import { describe, expect, it } from 'vitest';
import { buildPilotReadinessSnapshot } from './pilot-readiness';

describe('buildPilotReadinessSnapshot', () => {
  it('flags phase2 candidates and blockers from current case/feedback mix', () => {
    const snapshot = buildPilotReadinessSnapshot({
      now: new Date('2026-03-31T00:00:00.000Z'),
      cases: [
        {
          id: 'case_1',
          status: 'active',
          required_visit_support: { set_pilot_enabled: true },
          patient: {
            id: 'patient_1',
            name: '田中 一郎',
            residences: [{ facility_id: 'facility_1' }],
          },
        },
        {
          id: 'case_2',
          status: 'active',
          required_visit_support: null,
          patient: {
            id: 'patient_2',
            name: '山田 花子',
            residences: [{ facility_id: null }],
          },
        },
      ],
      feedback: [
        {
          id: 'feedback_1',
          priority: 'high',
          status: 'open',
          feedback: '戻る導線が分かりづらい',
          checklist_progress: '4/7',
          source: 'pilot_pharmacy',
          created_at: new Date('2026-03-30T12:00:00.000Z'),
        },
      ],
    });

    expect(snapshot.case_summary).toMatchObject({
      active_case_count: 2,
      facility_linked_case_count: 1,
      set_pilot_case_count: 1,
    });
    expect(snapshot.uat_summary.blocker_count).toBe(1);
    expect(snapshot.decisions.phase2_entry).toBe('blocked');
    expect(snapshot.recommendations).toContain(
      'UAT に critical/high が 1 件あります。Phase 2 開始前に優先修正を完了してください。',
    );
  });

  it('recommends phase2 deferral when facility/set pilot data is absent', () => {
    const snapshot = buildPilotReadinessSnapshot({
      cases: [
        {
          id: 'case_1',
          status: 'assessment',
          required_visit_support: null,
          patient: {
            id: 'patient_1',
            name: '佐藤 次郎',
            residences: [{ facility_id: null }],
          },
        },
        {
          id: 'case_2',
          status: 'active',
          required_visit_support: [{ set_pilot_enabled: true }],
          patient: {
            id: 'patient_2',
            name: '配列 設定',
            residences: [{ facility_id: null }],
          },
        },
      ],
      feedback: [],
    });

    expect(snapshot.case_summary.set_pilot_case_count).toBe(0);
    expect(snapshot.decisions).toMatchObject({
      facility_batching: 'phase2_candidate',
      medication_set_workflow: 'phase2_candidate',
      phase2_entry: 'ready',
    });
    expect(snapshot.recommendations.some((item) => item.includes('FacilityVisitBatch'))).toBe(true);
    expect(snapshot.recommendations.some((item) => item.includes('セット本格機能'))).toBe(true);
  });

  it('does not block phase2 when critical/high items are already resolved or deferred', () => {
    const snapshot = buildPilotReadinessSnapshot({
      cases: [],
      feedback: [
        {
          id: 'feedback_1',
          priority: 'critical',
          status: 'resolved',
          feedback: '保存失敗',
          checklist_progress: '8/8',
          source: 'pilot_pharmacy',
          created_at: new Date('2026-03-31T12:00:00.000Z'),
        },
        {
          id: 'feedback_2',
          priority: 'high',
          status: 'deferred',
          feedback: '改善要望',
          checklist_progress: '8/8',
          source: 'pilot_pharmacy',
          created_at: new Date('2026-03-31T11:00:00.000Z'),
        },
      ],
    });

    expect(snapshot.uat_summary.blocker_count).toBe(0);
    expect(snapshot.decisions.phase2_entry).toBe('ready');
  });
});
