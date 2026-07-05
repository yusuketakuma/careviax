import { beforeEach, describe, expect, it, vi } from 'vitest';

const { broadcastStatusUpdateMock, invalidateMock } = vi.hoisted(() => ({
  broadcastStatusUpdateMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('@/lib/utils/server-cache', () => ({
  serverCache: {
    invalidate: invalidateMock,
  },
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

import {
  notifyWorkflowMutation,
  parseWorkflowDashboardView,
  sanitizeWorkflowRealtimeSource,
} from './workflow-dashboard-cache';

describe('notifyWorkflowMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates workflow cache and redacts org-wide realtime identifiers', async () => {
    await notifyWorkflowMutation({
      orgId: 'org_1',
      eventType: 'cycle_transition',
      payload: {
        source: 'medication_cycles_transition',
        patientId: 'patient_1',
        case_id: 'case_1',
        schedule_id: 'schedule_1',
        cycleId: 'cycle_1',
        from: 'dispensing',
        to: 'dispensed',
        note: 'private note',
      },
    });

    expect(invalidateMock).toHaveBeenCalledWith('workflow:org_1:');
    expect(invalidateMock).toHaveBeenCalledWith('cockpit:org_1:');
    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('org:org_1', {
      type: 'cycle_transition',
      payload: { source: 'medication_cycles_transition' },
    });
    const event = broadcastStatusUpdateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toContain('patient_1');
    expect(JSON.stringify(event)).not.toContain('case_1');
    expect(JSON.stringify(event)).not.toContain('schedule_1');
    expect(JSON.stringify(event)).not.toContain('cycle_1');
    expect(JSON.stringify(event)).not.toContain('private note');
  });

  it('omits payload when no non-sensitive source is present', async () => {
    await notifyWorkflowMutation({
      orgId: 'org_1',
      payload: {
        case_id: 'case_1',
      },
    });

    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('org:org_1', {
      type: 'workflow_refresh',
    });
  });

  it('drops non-allowlisted source values from org-wide broadcasts', async () => {
    await notifyWorkflowMutation({
      orgId: 'org_1',
      payload: {
        // @ts-expect-error Runtime sanitizer must still protect against unsafe callers.
        source: 'patient_1',
        patientId: 'patient_1',
        case_id: 'case_1',
      },
    });

    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('org:org_1', {
      type: 'workflow_refresh',
    });
    const event = broadcastStatusUpdateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toContain('patient_1');
    expect(JSON.stringify(event)).not.toContain('case_1');
  });

  it('keeps cache invalidation even when realtime broadcast fails', async () => {
    broadcastStatusUpdateMock.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(
      notifyWorkflowMutation({
        orgId: 'org_1',
        payload: { source: 'visit_schedules_update', schedule_id: 'schedule_1' },
      }),
    ).resolves.toBeUndefined();

    expect(invalidateMock).toHaveBeenCalledWith('workflow:org_1:');
    expect(invalidateMock).toHaveBeenCalledWith('cockpit:org_1:');
  });
});

describe('sanitizeWorkflowRealtimeSource', () => {
  it.each([
    ['medication_cycles_transition', 'medication_cycles_transition'],
    ['inquiry_records_update', 'inquiry_records_update'],
    ['medication_issues_update', 'medication_issues_update'],
    ['prescription_intakes_create', 'prescription_intakes_create'],
    ['visit_schedules_update', 'visit_schedules_update'],
    ['set_batches_update', 'set_batches_update'],
    ['patient_1', null],
    ['case_1', null],
    ['', null],
    [null, null],
    [{ source: 'medication_cycles_transition' }, null],
    [['medication_cycles_transition'], null],
  ])('returns %s for %s', (value, expected) => {
    expect(sanitizeWorkflowRealtimeSource(value)).toBe(expected);
  });
});

describe('parseWorkflowDashboardView', () => {
  it.each([
    ['full', 'full'],
    ['phase', 'phase'],
    ['realtime', 'realtime'],
    ['performance', 'performance'],
    ['unknown', 'full'],
    ['', 'full'],
    [null, 'full'],
  ])('returns %s for %s', (value, expected) => {
    expect(parseWorkflowDashboardView(value)).toBe(expected);
  });
});
