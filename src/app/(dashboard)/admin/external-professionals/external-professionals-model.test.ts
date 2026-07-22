import { describe, expect, it } from 'vitest';
import {
  buildCreatePayload,
  buildUpdatePayload,
  createEmptyForm,
  externalProfessionalFormSchema,
  externalProfessionalsResponseSchema,
  facilitiesResponseSchema,
  formatOptionalDateTime,
  getCareTeamRoleLabel,
  getCaseStatusLabel,
  getContactMethodLabel,
  getProfessionLabel,
  linkedPatientsResponseSchema,
  matchesProfessionalQuery,
  NONE_VALUE,
  normalizeForm,
  toForm,
  type ExternalProfessional,
  type FormState,
} from './external-professionals-model';

function professionalFixture(overrides: Partial<ExternalProfessional> = {}): ExternalProfessional {
  return {
    id: 'external_1',
    profession_type: 'nurse',
    name: '外部専門職A',
    facility_id: 'facility_1',
    facility_name: '施設A',
    organization_name: '組織A',
    department: '部署A',
    phone: '000-0000-0000',
    email: 'professional@example.invalid',
    fax: '000-0000-0001',
    preferred_contact_method: 'fax',
    preferred_contact_time: '平日午後',
    last_contacted_at: '2026-07-01T04:00:00.000Z',
    last_success_channel: 'fax',
    address: 'テスト住所',
    notes: 'テスト備考',
    patient_count: 2,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function professionalsResponse(data: unknown[]) {
  return {
    data,
    meta: {
      total_count: data.length,
      visible_count: data.length,
      hidden_count: 0,
      truncated: false,
      count_basis: 'external_professionals',
      has_more: false,
      filters_applied: {
        q: null,
        profession_type: null,
        facility_id: null,
        preferred_contact_method: null,
      },
    },
  };
}

function linkedPatientsResponse(data: unknown[]) {
  return {
    data,
    meta: {
      limit: 20,
      total_count: data.length,
      visible_count: data.length,
      hidden_count: 0,
      has_more: false,
      count_basis: 'care_team_links',
      filters_applied: {
        external_professional_id: 'external_1',
        archive_status: 'active',
        assignment_scoped: false,
      },
    },
  };
}

describe('external professional response schemas', () => {
  it('preserves the existing shallow item contract and item metadata', () => {
    const sparseItem = { id: 'external_sparse', name: '専門職B', legacy_metadata: 'kept' };

    const parsed = externalProfessionalsResponseSchema.parse(professionalsResponse([sparseItem]));

    expect(parsed.data[0]).toEqual(sparseItem);
  });

  it('rejects malformed item identity and strict envelope fields', () => {
    expect(() =>
      externalProfessionalsResponseSchema.parse(professionalsResponse([{ id: 1, name: 'A' }])),
    ).toThrow();
    expect(() =>
      externalProfessionalsResponseSchema.parse({
        ...professionalsResponse([]),
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      externalProfessionalsResponseSchema.parse({
        ...professionalsResponse([]),
        meta: { ...professionalsResponse([]).meta, count_basis: 'other' },
      }),
    ).toThrow();
  });

  it('validates filter enum values while retaining optional limit behavior', () => {
    const response = professionalsResponse([]);
    expect(
      externalProfessionalsResponseSchema.parse({
        ...response,
        meta: { ...response.meta, limit: 20 },
      }).meta.limit,
    ).toBe(20);
    expect(() =>
      externalProfessionalsResponseSchema.parse({
        ...response,
        meta: {
          ...response.meta,
          filters_applied: {
            ...response.meta.filters_applied,
            profession_type: 'unknown',
          },
        },
      }),
    ).toThrow();
  });

  it('strips facility item metadata and rejects duplicate facility identities', () => {
    expect(
      facilitiesResponseSchema.parse({
        data: [{ id: ' facility_1 ', name: ' 施設A ', legacy_metadata: true }],
      }),
    ).toEqual({ data: [{ id: 'facility_1', name: '施設A' }] });
    expect(() =>
      facilitiesResponseSchema.parse({
        data: [
          { id: 'facility_1', name: '施設A' },
          { id: 'facility_1', name: '施設B' },
        ],
      }),
    ).toThrow('Duplicate facility identity');
  });

  it('preserves the existing shallow linked-patient item contract', () => {
    const sparseItem = {
      id: 'link_1',
      patient_id: 'patient_1',
      legacy_metadata: 'kept',
    };
    const parsed = linkedPatientsResponseSchema.parse(linkedPatientsResponse([sparseItem]));

    expect(parsed.data[0]).toEqual(sparseItem);
  });

  it('rejects invalid linked-patient pagination and filter metadata', () => {
    const response = linkedPatientsResponse([]);
    expect(() =>
      linkedPatientsResponseSchema.parse({
        ...response,
        meta: { ...response.meta, limit: 0 },
      }),
    ).toThrow();
    expect(() =>
      linkedPatientsResponseSchema.parse({
        ...response,
        meta: {
          ...response.meta,
          filters_applied: {
            ...response.meta.filters_applied,
            archive_status: 'unknown',
          },
        },
      }),
    ).toThrow();
  });
});

describe('external professional form model', () => {
  it('creates and normalizes the current default form values', () => {
    expect(createEmptyForm()).toEqual({
      profession_type: 'nurse',
      name: '',
      facility_id: NONE_VALUE,
      organization_name: '',
      department: '',
      phone: '',
      email: '',
      fax: '',
      preferred_contact_method: NONE_VALUE,
      preferred_contact_time: '',
      address: '',
      notes: '',
    });
    expect(normalizeForm(null)).toEqual(createEmptyForm());
    expect(normalizeForm({ name: '専門職C', phone: '000' })).toEqual({
      ...createEmptyForm(),
      name: '専門職C',
      phone: '000',
    });
  });

  it('maps nullable professional fields to form sentinel and empty values', () => {
    expect(
      toForm(
        professionalFixture({
          facility_id: null,
          organization_name: null,
          department: null,
          phone: null,
          email: null,
          fax: null,
          preferred_contact_method: null,
          preferred_contact_time: null,
          address: null,
          notes: null,
        }),
      ),
    ).toEqual({ ...createEmptyForm(), name: '外部専門職A' });
  });

  it('keeps create omissions undefined and update clear operations null', () => {
    const form: FormState = {
      ...createEmptyForm(),
      name: '  外部専門職D  ',
      organization_name: '  ',
      department: '\t',
      phone: ' ',
      email: '\n',
      fax: ' ',
      preferred_contact_time: ' ',
      address: ' ',
      notes: ' ',
    };

    expect(buildCreatePayload(form)).toEqual({
      profession_type: 'nurse',
      name: '外部専門職D',
      facility_id: undefined,
      organization_name: undefined,
      department: undefined,
      phone: undefined,
      email: undefined,
      fax: undefined,
      preferred_contact_method: undefined,
      preferred_contact_time: undefined,
      address: undefined,
      notes: undefined,
    });
    expect(buildUpdatePayload(form)).toEqual({
      profession_type: 'nurse',
      name: '外部専門職D',
      facility_id: null,
      organization_name: null,
      department: null,
      phone: null,
      email: null,
      fax: null,
      preferred_contact_method: null,
      preferred_contact_time: null,
      address: null,
      notes: null,
    });
  });

  it('trims optional payload values without changing selected identities', () => {
    const form: FormState = {
      ...createEmptyForm(),
      profession_type: 'physician',
      name: '  専門職E ',
      facility_id: 'facility_2',
      organization_name: ' 組織B ',
      preferred_contact_method: 'email',
      email: ' test@example.invalid ',
    };

    expect(buildCreatePayload(form)).toMatchObject({
      profession_type: 'physician',
      name: '専門職E',
      facility_id: 'facility_2',
      organization_name: '組織B',
      preferred_contact_method: 'email',
      email: 'test@example.invalid',
    });
    expect(buildUpdatePayload(form)).toMatchObject({
      profession_type: 'physician',
      name: '専門職E',
      facility_id: 'facility_2',
      organization_name: '組織B',
      preferred_contact_method: 'email',
      email: 'test@example.invalid',
    });
  });

  it('retains the required trimmed-name form validation', () => {
    const result = externalProfessionalFormSchema.safeParse({
      ...createEmptyForm(),
      name: '  ',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ['name'],
        message: '氏名は必須です。',
      });
    }
  });
});

describe('external professional labels and filtering', () => {
  it('returns known labels and existing fallbacks', () => {
    expect(getProfessionLabel('nurse')).toBe('訪問看護師');
    expect(getProfessionLabel('unknown' as 'nurse')).toBe('unknown');
    expect(getContactMethodLabel('fax')).toBe('FAX');
    expect(getContactMethodLabel(null)).toBe('送付方法未設定');
    expect(getContactMethodLabel('unknown' as 'fax')).toBe('unknown');
    expect(getCareTeamRoleLabel('pharmacist')).toBe('薬剤師');
    expect(getCareTeamRoleLabel('unknown')).toBe('その他');
    expect(getCaseStatusLabel('active')).toBe('有効ケース');
    expect(getCaseStatusLabel('unknown')).toBe('unknown');
  });

  it('formats optional timestamps with the existing fallback', () => {
    expect(formatOptionalDateTime(null)).toBe('記録なし');
    expect(formatOptionalDateTime('2026-07-01T04:00:00.000Z')).toBe('2026/7/1 13:00');
  });

  it.each([
    ['name', { name: 'ALPHA PERSON' }, 'alpha'],
    ['profession label', { profession_type: 'nurse' as const }, '訪問看護師'],
    ['facility', { facility_name: 'Facility Bravo' }, 'bravo'],
    ['organization', { organization_name: 'Organization Charlie' }, 'charlie'],
    ['department', { department: 'Department Delta' }, 'delta'],
    ['phone', { phone: '000-1111-2222' }, '1111'],
    ['email', { email: 'echo@example.invalid' }, 'ECHO@'],
    ['fax', { fax: '000-3333-4444' }, '3333'],
    ['address', { address: 'Address Foxtrot' }, 'foxtrot'],
    ['notes', { notes: 'Notes Golf' }, 'golf'],
  ])('matches a trimmed case-insensitive query against %s', (_label, overrides, query) => {
    expect(matchesProfessionalQuery(professionalFixture(overrides), `  ${query}  `)).toBe(true);
  });

  it('matches an empty query and rejects an absent value', () => {
    const item = professionalFixture();
    expect(matchesProfessionalQuery(item, '   ')).toBe(true);
    expect(matchesProfessionalQuery(item, 'not-present')).toBe(false);
  });
});
