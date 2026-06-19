import { describe, expect, it } from 'vitest';
import {
  buildScheduleCreateEditDrawerForm,
  buildScheduleCreateEditDrawerPayload,
  getScheduleCreateEditDrawerSaveBlocker,
  type ScheduleCreateEditDrawerForm,
} from './schedule-create-edit-drawer';
import type { Proposal } from './day-view.shared';

describe('schedule create/edit drawer helpers', () => {
  it('keeps patient contact status out of draft drawer payloads', () => {
    const form: ScheduleCreateEditDrawerForm = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    };

    expect(
      buildScheduleCreateEditDrawerPayload({
        form,
        proposalId: 'proposal_1',
        submitForContact: true,
      }),
    ).toEqual({
      id: 'proposal_1',
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
      submit_for_contact: true,
    });
  });

  it('does not copy existing contact results into the editable drawer form', () => {
    const proposal = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'urgent',
      proposed_date: '2026-06-30T00:00:00.000Z',
      time_window_start: '09:30',
      proposed_pharmacist_id: 'user_1',
      vehicle_resource: { travel_mode: 'DRIVE' },
      patient_contact_status: 'attempted',
    } as unknown as Proposal;

    expect(
      buildScheduleCreateEditDrawerForm({
        defaultDate: '2026-07-01',
        proposal,
        cases: [],
        pharmacists: [],
      }),
    ).toEqual({
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'urgent',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    });
  });

  it('summarizes missing save fields without copying patient or staff values', () => {
    const baseForm: ScheduleCreateEditDrawerForm = {
      case_id: 'case_1',
      visit_type: 'regular',
      priority: 'normal',
      proposed_date: '2026-06-30',
      time_window_start: '09:30',
      proposed_pharmacist_id: 'user_1',
      travel_mode: 'DRIVE',
    };

    expect(getScheduleCreateEditDrawerSaveBlocker(baseForm)).toBeNull();

    const blocker = getScheduleCreateEditDrawerSaveBlocker({
      ...baseForm,
      case_id: '',
      proposed_date: '',
      proposed_pharmacist_id: '',
    });

    expect(blocker).toBe('保存するには 患者、候補日、担当薬剤師 を選択してください。');
    expect(blocker).not.toMatch(/case_1|user_1|2026-06-30|09:30|山田|佐藤/);

    expect(getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, case_id: '' })).toBe(
      '保存するには 患者 を選択してください。',
    );
    expect(getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, proposed_date: '' })).toBe(
      '保存するには 候補日 を選択してください。',
    );
    expect(
      getScheduleCreateEditDrawerSaveBlocker({ ...baseForm, proposed_pharmacist_id: '' }),
    ).toBe('保存するには 担当薬剤師 を選択してください。');
    expect(
      getScheduleCreateEditDrawerSaveBlocker({
        ...baseForm,
        case_id: '',
        proposed_date: '',
      }),
    ).toBe('保存するには 患者、候補日 を選択してください。');

    const valueLeakBlocker = getScheduleCreateEditDrawerSaveBlocker({
      ...baseForm,
      case_id: '田中花子',
      proposed_date: '',
      time_window_start: '09:30',
      proposed_pharmacist_id: '薬剤師A',
    });

    expect(valueLeakBlocker).toBe('保存するには 候補日 を選択してください。');
    expect(valueLeakBlocker).not.toMatch(/田中|花子|09:30|薬剤師A/);
  });
});
