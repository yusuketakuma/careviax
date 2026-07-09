import { describe, expect, it } from 'vitest';
import { PATIENT_STATUS_ICON_ROLE } from '@/lib/constants/status-labels';
import { STATUS_ICON_CONFIG, derivePatientStatusIcon } from './status-icon';

// 6軸状態色(SSOT 3.1 / 確定表「PatientStatusIcon」): raw Tailwind パレットを廃し、
// 中央トークン(--state-*/--tag-*)のみで描くことを固定する。
describe('STATUS_ICON_CONFIG', () => {
  const RAW_PALETTE_PATTERN =
    /(green|blue|sky|yellow|red|orange|amber|indigo|purple|teal|rose|gray|slate)-\d{2,3}/;

  it('uses only central state/tag tokens (no raw Tailwind palette)', () => {
    for (const [icon, config] of Object.entries(STATUS_ICON_CONFIG)) {
      expect(`${config.color} ${config.bg}`, icon).not.toMatch(RAW_PALETTE_PATTERN);
    }
  });

  it('pins the ratified role map itself (SSOT 確定表 2026-07-10)', () => {
    // ROLE と CONFIG が「一緒にドリフト」しても通ってしまわないよう、確定表の
    // 12値写像そのものを exact equality で固定する。変更は SSOT 改版とセットでのみ。
    expect(PATIENT_STATUS_ICON_ROLE).toEqual({
      stable: 'neutral',
      new: 'info',
      first_visit_soon: 'info',
      attention: 'confirm',
      urgent: 'blocked',
      overdue_visit: 'confirm',
      report_pending: 'confirm',
      medication_change: 'info',
      hospitalized: 'readonly',
      discharged: 'confirm',
      no_contact: 'blocked',
      paused: 'confirm',
    });

    // 確定時に判断が割れた3値は個別にも明示固定(レビュー合意の記録)。
    expect(PATIENT_STATUS_ICON_ROLE.overdue_visit).toBe('confirm');
    expect(PATIENT_STATUS_ICON_ROLE.hospitalized).toBe('readonly');
    expect(PATIENT_STATUS_ICON_ROLE.discharged).toBe('confirm');
  });

  it('matches the ratified PATIENT_STATUS_ICON_ROLE mapping', () => {
    // 確定表(2026-07-10 ratified)と同一のキー集合・写像であること。
    expect(Object.keys(STATUS_ICON_CONFIG).sort()).toEqual(
      Object.keys(PATIENT_STATUS_ICON_ROLE).sort(),
    );

    const expectColor: Record<string, string> = {
      neutral: 'text-muted-foreground',
      info: 'text-tag-info',
      confirm: 'text-state-confirm',
      blocked: 'text-state-blocked',
      readonly: 'text-state-readonly',
    };
    for (const [icon, role] of Object.entries(PATIENT_STATUS_ICON_ROLE)) {
      const config = STATUS_ICON_CONFIG[icon as keyof typeof STATUS_ICON_CONFIG];
      expect(config.color, `${icon} (${role})`).toBe(expectColor[role]);
    }
  });

  it('keeps urgent risk mapping fail-visible (blocked, not neutral)', () => {
    const icon = derivePatientStatusIcon({
      score: 8,
      level: 'high',
      open_tasks: 0,
      pending_reports: 0,
      hasCompletedVisit: true,
      hasNextVisit: false,
      hasOverdueVisit: false,
      hasRecentMedChange: false,
      hasUnresolvedSelfReports: false,
      caseStatus: 'active',
      exceptionStatus: null,
    });
    expect(icon).toBe('urgent');
    expect(STATUS_ICON_CONFIG[icon].color).toBe('text-state-blocked');
  });
});
