import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  taskUpsertMock,
  taskCreateMock,
  taskFindFirstMock,
  taskFindManyMock,
  taskUpdateManyMock,
  allocateDisplayIdMock,
} = vi.hoisted(() => ({
  taskUpsertMock: vi.fn(),
  taskCreateMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskUpdateManyMock: vi.fn(),
  allocateDisplayIdMock: vi.fn(),
}));

vi.mock('@/lib/db/display-id', () => ({
  allocateDisplayId: allocateDisplayIdMock,
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
    findFirst: taskFindFirstMock,
    findMany: taskFindManyMock,
    updateMany: taskUpdateManyMock,
  },
};

describe('upsertOperationalTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allocateDisplayIdMock.mockResolvedValue('t0000000001');
  });

  it('keeps dedupe update branch display_id untouched when the task already has one', async () => {
    taskUpsertMock.mockResolvedValue({ id: 'task-1', display_id: 't0000000007' });

    const result = await upsertOperationalTask(tx, {
      orgId: 'org-1',
      taskType: 'visit_demand',
      title: 'Test task',
      dedupeKey: 'dedup-1',
    });

    expect(result).toEqual({ id: 'task-1', display_id: 't0000000007' });
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).toHaveBeenCalledOnce();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    const call = taskUpsertMock.mock.calls[0][0];
    expect(call.where.org_id_dedupe_key).toEqual({
      org_id: 'org-1',
      dedupe_key: 'dedup-1',
    });
    expect(call.create.task_type).toBe('visit_demand');
    expect(call.create.status).toBe('pending');
    expect(call.create).not.toHaveProperty('display_id');
    expect(call.update).not.toHaveProperty('display_id');
    expect(call.select).toEqual({ id: true, display_id: true });
  });

  it('fills display_id after dedupe upsert creates or returns a null display_id task', async () => {
    taskUpsertMock.mockResolvedValue({ id: 'task-1', display_id: null });
    taskUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await upsertOperationalTask(tx, {
      orgId: 'org-1',
      taskType: 'visit_demand',
      title: 'Test task',
      dedupeKey: 'dedup-1',
    });

    expect(result).toEqual({ id: 'task-1', display_id: 't0000000001' });
    expect(taskUpsertMock).toHaveBeenCalledOnce();
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(tx, 'Task', 'org-1');
    expect(taskUpdateManyMock).toHaveBeenCalledOnce();
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        org_id: 'org-1',
        display_id: null,
      },
      data: {
        display_id: 't0000000001',
      },
    });
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it('keeps display_id out of completed dedupe updates', async () => {
    taskUpsertMock.mockResolvedValue({ id: 'task-1', display_id: 't0000000007' });

    await upsertOperationalTask(tx, {
      orgId: 'org-1',
      taskType: 'visit_demand',
      title: 'Done task',
      dedupeKey: 'dedup-1',
      status: 'completed',
    });

    const call = taskUpsertMock.mock.calls[0][0];
    expect(call.update).toMatchObject({
      task_type: 'visit_demand',
      title: 'Done task',
      status: 'completed',
    });
    expect(call.update.completed_at).toBeInstanceOf(Date);
    expect(call.update).not.toHaveProperty('display_id');
    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it('rereads the task when a concurrent display_id fill wins the CAS update', async () => {
    taskUpsertMock.mockResolvedValue({ id: 'task-1', display_id: null });
    taskUpdateManyMock.mockResolvedValue({ count: 0 });
    taskFindFirstMock.mockResolvedValue({ id: 'task-1', display_id: 't0000000042' });

    const result = await upsertOperationalTask(tx, {
      orgId: 'org-1',
      taskType: 'visit_demand',
      title: 'Test task',
      dedupeKey: 'dedup-1',
    });

    expect(result).toEqual({ id: 'task-1', display_id: 't0000000042' });
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(tx, 'Task', 'org-1');
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'task-1',
        org_id: 'org-1',
      },
      select: {
        id: true,
        display_id: true,
      },
    });
  });

  it('fails closed when a dedupe task display_id fill does not converge', async () => {
    taskUpsertMock.mockResolvedValue({ id: 'task-1', display_id: null });
    taskUpdateManyMock.mockResolvedValue({ count: 0 });
    taskFindFirstMock.mockResolvedValue({ id: 'task-1', display_id: null });

    await expect(
      upsertOperationalTask(tx, {
        orgId: 'org-1',
        taskType: 'visit_demand',
        title: 'Test task',
        dedupeKey: 'dedup-1',
      }),
    ).rejects.toThrow('Task display_id fill did not converge');
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
    expect(allocateDisplayIdMock).toHaveBeenCalledWith(tx, 'Task', 'org-1');
    expect(taskCreateMock).toHaveBeenCalledOnce();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(taskUpdateManyMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
    const call = taskCreateMock.mock.calls[0][0];
    expect(call.data.display_id).toBe('t0000000001');
    expect(call.data.dedupe_key).toBeUndefined();
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

  it('rejects unregistered task types before writing', async () => {
    await expect(
      upsertOperationalTask(tx, {
        orgId: 'org-1',
        taskType: 'unknown_task_type',
        title: 'Unknown task',
      }),
    ).rejects.toThrow('Unregistered operational task_type: unknown_task_type');

    expect(allocateDisplayIdMock).not.toHaveBeenCalled();
    expect(taskCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
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

  it('can scope resolution to one selected task id', async () => {
    taskUpdateManyMock.mockResolvedValue({ count: 1 });

    await resolveOperationalTasks(tx, {
      orgId: 'org-1',
      taskId: 'task-1',
      taskType: 'handoff_supervision_review',
      relatedEntityType: 'visit_record',
      relatedEntityId: 'visit-record-1',
      assignedToUserId: 'supervisor-1',
    });

    const call = taskUpdateManyMock.mock.calls[0][0];
    expect(call.where).toMatchObject({
      id: 'task-1',
      org_id: 'org-1',
      task_type: 'handoff_supervision_review',
      related_entity_type: 'visit_record',
      related_entity_id: 'visit-record-1',
      OR: [{ assigned_to: 'supervisor-1' }],
    });
  });

  it('merges PHI-minimized resolution metadata without overwriting existing metadata', async () => {
    taskFindManyMock.mockResolvedValue([
      {
        id: 'task-1',
        metadata: {
          source: 'risk_finding',
          risk_domain: 'billing',
          patient_id: 'patient_1',
        },
      },
    ]);
    taskUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await resolveOperationalTasks(tx, {
      orgId: 'org-1',
      dedupeKey: 'dedup-1',
      status: 'cancelled',
      resolution: {
        state: 'waived',
        actorUserId: 'user_1',
        auditLogId: 'audit_1',
        reasonPresent: true,
        reasonLength: '患者 山田太郎 raw waiver note 090-1234-5678'.length,
        reasonCode: 'pharmacist_override',
      },
    });

    expect(result).toEqual({ count: 1 });
    expect(taskFindManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        org_id: 'org-1',
        dedupe_key: 'dedup-1',
        status: { in: ['pending', 'in_progress'] },
      }),
      select: {
        id: true,
        metadata: true,
      },
    });
    expect(taskUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'task-1',
        org_id: 'org-1',
        dedupe_key: 'dedup-1',
      }),
      data: {
        status: 'cancelled',
        completed_at: null,
        metadata: expect.objectContaining({
          source: 'risk_finding',
          risk_domain: 'billing',
          patient_id: 'patient_1',
          resolution: expect.objectContaining({
            state: 'waived',
            actor_user_id: 'user_1',
            audit_log_id: 'audit_1',
            reason_code: 'pharmacist_override',
            reason_present: true,
            reason_length: '患者 山田太郎 raw waiver note 090-1234-5678'.length,
            reason_redacted: true,
            recorded_at: expect.any(String),
          }),
        }),
      },
    });
    const serializedMetadata = JSON.stringify(taskUpdateManyMock.mock.calls[0][0].data.metadata);
    expect(serializedMetadata).not.toContain('山田太郎');
    expect(serializedMetadata).not.toContain('090-1234-5678');
    expect(serializedMetadata).not.toContain('raw waiver note');
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
      actionHref: '/tasks?status=&task_type=visit_demand',
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
      actionHref: '/tasks?status=&task_type=management_plan_review',
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

  it('encodes patient foundation review patient ids while keeping raw task identity input', () => {
    const patientId = '../patients/patient_1?x=1#frag';

    const result = describeOperationalTask({
      task_type: 'patient_foundation_review',
      related_entity_type: 'patient',
      related_entity_id: patientId,
    });

    expect(result).toEqual({
      actionHref: `/patients/${encodeURIComponent(patientId)}#patient-foundation`,
      actionLabel: '患者基盤を整備',
      queueLabel: '正本確認',
    });
    expect(result.actionHref).not.toContain(patientId);
    expect(result.actionHref).not.toContain('../');
    expect(result.actionHref).not.toContain('?x=');
  });

  it.each(['.', '..'])('rejects exact dot-segment patient foundation task id %s', (patientId) => {
    expect(() =>
      describeOperationalTask({
        task_type: 'patient_foundation_review',
        related_entity_type: 'patient',
        related_entity_id: patientId,
      }),
    ).toThrow(RangeError);
  });
});
