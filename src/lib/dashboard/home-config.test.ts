import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_PIPELINE_STEPS,
  DASHBOARD_ADMIN_LINKS,
  DASHBOARD_COORDINATION_LINKS,
  DASHBOARD_WORKBENCH_LINKS,
  DASHBOARD_TAB_FALLBACK_ACTIONS,
  DASHBOARD_TASK_TYPE_TO_TAB,
  DASHBOARD_WORKFLOW_LINKS,
} from './home-config';

describe('DASHBOARD_WORKFLOW_LINKS', () => {
  it('includes a direct medication-set entry point', () => {
    expect(DASHBOARD_WORKFLOW_LINKS.find((item) => item.key === 'medication_sets')).toEqual(
      expect.objectContaining({
        href: '/set',
        title: 'セット管理',
      }),
    );
  });

  it('keeps set and set-audit as separate workflow entries', () => {
    expect(DASHBOARD_WORKFLOW_LINKS.map((item) => item.key)).toEqual(
      expect.arrayContaining(['medication_sets', 'set_audit']),
    );
    expect(DASHBOARD_WORKFLOW_LINKS.find((item) => item.key === 'set_audit')).toEqual(
      expect.objectContaining({
        href: '/set-audit',
        title: 'セット監査',
      }),
    );
  });

  it('surfaces referral intake and qr drafts from the home workflow grid', () => {
    expect(DASHBOARD_WORKFLOW_LINKS.map((item) => item.href)).toEqual(
      expect.arrayContaining(['/referrals/new', '/prescriptions/qr-drafts', '/qr-scan']),
    );
  });
});

describe('dashboard home config', () => {
  it('includes direct dashboard coordination links for communication surfaces', () => {
    const hrefs = DASHBOARD_COORDINATION_LINKS.map((item) => item.href);
    // Each href is built via a link-builder and includes context params.
    // We assert on the base path so the test stays robust against filter-default changes.
    expect(hrefs.some((h) => h.startsWith('/notifications'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('/external'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('/communications/requests'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('/handoff'))).toBe(true);
  });

  it('includes direct dashboard workbench links for previously hidden major pages', () => {
    const hrefs = DASHBOARD_WORKBENCH_LINKS.map((item) => item.href);
    // Each href may carry context/filter params from link-builders.
    // We assert on the base path so the test stays robust against filter-default changes.
    expect(hrefs.some((h) => h.startsWith('/my-day'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('/workflow'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('/tasks'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('/billing/candidates'))).toBe(true);
    expect(hrefs.some((h) => h === '/billing' || h.startsWith('/billing?'))).toBe(true);
    expect(hrefs.some((h) => h.startsWith('/schedules/proposals'))).toBe(true);
  });

  it('includes direct admin dashboard links for management surfaces', () => {
    expect(DASHBOARD_ADMIN_LINKS.map((item) => item.href)).toEqual(
      expect.arrayContaining(['/admin', '/admin/data-explorer', '/admin/jobs', '/admin/metrics']),
    );
  });

  it('routes synthetic medication-set queue items to the correct tabs', () => {
    expect(DASHBOARD_TASK_TYPE_TO_TAB.medication_set_queue).toBe('medication_set');
    expect(DASHBOARD_TASK_TYPE_TO_TAB.set_audit_queue).toBe('set_audit');
    expect(DASHBOARD_TASK_TYPE_TO_TAB.communication_request_followup).toBe('reporting');
  });

  it('labels visit planning as schedule registration in the pipeline', () => {
    expect(DASHBOARD_PIPELINE_STEPS.find((item) => item.key === 'visit_planning')).toEqual(
      expect.objectContaining({ label: 'スケジュール' }),
    );
    expect(DASHBOARD_PIPELINE_STEPS.find((item) => item.key === 'reporting')).toEqual(
      expect.objectContaining({ label: '報告書' }),
    );
  });

  it('provides fallback actions for medication-set tabs', () => {
    expect(DASHBOARD_TAB_FALLBACK_ACTIONS.medication_set).toEqual({
      href: '/set',
      label: 'セット管理を開く',
    });
    expect(DASHBOARD_TAB_FALLBACK_ACTIONS.set_audit).toEqual({
      href: '/set-audit',
      label: 'セット監査を開く',
    });
  });
});
