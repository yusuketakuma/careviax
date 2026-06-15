import { describe, expect, it } from 'vitest';
import {
  buildFacilityCriteriaRows,
  summarizeFacilityCriteriaRows,
} from './facility-criteria-checklist';

describe('buildFacilityCriteriaRows', () => {
  it('maps requirement flags to ok / missing and unknown keys to checking', () => {
    const rows = buildFacilityCriteriaRows([
      {
        requirements_status: {
          home_visit_record: true,
          emergency_response: true,
          training_record: false,
          document_delivery: true,
        },
      },
    ]);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.status]));

    expect(byKey).toEqual({
      home_visit_record: 'ok',
      emergency_response: 'ok',
      training_record: 'missing',
      document_delivery: 'ok',
      electronic_collaboration: 'checking',
    });
  });

  it('treats a false in any registration as missing', () => {
    const rows = buildFacilityCriteriaRows([
      { requirements_status: { home_visit_record: true } },
      { requirements_status: { home_visit_record: false } },
    ]);
    expect(rows.find((row) => row.key === 'home_visit_record')?.status).toBe('missing');
  });

  it('marks everything checking without registrations', () => {
    const rows = buildFacilityCriteriaRows([]);
    expect(rows.every((row) => row.status === 'checking')).toBe(true);
    expect(rows).toHaveLength(5);
  });

  it('summarizes missing criteria as blocked with the first next action', () => {
    const rows = buildFacilityCriteriaRows([
      {
        requirements_status: {
          home_visit_record: true,
          emergency_response: true,
          training_record: false,
          document_delivery: true,
          electronic_collaboration: false,
        },
      },
    ]);

    expect(summarizeFacilityCriteriaRows(rows)).toMatchObject({
      okCount: 3,
      missingCount: 2,
      checkingCount: 0,
      statusLabel: '算定不可',
      statusTone: 'missing',
      missingLabels: ['研修記録', '電子的連携'],
      nextAction: '研修記録の資料を追加してから再確認します。',
    });
  });

  it('summarizes all-ok criteria as claimable', () => {
    const rows = buildFacilityCriteriaRows([
      {
        requirements_status: {
          home_visit_record: true,
          emergency_response: true,
          training_record: true,
          document_delivery: true,
          electronic_collaboration: true,
        },
      },
    ]);

    expect(summarizeFacilityCriteriaRows(rows)).toMatchObject({
      okCount: 5,
      missingCount: 0,
      checkingCount: 0,
      statusLabel: '算定可',
      statusTone: 'ok',
      nextAction: '現時点で不足はありません。期限アラートだけ継続確認します。',
    });
  });
});
