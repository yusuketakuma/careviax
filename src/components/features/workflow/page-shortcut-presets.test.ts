import { describe, expect, it } from 'vitest';
import {
  getDispenseConfirmShortcutLinks,
  getManagementPlanPrintShortcutLinks,
  getMyDayShortcutLinks,
  getPatientConsentShortcutLinks,
  getPatientEditShortcutLinks,
  getPatientHubShortcutLinks,
  getPatientMcsShortcutLinks,
  getPatientMedicationCalendarShortcutLinks,
  getPatientMedicationPrintShortcutLinks,
  getPatientMedicationShortcutLinks,
  getPatientNewShortcutLinks,
  getPatientPrescriptionShortcutLinks,
  getPatientShareShortcutLinks,
  getPatientVisitRecordPrintShortcutLinks,
  getQrScanShortcutLinks,
  getReferralShortcutLinks,
  getReportDetailShortcutLinks,
  getReportsOverviewShortcutLinks,
  getReportPrintShortcutLinks,
  getScheduleProposalShortcutLinks,
  getSettingsShortcutLinks,
  getVisitDetailShortcutLinks,
} from './page-shortcut-presets';

describe('page shortcut presets', () => {
  it('builds patient context shortcuts around the current patient id', () => {
    expect(getPatientHubShortcutLinks('p1')).toEqual([
      { href: '/patients/p1/edit', label: '患者情報編集', group: '基本情報' },
      { href: '/patients/p1/prescriptions', label: '処方履歴', group: '服薬・経過' },
      { href: '/patients/p1/medications', label: '服薬管理', group: '服薬・経過' },
      { href: '/patients/p1/medication-calendar', label: '服薬カレンダー', group: '服薬・経過' },
      { href: '/patients/p1/consent', label: '同意記録', group: '連携・共有' },
      { href: '/patients/p1/mcs', label: 'MCS連携', group: '連携・共有' },
      { href: '/patients/p1/share', label: '外部共有', group: '連携・共有' },
    ]);

    expect(getPatientMedicationShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
      { href: '/patients/p1/mcs', label: 'MCS連携' },
      { href: '/patients/p1/medication-calendar', label: '服薬カレンダー' },
    ]);

    expect(getPatientPrescriptionShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/prescriptions/new?patient_id=p1', label: '処方受付' },
    ]);

    expect(getPatientShareShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/mcs', label: 'MCS連携' },
      { href: '/patients/p1/consent', label: '同意記録' },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getPatientMcsShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
      { href: '/patients/p1/share', label: '外部共有' },
    ]);

    expect(getPatientConsentShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/mcs', label: 'MCS連携' },
      { href: '/patients/p1/share', label: '外部共有' },
      { href: '/patients/p1/medications', label: '服薬管理' },
    ]);

    expect(getPatientMedicationCalendarShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
    ]);

    expect(getPatientEditShortcutLinks('p1')).toEqual([
      { href: '/patients/p1', label: '患者詳細' },
      { href: '/patients/p1/prescriptions', label: '処方履歴' },
      { href: '/patients/p1/medications', label: '服薬管理' },
      { href: '/patients/p1/consent', label: '同意記録' },
    ]);
  });

  it('builds visit, dispensing, and referral shortcuts with stable targets', () => {
    expect(getDispenseConfirmShortcutLinks('task-1')).toEqual([
      { href: '/dispensing/task-1', label: '調剤入力' },
      { href: '/auditing/task-1', label: '鑑査確認' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getVisitDetailShortcutLinks('visit-1')).toEqual([
      { href: '/reports', label: '報告書' },
      { href: '/handoff', label: '申し送り確認' },
      { href: '/schedules', label: 'スケジュール' },
    ]);

    expect(getReferralShortcutLinks()).toEqual([
      { href: '/patients', label: '患者一覧' },
      { href: '/patients/new', label: '患者新規登録' },
      { href: '/prescriptions/new', label: '新規処方受付' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getPatientNewShortcutLinks()).toEqual([
      { href: '/referrals/new', label: '紹介受付' },
      { href: '/prescriptions/new', label: '新規処方受付' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getScheduleProposalShortcutLinks()).toEqual([
      { href: '/schedules', label: '日次スケジュール' },
      { href: '/communications/requests', label: '依頼・照会' },
      { href: '/visits', label: '訪問記録' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getQrScanShortcutLinks()).toEqual([
      { href: '/prescriptions/qr-drafts', label: 'QR下書き一覧' },
      { href: '/prescriptions/new', label: '処方受付' },
      { href: '/referrals/new', label: '紹介受付' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getMyDayShortcutLinks()).toEqual([
      { href: '/visits', label: '訪問記録' },
      { href: '/tasks', label: 'タスク' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getSettingsShortcutLinks()).toEqual([
      { href: '/dashboard', label: 'ホーム' },
      { href: '/my-day', label: 'My Day' },
      { href: '/qr-scan', label: 'QRスキャン' },
    ]);

    expect(getReportsOverviewShortcutLinks()).toEqual([
      { href: '/reports/print', label: '帳票・印刷' },
      { href: '/communications/requests', label: '依頼・照会' },
      { href: '/external', label: '外部連携' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getReportDetailShortcutLinks('patient_1', 'report_1')).toEqual([
      { href: '/reports', label: '報告書一覧' },
      { href: '/patients/patient_1', label: '患者詳細' },
      {
        href: '/communications/requests?patient_id=patient_1&related_entity_type=care_report&related_entity_id=report_1',
        label: '関連依頼',
      },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getReportDetailShortcutLinks(null)).toEqual([
      { href: '/reports', label: '報告書一覧' },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getReportPrintShortcutLinks('report_1')).toEqual([
      { href: '/reports/report_1', label: '報告書詳細' },
      {
        href: '/communications/requests?related_entity_type=care_report&related_entity_id=report_1',
        label: '関連依頼',
      },
      { href: '/reports', label: '報告書一覧' },
      { href: '/external', label: '外部連携' },
    ]);

    expect(getManagementPlanPrintShortcutLinks('patient_1')).toEqual([
      { href: '/patients/patient_1', label: '患者詳細' },
      { href: '/reports', label: '報告書' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getPatientMedicationPrintShortcutLinks('patient_1')).toEqual([
      { href: '/patients/patient_1/medications', label: '服薬管理' },
      { href: '/patients/patient_1/medication-calendar', label: '服薬カレンダー' },
      { href: '/patients/patient_1', label: '患者詳細' },
    ]);

    expect(getPatientVisitRecordPrintShortcutLinks('patient_1')).toEqual([
      { href: '/patients/patient_1', label: '患者詳細' },
      { href: '/visits', label: '訪問一覧' },
      { href: '/reports', label: '報告書' },
    ]);
  });
});
