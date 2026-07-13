import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  authRoleMock,
  withOrgContextMock,
  acquirePatientSelfReportTaskLockMock,
  findPatientSelfReportTaskMock,
  upsertPatientSelfReportTaskMock,
  patientSelfReportFindFirstMock,
  patientSelfReportUpdateManyMock,
  patientFindFirstMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  authRoleMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  acquirePatientSelfReportTaskLockMock: vi.fn(),
  findPatientSelfReportTaskMock: vi.fn(),
  upsertPatientSelfReportTaskMock: vi.fn(),
  patientSelfReportFindFirstMock: vi.fn(),
  patientSelfReportUpdateManyMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext:
    (handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: authRoleMock() }, routeContext),
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/patient-self-report-task', () => ({
  acquirePatientSelfReportTaskLock: acquirePatientSelfReportTaskLockMock,
  findPatientSelfReportTask: findPatientSelfReportTaskMock,
  upsertPatientSelfReportTask: upsertPatientSelfReportTaskMock,
}));

import { POST } from './route';

const CURRENT_UPDATED_AT = '2026-07-01T01:02:03.000Z';
const STALE_UPDATED_AT = '2026-06-30T01:02:03.000Z';

function createRequest(reportId: string, body: unknown) {
  return new NextRequest(`http://localhost/api/patient-self-reports/${reportId}/convert-to-task`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedRequest(reportId: string) {
  return new NextRequest(`http://localhost/api/patient-self-reports/${reportId}/convert-to-task`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"updated_at":',
  });
}

function routeContext(reportId = 'report_1') {
  return { params: Promise.resolve({ id: reportId }) };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report_1',
    patient_id: 'patient_1',
    subject: '残薬が増えた',
    preferred_contact_time: '18時以降',
    requested_callback: true,
    status: 'submitted',
    triaged_at: null,
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    updated_at: new Date(CURRENT_UPDATED_AT),
    ...overrides,
  };
}

function patient(overrides: Record<string, unknown> = {}) {
  return {
    id: 'patient_1',
    name: '患者A',
    archived_at: null,
    cases: [
      {
        id: 'case_1',
        primary_pharmacist_id: 'primary_1',
        backup_pharmacist_id: 'backup_1',
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authRoleMock.mockReturnValue('pharmacist');
  acquirePatientSelfReportTaskLockMock.mockResolvedValue(undefined);
  patientSelfReportFindFirstMock.mockResolvedValue(report());
  patientSelfReportUpdateManyMock.mockResolvedValue({ count: 1 });
  patientFindFirstMock.mockResolvedValue(patient());
  findPatientSelfReportTaskMock.mockResolvedValue(null);
  upsertPatientSelfReportTaskMock.mockResolvedValue({
    id: 'task_1',
    displayId: 'TSK-0001',
    status: 'pending',
    assignedTo: 'primary_1',
    created: true,
  });
  createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
  withOrgContextMock.mockImplementation(async (_orgId, callback) =>
    callback({
      patientSelfReport: {
        findFirst: patientSelfReportFindFirstMock,
        updateMany: patientSelfReportUpdateManyMock,
      },
      patient: { findFirst: patientFindFirstMock },
    }),
  );
});

describe('POST /api/patient-self-reports/[id]/convert-to-task', () => {
  it('atomically creates the scoped task, converts the report, and writes a PHI-safe audit', async () => {
    const response = await POST(
      createRequest('report_1', { updated_at: CURRENT_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
    });
    expect(acquirePatientSelfReportTaskLockMock).toHaveBeenCalledWith(
      expect.anything(),
      'org_1',
      'report_1',
    );
    expect(acquirePatientSelfReportTaskLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      patientSelfReportFindFirstMock.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(patientSelfReportFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'report_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        subject: true,
        preferred_contact_time: true,
        requested_callback: true,
        status: true,
        triaged_at: true,
        created_at: true,
        updated_at: true,
      },
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'patient_1', org_id: 'org_1' }),
      select: expect.objectContaining({
        id: true,
        name: true,
        archived_at: true,
        cases: expect.objectContaining({
          take: 1,
          select: {
            id: true,
            primary_pharmacist_id: true,
            backup_pharmacist_id: true,
          },
        }),
      }),
    });
    expect(upsertPatientSelfReportTaskMock).toHaveBeenCalledWith(expect.anything(), {
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
      converterUserId: 'user_1',
      converterRole: 'pharmacist',
      lockAcquired: true,
    });
    expect(patientSelfReportUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'report_1',
        org_id: 'org_1',
        status: 'submitted',
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
      data: expect.objectContaining({
        status: 'converted_to_task',
        triaged_by: 'user_1',
        triaged_at: expect.any(Date),
      }),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' },
      {
        action: 'patient_self_report_converted_to_task',
        targetType: 'patient_self_report',
        targetId: 'report_1',
        changes: {
          patient_id: 'patient_1',
          status_before: 'submitted',
          status_after: 'converted_to_task',
          task_id: 'task_1',
          task_created: true,
          report_status_changed: true,
          task_assigned: true,
          triage_stamped: true,
        },
      },
    );
    const auditChanges = createAuditLogEntryMock.mock.calls[0]?.[2]?.changes;
    for (const rawField of [
      'patient_name',
      'subject',
      'preferred_contact_time',
      'content',
      'reported_by_name',
    ]) {
      expect(auditChanges).not.toHaveProperty(rawField);
    }
    await expect(response.json()).resolves.toEqual({
      data: {
        task_id: 'task_1',
        task_display_id: 'TSK-0001',
        task_status: 'pending',
        report_status: 'converted_to_task',
        already_converted: false,
      },
    });
  });

  it.each([
    ['missing report', null, patient()],
    ['inaccessible patient', report(), null],
  ])('returns the same non-enumerating 404 for %s', async (_label, reportValue, patientValue) => {
    patientSelfReportFindFirstMock.mockResolvedValue(reportValue);
    patientFindFirstMock.mockResolvedValue(patientValue);

    const response = await POST(
      createRequest('report_1', { updated_at: CURRENT_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '患者自己申告が見つかりません',
    });
    expect(upsertPatientSelfReportTaskMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects a stale report version with no task or report side effects', async () => {
    const response = await POST(
      createRequest('report_1', { updated_at: STALE_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        '患者自己申告が他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(upsertPatientSelfReportTaskMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns a completed task on response-loss retry without reopening or re-auditing it', async () => {
    const existingTask = {
      id: 'task_1',
      display_id: 'TSK-0001',
      status: 'completed',
      assigned_to: 'primary_1',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
      metadata: {
        patient_id: 'patient_1',
        report_id: 'report_1',
        case_id: 'case_1',
        requested_callback: true,
      },
    };
    patientSelfReportFindFirstMock.mockResolvedValue(
      report({ status: 'converted_to_task', updated_at: new Date(CURRENT_UPDATED_AT) }),
    );
    findPatientSelfReportTaskMock.mockResolvedValue(existingTask);
    upsertPatientSelfReportTaskMock.mockResolvedValue({
      id: 'task_1',
      displayId: 'TSK-0001',
      status: 'completed',
      assignedTo: 'primary_1',
      created: false,
    });

    const response = await POST(
      createRequest('report_1', { updated_at: STALE_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(upsertPatientSelfReportTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ existingTask, lockAcquired: true }),
    );
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      data: {
        task_status: 'completed',
        report_status: 'converted_to_task',
        already_converted: true,
      },
    });
  });

  it('does not repair a missing task when an already-converted report version is stale', async () => {
    patientSelfReportFindFirstMock.mockResolvedValue(report({ status: 'converted_to_task' }));
    findPatientSelfReportTaskMock.mockResolvedValue(null);

    const response = await POST(
      createRequest('report_1', { updated_at: STALE_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(upsertPatientSelfReportTaskMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('repairs a missing task only for the current converted report version and audits the repair', async () => {
    patientSelfReportFindFirstMock.mockResolvedValue(report({ status: 'converted_to_task' }));
    findPatientSelfReportTaskMock.mockResolvedValue(null);

    const response = await POST(
      createRequest('report_1', { updated_at: CURRENT_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(upsertPatientSelfReportTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ existingTask: null, lockAcquired: true }),
    );
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        changes: expect.objectContaining({
          status_before: 'converted_to_task',
          status_after: 'converted_to_task',
          task_created: true,
          report_status_changed: false,
        }),
      }),
    );
  });

  it('rejects resolved or dismissed reports without side effects', async () => {
    patientSelfReportFindFirstMock.mockResolvedValue(report({ status: 'resolved' }));

    const response = await POST(
      createRequest('report_1', { updated_at: CURRENT_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      message: 'この患者自己申告はタスク化できない状態です。最新のデータを取得してください。',
    });
    expect(upsertPatientSelfReportTaskMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before task creation', async () => {
    patientFindFirstMock.mockResolvedValue(patient({ archived_at: new Date() }));

    const response = await POST(
      createRequest('report_1', { updated_at: CURRENT_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(upsertPatientSelfReportTaskMock).not.toHaveBeenCalled();
    expect(patientSelfReportUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-object', ['2026-07-01T01:02:03.000Z']],
    ['missing timestamp', {}],
    ['extra client-derived task field', { updated_at: CURRENT_UPDATED_AT, title: 'raw PHI' }],
  ])('rejects %s input before opening a transaction', async (_label, body) => {
    const response = await POST(createRequest('report_1', body), routeContext());

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(acquirePatientSelfReportTaskLockMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before opening a transaction', async () => {
    const response = await POST(createMalformedRequest('report_1'), routeContext());

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('returns a conflict when the compare-and-swap loses and leaves audit unwritten', async () => {
    patientSelfReportUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await POST(
      createRequest('report_1', { updated_at: CURRENT_UPDATED_AT }),
      routeContext(),
    );

    expect(response.status).toBe(409);
    expect(upsertPatientSelfReportTaskMock).toHaveBeenCalledOnce();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
