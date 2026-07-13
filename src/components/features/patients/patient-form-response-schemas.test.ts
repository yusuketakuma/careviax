import { describe, expect, it } from 'vitest';
import {
  patientDuplicateCheckResponseSchema,
  patientFormFacilitiesResponseSchema,
  patientFormStaffResponseSchema,
} from './patient-form-response-schemas';

const emptyMeta = {
  total_count: 0,
  visible_count: 0,
  hidden_count: 0,
  truncated: false,
  count_basis: 'facilities',
  filters_applied: {},
  limit: 100,
};

describe('patient form response schemas', () => {
  it('normalizes duplicate candidates without adding provider PHI', () => {
    const parsed = patientDuplicateCheckResponseSchema.safeParse({
      data: {
        duplicates: [
          {
            id: 'patient_1',
            name: '患者A',
            birth_date: '1950-01-01T00:00:00.000Z',
            gender: 'male',
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('duplicate response should parse');
    expect(parsed.data.data.duplicates[0]?.name_kana).toBeNull();
  });

  it('strips unused facility provider fields and validates count metadata', () => {
    const parsed = patientFormFacilitiesResponseSchema.safeParse({
      data: [
        {
          id: 'facility_1',
          name: '施設A',
          address: null,
          contacts: [{ phone: 'secret' }],
          patient_count: 3,
        },
      ],
      meta: { ...emptyMeta, total_count: 1, visible_count: 1 },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('facility response should parse');
    expect(parsed.data.data).toEqual([{ id: 'facility_1', name: '施設A', address: null }]);
    expect(
      patientFormFacilitiesResponseSchema.safeParse({
        data: [],
        meta: { ...emptyMeta, total_count: 1 },
      }).success,
    ).toBe(false);
  });

  it('strips staff role after validating the eligible member response', () => {
    expect(
      patientFormStaffResponseSchema.parse({
        data: [{ id: 'staff_1', name: '事務A', role: 'clerk' }],
      }),
    ).toEqual({ data: [{ id: 'staff_1', name: '事務A' }] });
  });
});
