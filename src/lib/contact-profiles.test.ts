import { describe, expect, it, vi } from 'vitest';
import {
  findExternalProfessionalSuggestions,
  getChannelStatsByName,
  getRecommendedChannels,
  listContactProfiles,
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
        groupBy: vi.fn().mockResolvedValue([]),
      },
      communicationEvent: {
        groupBy: vi.fn().mockResolvedValue([]),
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
        groupBy: vi.fn().mockResolvedValue([]),
      },
      communicationEvent: {
        groupBy: vi.fn().mockResolvedValue([]),
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
        groupBy: vi.fn().mockResolvedValue([]),
      },
      communicationEvent: {
        groupBy: vi.fn().mockResolvedValue([]),
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

describe('getChannelStatsByName', () => {
  it('folds weighted database groups without materializing delivery and event history rows', async () => {
    const deliveryGroupBy = vi.fn().mockResolvedValue([
      {
        recipient_name: '連携先A',
        channel: 'fax',
        status: 'sent',
        _count: { _all: 3 },
      },
      {
        recipient_name: '連携先A',
        channel: 'fax',
        status: 'failed',
        _count: { _all: 2 },
      },
      {
        recipient_name: '連携先A',
        channel: 'fax',
        status: 'draft',
        _count: { _all: 9 },
      },
      {
        recipient_name: '連携先A',
        channel: 'phone',
        status: 'confirmed',
        _count: { _all: 1 },
      },
    ]);
    const communicationEventGroupBy = vi.fn().mockResolvedValue([
      {
        counterpart_name: '連携先A',
        channel: 'fax',
        event_type: 'delivery_failure',
        _count: { _all: 4 },
      },
      {
        counterpart_name: '連携先A',
        channel: 'email',
        event_type: 'care_manager_report',
        _count: { _all: 5 },
      },
      {
        counterpart_name: null,
        channel: 'phone',
        event_type: 'care_manager_report',
        _count: { _all: 7 },
      },
    ]);
    const db = {
      deliveryRecord: { groupBy: deliveryGroupBy },
      communicationEvent: { groupBy: communicationEventGroupBy },
    } as unknown as Parameters<typeof getChannelStatsByName>[0];

    const result = await getChannelStatsByName(db, 'org_1', [' 連携先A ', '連携先A', '', '   ']);

    expect(deliveryGroupBy).toHaveBeenCalledWith({
      by: ['recipient_name', 'channel', 'status'],
      where: {
        org_id: 'org_1',
        recipient_name: { in: ['連携先A'] },
      },
      _count: { _all: true },
    });
    expect(communicationEventGroupBy).toHaveBeenCalledWith({
      by: ['counterpart_name', 'channel', 'event_type'],
      where: {
        org_id: 'org_1',
        direction: 'outbound',
        counterpart_name: { in: ['連携先A'] },
      },
      _count: { _all: true },
    });
    expect(result.get('連携先A')).toMatchObject({
      fax: { success: 3, failure: 6 },
      phone: { success: 1, failure: 0 },
      email: { success: 5, failure: 0 },
    });
    expect(result.has('')).toBe(false);
  });

  it('does not query channel history when every requested name is blank', async () => {
    const deliveryGroupBy = vi.fn();
    const communicationEventGroupBy = vi.fn();
    const db = {
      deliveryRecord: { groupBy: deliveryGroupBy },
      communicationEvent: { groupBy: communicationEventGroupBy },
    } as unknown as Parameters<typeof getChannelStatsByName>[0];

    await expect(getChannelStatsByName(db, 'org_1', ['', '   '])).resolves.toEqual(new Map());
    expect(deliveryGroupBy).not.toHaveBeenCalled();
    expect(communicationEventGroupBy).not.toHaveBeenCalled();
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

describe('listContactProfiles', () => {
  it('loads pending response counts with one deduplicated aggregate across contact kinds', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { recipient_name: '共通窓口', _count: { _all: 4 } },
      { recipient_name: '訪問看護B', _count: { _all: 2 } },
      { recipient_name: '青葉クリニック', _count: { _all: 1 } },
    ]);
    const db = {
      facilityContact: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'facility_contact_1',
            name: '共通窓口',
            role: '相談員',
            phone: '03-1111-1111',
            email: null,
            fax: null,
            preferred_contact_method: 'phone',
            preferred_contact_time: null,
            last_contacted_at: null,
            last_success_channel: null,
            facility: { name: '青葉苑', address: null, residences: [] },
          },
        ]),
      },
      externalProfessional: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'external_1',
            name: '共通窓口',
            profession_type: 'care_manager',
            organization_name: '居宅支援A',
            phone: '03-2222-2222',
            email: null,
            fax: '03-2222-2223',
            address: null,
            preferred_contact_method: 'fax',
            preferred_contact_time: null,
            last_contacted_at: null,
            last_success_channel: null,
            care_team_links: [],
          },
          {
            id: 'external_2',
            name: '訪問看護B',
            profession_type: 'nurse',
            organization_name: '訪問看護B',
            phone: '03-3333-3333',
            email: null,
            fax: null,
            address: null,
            preferred_contact_method: 'phone',
            preferred_contact_time: null,
            last_contacted_at: null,
            last_success_channel: null,
            care_team_links: [],
          },
        ]),
      },
      prescriberInstitution: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'prescriber_1',
            name: '青葉クリニック',
            institution_code: null,
            phone: '03-4444-4444',
            fax: '03-4444-4445',
            address: null,
            preferred_contact_method: 'fax',
            preferred_contact_time: null,
            last_contacted_at: null,
            last_success_channel: null,
            prescription_intakes: [],
          },
        ]),
      },
      deliveryRecord: { groupBy: vi.fn().mockResolvedValue([]) },
      communicationEvent: { groupBy: vi.fn().mockResolvedValue([]) },
      communicationRequest: { groupBy },
    } as unknown as Parameters<typeof listContactProfiles>[0];

    const result = await listContactProfiles(db, 'org_1', { kind: 'all', query: null });

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['recipient_name'],
      where: {
        org_id: 'org_1',
        recipient_name: {
          in: ['共通窓口', '訪問看護B', '青葉クリニック'],
        },
        status: {
          in: ['draft', 'sent', 'received', 'in_progress', 'escalated'],
        },
      },
      _count: { _all: true },
    });
    expect(
      result.map(({ kind, name, pending_response_count }) => ({
        kind,
        name,
        pending_response_count,
      })),
    ).toEqual([
      { kind: 'facility_contact', name: '共通窓口', pending_response_count: 4 },
      { kind: 'external_professional', name: '共通窓口', pending_response_count: 4 },
      { kind: 'external_professional', name: '訪問看護B', pending_response_count: 2 },
      { kind: 'prescriber_institution', name: '青葉クリニック', pending_response_count: 1 },
    ]);
  });

  it('pushes displayed-field search predicates into every profile master query', async () => {
    const facilityContactFindMany = vi.fn().mockResolvedValue([]);
    const externalProfessionalFindMany = vi.fn().mockResolvedValue([]);
    const prescriberInstitutionFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      facilityContact: { findMany: facilityContactFindMany },
      externalProfessional: { findMany: externalProfessionalFindMany },
      prescriberInstitution: { findMany: prescriberInstitutionFindMany },
      deliveryRecord: { groupBy: vi.fn() },
      communicationEvent: { groupBy: vi.fn() },
      communicationRequest: { groupBy: vi.fn() },
    } as unknown as Parameters<typeof listContactProfiles>[0];

    await expect(
      listContactProfiles(db, 'org_1', { kind: 'all', query: '処方元' }),
    ).resolves.toEqual([]);

    expect(facilityContactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [
            { name: { contains: '処方元', mode: 'insensitive' } },
            { role: { contains: '処方元', mode: 'insensitive' } },
            { phone: { contains: '処方元', mode: 'insensitive' } },
            { email: { contains: '処方元', mode: 'insensitive' } },
            { fax: { contains: '処方元', mode: 'insensitive' } },
            { facility: { name: { contains: '処方元', mode: 'insensitive' } } },
          ],
        },
      }),
    );
    expect(externalProfessionalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [
            { name: { contains: '処方元', mode: 'insensitive' } },
            { organization_name: { contains: '処方元', mode: 'insensitive' } },
            { phone: { contains: '処方元', mode: 'insensitive' } },
            { email: { contains: '処方元', mode: 'insensitive' } },
            { fax: { contains: '処方元', mode: 'insensitive' } },
          ],
        },
      }),
    );
    expect(prescriberInstitutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [
            { name: { contains: '処方元', mode: 'insensitive' } },
            { institution_code: { contains: '処方元', mode: 'insensitive' } },
            { phone: { contains: '処方元', mode: 'insensitive' } },
            { fax: { contains: '処方元', mode: 'insensitive' } },
            { institution_code: null },
          ],
        },
      }),
    );
  });

  it('pushes profession substring searches through enum-safe exact candidates', async () => {
    const externalProfessionalFindMany = vi.fn().mockResolvedValue([]);
    const db = {
      facilityContact: { findMany: vi.fn() },
      externalProfessional: { findMany: externalProfessionalFindMany },
      prescriberInstitution: { findMany: vi.fn() },
      deliveryRecord: { groupBy: vi.fn() },
      communicationEvent: { groupBy: vi.fn() },
      communicationRequest: { groupBy: vi.fn() },
    } as unknown as Parameters<typeof listContactProfiles>[0];

    await expect(
      listContactProfiles(db, 'org_1', {
        kind: 'external_professional',
        query: 'therapist',
      }),
    ).resolves.toEqual([]);

    expect(externalProfessionalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          org_id: 'org_1',
          OR: [
            { name: { contains: 'therapist', mode: 'insensitive' } },
            { organization_name: { contains: 'therapist', mode: 'insensitive' } },
            {
              profession_type: {
                in: ['physical_therapist', 'occupational_therapist', 'speech_therapist'],
              },
            },
            { phone: { contains: 'therapist', mode: 'insensitive' } },
            { email: { contains: 'therapist', mode: 'insensitive' } },
            { fax: { contains: 'therapist', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('keeps composite facility subtitle searches exact instead of narrowing them prematurely', async () => {
    const facilityContactFindMany = vi.fn().mockResolvedValue([
      {
        id: 'facility_contact_1',
        name: '共同窓口',
        role: '相談員',
        phone: null,
        email: null,
        fax: null,
        preferred_contact_method: null,
        preferred_contact_time: null,
        last_contacted_at: null,
        last_success_channel: null,
        facility: { name: '青葉苑', address: null, residences: [] },
      },
    ]);
    const db = {
      facilityContact: { findMany: facilityContactFindMany },
      externalProfessional: { findMany: vi.fn().mockResolvedValue([]) },
      prescriberInstitution: { findMany: vi.fn().mockResolvedValue([]) },
      deliveryRecord: { groupBy: vi.fn().mockResolvedValue([]) },
      communicationEvent: { groupBy: vi.fn().mockResolvedValue([]) },
      communicationRequest: { groupBy: vi.fn().mockResolvedValue([]) },
    } as unknown as Parameters<typeof listContactProfiles>[0];

    const result = await listContactProfiles(db, 'org_1', {
      kind: 'all',
      query: '青葉苑 / 相談員',
    });

    expect(facilityContactFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { org_id: 'org_1' } }),
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'facility_contact_1',
        subtitle: '青葉苑 / 相談員',
      }),
    ]);
  });

  it('skips the pending response aggregate when no profiles are returned', async () => {
    const groupBy = vi.fn();
    const db = {
      facilityContact: { findMany: vi.fn().mockResolvedValue([]) },
      externalProfessional: { findMany: vi.fn().mockResolvedValue([]) },
      prescriberInstitution: { findMany: vi.fn().mockResolvedValue([]) },
      deliveryRecord: { groupBy: vi.fn() },
      communicationEvent: { groupBy: vi.fn() },
      communicationRequest: { groupBy },
    } as unknown as Parameters<typeof listContactProfiles>[0];

    await expect(listContactProfiles(db, 'org_1', { kind: 'all', query: null })).resolves.toEqual(
      [],
    );
    expect(groupBy).not.toHaveBeenCalled();
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
