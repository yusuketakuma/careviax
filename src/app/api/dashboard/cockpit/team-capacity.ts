import type { CockpitTeamMember } from '@/types/dashboard-cockpit';

/**
 * チームの余白(new_01「チームの余白」カード)集計。
 * Route Handler は GET 以外を export できないため、route.ts から分離してテスト可能にする。
 */

// シフト未登録時の既定勤務枠と、表示メンバー上限
const TEAM_CAPACITY_LIMIT = 4;
const DEFAULT_WORK_START_HOUR = 9;
const DEFAULT_WORK_END_HOUR = 18;
const DEFAULT_VISIT_DURATION_MINUTES = 60;

export type TeamMemberRow = {
  user_id: string;
  role: string;
  user: { name: string };
};

export type TeamShiftRow = {
  user_id: string;
  available: boolean;
  available_from: Date | null;
  available_to: Date | null;
};

export type TeamVisitRow = {
  pharmacist_id: string;
  time_window_start: Date | null;
  time_window_end: Date | null;
};

/** @db.Time の値を today の実時刻へ投影する(null は fallbackHour 時)。 */
function projectTimeOfDay(time: Date | null, base: Date, fallbackHour: number): Date {
  const projected = new Date(base);
  if (time) {
    projected.setHours(time.getUTCHours(), time.getUTCMinutes(), 0, 0);
  } else {
    projected.setHours(fallbackHour, 0, 0, 0);
  }
  return projected;
}

/**
 * チームの余白(残り勤務 − 残り訪問拘束の目安)。
 * シフトがあれば勤務枠と不在を尊重し、なければ 9:00-18:00 とみなす読み取り専用の近似値。
 */
export function buildTeamCapacity(
  members: TeamMemberRow[],
  shifts: TeamShiftRow[],
  visits: TeamVisitRow[],
  now: Date,
): CockpitTeamMember[] {
  const shiftByUser = new Map(shifts.map((shift) => [shift.user_id, shift]));
  const roleWeight = (role: string) => (role === 'clerk' ? 1 : 0);

  return members
    .slice()
    .sort((left, right) => roleWeight(left.role) - roleWeight(right.role))
    .slice(0, TEAM_CAPACITY_LIMIT)
    .map((member) => {
      const roleLabel = member.role === 'clerk' ? '事務' : '薬';
      const shift = shiftByUser.get(member.user_id) ?? null;
      if (shift && !shift.available) {
        return {
          user_id: member.user_id,
          name: member.user.name,
          role_label: roleLabel,
          status: 'off',
          slack_minutes: null,
          busy_ratio: null,
        } satisfies CockpitTeamMember;
      }

      const workStart = projectTimeOfDay(
        shift?.available_from ?? null,
        now,
        DEFAULT_WORK_START_HOUR,
      );
      const workEnd = projectTimeOfDay(shift?.available_to ?? null, now, DEFAULT_WORK_END_HOUR);
      const effectiveStart = now > workStart ? now : workStart;
      const remainingWorkMinutes = Math.max(
        0,
        Math.round((workEnd.getTime() - effectiveStart.getTime()) / 60_000),
      );

      const busyMinutes = visits
        .filter((visit) => visit.pharmacist_id === member.user_id)
        .reduce((total, visit) => {
          const start = visit.time_window_start;
          if (!start || start.getTime() < now.getTime()) return total;
          const end = visit.time_window_end;
          const duration = end
            ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000))
            : DEFAULT_VISIT_DURATION_MINUTES;
          return total + duration;
        }, 0);

      const slackMinutes = Math.max(0, remainingWorkMinutes - busyMinutes);
      const busyRatio =
        remainingWorkMinutes > 0 ? Math.min(1, busyMinutes / remainingWorkMinutes) : 1;

      return {
        user_id: member.user_id,
        name: member.user.name,
        role_label: roleLabel,
        status: 'working',
        slack_minutes: slackMinutes,
        busy_ratio: Number(busyRatio.toFixed(3)),
      } satisfies CockpitTeamMember;
    });
}
