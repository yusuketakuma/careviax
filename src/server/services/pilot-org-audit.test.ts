import { describe, expect, it } from 'vitest';
import { buildPilotOrgAuditSnapshot } from './pilot-org-audit';

describe('buildPilotOrgAuditSnapshot', () => {
  it('summarizes org structure, pilot targets, and coverage gaps', () => {
    const snapshot = buildPilotOrgAuditSnapshot({
      now: new Date('2026-03-31T00:00:00.000Z'),
      memberships: [
        {
          role: 'owner',
          site_id: null,
          site_name: null,
          is_active: true,
          user: { is_active: true, account_status: 'active' },
        },
        {
          role: 'pharmacist',
          site_id: 'site_1',
          site_name: '本店',
          is_active: true,
          user: { is_active: true, account_status: 'active' },
        },
      ],
      sites: [
        {
          id: 'site_1',
          name: '本店',
          address: '東京都新宿区1-1-1',
          lat: 35.69,
          lng: 139.70,
          service_areas: [
            {
              id: 'area_1',
              site_id: 'site_1',
              name: '新宿区',
              area_type: 'radius',
              geo_data: { match_keywords: ['新宿区'] },
              notes: null,
            },
          ],
        },
      ],
      cases: [
        {
          id: 'case_1',
          status: 'active',
          required_visit_support: { set_pilot_enabled: true },
          patient: {
            id: 'patient_1',
            name: '田中 一郎',
            residences: [
              {
                address: '東京都新宿区2-2-2',
                facility_id: 'facility_1',
                lat: 35.691,
                lng: 139.702,
                geocode_status: 'ok',
              },
            ],
          },
        },
        {
          id: 'case_2',
          status: 'active',
          required_visit_support: null,
          patient: {
            id: 'patient_2',
            name: '佐藤 花子',
            residences: [
              {
                address: '東京都八王子市9-9-9',
                facility_id: null,
                lat: 35.655,
                lng: 139.323,
                geocode_status: 'ok',
              },
            ],
          },
        },
      ],
    });

    expect(snapshot.org_structure).toMatchObject({
      site_count: 1,
      active_member_count: 2,
      role_counts: {
        owner: 1,
        pharmacist: 1,
      },
    });
    expect(snapshot.pilot_targets).toMatchObject({
      active_case_count: 2,
      facility_linked_case_count: 1,
      set_pilot_case_count: 1,
    });
    expect(snapshot.coverage.service_area_covered_count).toBe(1);
    expect(snapshot.coverage.uncovered_count).toBe(1);
    expect(snapshot.coverage.flagged_patient_count).toBe(1);
    expect(snapshot.coverage.flagged_patients_truncated).toBe(false);
    expect(snapshot.coverage.flagged_patients[0]).toMatchObject({
      patient_id: 'patient_2',
      reason: '既存拠点から 16km 圏外',
      nearest_site_name: '本店',
    });
  });

  it('marks residences without coordinates or service-area matches for review', () => {
    const snapshot = buildPilotOrgAuditSnapshot({
      memberships: [],
      sites: [
        {
          id: 'site_1',
          name: '本店',
          address: '東京都新宿区1-1-1',
          lat: null,
          lng: null,
          service_areas: [],
        },
      ],
      cases: [
        {
          id: 'case_1',
          status: 'active',
          required_visit_support: null,
          patient: {
            id: 'patient_1',
            name: '高橋 次郎',
            residences: [
              {
                address: '東京都港区1-1-1',
                facility_id: null,
                lat: null,
                lng: null,
                geocode_status: null,
              },
            ],
          },
        },
      ],
    });

    expect(snapshot.coverage.review_required_count).toBe(1);
    expect(snapshot.recommendations.some((item) => item.includes('位置情報不足'))).toBe(true);
    expect(snapshot.recommendations.some((item) => item.includes('service area 未設定'))).toBe(true);
  });

  it('treats missing primary residence as review-required and still counts set pilot cases', () => {
    const snapshot = buildPilotOrgAuditSnapshot({
      memberships: [],
      sites: [],
      cases: [
        {
          id: 'case_1',
          status: 'active',
          required_visit_support: { set_pilot_enabled: true },
          patient: {
            id: 'patient_1',
            name: '住所未登録 患者',
            residences: [],
          },
        },
      ],
    });

    expect(snapshot.pilot_targets.active_case_count).toBe(1);
    expect(snapshot.pilot_targets.set_pilot_case_count).toBe(1);
    expect(snapshot.coverage.total_primary_residences).toBe(0);
    expect(snapshot.coverage.review_required_count).toBe(1);
    expect(snapshot.coverage.flagged_patients[0]).toMatchObject({
      patient_name: '住所未登録 患者',
      reason: 'primary residence が未登録のため訪問カバレッジ判定不可',
    });
  });

  it('counts only activated users as active members', () => {
    const snapshot = buildPilotOrgAuditSnapshot({
      memberships: [
        {
          role: 'owner',
          site_id: null,
          site_name: null,
          is_active: true,
          user: { is_active: true, account_status: 'active' },
        },
        {
          role: 'pharmacist',
          site_id: 'site_1',
          site_name: '本店',
          is_active: true,
          user: { is_active: true, account_status: 'invited' },
        },
        {
          role: 'clerk',
          site_id: 'site_1',
          site_name: '本店',
          is_active: true,
          user: { is_active: false, account_status: 'suspended' },
        },
      ],
      sites: [],
      cases: [],
    });

    expect(snapshot.org_structure.active_member_count).toBe(1);
    expect(snapshot.org_structure.role_counts).toEqual({ owner: 1 });
  });

  it('reports when flagged patients are truncated to the preview list', () => {
    const snapshot = buildPilotOrgAuditSnapshot({
      memberships: [],
      sites: [],
      cases: Array.from({ length: 21 }, (_, index) => ({
        id: `case_${index + 1}`,
        status: 'active',
        required_visit_support: null,
        patient: {
          id: `patient_${index + 1}`,
          name: `患者${index + 1}`,
          residences: [
            {
              address: `住所${index + 1}`,
              facility_id: null,
              lat: null,
              lng: null,
              geocode_status: null,
            },
          ],
        },
      })),
    });

    expect(snapshot.coverage.flagged_patient_count).toBe(21);
    expect(snapshot.coverage.flagged_patients_truncated).toBe(true);
    expect(snapshot.coverage.flagged_patients).toHaveLength(20);
    expect(snapshot.recommendations.some((item) => item.includes('先頭 20 件のみ表示'))).toBe(true);
  });
});
