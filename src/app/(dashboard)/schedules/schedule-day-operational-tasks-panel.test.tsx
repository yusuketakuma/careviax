// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import type { Proposal, ScheduleTask, VisitSchedule } from './day-view.shared';
import {
  ScheduleDayOperationalTasksPanel,
  type ScheduleDayOperationalTasksPanelProps,
} from './schedule-day-operational-tasks-panel';

setupDomTestEnv();

function task(overrides: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 'task_1',
    task_type: 'visit_contact_followup',
    title: '折返し架電が必要です',
    description: '家族へ折返し予定',
    status: 'pending',
    priority: 'high',
    assigned_to: 'pharmacist_1',
    due_date: '2026-04-09',
    sla_due_at: null,
    related_entity_type: 'visit_proposal',
    related_entity_id: 'proposal_1',
    metadata: null,
    created_at: '2026-04-09T08:00:00.000Z',
    ...overrides,
  };
}

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'proposal_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    proposal_status: 'patient_contact_pending',
    patient_contact_status: 'attempted',
    proposed_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    proposed_pharmacist_id: 'pharmacist_1',
    proposed_pharmacist: { id: 'pharmacist_1', name: '薬剤師A', name_kana: null },
    assignment_mode: 'primary',
    route_order: 1,
    route_distance_score: 1.4,
    medication_end_date: '2026-04-10',
    visit_deadline_date: '2026-04-09',
    proposal_reason: '担当薬剤師優先',
    escalation_reason: null,
    finalized_schedule_id: null,
    reschedule_source_schedule_id: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都千代田区2-2-2' },
    vehicle_resource: null,
    finalized_schedule: null,
    reschedule_source_schedule: null,
    contact_logs: [],
    ...overrides,
  };
}

function schedule(overrides: Partial<VisitSchedule> = {}): VisitSchedule {
  return {
    id: 'schedule_1',
    case_id: 'case_1',
    visit_type: 'regular',
    priority: 'normal',
    schedule_status: 'planned',
    carry_items_status: 'ready',
    scheduled_date: '2026-04-09',
    time_window_start: '2026-04-09T09:00:00.000Z',
    time_window_end: '2026-04-09T10:00:00.000Z',
    pharmacist_id: 'pharmacist_1',
    assignment_mode: 'primary',
    route_order: 1,
    facility_batch_id: null,
    confirmed_at: null,
    case_: {
      patient: {
        id: 'patient_1',
        name: '山田花子',
        residences: [{ address: '東京都千代田区1-1-1' }],
      },
    },
    site: { id: 'site_1', name: '本店', address: '東京都千代田区2-2-2' },
    vehicle_resource: null,
    preparation: null,
    override_request: null,
    applied_override: null,
    facility_hint: null,
    workload_hint: { daily_visit_count: 1, urgent_visit_count: 0 },
    handoff_hint: null,
    ...overrides,
  };
}

function props(
  overrides: Partial<ScheduleDayOperationalTasksPanelProps> = {},
): ScheduleDayOperationalTasksPanelProps {
  return {
    callbackTasks: [],
    callbackTasksLoading: false,
    schedulingTasks: [],
    tasksLoading: false,
    proposalById: new Map(),
    scheduleById: new Map(),
    pharmacistNameById: new Map([['pharmacist_1', '薬剤師A']]),
    callbackTaskPending: false,
    rescheduleApprovalPending: false,
    onRecordCallbackTask: vi.fn(),
    onUpdateCallbackTaskStatus: vi.fn(),
    onOpenPreparation: vi.fn(),
    onApproveOverride: vi.fn(),
    ...overrides,
  };
}

describe('ScheduleDayOperationalTasksPanel', () => {
  it('renders callback task actions with target-specific accessible names', () => {
    const callbackTask = task();
    const relatedProposal = proposal();
    const onRecordCallbackTask = vi.fn();
    const onUpdateCallbackTaskStatus = vi.fn();

    render(
      <ScheduleDayOperationalTasksPanel
        {...props({
          callbackTasks: [callbackTask],
          proposalById: new Map([[relatedProposal.id, relatedProposal]]),
          onRecordCallbackTask,
          onUpdateCallbackTaskStatus,
        })}
      />,
    );

    expect(screen.getByRole('list', { name: '再架電タスク' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '折返し架電が必要です' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /山田花子.*架電結果を記録/ }));
    expect(onRecordCallbackTask).toHaveBeenCalledWith(callbackTask, relatedProposal);

    fireEvent.click(screen.getByRole('button', { name: /山田花子.*対応中にする/ }));
    expect(onUpdateCallbackTaskStatus).toHaveBeenCalledWith(callbackTask.id, 'in_progress');

    fireEvent.click(screen.getByRole('button', { name: /山田花子.*完了にする/ }));
    expect(onUpdateCallbackTaskStatus).toHaveBeenCalledWith(callbackTask.id, 'completed');
  });

  it('does not show the callback record action when the related proposal is outside the current week', () => {
    render(<ScheduleDayOperationalTasksPanel {...props({ callbackTasks: [task()] })} />);

    expect(screen.getByText('対象候補は現在の表示週外です。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /架電結果を記録/ })).toBeNull();
  });

  it('disables the in-progress callback action for an in-progress task', () => {
    render(
      <ScheduleDayOperationalTasksPanel
        {...props({
          callbackTasks: [task({ status: 'in_progress' })],
          proposalById: new Map([['proposal_1', proposal()]]),
        })}
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>('button', { name: /対応中にする/ }).disabled).toBe(
      true,
    );
  });

  it('keeps override approval unavailable when the related schedule is not visible', () => {
    render(
      <ScheduleDayOperationalTasksPanel
        {...props({
          schedulingTasks: [
            task({
              task_type: 'visit_schedule_override_approval',
              title: '変更承認が必要です',
              related_entity_type: 'visit_schedule',
              related_entity_id: 'schedule_outside_week',
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText('変更承認が必要です')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /変更承認を確認/ })).toBeNull();
    expect(
      screen.getByText('対象予定をこの週の予定一覧で確認してから変更承認してください。'),
    ).toBeTruthy();
  });

  it('opens preparation and approves override tasks for visible schedules', () => {
    const visibleSchedule = schedule();
    const preparationTask = task({
      id: 'task_preparation',
      task_type: 'visit_preparation',
      title: '訪問準備を確認してください',
      related_entity_type: 'visit_schedule',
      related_entity_id: visibleSchedule.id,
    });
    const approvalTask = task({
      id: 'task_approval',
      task_type: 'visit_schedule_override_approval',
      title: '変更承認が必要です',
      related_entity_type: 'visit_schedule',
      related_entity_id: visibleSchedule.id,
    });
    const onOpenPreparation = vi.fn();
    const onApproveOverride = vi.fn();

    render(
      <ScheduleDayOperationalTasksPanel
        {...props({
          schedulingTasks: [preparationTask, approvalTask],
          scheduleById: new Map([[visibleSchedule.id, visibleSchedule]]),
          onOpenPreparation,
          onApproveOverride,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /山田花子.*準備チェックを開く/ }));
    expect(onOpenPreparation).toHaveBeenCalledWith(visibleSchedule);

    fireEvent.click(screen.getByRole('button', { name: /山田花子.*変更承認を確認/ }));
    expect(onApproveOverride).toHaveBeenCalledWith(visibleSchedule);
  });

  it('renders loading and empty states', () => {
    const { rerender } = render(
      <ScheduleDayOperationalTasksPanel
        {...props({ callbackTasksLoading: true, tasksLoading: true })}
      />,
    );

    expect(screen.getByText('再架電タスクを読み込んでいます...')).toBeTruthy();
    expect(screen.getByText('運用タスクを読み込んでいます...')).toBeTruthy();

    rerender(<ScheduleDayOperationalTasksPanel {...props()} />);
    expect(screen.getByText('スケジュール関連の未完了タスクはありません')).toBeTruthy();
  });
});
