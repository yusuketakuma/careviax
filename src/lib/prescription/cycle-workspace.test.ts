// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  CYCLE_STATUS_LABELS,
  CYCLE_STATUS_SHORT_LABELS,
  CYCLE_WORKSPACE_ACTIONS,
  PROCESS_STEPS_9,
  getProcessStepIndex,
  getProcessStepKeyForStatus,
  getCycleWorkspaceAction,
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

  it('uses current audit and set-audit labels without legacy wording', () => {
    expect(CYCLE_STATUS_LABELS.audit_pending).toBe('監査待ち');
    expect(CYCLE_STATUS_LABELS.audited).toBe('監査済');
    expect(CYCLE_STATUS_LABELS.setting).toBe('セット監査待ち');
    expect(CYCLE_STATUS_LABELS.set_audited).toBe('セット監査済み');
    expect(CYCLE_STATUS_SHORT_LABELS.setting).toBe('監査待');
    expect(CYCLE_STATUS_SHORT_LABELS.set_audited).toBe('監査済');
  });

  it('focuses inquiry-pending cycle action on reply-waiting communication requests', () => {
    expect(CYCLE_WORKSPACE_ACTIONS.inquiry_pending).toMatchObject({
      actionLabel: '照会状況を確認する',
      actionHref: '/communications/requests?status=sent',
    });
  });

  it('keeps static cycle actions as fallback when no context is supplied', () => {
    expect(getCycleWorkspaceAction('visit_ready')?.actionHref).toBe('/visits');
    expect(getCycleWorkspaceAction('visit_completed')?.actionHref).toBe('/reports');
    expect(getCycleWorkspaceAction('unknown_status')).toBeNull();
  });

  it('focuses prescription cycle actions on the exact prescription intake when supplied', () => {
    const intakeId = '../intake with space?x=1#frag';

    expect(
      getCycleWorkspaceAction('intake_received', { prescriptionIntakeId: intakeId })?.actionHref,
    ).toBe(`/prescriptions/${encodeURIComponent(intakeId)}`);
    expect(
      JSON.stringify(getCycleWorkspaceAction('structuring', { prescriptionIntakeId: intakeId })),
    ).not.toContain(intakeId);
  });

  it('focuses inquiry, visit, report, and hold actions using supplied patient workflow context', () => {
    const patientId = '../patient with space?x=1#frag';
    const scheduleId = '../schedule with space?x=1#frag';
    const visitRecordId = '../visit record?x=1#frag';
    const reportId = '../report with space?x=1#frag';

    expect(getCycleWorkspaceAction('inquiry_pending', { patientId })?.actionHref).toBe(
      `/communications/requests?${new URLSearchParams({ status: 'sent', patient_id: patientId }).toString()}`,
    );
    expect(
      getCycleWorkspaceAction('set_audited', { visitScheduleId: scheduleId })?.actionHref,
    ).toBe(`/schedules?focus=schedule&schedule_id=${encodeURIComponent(scheduleId)}`);
    expect(
      getCycleWorkspaceAction('visit_ready', { visitScheduleId: scheduleId })?.actionHref,
    ).toBe(`/visits/${encodeURIComponent(scheduleId)}/record`);
    expect(getCycleWorkspaceAction('visit_completed', { visitRecordId })?.actionHref).toBe(
      `/visits/${encodeURIComponent(visitRecordId)}`,
    );
    expect(getCycleWorkspaceAction('reported', { reportId })?.actionHref).toBe(
      `/reports/${encodeURIComponent(reportId)}`,
    );
    expect(getCycleWorkspaceAction('on_hold', { patientId })?.actionHref).toBe(
      `/patients/${encodeURIComponent(patientId)}`,
    );
  });

  it('fails closed when context ids are dot path segments', () => {
    expect(() => getCycleWorkspaceAction('intake_received', { prescriptionIntakeId: '.' })).toThrow(
      RangeError,
    );
    expect(() => getCycleWorkspaceAction('visit_ready', { visitScheduleId: '..' })).toThrow(
      RangeError,
    );
    expect(() => getCycleWorkspaceAction('reported', { reportId: '.' })).toThrow(RangeError);
    expect(() => getCycleWorkspaceAction('cancelled', { patientId: '..' })).toThrow(RangeError);
  });
});
