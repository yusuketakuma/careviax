import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { acquireAdvisoryTxLockMock, upsertOperationalTaskMock } = vi.hoisted(() => ({
  acquireAdvisoryTxLockMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/db/advisory-lock', () => ({
  acquireAdvisoryTxLock: acquireAdvisoryTxLockMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import {
  buildPatientSelfReportTaskKey,
  findPatientSelfReportTask,
  resolvePatientSelfReportTaskAssignee,
  upsertPatientSelfReportTask,
} from './patient-self-report-task';

function createTx() {
  return {
    task: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

function asTransactionClient(tx: ReturnType<typeof createTx>) {
  return tx as unknown as Prisma.TransactionClient;
}

function baseInput() {
  return {
    orgId: 'org_1',
    reportId: 'report_1',
    patientId: 'patient_1',
    patientName: '患者A',
    subject: '残薬が増えた',
    preferredContactTime: '18時以降',
    requestedCallback: true,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    caseId: 'case_1',
    primaryPharmacistId: 'primary_1',
    backupPharmacistId: 'backup_1',
    converterUserId: 'converter_1',
    converterRole: 'pharmacist' as const,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  acquireAdvisoryTxLockMock.mockResolvedValue(undefined);
  upsertOperationalTaskMock.mockResolvedValue({ id: 'task_1', display_id: 'TSK-0001' });
});

describe('resolvePatientSelfReportTaskAssignee', () => {
  it('uses primary, backup, then an authorized pharmacist converter', () => {
    expect(
      resolvePatientSelfReportTaskAssignee({
        primaryPharmacistId: 'primary_1',
        backupPharmacistId: 'backup_1',
        converterUserId: 'converter_1',
        converterRole: 'pharmacist',
      }),
    ).toBe('primary_1');
    expect(
      resolvePatientSelfReportTaskAssignee({
        backupPharmacistId: 'backup_1',
        converterUserId: 'converter_1',
        converterRole: 'pharmacist_trainee',
      }),
    ).toBe('backup_1');
    expect(
      resolvePatientSelfReportTaskAssignee({
        converterUserId: 'converter_1',
        converterRole: 'pharmacist_trainee',
      }),
    ).toBe('converter_1');
  });

  it('keeps clerk and administrative converters in the unassigned team queue', () => {
    for (const converterRole of ['clerk', 'owner', 'admin'] as const) {
      expect(
        resolvePatientSelfReportTaskAssignee({
          converterUserId: 'converter_1',
          converterRole,
        }),
      ).toBeNull();
    }
  });
});

describe('patient self-report task persistence', () => {
  it('uses one deterministic org-scoped task lookup key', async () => {
    const tx = createTx();
    tx.task.findFirst.mockResolvedValue(null);

    await findPatientSelfReportTask(asTransactionClient(tx), 'org_1', 'report_1');

    expect(buildPatientSelfReportTaskKey('report_1')).toBe('patient-self-report:report_1');
    expect(tx.task.findFirst).toHaveBeenCalledWith({
      where: { org_id: 'org_1', dedupe_key: 'patient-self-report:report_1' },
      select: {
        id: true,
        display_id: true,
        status: true,
        assigned_to: true,
        related_entity_type: true,
        related_entity_id: true,
        metadata: true,
      },
    });
  });

  it('creates a patient-scoped task with server-derived fields and metadata', async () => {
    const tx = createTx();
    tx.task.findFirst.mockResolvedValue(null);

    const result = await upsertPatientSelfReportTask(asTransactionClient(tx), baseInput());

    expect(acquireAdvisoryTxLockMock).toHaveBeenCalledWith(
      tx,
      'patient_self_report_task',
      'org_1:report_1',
    );
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(tx, {
      orgId: 'org_1',
      taskType: 'patient_self_report_followup',
      title: '患者A からの自己申告対応',
      description: '残薬が増えた / 希望時間 18時以降',
      priority: 'urgent',
      assignedTo: 'primary_1',
      dueDate: new Date('2026-07-02T00:00:00.000Z'),
      slaDueAt: new Date('2026-07-02T00:00:00.000Z'),
      relatedEntityType: 'patient',
      relatedEntityId: 'patient_1',
      dedupeKey: 'patient-self-report:report_1',
      metadata: {
        patient_id: 'patient_1',
        report_id: 'report_1',
        case_id: 'case_1',
        requested_callback: true,
      },
    });
    expect(result).toEqual({
      id: 'task_1',
      displayId: 'TSK-0001',
      status: 'pending',
      assignedTo: 'primary_1',
      created: true,
    });
  });

  it('preserves completed status and manual assignment on response-loss retries', async () => {
    const tx = createTx();
    tx.task.findFirst.mockResolvedValue({
      id: 'task_1',
      display_id: 'TSK-0001',
      status: 'completed',
      assigned_to: 'manual_1',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
      metadata: {
        patient_id: 'patient_1',
        report_id: 'report_1',
        case_id: 'case_1',
        requested_callback: true,
      },
    });

    const result = await upsertPatientSelfReportTask(asTransactionClient(tx), baseInput());

    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'task_1',
      displayId: 'TSK-0001',
      status: 'completed',
      assignedTo: 'manual_1',
      created: false,
    });
  });

  it('normalizes legacy relation and fills only an unassigned task without reopening it', async () => {
    const tx = createTx();
    tx.task.findFirst.mockResolvedValue({
      id: 'task_legacy',
      display_id: 'TSK-0002',
      status: 'in_progress',
      assigned_to: null,
      related_entity_type: 'patient_self_report',
      related_entity_id: 'report_1',
      metadata: { patient_id: 'patient_1', legacy_key: 'kept' },
    });
    tx.task.updateMany.mockResolvedValue({ count: 1 });

    const result = await upsertPatientSelfReportTask(asTransactionClient(tx), baseInput());

    expect(tx.task.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task_legacy',
        org_id: 'org_1',
        dedupe_key: 'patient-self-report:report_1',
      },
      data: {
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        assigned_to: 'primary_1',
        metadata: {
          patient_id: 'patient_1',
          legacy_key: 'kept',
          report_id: 'report_1',
          case_id: 'case_1',
          requested_callback: true,
        },
      },
    });
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'in_progress',
      assignedTo: 'primary_1',
      created: false,
    });
  });
});
