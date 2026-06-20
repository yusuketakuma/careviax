import { describe, expect, it, vi } from 'vitest';
import {
  findExternalProfessionalSuggestions,
  getRecommendedChannels,
  listContactProfileSearchSummaries,
} from './contact-profiles';

describe('findExternalProfessionalSuggestions', () => {
  it('uses patient care-team links even when they are not linked to the external-professional master', async () => {
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'case_1',
            care_team_links: [
              {
                id: 'care_team_1',
                is_primary: true,
                role: 'care_manager',
                name: '田中 ケアマネ',
                organization_name: '在宅支援事業所A',
                department: null,
                phone: '03-0000-0001',
                email: null,
                fax: '03-0000-0002',
                address: '東京都千代田区',
                external_professional_id: null,
                external_professional: null,
              },
            ],
          },
        ]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const suggestions = await findExternalProfessionalSuggestions(db, 'org_1', {
      patientId: 'patient_1',
    });

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: 'care-team:care_team_1',
        name: '田中 ケアマネ',
        profession_type: 'care_manager',
        organization_name: '在宅支援事業所A',
        source: 'patient_care_team',
        recommended_channels: ['fax', 'phone', 'postal', 'in_person'],
        contact_reliability: {
          ready: true,
          warnings: [],
          missing_channel_labels: [],
        },
      }),
    ]);
  });

  it('keeps recommended channels but marks required care-team FAX as unready', async () => {
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'case_1',
            care_team_links: [
              {
                id: 'care_team_1',
                is_primary: true,
                role: 'care_manager',
                name: '田中 ケアマネ',
                organization_name: '在宅支援事業所A',
                department: null,
                phone: '03-0000-0001',
                email: null,
                fax: null,
                address: null,
                external_professional_id: null,
                external_professional: null,
              },
            ],
          },
        ]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const suggestions = await findExternalProfessionalSuggestions(db, 'org_1', {
      patientId: 'patient_1',
    });

    expect(suggestions[0]).toMatchObject({
      recommended_channels: ['phone'],
      contact_reliability: {
        ready: false,
        warnings: ['FAX未確認'],
        missing_channel_labels: ['FAX'],
      },
    });
  });

  it('can recommend FAX delivery while marking a physician profile unready without phone', async () => {
    const db = {
      careCase: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'case_1',
            care_team_links: [
              {
                id: 'care_team_1',
                is_primary: true,
                role: 'physician',
                name: '佐藤 医師',
                organization_name: '在宅クリニック',
                department: null,
                phone: null,
                email: null,
                fax: '03-0000-0002',
                address: null,
                external_professional_id: null,
                external_professional: null,
              },
            ],
          },
        ]),
      },
      deliveryRecord: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      communicationEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const suggestions = await findExternalProfessionalSuggestions(db, 'org_1', {
      patientId: 'patient_1',
    });

    expect(suggestions[0]).toMatchObject({
      recommended_channels: ['fax'],
      contact_reliability: {
        ready: false,
        warnings: ['電話未確認'],
        missing_channel_labels: ['電話'],
      },
    });
  });
});

describe('getRecommendedChannels', () => {
  it('does not recommend an unreachable preferred channel', () => {
    expect(
      getRecommendedChannels({
        preferred: 'fax',
        phone: '03-0000-0001',
        fax: null,
      }),
    ).toEqual(['phone']);
  });

  it('prioritizes the preferred channel when its contact value exists', () => {
    expect(
      getRecommendedChannels({
        preferred: 'phone',
        phone: '03-0000-0001',
        fax: '03-0000-0002',
      }),
    ).toEqual(['phone', 'fax']);
  });

  it('ignores whitespace-only channel values', () => {
    expect(
      getRecommendedChannels({
        preferred: 'fax',
        phone: '   ',
        email: '   ',
        fax: '   ',
        address: '   ',
      }),
    ).toEqual([]);
  });
});

describe('listContactProfileSearchSummaries', () => {
  it('returns bounded minimal contact summaries without selecting raw contact fields', async () => {
    const facilityContactFindMany = vi.fn().mockResolvedValue([
      {
        id: 'facility_contact_1',
        name: '山田 相談員',
        role: '相談員',
        last_contacted_at: new Date('2026-03-30T00:00:00.000Z'),
        facility: {
          name: 'あおば苑',
        },
        phone: '03-1111-2222',
        email: 'facility@example.com',
        fax: '03-1111-3333',
      },
      {
        id: 'facility_contact_2',
        name: '山田 看護師',
        role: null,
        last_contacted_at: null,
        facility: {
          name: 'みどり苑',
        },
      },
    ]);
    const externalProfessionalFindMany = vi.fn().mockResolvedValue([
      {
        id: 'external_1',
        name: '山田 ケアマネ',
        profession_type: 'care_manager',
        organization_name: '在宅支援A',
        department: null,
        last_contacted_at: null,
        phone: '03-2222-3333',
        email: 'care@example.com',
        fax: '03-2222-4444',
      },
    ]);
    const prescriberInstitutionFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      facilityContact: {
        findMany: facilityContactFindMany,
      },
      externalProfessional: {
        findMany: externalProfessionalFindMany,
      },
      prescriberInstitution: {
        findMany: prescriberInstitutionFindMany,
      },
    } as unknown as Parameters<typeof listContactProfileSearchSummaries>[0];

    const result = await listContactProfileSearchSummaries(db, 'org_1', {
      kind: 'all',
      query: '山田',
      limit: 2,
    });

    expect(facilityContactFindMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        OR: [
          { name: { contains: '山田', mode: 'insensitive' } },
          { role: { contains: '山田', mode: 'insensitive' } },
          { facility: { name: { contains: '山田', mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        name: true,
        role: true,
        last_contacted_at: true,
        facility: {
          select: {
            name: true,
          },
        },
      },
      take: 3,
      orderBy: [{ name: 'asc' }],
    });
    const externalArgs = externalProfessionalFindMany.mock.calls[0]?.[0];
    expect(externalArgs.select).toEqual({
      id: true,
      name: true,
      profession_type: true,
      organization_name: true,
      department: true,
      last_contacted_at: true,
    });
    expect(externalArgs.select).not.toHaveProperty('phone');
    expect(externalArgs.select).not.toHaveProperty('email');
    expect(externalArgs.select).not.toHaveProperty('fax');
    expect(result).toEqual({
      data: [
        {
          id: 'facility_contact_1',
          kind: 'facility_contact',
          name: '山田 相談員',
          subtitle: 'あおば苑 / 相談員',
          last_contacted_at: new Date('2026-03-30T00:00:00.000Z'),
        },
        {
          id: 'facility_contact_2',
          kind: 'facility_contact',
          name: '山田 看護師',
          subtitle: 'みどり苑',
          last_contacted_at: null,
        },
      ],
      hasMore: true,
    });
  });

  it('does not scan later contact kinds when the first kind already fills the result window', async () => {
    const facilityContactFindMany = vi.fn().mockResolvedValue([
      {
        id: 'facility_contact_1',
        name: '山田 相談員',
        role: null,
        last_contacted_at: null,
        facility: { name: 'あおば苑' },
      },
      {
        id: 'facility_contact_2',
        name: '山田 看護師',
        role: null,
        last_contacted_at: null,
        facility: { name: 'みどり苑' },
      },
      {
        id: 'facility_contact_3',
        name: '山田 管理者',
        role: null,
        last_contacted_at: null,
        facility: { name: 'さくら苑' },
      },
    ]);
    const externalProfessionalFindMany = vi.fn();
    const prescriberInstitutionFindMany = vi.fn();
    const db = {
      facilityContact: { findMany: facilityContactFindMany },
      externalProfessional: { findMany: externalProfessionalFindMany },
      prescriberInstitution: { findMany: prescriberInstitutionFindMany },
    } as unknown as Parameters<typeof listContactProfileSearchSummaries>[0];

    const result = await listContactProfileSearchSummaries(db, 'org_1', {
      kind: 'all',
      query: '山田',
      limit: 2,
    });

    expect(facilityContactFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(externalProfessionalFindMany).not.toHaveBeenCalled();
    expect(prescriberInstitutionFindMany).not.toHaveBeenCalled();
    expect(result.data.map((item) => item.id)).toEqual([
      'facility_contact_1',
      'facility_contact_2',
    ]);
    expect(result.hasMore).toBe(true);
  });

  it('only searches later contact kinds for the remaining result window', async () => {
    const facilityContactFindMany = vi.fn().mockResolvedValue([
      {
        id: 'facility_contact_1',
        name: '山田 相談員',
        role: null,
        last_contacted_at: null,
        facility: { name: 'あおば苑' },
      },
    ]);
    const externalProfessionalFindMany = vi.fn().mockResolvedValue([
      {
        id: 'external_1',
        name: '山田 ケアマネ',
        profession_type: 'care_manager',
        organization_name: '在宅支援A',
        department: null,
        last_contacted_at: null,
      },
      {
        id: 'external_2',
        name: '山田 訪問看護師',
        profession_type: 'nurse',
        organization_name: '訪問看護B',
        department: null,
        last_contacted_at: null,
      },
    ]);
    const prescriberInstitutionFindMany = vi.fn();
    const db = {
      facilityContact: { findMany: facilityContactFindMany },
      externalProfessional: { findMany: externalProfessionalFindMany },
      prescriberInstitution: { findMany: prescriberInstitutionFindMany },
    } as unknown as Parameters<typeof listContactProfileSearchSummaries>[0];

    const result = await listContactProfileSearchSummaries(db, 'org_1', {
      kind: 'all',
      query: '山田',
      limit: 2,
    });

    expect(facilityContactFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(externalProfessionalFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
    expect(prescriberInstitutionFindMany).not.toHaveBeenCalled();
    expect(result.data.map((item) => item.id)).toEqual(['facility_contact_1', 'external_1']);
    expect(result.hasMore).toBe(true);
  });
});
