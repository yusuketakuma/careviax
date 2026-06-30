// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
import { PatientFacilityMultiVisitCard } from './patient-facility-multi-visit-card';
import type { PatientOverview } from './patient-detail.types';

setupDomTestEnv();

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

function buildPatient(overrides: Partial<PatientOverview> = {}): PatientOverview {
  return {
    id: 'patient_1',
    name: '田中太郎',
    name_kana: 'タナカタロウ',
    birth_date: '1940-01-01',
    gender: 'male',
    updated_at: '2026-06-01T00:00:00.000Z',
    phone: null,
    medical_insurance_number: null,
    care_insurance_number: null,
    billing_support_flag: false,
    primary_pharmacist_id: null,
    backup_pharmacist_id: null,
    primary_staff_id: null,
    backup_staff_id: null,
    allergy_info: null,
    notes: null,
    archived_at: null,
    archived_by: null,
    archived_by_name: null,
    residences: [
      {
        id: 'res_1',
        address: '青空ホーム',
        building_id: null,
        facility_id: 'facility_1',
        facility_unit_id: 'unit_1',
        unit_name: '201',
        is_primary: true,
      },
    ],
    scheduling_preference: {
      preferred_weekdays: [1, 3],
      preferred_time_from: null,
      preferred_time_to: null,
      phone_contact_from: null,
      phone_contact_to: null,
      facility_time_from: '1970-01-01T09:00:00.000-08:00',
      facility_time_to: '1970-01-01T11:00:00.000-0800',
      family_presence_required: false,
      visit_buffer_minutes: 10,
      preferred_contact_name: null,
      preferred_contact_phone: null,
      visit_before_contact_required: false,
      first_visit_preferred_date: null,
      first_visit_time_slot: null,
      first_visit_time_note: null,
      parking_available: null,
      primary_contact_preference: null,
      mcs_linked: null,
      adl_level: null,
      dementia_level: null,
      swallowing_route: null,
      care_level: null,
      infection_isolation: false,
    },
    conditions: [],
    contacts: [],
    cases: [
      {
        id: 'case_1',
        status: 'active',
        primary_pharmacist_id: null,
        backup_pharmacist_id: null,
        referral_source: null,
        referral_date: null,
        start_date: null,
        end_date: null,
        end_reason: null,
        notes: null,
        created_at: '2026-04-01T00:00:00.000Z',
        updated_at: '2026-04-01T00:00:00.000Z',
        required_visit_support: null,
        care_team_links: [
          {
            id: 'team_1',
            role: 'care_manager',
            name: '佐藤ケアマネ',
            organization_name: '支援事業所',
            department: null,
            phone: null,
            email: null,
            fax: null,
            address: null,
            is_primary: true,
            notes: null,
          },
        ],
      },
    ],
    visit_schedules: [],
    summary_metrics: { open_tasks_count: 0 },
    risk_summary: null,
    visit_brief: {
      patient: {
        id: 'patient_1',
        name: '田中太郎',
      },
      context: 'patient',
      generated_at: '2026-04-01T00:00:00.000Z',
      last_prescribed_date: null,
      baseline_context: null,
      medication_changes: [],
      patient_changes: [],
      medications: [],
      dispensing_items: [],
      delivery_status: [],
      dosage_form_support: [],
      multidisciplinary_updates: [],
      jahis_supplemental_records: [],
      latest_labs: [],
      unresolved_items: [],
      must_check_today: [],
      rule_summary: {
        generation_id: 'rule_1',
        headline: '共有事項はありません',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-04-01T00:00:00.000Z',
      },
      ai_summary: {
        generation_id: 'ai_1',
        provider: 'rule',
        requested_provider: 'rule',
        is_fallback: true,
        model: null,
        fallback_reason: null,
        headline: '共有事項はありません',
        bullets: [],
        must_check_today: [],
        source_refs: [],
        generated_at: '2026-04-01T00:00:00.000Z',
        duration_ms: null,
        recent_generation_count_24h: 0,
        recent_failure_count_24h: 0,
        recent_failure_rate_24h: null,
      },
      conference_summary: null,
      facility_context: null,
      drug_cautions: [],
    },
    lab_summary: [],
    foundation: {
      summary: {
        status: 'ready',
        label: '基盤確認済',
        items: ['主要項目あり'],
      },
      items: [],
      changes_since_last_visit: [],
      latest_labs: [],
      insurances: [],
      archive: {
        archived: false,
        archived_at: null,
        archived_by_name: null,
      },
    },
    jahis_supplemental_records: [],
    workspace: null,
    privacy: {
      sensitive_fields_masked: false,
      address_fields_masked: false,
      can_view_detail: true,
    },
    ...overrides,
  };
}

describe('PatientFacilityMultiVisitCard', () => {
  it('shows facility/unit readiness and schedule grouping guidance', () => {
    vi.mocked(buildPatientHref).mockClear();

    const { container } = render(<PatientFacilityMultiVisitCard patient={buildPatient()} />);

    // SSOT/L170: 装飾に bespoke な Tailwind 状態色をベタ書きしない（トークンへ寄せる）。
    // 色名+シェード番号(例 sky-200)のみを検出する(translate-y 等の誤検出を避ける)。
    expect(container.innerHTML).not.toMatch(/(sky|emerald|violet|amber|slate|rose|cyan)-\d/);

    expect(screen.getByText('施設・個人宅の複数名同時訪問設定')).toBeTruthy();
    expect(screen.getByText('施設 登録済み')).toBeTruthy();
    expect(screen.getByText('ユニット 登録済み')).toBeTruthy();
    expect(screen.getByText('月・水')).toBeTruthy();
    expect(screen.getByText('09:00〜11:00 を訪問条件に保持しています。')).toBeTruthy();
    expect(
      screen.getByText(
        'スケジュール画面で同一施設または同一個人宅・同日訪問をひとまとめに表示します。',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '施設・ユニットを編集' }).getAttribute('href')).toBe(
      '#patient-facility-section',
    );
    expect(screen.getByRole('link', { name: '連携で編集' }).getAttribute('href')).toBe(
      '/patients/patient_1/collaboration',
    );
  });

  it('routes the collaboration link through buildPatientHref return value', () => {
    const realImpl = vi.mocked(buildPatientHref).getMockImplementation();
    vi.mocked(buildPatientHref).mockImplementation(
      (patientId: string, suffix = '') => `/patients/__sentinel_${patientId}__${suffix}`,
    );
    vi.mocked(buildPatientHref).mockClear();

    try {
      render(<PatientFacilityMultiVisitCard patient={buildPatient()} />);

      expect(screen.getByRole('link', { name: '連携で編集' }).getAttribute('href')).toBe(
        '/patients/__sentinel_patient_1__/collaboration',
      );
      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('patient_1', '/collaboration');
    } finally {
      if (realImpl) vi.mocked(buildPatientHref).mockImplementation(realImpl);
      vi.mocked(buildPatientHref).mockClear();
    }
  });

  it('encodes only the patient id segment for hostile collaboration ids', () => {
    vi.mocked(buildPatientHref).mockClear();
    const patientId = 'patient/1?tab=x#frag';

    render(<PatientFacilityMultiVisitCard patient={buildPatient({ id: patientId })} />);

    const href = screen.getByRole('link', { name: '連携で編集' }).getAttribute('href');
    expect(href).toBe(`/patients/${encodeURIComponent(patientId)}/collaboration`);
    expect(href).not.toContain('?tab=x');
    expect(href).not.toContain('#frag');
    expect(href).not.toContain('%25');
    expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith(patientId, '/collaboration');
  });

  it.each(['.', '..'])('inherits the patient href dot-segment guard for %s', (patientId) => {
    vi.mocked(buildPatientHref).mockClear();

    expect(() =>
      render(<PatientFacilityMultiVisitCard patient={buildPatient({ id: patientId })} />),
    ).toThrow(RangeError);
    expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith(patientId, '/collaboration');
  });

  it('treats an individual home address as a multi-visit grouping source', () => {
    render(
      <PatientFacilityMultiVisitCard
        patient={buildPatient({
          residences: [
            {
              id: 'res_1',
              address: '東京都港区1-1-1',
              building_id: '山田家',
              facility_id: null,
              facility_unit_id: null,
              unit_name: '1F',
              is_primary: true,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('個人宅 登録済み')).toBeTruthy();
    expect(screen.getByText('同居グループ 登録済み')).toBeTruthy();
    expect(screen.getByText(/個人宅 \/ 東京都港区1-1-1/)).toBeTruthy();
  });

  it('treats an individual home co-resident group id as a grouping source', () => {
    render(
      <PatientFacilityMultiVisitCard
        patient={buildPatient({
          residences: [
            {
              id: 'res_1',
              address: '',
              building_id: '山田家',
              facility_id: null,
              facility_unit_id: null,
              unit_name: '1F',
              is_primary: true,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText('個人宅 登録済み')).toBeTruthy();
    expect(
      screen.getByText('個人宅は同居グループIDで夫婦・同居人を同時訪問グループとして扱います。'),
    ).toBeTruthy();
    expect(screen.getByText(/個人宅 \/ 住所未登録 \/ 1F \/ 山田家/)).toBeTruthy();
  });
});
