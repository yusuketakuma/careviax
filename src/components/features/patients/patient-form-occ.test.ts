import { describe, expect, it } from 'vitest';
import { HOME_VISIT_SCHEDULING_PREFERENCE_KEYS } from '@/lib/patient/home-visit-intake-patch';
import {
  buildPatientEditPayload,
  hasPatientEditConcurrencyAuthority,
  isValidPatientEditAcknowledgement,
  isPatientSchedulingPreferenceFieldName,
} from './patient-form-occ';

const base = {
  name: '患者A',
  name_kana: 'カンジャエー',
  birth_date: '1980-01-01',
  gender: 'male' as const,
};

describe('patient form optimistic concurrency payload', () => {
  it('sends both patient and care-case revisions for care-case-owned changes', () => {
    expect(
      buildPatientEditPayload({
        data: { ...base, intake: { medication_manager: 'self' } },
        expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
        selectedCareCase: { id: 'case_1', version: 4 },
        duplicateAcknowledged: false,
      }),
    ).toMatchObject({
      expected_updated_at: '2026-07-22T00:00:00.000Z',
      care_case_id: 'case_1',
      expected_care_case_version: 4,
      intake: { medication_manager: 'self' },
    });
  });

  it('sends an explicit null case pair for patient and scheduling changes without a case', () => {
    expect(
      buildPatientEditPayload({
        data: {
          ...base,
          phone: '0312345678',
          intake: { first_visit_time_note: '午前' },
        },
        expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
        selectedCareCase: null,
        duplicateAcknowledged: false,
      }),
    ).toEqual({
      ...base,
      phone: '0312345678',
      intake: { first_visit_time_note: '午前' },
      expected_updated_at: '2026-07-22T00:00:00.000Z',
      care_case_id: null,
      expected_care_case_version: null,
    });
  });

  it('fails closed instead of silently stripping care-case-owned draft values', () => {
    expect(() =>
      buildPatientEditPayload({
        data: {
          ...base,
          requester: { organization_name: '地域連携室' },
          intake: { first_visit_time_note: '午前', medication_manager: 'self' },
        },
        expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
        selectedCareCase: null,
        duplicateAcknowledged: false,
      }),
    ).toThrow('Care-case-owned patient intake requires a selected care case');
  });

  it('uses the server scheduling-preference key SSOT for every client field guard', () => {
    expect(HOME_VISIT_SCHEDULING_PREFERENCE_KEYS).toEqual([
      'primary_contact_preference',
      'visit_before_contact_required',
      'first_visit_preferred_date',
      'first_visit_time_slot',
      'first_visit_time_note',
      'parking_available',
      'mcs_linked',
      'adl_level',
      'dementia_level',
      'swallowing_route',
      'care_level',
      'infection_isolation',
    ]);
    for (const key of HOME_VISIT_SCHEDULING_PREFERENCE_KEYS) {
      expect(isPatientSchedulingPreferenceFieldName(`intake.${key}`)).toBe(true);
    }
    expect(isPatientSchedulingPreferenceFieldName('intake.medication_manager')).toBe(false);
    expect(isPatientSchedulingPreferenceFieldName('requester.organization_name')).toBe(false);
  });

  it('materializes dirty edit-mode tri-state clears as explicit null sentinels', () => {
    expect(
      buildPatientEditPayload({
        data: {
          ...base,
          intake: {
            mcs_linked: undefined,
            medication_manager: undefined,
            home_pharmacy_add_on_2: { candidate: undefined },
          },
        },
        dirtyFields: {
          intake: {
            mcs_linked: true,
            medication_manager: true,
            home_pharmacy_add_on_2: { candidate: true },
          },
        },
        expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
        selectedCareCase: { id: 'case_1', version: 5 },
        duplicateAcknowledged: false,
      }),
    ).toMatchObject({
      intake: {
        mcs_linked: null,
        medication_manager: null,
        home_pharmacy_add_on_2: { candidate: null },
      },
      care_case_id: 'case_1',
      expected_care_case_version: 5,
    });
  });

  it('keeps a dirty scheduling clear in the no-case projection with the null OCC pair', () => {
    expect(
      buildPatientEditPayload({
        data: { ...base, intake: { mcs_linked: undefined } },
        dirtyFields: { intake: { mcs_linked: true } },
        expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
        selectedCareCase: null,
        duplicateAcknowledged: false,
      }),
    ).toMatchObject({
      intake: { mcs_linked: null },
      care_case_id: null,
      expected_care_case_version: null,
    });
  });

  it('requires the selected case revision even for scheduling-preference intake changes', () => {
    expect(
      buildPatientEditPayload({
        data: { ...base, intake: { first_visit_time_note: '' } },
        expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
        selectedCareCase: { id: 'case_1', version: 3 },
        duplicateAcknowledged: false,
      }),
    ).toMatchObject({
      intake: { first_visit_time_note: '' },
      care_case_id: 'case_1',
      expected_care_case_version: 3,
    });
  });

  it('omits empty nested objects and rejects a missing patient revision', () => {
    const payload = buildPatientEditPayload({
      data: { ...base, requester: {}, intake: {} },
      expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
      selectedCareCase: { id: 'case_1', version: 1 },
      duplicateAcknowledged: false,
    });
    expect(payload).not.toHaveProperty('requester');
    expect(payload).not.toHaveProperty('intake');
    expect(payload).not.toHaveProperty('care_case_id');
    expect(hasPatientEditConcurrencyAuthority(null)).toBe(false);
    expect(hasPatientEditConcurrencyAuthority('')).toBe(false);
  });
});

describe('patient edit acknowledgement', () => {
  const acknowledgement = {
    data: {
      id: 'patient_1',
      updated_at: '2026-07-22T00:00:01.000Z',
    },
    meta: {
      version_basis: {
        patient_updated_at: '2026-07-22T00:00:01.000Z',
        care_case_id: null,
        care_case_version: null,
      },
    },
  };
  const pending = {
    patientId: 'patient_1',
    expectedUpdatedAt: '2026-07-22T00:00:00.000Z',
    careCaseId: null,
    expectedCareCaseVersion: null,
  };

  it('accepts an exact, strictly advancing patient-only acknowledgement', () => {
    expect(isValidPatientEditAcknowledgement(acknowledgement, pending)).toBe(true);
  });

  it.each([
    ['patient id mismatch', { data: { ...acknowledgement.data, id: 'patient_2' } }],
    [
      'data and version-basis timestamp mismatch',
      { data: { ...acknowledgement.data, updated_at: '2026-07-22T00:00:02.000Z' } },
    ],
    [
      'equal patient version',
      {
        data: { ...acknowledgement.data, updated_at: pending.expectedUpdatedAt },
        meta: {
          version_basis: {
            ...acknowledgement.meta.version_basis,
            patient_updated_at: pending.expectedUpdatedAt,
          },
        },
      },
    ],
    [
      'older patient version',
      {
        data: { ...acknowledgement.data, updated_at: '2026-07-21T23:59:59.000Z' },
        meta: {
          version_basis: {
            ...acknowledgement.meta.version_basis,
            patient_updated_at: '2026-07-21T23:59:59.000Z',
          },
        },
      },
    ],
    [
      'case response for a null/null request',
      {
        data: {},
        meta: {
          version_basis: {
            ...acknowledgement.meta.version_basis,
            care_case_id: 'case_1',
            care_case_version: 1,
          },
        },
      },
    ],
    [
      'incoherent response case pair',
      {
        data: {},
        meta: {
          version_basis: {
            ...acknowledgement.meta.version_basis,
            care_case_id: 'case_1',
          },
        },
      },
    ],
  ] as const)('rejects %s', (_label, patch) => {
    expect(
      isValidPatientEditAcknowledgement(
        {
          ...acknowledgement,
          ...patch,
          data: { ...acknowledgement.data, ...patch.data },
        },
        pending,
      ),
    ).toBe(false);
  });

  it.each([
    ['wrong case id', 'case_2', 5],
    ['equal case version', 'case_1', 4],
    ['skipped case version', 'case_1', 6],
  ] as const)('rejects a canonical Case acknowledgement with %s', (_label, caseId, version) => {
    expect(
      isValidPatientEditAcknowledgement(
        {
          ...acknowledgement,
          meta: {
            version_basis: {
              ...acknowledgement.meta.version_basis,
              care_case_id: caseId,
              care_case_version: version,
            },
          },
        },
        { ...pending, careCaseId: 'case_1', expectedCareCaseVersion: 4 },
      ),
    ).toBe(false);
  });

  it('accepts the exact canonical Case id and expected version plus one', () => {
    expect(
      isValidPatientEditAcknowledgement(
        {
          ...acknowledgement,
          meta: {
            version_basis: {
              ...acknowledgement.meta.version_basis,
              care_case_id: 'case_1',
              care_case_version: 5,
            },
          },
        },
        { ...pending, careCaseId: 'case_1', expectedCareCaseVersion: 4 },
      ),
    ).toBe(true);
  });
});
