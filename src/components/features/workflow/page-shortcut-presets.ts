import type { PageShortcutLink } from './page-shortcut-links';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';

export function getDispenseConfirmShortcutLinks(taskId: string): PageShortcutLink[] {
  return [
    { href: `/dispensing/${taskId}`, label: '調剤入力' },
    { href: `/auditing/${taskId}`, label: '鑑査確認' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getVisitDetailShortcutLinks(visitRecordId: string): PageShortcutLink[] {
  return [
    { href: '/reports', label: '報告書' },
    { href: `/visits/handoffs/${visitRecordId}`, label: '申し送り確認' },
    { href: '/schedules', label: 'スケジュール' },
  ];
}

export function getVisitHandoffShortcutLinks(visitRecordId: string): PageShortcutLink[] {
  return [
    { href: `/visits/${visitRecordId}`, label: '訪問記録詳細' },
    { href: '/handoff', label: '申し送り一覧' },
    { href: '/tasks', label: 'タスク' },
  ];
}

export function getPatientHubShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}/edit`, label: '患者情報編集', group: '基本情報' },
    { href: `/patients/${patientId}/prescriptions`, label: '処方履歴', group: '服薬・経過' },
    { href: `/patients/${patientId}/medications`, label: '服薬管理', group: '服薬・経過' },
    {
      href: `/patients/${patientId}/medication-calendar`,
      label: '服薬カレンダー',
      group: '服薬・経過',
    },
    { href: `/patients/${patientId}/consent`, label: '同意記録', group: '連携・共有' },
    { href: `/patients/${patientId}/mcs`, label: 'MCS連携', group: '連携・共有' },
    { href: `/patients/${patientId}/share`, label: '外部共有', group: '連携・共有' },
  ];
}

export function getPatientEditShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: `/patients/${patientId}/prescriptions`, label: '処方履歴' },
    { href: `/patients/${patientId}/medications`, label: '服薬管理' },
    { href: `/patients/${patientId}/consent`, label: '同意記録' },
  ];
}

export function getPatientMedicationShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: `/patients/${patientId}/prescriptions`, label: '処方履歴' },
    { href: `/patients/${patientId}/mcs`, label: 'MCS連携' },
    { href: `/patients/${patientId}/medication-calendar`, label: '服薬カレンダー' },
  ];
}

export function getPatientPrescriptionShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: `/patients/${patientId}/medications`, label: '服薬管理' },
    {
      href: `/prescriptions/new?patient_id=${patientId}`,
      label: '処方受付',
    },
  ];
}

export function getPatientShareShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: `/patients/${patientId}/mcs`, label: 'MCS連携' },
    { href: `/patients/${patientId}/consent`, label: '同意記録' },
    { href: '/external', label: '外部連携' },
  ];
}

export function getPatientMcsShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: `/patients/${patientId}/medications`, label: '服薬管理' },
    { href: `/patients/${patientId}/prescriptions`, label: '処方履歴' },
    { href: `/patients/${patientId}/share`, label: '外部共有' },
  ];
}

export function getPatientConsentShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: `/patients/${patientId}/mcs`, label: 'MCS連携' },
    { href: `/patients/${patientId}/share`, label: '外部共有' },
    { href: `/patients/${patientId}/medications`, label: '服薬管理' },
  ];
}

export function getPatientMedicationCalendarShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: `/patients/${patientId}/medications`, label: '服薬管理' },
    { href: `/patients/${patientId}/prescriptions`, label: '処方履歴' },
  ];
}

export function getSetPlanEditShortcutLinks(planId: string): PageShortcutLink[] {
  return [
    { href: `/medication-sets/full?plan_id=${planId}`, label: '計画詳細' },
    { href: `/medication-sets/audit/${planId}`, label: 'セット監査' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getMedicationSetFullShortcutLinks(planId: string | null): PageShortcutLink[] {
  return [
    ...(planId
      ? [
          { href: `/medication-sets/${planId}/edit`, label: 'セット編集' },
          { href: `/medication-sets/audit/${planId}`, label: 'セット監査' },
        ]
      : []),
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getReferralShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/patients', label: '患者一覧' },
    { href: '/patients/new', label: '患者新規登録' },
    { href: '/prescriptions/new', label: '新規処方受付' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getPatientNewShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/referrals/new', label: '紹介受付' },
    { href: '/prescriptions/new', label: '新規処方受付' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getScheduleProposalShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/schedules', label: '日次スケジュール' },
    { href: '/communications/requests', label: '依頼・照会' },
    { href: '/visits', label: '訪問記録' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getQrScanShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/prescriptions/qr-drafts', label: 'QR下書き一覧' },
    { href: '/prescriptions/new', label: '処方受付' },
    { href: '/referrals/new', label: '紹介受付' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getMyDayShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/visits', label: '訪問記録' },
    { href: '/tasks', label: 'タスク' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getSettingsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/dashboard', label: 'ホーム' },
    { href: '/my-day', label: 'My Day' },
    { href: '/qr-scan', label: 'QRスキャン' },
  ];
}

export function getReportsOverviewShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/reports/print', label: '帳票・印刷' },
    { href: '/communications/requests', label: '依頼・照会' },
    { href: '/external', label: '外部連携' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getReportDetailShortcutLinks(
  patientId: string | null,
  reportId?: string | null,
): PageShortcutLink[] {
  return [
    { href: '/reports', label: '報告書一覧' },
    ...(patientId ? [{ href: `/patients/${patientId}`, label: '患者詳細' }] : []),
    ...(reportId
      ? [
          {
            href: buildCommunicationRequestsHref({
              patientId,
              relatedEntityType: 'care_report',
              relatedEntityId: reportId,
            }),
            label: '関連依頼',
          },
        ]
      : []),
    { href: '/external', label: '外部連携' },
  ];
}

export function getReportPrintShortcutLinks(reportId: string): PageShortcutLink[] {
  return [
    { href: `/reports/${reportId}`, label: '報告書詳細' },
    {
      href: buildCommunicationRequestsHref({
        relatedEntityType: 'care_report',
        relatedEntityId: reportId,
      }),
      label: '関連依頼',
    },
    { href: '/reports', label: '報告書一覧' },
    { href: '/external', label: '外部連携' },
  ];
}

export function getManagementPlanPrintShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: '/reports', label: '報告書' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getPatientMedicationPrintShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}/medications`, label: '服薬管理' },
    { href: `/patients/${patientId}/medication-calendar`, label: '服薬カレンダー' },
    { href: `/patients/${patientId}`, label: '患者詳細' },
  ];
}

export function getPatientVisitRecordPrintShortcutLinks(patientId: string): PageShortcutLink[] {
  return [
    { href: `/patients/${patientId}`, label: '患者詳細' },
    { href: '/visits', label: '訪問一覧' },
    { href: '/reports', label: '報告書' },
  ];
}
