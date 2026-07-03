import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  consentRecordFindFirstMock,
  consentRecordFindUniqueMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  txPatientFindFirstMock,
  consentRecordUpdateMock,
  externalAccessGrantUpdateManyMock,
  workflowExceptionCreateMock,
  medicationCycleFindManyMock,
  txCareCaseFindFirstMock,
  taskUpsertMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  consentRecordFindFirstMock: vi.fn(),
  consentRecordFindUniqueMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  txPatientFindFirstMock: vi.fn(),
  consentRecordUpdateMock: vi.fn(),
  externalAccessGrantUpdateManyMock: vi.fn(),
  workflowExceptionCreateMock: vi.fn(),
  medicationCycleFindManyMock: vi.fn(),
  txCareCaseFindFirstMock: vi.fn(),
  taskUpsertMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => unknown) => {
    return (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
      handler(req, { orgId: 'org_1', userId: 'user_1', role: 'pharmacist' }, routeContext);
  },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    consentRecord: {
      findFirst: consentRecordFindFirstMock,
    },
    patient: {
      findFirst: patientFindFirstMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { POST } from './route';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/consent-records/consent_1/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/consent-records/consent_1/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"reason":',
  });
}

describe('/api/consent-records/[id]/revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consentRecordFindFirstMock.mockResolvedValue({
      id: 'consent_1',
      patient_id: 'patient_1',
      consent_type: 'external_sharing',
      case_id: null,
      is_active: true,
      access_restricted: false,
      revoked_date: null,
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    consentRecordUpdateMock.mockResolvedValue({ count: 1 });
    consentRecordFindUniqueMock.mockResolvedValue({
      id: 'consent_1',
      is_active: false,
      document_url: 'https://files.example.test/legacy-consent.pdf',
    });
    externalAccessGrantUpdateManyMock.mockResolvedValue({ count: 2 });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1' });
    txPatientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    txCareCaseFindFirstMock.mockResolvedValue({
      id: 'case_1',
      primary_pharmacist_id: 'primary_1',
    });
    taskUpsertMock.mockResolvedValue({ id: 'task_1', display_id: 'task0000000001' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        consentRecord: {
          updateMany: consentRecordUpdateMock,
          findUnique: consentRecordFindUniqueMock,
        },
        externalAccessGrant: {
          updateMany: externalAccessGrantUpdateManyMock,
        },
        patient: {
          findFirst: txPatientFindFirstMock,
        },
        medicationCycle: {
          findMany: medicationCycleFindManyMock,
        },
        workflowException: {
          create: workflowExceptionCreateMock,
        },
        careCase: {
          findFirst: txCareCaseFindFirstMock,
        },
        task: {
          upsert: taskUpsertMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('revokes the consent record and related external grants', async () => {
    medicationCycleFindManyMock.mockResolvedValue([{ id: 'cycle_1' }, { id: 'cycle_2' }]);

    const response = (await POST(
      createRequest({
        reason: '本人希望',
      }),
      {
        params: Promise.resolve({ id: 'consent_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(consentRecordFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'consent_1', org_id: 'org_1' },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        consent_type: true,
        is_active: true,
        access_restricted: true,
        revoked_date: true,
        updated_at: true,
      },
    });
    expect(consentRecordUpdateMock).toHaveBeenCalledWith({
      where: {
        id: 'consent_1',
        org_id: 'org_1',
        is_active: true,
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
      data: {
        is_active: false,
        revoked_date: expect.any(Date),
        access_restricted: true,
      },
    });
    expect(patientFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
    expect(txPatientFindFirstMock).toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        revoked_at: null,
      },
      data: {
        revoked_at: expect.any(Date),
      },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalled();
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        overall_status: { notIn: ['reported', 'cancelled'] },
      },
      orderBy: { updated_at: 'desc' },
      select: { id: true },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledTimes(2);
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        cycle_id: 'cycle_1',
        exception_type: 'consent_revoked',
        description:
          '患者の同意が撤回されました（種別: external_sharing）。ケース継続判断が必要です。',
      }),
    });
    expect(workflowExceptionCreateMock).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        cycle_id: 'cycle_2',
        exception_type: 'consent_revoked',
      }),
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_id: 'user_1',
        action: 'consent_record_revoked',
        target_type: 'consent_record',
        target_id: 'consent_1',
        changes: expect.objectContaining({
          patient_id: 'patient_1',
          consent_type: 'external_sharing',
          reason_provided: true,
          external_access_grants_revoked: 2,
          workflow_exception_cycle_ids: ['cycle_1', 'cycle_2'],
          before: expect.objectContaining({
            is_active: true,
            access_restricted: false,
          }),
          after: expect.objectContaining({
            is_active: false,
            access_restricted: true,
          }),
        }),
      }),
    });
    await expect(response.json()).resolves.toMatchObject({
      id: 'consent_1',
      document_url: null,
      has_document_url: true,
      document_url_redacted: true,
    });
  });

  it('scopes workflow review cycles to the consent case when present', async () => {
    consentRecordFindFirstMock.mockResolvedValue({
      id: 'consent_1',
      patient_id: 'patient_1',
      case_id: 'case_1',
      consent_type: 'external_sharing',
      is_active: true,
      access_restricted: false,
      revoked_date: null,
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
    });
    medicationCycleFindManyMock.mockResolvedValue([{ id: 'cycle_case_1' }]);

    const response = (await POST(createRequest({}), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(careCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(txCareCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
    expect(medicationCycleFindManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        case_id: 'case_1',
        overall_status: { notIn: ['reported', 'cancelled'] },
      },
      orderBy: { updated_at: 'desc' },
      select: { id: true },
    });
    expect(workflowExceptionCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cycle_id: 'cycle_case_1',
      }),
    });
    expect(externalAccessGrantUpdateManyMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        revoked_at: null,
        scope: {
          path: ['allowed_case_ids'],
          array_contains: ['case_1'],
        },
      },
      data: {
        revoked_at: expect.any(Date),
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          case_id: 'case_1',
          workflow_exception_cycle_ids: ['cycle_case_1'],
        }),
      }),
    });
  });

  it('keeps an auditable operational task when no active cycle exists', async () => {
    medicationCycleFindManyMock.mockResolvedValue([]);

    const sensitiveReason = '家族関係や疾患名を含む詳細理由';
    const response = (await POST(createRequest({ reason: sensitiveReason }), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(txCareCaseFindFirstMock).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      orderBy: { updated_at: 'desc' },
      select: {
        id: true,
        primary_pharmacist_id: true,
      },
    });
    expect(taskUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org_1',
          dedupe_key: 'consent-revocation-review:consent_1',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        task_type: 'consent_revocation_review',
        priority: 'high',
        status: 'pending',
        assigned_to: 'primary_1',
        dedupe_key: 'consent-revocation-review:consent_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        description:
          '同意撤回後の継続可否と外部共有停止状況を確認してください（種別: external_sharing）。',
        metadata: expect.objectContaining({
          patient_id: 'patient_1',
          consent_record_id: 'consent_1',
          reason_provided: true,
        }),
      }),
      update: expect.objectContaining({
        task_type: 'consent_revocation_review',
        priority: 'high',
        status: 'pending',
        assigned_to: 'primary_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        description:
          '同意撤回後の継続可否と外部共有停止状況を確認してください（種別: external_sharing）。',
        metadata: expect.objectContaining({
          patient_id: 'patient_1',
          consent_record_id: 'consent_1',
          reason_provided: true,
        }),
      }),
      select: {
        id: true,
        display_id: true,
      },
    });
    const taskCreate = taskUpsertMock.mock.calls[0][0].create;
    expect(taskCreate.description).not.toContain('patient_1');
    expect(taskCreate.description).not.toContain('consent_1');
    expect(taskCreate.description).not.toContain(sensitiveReason);
    expect(taskCreate.metadata).not.toHaveProperty('reason');
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        changes: expect.objectContaining({
          workflow_exception_cycle_ids: [],
          fallback_operational_task_created: true,
          reason_provided: true,
        }),
      }),
    });
    expect(auditLogCreateMock.mock.calls[0][0].data.changes).not.toHaveProperty('reason');
  });

  it('keeps patient-level fallback task assigned to the actor when no assigned case is available', async () => {
    medicationCycleFindManyMock.mockResolvedValue([]);
    txCareCaseFindFirstMock.mockResolvedValue(null);

    const response = (await POST(createRequest({ reason: '本人希望' }), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(200);
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_dedupe_key: {
          org_id: 'org_1',
          dedupe_key: 'consent-revocation-review:consent_1',
        },
      },
      create: expect.objectContaining({
        assigned_to: 'user_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: null,
          consent_record_id: 'consent_1',
        }),
      }),
      update: expect.objectContaining({
        assigned_to: 'user_1',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        metadata: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: null,
          consent_record_id: 'consent_1',
        }),
      }),
      select: {
        id: true,
        display_id: true,
      },
    });
  });

  it('rejects overlong revocation reasons before loading consent data', async () => {
    const response = (await POST(createRequest({ reason: 'あ'.repeat(501) }), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank consent record ids before parsing or revoking consent data', async () => {
    const response = (await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '   ' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '同意記録IDが不正です',
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(consentRecordFindUniqueMock).not.toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns conflict without side effects when the consent was updated after loading', async () => {
    consentRecordUpdateMock.mockResolvedValue({ count: 0 });

    const response = (await POST(createRequest({ reason: '本人希望' }), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message:
        'この同意記録は他のユーザーによって更新されています。最新のデータを取得してください。',
    });
    expect(consentRecordUpdateMock).toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('returns not found without side effects when assignment changes inside the transaction', async () => {
    txPatientFindFirstMock.mockResolvedValue(null);

    const response = (await POST(createRequest({ reason: '本人希望' }), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      message: '同意記録が見つかりません',
    });
    expect(patientFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).toHaveBeenCalled();
    expect(txPatientFindFirstMock).toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('denies consent revocation outside the patient assignment scope before mutation', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = (await POST(createRequest({ reason: '本人希望' }), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(404);
    expect(patientFindFirstMock).toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(taskUpsertMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-object request bodies before loading or revoking consent data', async () => {
    const response = (await POST(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(400);
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before changing consent status or external access', async () => {
    const response = (await POST(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'consent_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(consentRecordFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(consentRecordUpdateMock).not.toHaveBeenCalled();
    expect(externalAccessGrantUpdateManyMock).not.toHaveBeenCalled();
    expect(medicationCycleFindManyMock).not.toHaveBeenCalled();
    expect(workflowExceptionCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });
});
