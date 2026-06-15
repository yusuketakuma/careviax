'use client';

import { DashboardCockpit } from './dashboard-cockpit';
import { type DashboardFocusRole } from './dashboard-role-focus';

/**
 * /dashboard 本文。new_01_dashboard の運用コックピットを唯一の現行 UI として表示する。
 */
export function DashboardContent({ focusRole }: { focusRole?: DashboardFocusRole }) {
  void focusRole;

  return <DashboardCockpit />;
}
