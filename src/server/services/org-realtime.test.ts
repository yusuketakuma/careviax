import { describe, expect, it, vi } from 'vitest';

const { broadcastStatusUpdateMock } = vi.hoisted(() => ({
  broadcastStatusUpdateMock: vi.fn(),
}));

vi.mock('@/server/adapters/realtime', () => ({
  getRealtimeAdapter: () => ({
    broadcastStatusUpdate: broadcastStatusUpdateMock,
  }),
}));

import {
  broadcastOrgRealtimeEvent,
  buildOrgRealtimeChannel,
  ORG_REALTIME_EVENT_TYPES,
  sanitizeOrgRealtimeEvent,
  WORKFLOW_REALTIME_SOURCES,
} from './org-realtime';

describe('org realtime helpers', () => {
  it('builds the canonical org-wide channel', () => {
    expect(buildOrgRealtimeChannel('org_1')).toBe('org:org_1');
  });

  it('sanitizes org-wide events to safe event types and allowlisted source only', () => {
    expect(
      sanitizeOrgRealtimeEvent({
        type: 'cycle_transition',
        payload: {
          source: 'medication_cycles_transition',
          patientId: 'patient_1',
          case_id: 'case_1',
        },
      }),
    ).toEqual({
      type: 'cycle_transition',
      payload: { source: 'medication_cycles_transition' },
    });

    expect(
      sanitizeOrgRealtimeEvent({
        type: 'not_allowed',
        payload: {
          source: 'patient_1',
          patientId: 'patient_1',
        },
      }),
    ).toEqual({ type: 'workflow_refresh' });
  });

  it.each(ORG_REALTIME_EVENT_TYPES)(
    'drops hostile payload fields for %s events before publishing',
    (type) => {
      const sanitized = sanitizeOrgRealtimeEvent({
        type,
        payload: {
          source: 'medication_cycles_transition',
          patientId: 'patient_1',
          patient_id: 'patient_1',
          case_id: 'case_1',
          schedule_id: 'schedule_1',
          cycleId: 'cycle_1',
          draftId: 'draft_1',
          intakeId: 'intake_1',
          note: 'private note',
          nested: { patientId: 'patient_1' },
        },
      });

      expect(sanitized).toEqual({
        type,
        payload: { source: 'medication_cycles_transition' },
      });
      const serialized = JSON.stringify(sanitized);
      expect(serialized).not.toContain('patient_1');
      expect(serialized).not.toContain('case_1');
      expect(serialized).not.toContain('schedule_1');
      expect(serialized).not.toContain('cycle_1');
      expect(serialized).not.toContain('draft_1');
      expect(serialized).not.toContain('intake_1');
      expect(serialized).not.toContain('private note');
    },
  );

  it.each(WORKFLOW_REALTIME_SOURCES)(
    'allows only category source %s through payloads',
    (source) => {
      expect(
        sanitizeOrgRealtimeEvent({
          type: 'workflow_refresh',
          payload: {
            source,
            patientId: 'patient_1',
            note: 'private note',
          },
        }),
      ).toEqual({
        type: 'workflow_refresh',
        payload: { source },
      });
    },
  );

  it('broadcasts only sanitized org-wide payloads', async () => {
    await broadcastOrgRealtimeEvent({
      orgId: 'org_1',
      type: 'qr_draft_created',
      payload: {
        // @ts-expect-error Runtime sanitizer must still protect against unsafe callers.
        source: 'draft_1',
        draftId: 'draft_1',
        patientId: 'patient_1',
      },
    });

    expect(broadcastStatusUpdateMock).toHaveBeenCalledWith('org:org_1', {
      type: 'qr_draft_created',
    });
    const event = broadcastStatusUpdateMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(event)).not.toContain('draft_1');
    expect(JSON.stringify(event)).not.toContain('patient_1');
  });
});
