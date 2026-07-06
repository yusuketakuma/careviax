import { describe, expect, it } from 'vitest';
import {
  buildPatientWorkflowProcessLabel,
  derivePatientWorkflowState,
  getPatientWorkflowStepLabel,
  type PatientWorkflowStateInput,
} from './patient-workflow-state';

function buildInput(overrides: Partial<PatientWorkflowStateInput> = {}): PatientWorkflowStateInput {
  return {
    patientId: 'patient_1',
    hasCareCase: true,
    careCaseStatus: 'active',
    currentStep: 'audit',
    cycleOverallStatus: 'dispensed',
    cycleExceptionStatus: null,
    cycleUpdatedAt: new Date('2026-07-04T09:00:00+09:00'),
    hospitalized: false,
    auditWaiting: false,
    hasNarcotic: false,
    auditDueDate: null,
    inquiryResolvedAt: null,
    inquiryInquiredAt: null,
    visitToday: false,
    visitPreparationReady: false,
    nextScheduleId: null,
    pendingReportId: null,
    openExceptionType: null,
    now: new Date('2026-07-05T10:00:00+09:00'),
    ...overrides,
  };
}

describe('patient-workflow-state', () => {
  it('keeps paused and acceptance states outside the linear current step', () => {
    expect(
      derivePatientWorkflowState(
        buildInput({
          hospitalized: true,
          currentStep: 'billing',
        }),
      ),
    ).toMatchObject({
      attention: 'paused',
      statusText: '入院中 — 退院時共同指導の対象',
      currentStep: null,
      nextVisitLabel: '退院連絡待ち',
      link: { label: '算定チェックへ', href: '/billing' },
    });

    expect(
      derivePatientWorkflowState(
        buildInput({
          careCaseStatus: 'assessment',
          currentStep: 'visit',
          nextScheduleId: '../schedule with space?x=1#frag',
        }),
      ),
    ).toMatchObject({
      attention: 'acceptance',
      statusTone: 'caution',
      currentStep: null,
      link: {
        label: 'スケジュールへ',
        href: '/schedules?focus=schedule&schedule_id=..%2Fschedule%20with%20space%3Fx%3D1%23frag',
      },
    });
  });

  it('preserves clinically meaningful priority order before generic workflow exceptions', () => {
    expect(
      derivePatientWorkflowState(
        buildInput({
          auditWaiting: true,
          hasNarcotic: true,
          auditDueDate: new Date('2026-06-12T00:05:00.000Z'),
          openExceptionType: 'prescription_structuring_block',
        }),
      ),
    ).toMatchObject({
      attention: 'urgent_now',
      statusText: '麻薬監査 期限09:05 — 持参薬が未確定',
      statusTone: 'critical',
      link: { label: '監査へ', href: '/audit' },
    });

    expect(
      derivePatientWorkflowState(
        buildInput({
          cycleOverallStatus: 'inquiry_resolved',
          inquiryResolvedAt: new Date('2026-06-12T00:05:00.000Z'),
          openExceptionType: 'prescription_structuring_block',
        }),
      ),
    ).toMatchObject({
      attention: 'wait_release',
      statusText: '照会回答が届きました(09:05) — 調剤を再開できます',
      statusTone: 'positive',
      link: { label: '調剤へ', href: '/dispense' },
    });
  });

  it('keeps cycle reply-wait status separate from generic open exception labels', () => {
    expect(
      derivePatientWorkflowState(
        buildInput({
          cycleExceptionStatus: 'awaiting_reply',
          openExceptionType: 'prescription_structuring_block',
          pendingReportId: '../report?x=1#frag',
        }),
      ),
    ).toMatchObject({
      attention: 'reply_wait',
      statusText: '報告先の返信待ち 1日 — 再送できます',
      statusTone: 'external',
      link: {
        label: '報告・共有へ',
        href: '/reports/..%2Freport%3Fx%3D1%23frag',
      },
    });
  });

  it('returns controlled exception text and never needs raw workflow descriptions', () => {
    expect(
      derivePatientWorkflowState(
        buildInput({
          openExceptionType: 'prescription_structuring_block',
        }),
      ),
    ).toMatchObject({
      attention: 'checking',
      statusText: '処方構造化の確認中 — 詳細確認が必要です',
      statusTone: 'caution',
    });

    expect(
      derivePatientWorkflowState(
        buildInput({
          openExceptionType: 'unknown_exception',
        }),
      ).statusText,
    ).toBe('確認事項があります — 詳細確認が必要です');
  });

  it('shares command-center step labels without duplicating process label formatting', () => {
    expect(getPatientWorkflowStepLabel('audit')).toBe('監査');
    expect(getPatientWorkflowStepLabel(null)).toBeNull();
    expect(
      buildPatientWorkflowProcessLabel({
        currentStep: 'audit',
        cycleAction: {
          statusLabel: '調剤鑑査待ち',
          description: '調剤鑑査をして、セット作業へ進めます。',
          actionLabel: '調剤鑑査を始める',
          actionHref: '/audit',
        },
      }),
    ).toBe('工程: 監査(いまここ)');
    expect(
      buildPatientWorkflowProcessLabel({
        currentStep: null,
        cycleAction: {
          statusLabel: '保留中',
          description: '保留の理由を確認します。',
          actionLabel: '確認する',
          actionHref: '/workflow',
        },
      }),
    ).toBe('工程: 保留中');
  });
});
