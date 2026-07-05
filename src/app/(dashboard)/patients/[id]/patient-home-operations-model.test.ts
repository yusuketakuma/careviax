import { describe, expect, it } from 'vitest';
import type { PatientHomeOperationItem } from '@/types/patient-home-operations';
import type { PatientOverview } from './patient-detail.types';
import {
  buildHomeOperationsItems,
  getPrimaryHomeVisitIntake,
  selectHomeOperationMetrics,
} from './patient-home-operations-model';

function buildPatient(overrides: Partial<PatientOverview> = {}): PatientOverview {
  return {
    id: 'patient/../unsafe id',
    billing_support_flag: false,
    scheduling_preference: {
      mcs_linked: false,
    },
    cases: [
      {
        id: 'case_stale',
        status: 'on_hold',
        required_visit_support: null,
      },
      {
        id: 'case_active',
        status: 'active',
        required_visit_support: {
          home_visit_intake: {
            document_status_note: '契約書類は回収済み',
          },
        },
      },
    ],
    workspace: {
      current_intake: {
        id: 'intake_1',
      },
    },
    visit_brief: {
      conference_summary: {
        recent_conferences: 1,
      },
    },
    ...overrides,
  } as PatientOverview;
}

describe('buildHomeOperationsItems', () => {
  it('derives a fail-soft fallback home operations model with encoded patient links', () => {
    const items = buildHomeOperationsItems(
      buildPatient({
        id: 'pt/1?x=y#z',
        billing_support_flag: true,
        scheduling_preference: { mcs_linked: true } as PatientOverview['scheduling_preference'],
      }),
    );

    expect(items.map((item) => item.key)).toEqual([
      'documents',
      'mcs',
      'prescription',
      'billing',
      'conference',
    ]);
    expect(items.find((item) => item.key === 'documents')).toMatchObject({
      status: '書類メモあり',
      tone: 'ok',
      description: '契約書類は回収済み',
      href: '/patients/pt%2F1%3Fx%3Dy%23z#patient-documents',
      alerts: [],
    });
    expect(items.find((item) => item.key === 'mcs')).toMatchObject({
      status: '連携あり',
      tone: 'ok',
      href: '/patients/pt%2F1%3Fx%3Dy%23z/mcs',
    });
    expect(items.find((item) => item.key === 'prescription')).toMatchObject({
      status: '受付あり',
      tone: 'ok',
      href: '/patients/pt%2F1%3Fx%3Dy%23z/prescriptions',
    });
    expect(items.find((item) => item.key === 'billing')).toMatchObject({
      status: '支援対象',
      tone: 'ok',
      href: '/billing/candidates?patient_id=pt%2F1%3Fx%3Dy%23z',
    });
    expect(items.find((item) => item.key === 'conference')).toMatchObject({
      status: '共有要点あり',
      tone: 'ok',
      href: '/conferences?patient_id=pt%2F1%3Fx%3Dy%23z&case_id=case_active&focus=notes&context=patient_detail',
    });
  });

  it('fails closed for exact dot-segment patient ids before creating patient-scoped fallback links', () => {
    expect(() => buildHomeOperationsItems(buildPatient({ id: '..' }))).toThrow(
      'Patient id cannot be a dot segment',
    );
  });

  it('keeps attention alerts when server-side home operations are unavailable and local context is missing', () => {
    const items = buildHomeOperationsItems(
      buildPatient({
        billing_support_flag: false,
        scheduling_preference: { mcs_linked: false } as PatientOverview['scheduling_preference'],
        cases: [
          {
            id: 'case_without_intake',
            status: 'active',
            required_visit_support: null,
          },
        ] as PatientOverview['cases'],
        workspace: null,
        visit_brief: { conference_summary: null } as PatientOverview['visit_brief'],
      }),
    );

    expect(items.find((item) => item.key === 'documents')).toMatchObject({
      status: '要確認',
      tone: 'attention',
      alerts: ['書類状態を確認してください'],
    });
    expect(items.find((item) => item.key === 'prescription')).toMatchObject({
      status: '未受付',
      tone: 'attention',
      alerts: ['処方せん受付がまだありません'],
    });
    expect(items.find((item) => item.key === 'conference')).toMatchObject({
      status: '未登録',
      tone: 'attention',
      alerts: ['カンファレンス記録が未登録です'],
    });
  });

  it('selects priority metrics without duplicates and caps the compact view at four rows', () => {
    const metrics = selectHomeOperationMetrics({
      key: 'billing',
      metrics: [
        { label: 'その他', value: 'A' },
        { label: '領収証', value: 'あり' },
        { label: '未収額', value: '12,000円' },
        { label: '支払者', value: '家族' },
        { label: '未収額', value: '重複' },
        { label: '次回集金予定', value: '7/10' },
        { label: '請求書', value: '未' },
      ],
    } as PatientHomeOperationItem);

    expect(metrics).toEqual([
      { label: '未収額', value: '12,000円' },
      { label: '次回集金予定', value: '7/10' },
      { label: '支払者', value: '家族' },
      { label: '領収証', value: 'あり' },
    ]);
  });

  it('returns the active case home-visit intake as the fallback source of document state', () => {
    expect(getPrimaryHomeVisitIntake(buildPatient())?.document_status_note).toBe(
      '契約書類は回収済み',
    );
  });
});
