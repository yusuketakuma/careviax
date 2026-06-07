import type { PageShortcutLink } from '@/components/features/workflow/page-shortcut-links';

export function getAdminDashboardShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/settings', label: '管理設定' },
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/admin/staff', label: 'スタッフ' },
    { href: '/admin/facilities', label: '施設' },
    { href: '/admin/contact-profiles', label: '連携先' },
    { href: '/admin/pca-pumps', label: 'PCAポンプ' },
    { href: '/admin/formulary', label: '採用薬' },
    { href: '/admin/drug-masters', label: '医薬品' },
    { href: '/admin/billing-rules', label: '請求ルール' },
    { href: '/admin/document-templates', label: '文書' },
    { href: '/admin/audit-logs', label: '監査ログ' },
  ];
}

export function getAdminSettingsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/admin/notification-settings', label: '通知設定' },
    { href: '/admin/audit-logs', label: '監査ログ' },
  ];
}

export function getAdminStaffShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/users', label: 'ユーザー' },
    { href: '/admin/shifts', label: 'シフト' },
    { href: '/admin/performance', label: 'パフォーマンス' },
  ];
}

export function getAdminFacilitiesShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/admin/service-areas', label: '訪問エリア' },
    { href: '/admin/contact-profiles', label: '連携先' },
  ];
}

export function getAdminExternalProfessionalsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/contact-profiles', label: '連携先' },
    { href: '/admin/institutions', label: '医療機関' },
    { href: '/communications/requests', label: '依頼・照会' },
  ];
}

export function getAdminContactProfilesShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/external-professionals', label: '他職種' },
    { href: '/admin/institutions', label: '医療機関' },
    { href: '/admin/document-templates', label: '文書テンプレート' },
  ];
}

export function getAdminInstitutionsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/contact-profiles', label: '連携先' },
    { href: '/admin/pca-pumps', label: 'PCAポンプ' },
    { href: '/admin/alert-rules', label: '処方安全アラート' },
    { href: '/reports', label: '報告書' },
  ];
}

export function getAdminBusinessHolidaysShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/admin/shifts', label: 'シフト' },
    { href: '/schedules', label: 'スケジュール' },
  ];
}

export function getAdminPharmacySitesShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/business-holidays', label: '休日カレンダー' },
    { href: '/admin/service-areas', label: '訪問エリア' },
    { href: '/admin/billing-rules', label: '請求ルール' },
  ];
}

export function getAdminServiceAreasShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/facilities', label: '施設' },
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/patients', label: '患者一覧' },
  ];
}

export function getAdminNotificationSettingsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/realtime', label: 'リアルタイム監視' },
    { href: '/admin/alert-rules', label: '処方安全アラート' },
    { href: '/notifications', label: '通知一覧' },
  ];
}

export function getAdminDocumentTemplatesShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/contact-profiles', label: '連携先' },
    { href: '/reports', label: '報告書' },
    { href: '/admin/notification-settings', label: '通知設定' },
  ];
}

export function getAdminDataExplorerShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/audit-logs', label: '監査ログ' },
    { href: '/admin/metrics', label: '経営指標' },
    { href: '/admin/realtime', label: 'リアルタイム監視' },
  ];
}

export function getAdminDrugMasterShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/alert-rules', label: '処方安全アラート' },
    { href: '/admin/packaging-methods', label: '配薬方法' },
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/prescriptions', label: '処方受付' },
  ];
}

export function getAdminPackagingMethodsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/drug-masters', label: '医薬品マスター' },
    { href: '/admin/formulary', label: '採用薬' },
    { href: '/medication-sets', label: 'セット管理' },
  ];
}

export function getAdminAlertRulesShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/drug-masters', label: '医薬品マスター' },
    { href: '/admin/institutions', label: '医療機関' },
    { href: '/prescriptions', label: '処方受付' },
  ];
}

export function getAdminJobsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/realtime', label: 'リアルタイム監視' },
    { href: '/admin/metrics', label: '経営指標' },
    { href: '/admin/audit-logs', label: '監査ログ' },
  ];
}

export function getAdminMetricsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/analytics', label: 'KPI分析' },
    { href: '/billing', label: '請求' },
    { href: '/reports/analytics', label: '報告書分析' },
  ];
}

export function getAdminAnalyticsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/metrics', label: '経営指標' },
    { href: '/billing', label: '請求' },
    { href: '/reports/analytics', label: '報告書分析' },
  ];
}

export function getAdminPerformanceShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/realtime', label: 'リアルタイム監視' },
    { href: '/schedules/proposals', label: 'スケジュール提案' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getAdminRealtimeShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/notifications', label: '通知一覧' },
    { href: '/admin/performance', label: 'パフォーマンス' },
    { href: '/workflow', label: 'ワークフロー' },
  ];
}

export function getAdminFacilityStandardsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/facilities', label: '施設' },
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/admin/service-areas', label: '訪問エリア' },
  ];
}

export function getAdminPharmacistCredentialsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/staff', label: 'スタッフ' },
    { href: '/admin/shifts', label: 'シフト' },
    { href: '/admin/performance', label: 'パフォーマンス' },
  ];
}

export function getAdminUatShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/metrics', label: '経営指標' },
    { href: '/admin/jobs', label: 'ジョブ' },
    { href: '/admin/audit-logs', label: '監査ログ' },
  ];
}

export function getAdminShiftsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/staff', label: 'スタッフ' },
    { href: '/admin/business-holidays', label: '休日カレンダー' },
    { href: '/schedules', label: 'スケジュール' },
  ];
}

export function getAdminUsersShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/staff', label: 'スタッフ' },
    { href: '/admin/pharmacist-credentials', label: '薬剤師資格' },
    { href: '/admin/settings', label: '管理設定' },
  ];
}

export function getAdminBillingRulesShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/billing', label: '請求' },
    { href: '/admin/pharmacy-sites', label: '薬局情報' },
    { href: '/admin/metrics', label: '経営指標' },
  ];
}

export function getAdminFormularyShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/drug-masters', label: '医薬品マスター' },
    { href: '/admin/alert-rules', label: '処方安全アラート' },
    { href: '/prescriptions', label: '処方受付' },
  ];
}

export function getAdminAuditLogsShortcutLinks(): PageShortcutLink[] {
  return [
    { href: '/admin/data-explorer', label: 'データ探索' },
    { href: '/admin/settings', label: '管理設定' },
    { href: '/admin/jobs', label: 'ジョブ' },
  ];
}
