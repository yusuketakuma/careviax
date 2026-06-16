import { describe, expect, it } from 'vitest';
import {
  classifyPatientInsurances,
  formatCareLevel,
  formatCopayRatio,
  summarizePatientInsurance,
} from './insurance-summary';

describe('patient insurance summary helpers', () => {
  it('classifies active, upcoming, inactive, and expired records with @db.Date boundaries', () => {
    const today = new Date('2026-06-12T00:00:00.000Z');
    const records = [
      {
        id: 'starts_today',
        is_active: true,
        valid_from: new Date('2026-06-12T00:00:00.000Z'),
        valid_until: null,
      },
      {
        id: 'ends_today',
        is_active: true,
        valid_from: new Date('2026-04-01T00:00:00.000Z'),
        valid_until: new Date('2026-06-12T00:00:00.000Z'),
      },
      {
        id: 'upcoming',
        is_active: true,
        valid_from: new Date('2026-06-13T00:00:00.000Z'),
        valid_until: null,
      },
      {
        id: 'inactive',
        is_active: false,
        valid_from: new Date('2026-04-01T00:00:00.000Z'),
        valid_until: null,
      },
      {
        id: 'expired',
        is_active: true,
        valid_from: new Date('2026-04-01T00:00:00.000Z'),
        valid_until: new Date('2026-06-11T00:00:00.000Z'),
      },
    ];

    const result = classifyPatientInsurances(records, today);

    expect(result.current.map((record) => record.id)).toEqual(['starts_today', 'ends_today']);
    expect(result.upcoming.map((record) => record.id)).toEqual(['upcoming']);
    expect(result.history.map((record) => record.id)).toEqual(['inactive', 'expired']);
    expect(result.all).toBe(records);
  });

  it('builds card-safe public summaries without raw insurance identifiers', () => {
    const summary = summarizePatientInsurance(
      {
        insurance_type: 'public_subsidy',
        application_status: 'applying',
        public_program_code: '54',
        copay_ratio: 10,
        valid_from: new Date('2026-06-01T00:00:00.000Z'),
        valid_until: new Date('2026-06-30T00:00:00.000Z'),
        is_active: true,
        insurer_number: '21540000',
        number: '54001234',
        symbol: 'A-1',
        branch_number: '01',
        notes: 'raw note',
      } as never,
      new Date('2026-06-15T00:00:00.000Z'),
    );

    expect(summary).toEqual({
      insurance_type: '公費 54',
      status_label: '申請中',
      period_label: '2026-06-01 - 2026-06-30',
      copay_label: '10%',
      expires_soon: true,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).toContain('54');
    expect(serialized).not.toMatch(/21540000|54001234|A-1|raw note/);
    expect(serialized).not.toMatch(/insurer_number|number|symbol|branch_number|notes/);
  });

  it('formats labels shared by insurance detail UI', () => {
    expect(formatCopayRatio(30)).toBe('30%');
    expect(formatCopayRatio(null)).toBe('—');
    expect(formatCareLevel('care_2')).toBe('要介護2');
    expect(formatCareLevel(null)).toBe('—');
  });
});
