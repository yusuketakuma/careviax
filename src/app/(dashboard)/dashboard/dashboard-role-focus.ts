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
