// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  CYCLE_WORKSPACE_ACTIONS,
  PROCESS_STEPS_9,
  getProcessStepIndex,
  getProcessStepKeyForStatus,
  type ProcessStepKey,
} from './cycle-workspace';

describe('PROCESS_STEPS_9', () => {
  it('defines the 9 steps in the new design order (取込→入力→判断→調剤→監査→セット→訪問→報告→算定)', () => {
    expect(PROCESS_STEPS_9.map((step) => step.label)).toEqual([
      '取込',
      '入力',
      '判断',
      '調剤',
      '監査',
      'セット',
      '訪問',
      '報告',
      '算定',
    ]);
    expect(PROCESS_STEPS_9.map((step) => step.key)).toEqual([
      'intake',
      'entry',
      'decision',
      'dispense',
      'audit',
      'set',
      'visit',
      'report',
      'billing',
    ]);
  });

  it('maps every MedicationCycleStatus to the fixed current step (on_hold/cancelled are out of flow)', () => {
    const expected: Record<string, ProcessStepKey | null> = {
      intake_received: 'intake',
      structuring: 'entry',
      inquiry_pending: 'decision',
      inquiry_resolved: 'decision',
      ready_to_dispense: 'dispense',
      dispensing: 'dispense',
      dispensed: 'audit',
      audit_pending: 'audit',
      audited: 'set',
      setting: 'set',
      set_audited: 'visit',
      visit_ready: 'visit',
      visit_completed: 'report',
      reported: 'billing',
      on_hold: null,
      cancelled: null,
    };
    for (const [status, key] of Object.entries(expected)) {
      expect(getProcessStepKeyForStatus(status), `status=${status}`).toBe(key);
    }
  });

  it('keeps 監査(いまここ) for dispensed/audit_pending and moves audited to セット (06_card alignment)', () => {
    expect(getProcessStepKeyForStatus('dispensed')).toBe('audit');
    expect(getProcessStepKeyForStatus('audit_pending')).toBe('audit');
    expect(getProcessStepKeyForStatus('audited')).toBe('set');
  });

  it('covers all CYCLE_WORKSPACE_ACTIONS statuses except on_hold/cancelled, with no duplicates', () => {
    const mappedStatuses = PROCESS_STEPS_9.flatMap((step) => [...step.statuses]);
    expect(new Set(mappedStatuses).size).toBe(mappedStatuses.length);

    for (const status of Object.keys(CYCLE_WORKSPACE_ACTIONS)) {
      const isOutOfFlow = status === 'on_hold' || status === 'cancelled';
      expect(mappedStatuses.includes(status), `status=${status}`).toBe(!isOutOfFlow);
    }
  });

  it('returns null for unknown statuses', () => {
    expect(getProcessStepKeyForStatus('unknown_status')).toBeNull();
  });

  it('getProcessStepIndex returns the position in the flow', () => {
    expect(getProcessStepIndex('intake')).toBe(0);
    expect(getProcessStepIndex('audit')).toBe(4);
    expect(getProcessStepIndex('billing')).toBe(8);
  });
});
