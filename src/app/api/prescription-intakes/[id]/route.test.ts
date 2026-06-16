import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  prescriptionIntakeFindFirstMock,
  createAuditLogEntryMock,
  resolveOperationalTasksMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  resolveOperationalTasksMock: vi.fn(),
  upsertOperationalTaskMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    prescriptionIntake: {
      findFirst: prescriptionIntakeFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/operational-tasks', () => ({
  resolveOperationalTasks: resolveOperationalTasksMock,
  upsertOperationalTask: upsertOperationalTaskMock,
}));

import { GET, PATCH } from './route';

function createGetRequest() {
  return new NextRequest('http://localhost/api/prescription-intakes/intake_1', {
    method: 'GET',
  });
}

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/prescription-intakes/intake_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/prescription-intakes/intake_1', {
    method: 'PATCH',
    body: '{"original_collected_at":',
    headers: { 'content-type': 'application/json' },
  });
}

describe('/api/prescription-intakes/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
      },
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('rejects blank prescription intake ids before loading the intake on GET', async () => {
    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '処方受付IDが不正です',
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects blank prescription intake ids before parsing or loading the intake on PATCH', async () => {
    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '処方受付IDが不正です',
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('records fax original collection and resolves follow-up tasks', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_1',
      org_id: 'org_1',
      source_type: 'fax',
    });

    const updateMock = vi.fn().mockResolvedValue({
      id: 'intake_1',
      source_type: 'fax',
      original_collected_at: new Date('2026-03-28T09:00:00.000Z'),
      original_collected_by: 'user_1',
      lines: [],
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: updateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'intake_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_collected_at: new Date('2026-03-28T09:00:00.000Z'),
          original_collected_by: 'user_1',
        }),
      }),
    );
    expect(resolveOperationalTasksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'fax_original_followup',
        relatedEntityType: 'prescription_intake',
        relatedEntityId: 'intake_1',
        status: 'completed',
      }),
    );
  });

  it('rejects non-object request bodies before loading the intake', async () => {
    const response = await PATCH(createRequest(['unexpected']), {
      params: Promise.resolve({ id: 'intake_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON request bodies before loading the intake', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'intake_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects non-local HTTP prescription original URLs before loading the intake', async () => {
    const response = await PATCH(
      createRequest({
        original_document_url: 'http://storage.example.com/original.pdf',
      }),
      { params: Promise.resolve({ id: 'intake_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('does not resolve fax follow-up tasks for non-fax intakes', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_2',
      org_id: 'org_1',
      source_type: 'paper',
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: vi.fn().mockResolvedValue({
            id: 'intake_2',
            source_type: 'paper',
            original_collected_at: new Date('2026-03-28T09:00:00.000Z'),
            lines: [],
          }),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'intake_2' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects split updates when the next dispense date is missing for a partial split', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_3',
      org_id: 'org_1',
      source_type: 'paper',
      split_dispense_total: null,
      split_dispense_current: null,
      split_next_dispense_date: null,
    });

    const response = await PATCH(
      createRequest({
        split_dispense_total: 3,
        split_dispense_current: 1,
      }),
      { params: Promise.resolve({ id: 'intake_3' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '分割調剤の途中回は次回調剤予定日が必須です',
    });
  });

  it('allows clearing next dispense dates with explicit null', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_4',
      org_id: 'org_1',
      source_type: 'refill',
      split_dispense_total: 2,
      split_dispense_current: 2,
      split_next_dispense_date: new Date('2026-04-10T00:00:00.000Z'),
      refill_next_dispense_date: new Date('2026-04-05T00:00:00.000Z'),
    });

    const updateMock = vi.fn().mockResolvedValue({
      id: 'intake_4',
      source_type: 'refill',
      lines: [],
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: updateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        split_dispense_current: 2,
        split_dispense_total: 2,
        split_next_dispense_date: null,
        refill_next_dispense_date: null,
      }),
      { params: Promise.resolve({ id: 'intake_4' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          split_next_dispense_date: null,
          refill_next_dispense_date: null,
        }),
      }),
    );
  });

  it('rejects updates that would leave an emergency prescription without an emergency category', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_5',
      org_id: 'org_1',
      source_type: 'paper',
      prescription_category: 'emergency',
      emergency_category: 'other_exacerbation',
    });

    const response = await PATCH(
      createRequest({
        emergency_category: null,
      }),
      { params: Promise.resolve({ id: 'intake_5' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: '緊急処方の場合は緊急区分の選択が必須です',
    });
  });

  it('clears the emergency category when switching the prescription back to regular', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_6',
      org_id: 'org_1',
      source_type: 'paper',
      prescription_category: 'emergency',
      emergency_category: 'other_exacerbation',
    });

    const updateMock = vi.fn().mockResolvedValue({
      id: 'intake_6',
      source_type: 'paper',
      prescription_category: 'regular',
      emergency_category: null,
      lines: [],
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: updateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        prescription_category: 'regular',
      }),
      { params: Promise.resolve({ id: 'intake_6' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          prescription_category: 'regular',
          emergency_category: null,
        }),
      }),
    );
  });

  it('records prescription original management as a completed workflow task', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_7',
      org_id: 'org_1',
      source_type: 'fax',
      prescription_category: 'regular',
      emergency_category: null,
      split_dispense_total: null,
      split_dispense_current: null,
      split_next_dispense_date: null,
      cycle: {
        patient_id: 'patient_1',
        case_id: 'case_1',
      },
    });

    const updateMock = vi.fn().mockResolvedValue({
      id: 'intake_7',
      source_type: 'fax',
      lines: [],
    });

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: updateMock,
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        original_management: {
          reconciliation_result: 'discrepancy',
          discrepancy_note: 'FAXは28日分、原本は14日分',
          storage_location: 'store',
          e_prescription_exchange_number: 'EP-12345',
          e_prescription_acquired_status: 'acquired',
          dispensing_result_registration: 'registered',
          note: '医師確認済み',
        },
      }),
      { params: Promise.resolve({ id: 'intake_7' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        taskType: 'prescription_original_management',
        priority: 'high',
        status: 'completed',
        dedupeKey: 'prescription_original_management:intake_7',
        relatedEntityType: 'prescription_intake',
        relatedEntityId: 'intake_7',
        metadata: expect.objectContaining({
          reconciliation_result: 'discrepancy',
          discrepancy_note: 'FAXは28日分、原本は14日分',
          storage_location: 'store',
          patient_id: 'patient_1',
          case_id: 'case_1',
          updated_by: 'user_1',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
      }),
      {
        action: 'prescription_original_management_updated',
        targetType: 'prescription_intake',
        targetId: 'intake_7',
        changes: expect.objectContaining({
          reconciliation_result: 'discrepancy',
          discrepancy_note: 'FAXは28日分、原本は14日分',
          storage_location: 'store',
          patient_id: 'patient_1',
          case_id: 'case_1',
          updated_by: 'user_1',
        }),
      },
    );
  });

  it('rejects discrepancy reconciliation without discrepancy details', async () => {
    const response = await PATCH(
      createRequest({
        original_management: {
          reconciliation_result: 'discrepancy',
          storage_location: 'store',
        },
      }),
      { params: Promise.resolve({ id: 'intake_8' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects electronic prescription management without exchange number', async () => {
    const response = await PATCH(
      createRequest({
        original_management: {
          reconciliation_result: 'matched',
          storage_location: 'electronic',
          e_prescription_acquired_status: 'acquired',
          dispensing_result_registration: 'registered',
        },
      }),
      { params: Promise.resolve({ id: 'intake_9' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        original_management: expect.arrayContaining([
          '電子処方せん対象では引換番号を入力してください',
        ]),
      },
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('rejects dispensing result registration while electronic prescription acquisition is pending', async () => {
    const response = await PATCH(
      createRequest({
        original_management: {
          reconciliation_result: 'matched',
          storage_location: 'electronic',
          e_prescription_exchange_number: 'EP-12345',
          e_prescription_acquired_status: 'pending',
          dispensing_result_registration: 'registered',
        },
      }),
      { params: Promise.resolve({ id: 'intake_10' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        original_management: expect.arrayContaining([
          '電子処方せん取得待ちでは調剤結果登録済みにできません',
        ]),
      },
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
