import { describe, expect, it, vi } from 'vitest';
import { findExternalProfessionalSuggestions, getRecommendedChannels } from './contact-profiles';

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

    const suggestions = await findExternalProfessionalSuggestions(
      db as unknown as Parameters<typeof findExternalProfessionalSuggestions>[0],
      'org_1',
      { patientId: 'patient_1' },
    );

    expect(suggestions).toEqual([
      expect.objectContaining({
        id: 'care-team:care_team_1',
        name: '田中 ケアマネ',
        profession_type: 'care_manager',
        organization_name: '在宅支援事業所A',
        source: 'patient_care_team',
        recommended_channels: ['fax', 'phone', 'postal', 'in_person'],
      }),
    ]);
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
});
