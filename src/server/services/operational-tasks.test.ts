import { beforeEach, describe, expect, it, vi } from 'vitest';

const { taskUpsertMock, taskCreateMock, taskUpdateManyMock } = vi.hoisted(() => ({
  taskUpsertMock: vi.fn(),
  taskCreateMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
}));

import {
  upsertOperationalTask,
  resolveOperationalTasks,
  describeOperationalTask,
} from './operational-tasks';

const tx = {
  task: {
    upsert: taskUpsertMock,
    create: taskCreateMock,
    updateMany: taskUpdateManyMock,
  },
};

describe('upsertOperationalTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts when dedupeKey is provided', async () => {
    taskUpsertMock.mockResolvedValue({ id: 'task-1' });

    const result = await upsertOperationalTask(tx, {
      orgId: 'org-1',
      taskType: 'visit_demand',
      title: 'Test task',
      dedupeKey: 'dedup-1',
    });

    expect(result).toEqual({ id: 'task-1' });
    expect(taskUpsertMock).toHaveBeenCalledOnce();
    expect(taskCreateMock).not.toHaveBeenCalled();
    const call = taskUpsertMock.mock.calls[0][0];
    expect(call.where.org_id_dedupe_key).toEqual({
      org_id: 'org-1',
      dedupe_key: 'dedup-1',
    });
    expect(call.create.task_type).toBe('visit_demand');
    expect(call.create.status).toBe('pending');
  });

  it('creates when no dedupeKey is provided', async () => {
    taskCreateMock.mockResolvedValue({ id: 'task-2' });

    const result = await upsertOperationalTask(tx, {
      orgId: 'org-1',
      taskType: 'geocode_review',
      title: 'Geocode task',
      priority: 'high',
    });

    expect(result).toEqual({ id: 'task-2' });
    expect(taskCreateMock).toHaveBeenCalledOnce();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    const call = taskCreateMock.mock.calls[0][0];
    expect(call.data.priority).toBe('high');
    expect(call.data.status).toBe('pending');
  });

  it('sets completed_at when status is completed', async () => {
    taskCreateMock.mockResolvedValue({ id: 'task-3' });

    await upsertOperationalTask(tx, {
      orgId: 'org-1',
      taskType: 'visit_demand',
      title: 'Done task',
      status: 'completed',
    });

    const call = taskCreateMock.mock.calls[0][0];
    expect(call.data.status).toBe('completed');
    expect(call.data.completed_at).toBeInstanceOf(Date);
  });
});

describe('resolveOperationalTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates matching tasks to completed', async () => {
    taskUpdateManyMock.mockResolvedValue({ count: 2 });

    const result = await resolveOperationalTasks(tx, {
      orgId: 'org-1',
      dedupeKey: 'dedup-1',
    });

    expect(result).toEqual({ count: 2 });
    expect(taskUpdateManyMock).toHaveBeenCalledOnce();
    const call = taskUpdateManyMock.mock.calls[0][0];
    expect(call.where.org_id).toBe('org-1');
    expect(call.where.dedupe_key).toBe('dedup-1');
    expect(call.data.status).toBe('completed');
    expect(call.data.completed_at).toBeInstanceOf(Date);
  });

  it('allows cancelling tasks', async () => {
    taskUpdateManyMock.mockResolvedValue({ count: 1 });

    await resolveOperationalTasks(tx, {
      orgId: 'org-1',
      taskType: 'visit_demand',
      status: 'cancelled',
    });

    const call = taskUpdateManyMock.mock.calls[0][0];
    expect(call.data.status).toBe('cancelled');
    expect(call.data.completed_at).toBeNull();
  });
});

describe('describeOperationalTask', () => {
  it('returns correct presentation for visit_demand', () => {
    const result = describeOperationalTask({
      task_type: 'visit_demand',
      related_entity_type: null,
      related_entity_id: null,
    });

    expect(result).toEqual({
      actionHref: '/schedules',
      actionLabel: '候補を確認',
      queueLabel: '訪問候補',
    });
  });

  it('returns correct presentation for management_plan_review', () => {
    const result = describeOperationalTask({
      task_type: 'management_plan_review',
      related_entity_type: null,
      related_entity_id: null,
    });

    expect(result).toEqual({
      actionHref: '/workflow',
      actionLabel: '計画を見直す',
      queueLabel: '計画書',
    });
  });

  it('falls back to visit_schedule presentation when entity type matches', () => {
    const result = describeOperationalTask({
      task_type: 'unknown_type',
      related_entity_type: 'visit_schedule',
      related_entity_id: 'vs-1',
    });

    expect(result).toEqual({
      actionHref: '/schedules?focus=schedule&schedule_id=vs-1',
      actionLabel: '予定を確認',
      queueLabel: '訪問',
    });
  });

  it('returns default presentation for unknown types', () => {
    const result = describeOperationalTask({
      task_type: 'something_new',
      related_entity_type: null,
      related_entity_id: null,
    });

    expect(result).toEqual({
      actionHref: '/workflow',
      actionLabel: 'ワークフローを開く',
      queueLabel: '運用',
    });
  });

  it('deep-links fax original follow-up tasks to the prescription detail when intake is linked', () => {
    const result = describeOperationalTask({
      task_type: 'fax_original_followup',
      related_entity_type: 'prescription_intake',
      related_entity_id: 'intake_1',
    });

    expect(result).toEqual({
      actionHref: '/prescriptions/intake_1',
      actionLabel: '原本回収を記録',
      queueLabel: 'FAX原本',
    });
  });

  it('deep-links patient foundation review tasks to the patient detail', () => {
    const result = describeOperationalTask({
      task_type: 'patient_foundation_review',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
    });

    expect(result).toEqual({
      actionHref: '/patients/patient_1#patient-foundation',
      actionLabel: '患者基盤を整備',
      queueLabel: '正本確認',
    });
  });
});
