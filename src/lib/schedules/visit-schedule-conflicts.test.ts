import { describe, expect, it } from 'vitest';
import {
  buildScheduleConflictViewModel,
  type ConflictScheduleInput,
} from './visit-schedule-conflicts';

function schedule(overrides: Partial<ConflictScheduleInput>): ConflictScheduleInput {
  return {
    scheduleId: 'schedule_1',
    patientName: '患者A',
    pharmacistId: 'pharmacist_1',
    pharmacistName: '薬剤師A',
    startMinutes: 9 * 60,
    endMinutes: 10 * 60,
    priority: 'normal',
    visitType: 'regular',
    confirmed: false,
    vehicleResourceId: null,
    vehicleLabel: null,
    ...overrides,
  };
}

describe('buildScheduleConflictViewModel', () => {
  it('does not target confirmed schedules when building conflict adjustment plans', () => {
    const viewModel = buildScheduleConflictViewModel([
      schedule({
        scheduleId: 'confirmed_1',
        patientName: '患者A',
        confirmed: true,
      }),
      schedule({
        scheduleId: 'emergency_1',
        patientName: '患者B',
        startMinutes: 9 * 60 + 15,
        endMinutes: 10 * 60 + 15,
        visitType: 'emergency',
        confirmed: false,
      }),
    ]);

    expect(viewModel.hasConflict).toBe(true);
    expect(viewModel.hasLockedSchedule).toBe(true);
    expect(viewModel.plans.find((plan) => plan.id === 'plan_a')?.targetScheduleIds).toEqual([
      'emergency_1',
    ]);
  });

  it('does not generate automatic adjustment plans when every overlapping schedule is confirmed', () => {
    const viewModel = buildScheduleConflictViewModel([
      schedule({
        scheduleId: 'confirmed_1',
        patientName: '患者A',
        confirmed: true,
      }),
      schedule({
        scheduleId: 'confirmed_2',
        patientName: '患者B',
        startMinutes: 9 * 60 + 15,
        endMinutes: 10 * 60 + 15,
        confirmed: true,
      }),
    ]);

    expect(viewModel.hasConflict).toBe(true);
    expect(viewModel.hasLockedSchedule).toBe(true);
    expect(viewModel.plans).toEqual([]);
  });
});
