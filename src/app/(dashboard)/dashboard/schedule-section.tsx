'use client';

import { HomeScheduleBoard } from './home-schedule-board';
import { type DashboardFocusRole } from './dashboard-role-focus';

export function ScheduleSection({
  focusRole = 'common',
}: {
  focusRole?: DashboardFocusRole;
}) {
  return <HomeScheduleBoard focusRole={focusRole} />;
}
