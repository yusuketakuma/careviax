import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_HEADER_SHORTCUTS,
  DASHBOARD_ADMIN_LINKS,
  DASHBOARD_COORDINATION_LINKS,
  DASHBOARD_WORKBENCH_LINKS,
  DASHBOARD_TAB_FALLBACK_ACTIONS,
  DASHBOARD_TASK_TYPE_TO_TAB,
  DASHBOARD_WORKFLOW_LINKS,
} from './home-config';

describe('DASHBOARD_WORKFLOW_LINKS', () => {
  it('includes a direct medication-set entry point', () => {
    expect(
      DASHBOARD_WORKFLOW_LINKS.find((item) => item.key === 'medication_sets'),
    ).toEqual(
      expect.objectContaining({
        href: '/medication-sets',
        title: 'セット管理',
      }),
    );
  });

  it('surfaces referral intake and qr drafts from the home workflow grid', () => {
    expect(
      DASHBOARD_WORKFLOW_LINKS.map((item) => item.href),
    ).toEqual(
      expect.arrayContaining([
        '/referrals/new',
        '/prescriptions/qr-drafts',
        '/qr-scan',
      ]),
    );
  });
});

describe('dashboard home config', () => {
  it('includes direct dashboard coordination links for communication surfaces', () => {
    expect(
      DASHBOARD_COORDINATION_LINKS.map((item) => item.href),
    ).toEqual(
      expect.arrayContaining([
        '/notifications',
        '/external',
        '/communications/requests',
        '/handoff',
      ]),
    );
  });

  it('includes direct dashboard workbench links for previously hidden major pages', () => {
    expect(
      DASHBOARD_WORKBENCH_LINKS.map((item) => item.href),
    ).toEqual(
      expect.arrayContaining([
        '/my-day',
        '/workflow',
        '/tasks',
        '/billing',
        '/billing/candidates',
        '/schedules/proposals',
      ]),
    );
  });

  it('includes direct admin dashboard links for management surfaces', () => {
    expect(
      DASHBOARD_ADMIN_LINKS.map((item) => item.href),
    ).toEqual(
      expect.arrayContaining([
        '/admin',
        '/admin/data-explorer',
        '/admin/jobs',
        '/admin/metrics',
      ]),
    );
  });

  it('keeps dashboard header shortcuts for utility screens that are not in the main grids', () => {
    expect(DASHBOARD_HEADER_SHORTCUTS).toEqual(
      expect.arrayContaining([
        { href: '/settings', label: 'ユーザー設定' },
        { href: '/qr-scan', label: 'QRスキャン' },
        { href: '/admin/notification-settings', label: '通知設定' },
      ]),
    );
  });

  it('routes synthetic medication-set queue items to the correct tabs', () => {
    expect(DASHBOARD_TASK_TYPE_TO_TAB.medication_set_queue).toBe('medication_set');
    expect(DASHBOARD_TASK_TYPE_TO_TAB.set_audit_queue).toBe('set_audit');
  });

  it('provides fallback actions for medication-set tabs', () => {
    expect(DASHBOARD_TAB_FALLBACK_ACTIONS.medication_set).toEqual({
      href: '/medication-sets',
      label: 'セット管理を開く',
    });
    expect(DASHBOARD_TAB_FALLBACK_ACTIONS.set_audit).toEqual({
      href: '/medication-sets',
      label: 'セット監査を開く',
    });
  });
});
