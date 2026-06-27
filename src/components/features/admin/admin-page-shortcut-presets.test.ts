import { describe, expect, it } from 'vitest';
import {
  getAdminAlertRulesShortcutLinks,
  getAdminAnalyticsShortcutLinks,
  getAdminBusinessHolidaysShortcutLinks,
  getAdminContactProfilesShortcutLinks,
  getAdminDataExplorerShortcutLinks,
  getAdminDocumentTemplatesShortcutLinks,
  getAdminDrugMasterShortcutLinks,
  getAdminExternalProfessionalsShortcutLinks,
  getAdminFacilitiesShortcutLinks,
  getAdminInstitutionsShortcutLinks,
  getAdminJobsShortcutLinks,
  getAdminMetricsShortcutLinks,
  getAdminPackagingMethodsShortcutLinks,
  getAdminNotificationSettingsShortcutLinks,
  getAdminOperatingHoursShortcutLinks,
  getAdminPerformanceShortcutLinks,
  getAdminPharmacySitesShortcutLinks,
  getAdminRealtimeShortcutLinks,
  getAdminServiceAreasShortcutLinks,
  getAdminSettingsShortcutLinks,
  getAdminStaffShortcutLinks,
} from './admin-page-shortcut-presets';

describe('admin page shortcut presets', () => {
  it('returns stable related shortcuts for admin detail surfaces', () => {
    expect(getAdminSettingsShortcutLinks()).toEqual([
      { href: '/admin/pharmacy-sites', label: '薬局情報' },
      { href: '/admin/notification-settings', label: '通知設定' },
      { href: '/admin/audit-logs', label: '監査ログ' },
    ]);

    expect(getAdminStaffShortcutLinks()).toEqual([
      { href: '/admin/users', label: 'ユーザー' },
      { href: '/admin/shifts', label: 'シフト' },
      { href: '/admin/performance', label: 'パフォーマンス' },
    ]);

    expect(getAdminFacilitiesShortcutLinks()).toEqual([
      { href: '/admin/pharmacy-sites', label: '薬局情報' },
      { href: '/admin/service-areas', label: '訪問エリア' },
      { href: '/admin/contact-profiles', label: '連携先' },
    ]);

    expect(getAdminExternalProfessionalsShortcutLinks()).toEqual([
      { href: '/admin/contact-profiles', label: '連携先' },
      { href: '/admin/institutions', label: '医療機関' },
      { href: '/communications/requests', label: '依頼・照会' },
    ]);

    expect(getAdminContactProfilesShortcutLinks()).toEqual([
      { href: '/admin/external-professionals', label: '他職種' },
      { href: '/admin/institutions', label: '医療機関' },
      { href: '/admin/document-templates', label: '文書テンプレート' },
    ]);

    expect(getAdminInstitutionsShortcutLinks()).toEqual([
      { href: '/admin/contact-profiles', label: '連携先' },
      { href: '/admin/pca-pumps', label: 'PCAポンプ' },
      { href: '/admin/alert-rules', label: '処方安全アラート' },
      { href: '/reports', label: '報告書' },
    ]);

    expect(getAdminBusinessHolidaysShortcutLinks()).toEqual([
      { href: '/admin/operating-hours', label: '稼働日設定' },
      { href: '/admin/pharmacy-sites', label: '薬局情報' },
      { href: '/admin/shifts', label: 'シフト' },
      { href: '/schedules', label: 'スケジュール' },
    ]);

    expect(getAdminOperatingHoursShortcutLinks()).toEqual([
      { href: '/admin/business-holidays', label: '休日カレンダー' },
      { href: '/admin/pharmacy-sites', label: '薬局情報' },
      { href: '/admin/shifts', label: 'シフト' },
    ]);

    expect(getAdminPharmacySitesShortcutLinks()).toEqual([
      { href: '/admin/operating-hours', label: '稼働日設定' },
      { href: '/admin/business-holidays', label: '休日カレンダー' },
      { href: '/admin/service-areas', label: '訪問エリア' },
      { href: '/admin/billing-rules', label: '請求ルール' },
    ]);

    expect(getAdminServiceAreasShortcutLinks()).toEqual([
      { href: '/admin/facilities', label: '施設' },
      { href: '/admin/pharmacy-sites', label: '薬局情報' },
      { href: '/patients', label: '患者一覧' },
    ]);

    expect(getAdminNotificationSettingsShortcutLinks()).toEqual([
      { href: '/admin/realtime', label: 'リアルタイム監視' },
      { href: '/admin/alert-rules', label: '処方安全アラート' },
      { href: '/notifications', label: '通知一覧' },
    ]);

    expect(getAdminDocumentTemplatesShortcutLinks()).toEqual([
      { href: '/admin/contact-profiles', label: '連携先' },
      { href: '/reports', label: '報告書' },
      { href: '/admin/notification-settings', label: '通知設定' },
    ]);

    expect(getAdminDataExplorerShortcutLinks()).toEqual([
      { href: '/admin/audit-logs', label: '監査ログ' },
      { href: '/admin/metrics', label: '経営指標' },
      { href: '/admin/realtime', label: 'リアルタイム監視' },
    ]);

    expect(getAdminDrugMasterShortcutLinks()).toEqual([
      { href: '/admin/alert-rules', label: '処方安全アラート' },
      { href: '/admin/packaging-methods', label: '配薬方法' },
      { href: '/admin/pharmacy-sites', label: '薬局情報' },
      { href: '/prescriptions', label: '処方受付' },
    ]);

    expect(getAdminPackagingMethodsShortcutLinks()).toEqual([
      { href: '/admin/drug-masters', label: '医薬品マスター' },
      { href: '/admin/formulary', label: '採用薬' },
      { href: '/set', label: 'セット管理' },
    ]);

    expect(getAdminAlertRulesShortcutLinks()).toEqual([
      { href: '/admin/drug-masters', label: '医薬品マスター' },
      { href: '/admin/institutions', label: '医療機関' },
      { href: '/prescriptions', label: '処方受付' },
    ]);

    expect(getAdminJobsShortcutLinks()).toEqual([
      { href: '/admin/realtime', label: 'リアルタイム監視' },
      { href: '/admin/metrics', label: '経営指標' },
      { href: '/admin/audit-logs', label: '監査ログ' },
    ]);

    expect(getAdminMetricsShortcutLinks()).toEqual([
      { href: '/admin/analytics', label: 'KPI分析' },
      { href: '/billing', label: '請求' },
      { href: '/reports/analytics', label: '報告書分析' },
    ]);

    expect(getAdminAnalyticsShortcutLinks()).toEqual([
      { href: '/admin/metrics', label: '経営指標' },
      { href: '/billing', label: '請求' },
      { href: '/reports/analytics', label: '報告書分析' },
    ]);

    expect(getAdminPerformanceShortcutLinks()).toEqual([
      { href: '/admin/realtime', label: 'リアルタイム監視' },
      { href: '/schedules/proposals', label: 'スケジュール提案' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);

    expect(getAdminRealtimeShortcutLinks()).toEqual([
      { href: '/notifications', label: '通知一覧' },
      { href: '/admin/performance', label: 'パフォーマンス' },
      { href: '/workflow', label: 'ワークフロー' },
    ]);
  });
});
