import { describe, expect, it } from 'vitest';
import {
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
});

describe('dashboard home config', () => {
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
