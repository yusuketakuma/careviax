import { describe, expect, it } from 'vitest';

import {
  formatFacilityTimeValue,
  serializeFacilityResponse,
  toFacilityTimeValue,
} from './facility-api';

describe('facility API helpers', () => {
  it('converts HH:mm strings to UTC time-only dates and back', () => {
    const value = toFacilityTimeValue('09:30');

    expect(value).toEqual(new Date('1970-01-01T09:30:00.000Z'));
    expect(formatFacilityTimeValue(value)).toBe('09:30');
    expect(toFacilityTimeValue(null)).toBeNull();
    expect(formatFacilityTimeValue(null)).toBeNull();
  });

  it('serializes facilities while preserving existing list timestamp opt-in', () => {
    const serialized = serializeFacilityResponse(
      {
        id: 'facility_1',
        name: 'あおば苑',
        facility_type: 'nursing_home',
        address: null,
        phone: null,
        fax: null,
        acceptance_time_from: new Date('1970-01-01T09:00:00.000Z'),
        acceptance_time_to: new Date('1970-01-01T17:30:00.000Z'),
        regular_visit_weekdays: 'not-array',
        notes: null,
        _count: { residences: 3 },
        contacts: [
          {
            id: 'contact_1',
            name: '施設担当',
            role: null,
            phone: null,
            email: null,
            fax: null,
            is_primary: true,
            notes: null,
            updated_at: new Date('2026-03-02T00:05:00.000Z'),
          },
        ],
        created_at: new Date('2026-03-01T00:00:00.000Z'),
        updated_at: new Date('2026-03-02T00:00:00.000Z'),
      },
      { includeTimestamps: true },
    );

    expect(serialized).toMatchObject({
      acceptance_time_from: '09:00',
      acceptance_time_to: '17:30',
      regular_visit_weekdays: [],
      patient_count: 3,
      contacts: [{ updated_at: '2026-03-02T00:05:00.000Z' }],
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    });
  });

  it('does not add timestamps to detail responses unless requested', () => {
    const serialized = serializeFacilityResponse({
      id: 'facility_1',
      name: 'あおば苑',
      facility_type: 'nursing_home',
      address: null,
      phone: null,
      fax: null,
      acceptance_time_from: null,
      acceptance_time_to: null,
      regular_visit_weekdays: [],
      notes: null,
      patient_count: 0,
      contacts: [],
      created_at: new Date('2026-03-01T00:00:00.000Z'),
      updated_at: new Date('2026-03-02T00:00:00.000Z'),
    });

    expect(serialized).not.toHaveProperty('created_at');
    expect(serialized).not.toHaveProperty('updated_at');
  });
});
