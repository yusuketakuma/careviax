import type { MemberRole } from '@prisma/client';

export type DashboardFocusRole = 'pharmacist' | 'clerk' | 'common';

export function resolveDashboardFocusRole(
  role: MemberRole | string | null | undefined,
): DashboardFocusRole {
  if (
    role === 'owner' ||
    role === 'admin' ||
    role === 'pharmacist' ||
    role === 'pharmacist_trainee'
  ) {
    return 'pharmacist';
  }

  if (role === 'clerk') {
    return 'clerk';
  }

  return 'common';
}

export function dashboardFocusSummary(role: DashboardFocusRole) {
  switch (role) {
    case 'pharmacist':
      return '薬剤師導線を優先して表示しています。優先アクション、訪問、調剤、報告の順で確認します。';
    case 'clerk':
      return '事務スタッフ導線を優先して表示しています。受付、QR、日程調整、照会対応の順で確認します。';
    default:
      return '共通導線を表示しています。緊急対応、今日の予定、個人タスク、申し送りの順で確認します。';
  }
}
