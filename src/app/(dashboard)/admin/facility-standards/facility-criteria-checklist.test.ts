import { describe, expect, it } from 'vitest';
import { buildFacilityCriteriaRows } from './facility-criteria-checklist';

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
});
