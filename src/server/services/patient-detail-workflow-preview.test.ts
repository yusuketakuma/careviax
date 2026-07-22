import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

const getPatientRiskSummaryMock = vi.hoisted(() => vi.fn());
const getPatientVisitBriefMock = vi.hoisted(() => vi.fn());
const getPatientHomeCareFeatureSummaryMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/services/patient-risk', () => ({
  getPatientRiskSummary: getPatientRiskSummaryMock,
}));

vi.mock('@/server/services/visit-brief', () => ({
  getPatientVisitBrief: getPatientVisitBriefMock,
}));

vi.mock('@/server/services/home-care-ops', () => ({
  getPatientHomeCareFeatureSummary: getPatientHomeCareFeatureSummaryMock,
}));

import { getPatientWorkflowPreviewData } from './patient-detail';
import { buildDb } from './patient-detail.test-support';

beforeEach(() => {
  vi.clearAllMocks();
  getPatientRiskSummaryMock.mockResolvedValue({
    level: 'low',
    score: 0,
    factors: [],
  });
  getPatientVisitBriefMock.mockResolvedValue(null);
  getPatientHomeCareFeatureSummaryMock.mockResolvedValue({
    states: [],
    highlights: [],
  });
});

describe('getPatientWorkflowPreviewData', () => {
  it('prefers care-team report targets, falls back to intake targets, and surfaces blockers', async () => {
    const db = buildDb({
      patient: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'patient_1',
          contacts: [],
          scheduling_preference: {
            preferred_weekdays: [],
            preferred_time_from: null,
            preferred_time_to: null,
            phone_contact_from: null,
            phone_contact_to: null,
            facility_time_from: null,
            facility_time_to: null,
            family_presence_required: false,
            visit_buffer_minutes: null,
            preferred_contact_name: null,
            preferred_contact_phone: null,
            visit_before_contact_required: true,
            first_visit_preferred_date: null,
            first_visit_time_slot: null,
            first_visit_time_note: null,
            parking_available: null,
            primary_contact_preference: 'mcs',
            mcs_linked: true,
            adl_level: null,
            dementia_level: null,
            swallowing_route: null,
            care_level: null,
            infection_isolation: null,
            notes: null,
          },
          consents: [],
          mcs_link: null,
          cases: [
            {
              id: 'case_1',
              status: 'active',
              required_visit_support: {
                home_visit_intake: {
                  requester: {
                    profession: 'physician',
                    contact_name: '依頼医',
                    organization_name: '依頼医院',
                    phone: '03-1111-2222',
                    preferred_contact_method: 'mcs',
                    pharmacy_decision_due_date: '2026-04-09',
                  },
                  care_manager: {
                    name: '居宅CM',
                    organization_name: '居宅介護',
                    phone: '03-3333-4444',
                  },
                  visiting_nurse: {
                    name: '訪問看護師',
                    organization_name: '訪問看護ST',
                    phone: '03-5555-6666',
                  },
                  primary_disease: '心不全',
                  care_level: 'care_3',
                  visit_before_contact_required: true,
                  mcs_linked: true,
                },
              },
              care_team_links: [
                {
                  id: 'link_physician',
                  role: 'doctor',
                  name: '主治医',
                  organization_name: '主治医クリニック',
                  phone: '03-9999-0000',
                  email: null,
                  fax: null,
                  is_primary: true,
                },
              ],
              management_plans: [],
            },
          ],
        }),
      },
    });

    const result = await getPatientWorkflowPreviewData(
      db as unknown as Parameters<typeof getPatientWorkflowPreviewData>[0],
      {
        orgId: 'org_1',
        patientId: 'patient_1',
        role: 'pharmacist',
        userId: 'pharmacist_1',
      },
    );

    expect(result?.report_targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'physician_report',
          source: 'care_team',
          recipient_name: '主治医',
        }),
        expect.objectContaining({
          key: 'care_manager_report',
          source: 'intake',
          recipient_name: '居宅CM',
        }),
        expect.objectContaining({
          key: 'nurse_share',
          source: 'intake',
          recipient_name: '訪問看護師',
        }),
      ]),
    );
    expect(result?.visit_preparation.blockers).toEqual(
      expect.arrayContaining([
        '訪問薬剤管理同意が未取得です。',
        '緊急連絡先が未登録です。',
        '承認済み管理計画書がありません。',
        '訪問前連絡が必要ですが連絡先電話が不足しています。',
      ]),
    );
    expect(result?.communication_priority).toMatchObject({
      preferred_contact_method: 'mcs',
      effective_channel: 'collaboration',
      visit_before_contact_required: true,
      pharmacy_decision_due_date: '2026-04-09T00:00:00.000Z',
      warnings: expect.arrayContaining([
        '患者・家族への事前連絡を優先します。',
        'MCS連携フラグはありますが連携先 URL が未登録です。',
      ]),
    });
  });
});
