import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  withOrgContextMock,
  prescriptionIntakeFindFirstMock,
  requireWritablePatientMock,
  createAuditLogEntryMock,
  resolveOperationalTasksMock,
  upsertOperationalTaskMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  prescriptionIntakeFindFirstMock: vi.fn(),
  requireWritablePatientMock: vi.fn(),
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

vi.mock('@/server/services/patient-write-guard', () => ({
  requireWritablePatient: requireWritablePatientMock,
}));

import { GET, PATCH } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

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
        role: 'pharmacist',
      },
    });
    requireWritablePatientMock.mockResolvedValue({
      patient: { id: 'patient_1', archived_at: null },
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('rejects blank prescription intake ids before loading the intake on GET', async () => {
    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '処方受付IDが不正です',
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('uses decoded hostile route ids as raw identity on GET without treating them as paths', async () => {
    const hostileId = '../settings?x=1#frag';
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: hostileId,
      org_id: 'org_1',
      lines: [],
      prescriber_institution_ref: null,
      jahis_supplemental_records: [],
      cycle: null,
    });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: hostileId }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);

    const findFirstArg = prescriptionIntakeFindFirstMock.mock.calls[0]?.[0] as {
      where: { id: string; org_id: string };
    };
    expect(findFirstArg.where).toEqual({
      id: hostileId,
      org_id: 'org_1',
    });
    expect(findFirstArg.where.id).not.toBe(encodeURIComponent(hostileId));
  });

  it('keeps PHI-rich prescription detail responses no-store', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_phi_1',
      display_id: 'r0000000202',
      org_id: 'org_1',
      source_type: 'qr',
      lines: [
        {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1回1錠',
          days: 14,
          quantity: 14,
        },
      ],
      prescriber_institution_ref: {
        id: 'institution_1',
        name: 'みなとクリニック',
      },
      jahis_supplemental_records: [
        {
          id: 'jahis_1',
          payload: { patient_name: '山田 太郎', insurance_number: '12345678' },
          raw_line: 'JAHIS RAW 山田 太郎',
        },
      ],
      cycle: {
        display_id: 'mcyc0000000009',
        patient_id: 'patient_1',
        case_id: 'case_1',
        case_: {
          patient: {
            id: 'patient_1',
            name: '山田 太郎',
            name_kana: 'ヤマダ タロウ',
            birth_date: '1950-01-01',
            gender: 'male',
          },
        },
        inquiries: [
          {
            id: 'inquiry_1',
            inquiry_content: '服用タイミングを確認',
            change_detail: '朝食後へ変更',
          },
        ],
      },
    });

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'intake_phi_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const findFirstArg = prescriptionIntakeFindFirstMock.mock.calls[0]?.[0];
    expect(findFirstArg.include.cycle.select.display_id).toBe(true);
    await expect(response.json()).resolves.toMatchObject({
      id: 'intake_phi_1',
      display_id: 'r0000000202',
      lines: [expect.objectContaining({ drug_name: 'アムロジピン錠5mg' })],
      jahis_supplemental_records: [
        expect.objectContaining({
          raw_line: 'JAHIS RAW 山田 太郎',
          payload: expect.objectContaining({ insurance_number: '12345678' }),
        }),
      ],
      cycle: {
        display_id: 'mcyc0000000009',
        case_: {
          patient: expect.objectContaining({ name: '山田 太郎' }),
        },
      },
    });
  });

  it('returns no-store 404 when the prescription intake is not found', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue(null);

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'missing_intake' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
      message: '処方箋が見つかりません',
    });
  });

  it('returns a fixed no-store 500 when prescription intake loading fails without exposing raw PHI', async () => {
    prescriptionIntakeFindFirstMock.mockRejectedValue(
      new Error('intake detail failed for patient 山田 太郎 raw JAHIS 12345678'),
    );

    const response = await GET(createGetRequest(), {
      params: Promise.resolve({ id: 'intake_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(bodyText).not.toContain('山田');
    expect(bodyText).not.toContain('JAHIS');
    expect(bodyText).not.toContain('12345678');
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
    expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function), {
      requestContext: expect.objectContaining({
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      }),
    });
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
    expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
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
    expectSensitiveNoStore(response);
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before updating the intake', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_archived',
      org_id: 'org_1',
      source_type: 'fax',
      cycle: {
        patient_id: 'patient_1',
        case_id: 'case_1',
      },
    });
    requireWritablePatientMock.mockResolvedValue({
      response: Response.json(
        { message: 'アーカイブ中の患者は復元するまで更新できません' },
        { status: 409 },
      ),
    });

    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'intake_archived' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('returns auth rejections with sensitive no-store headers before prescription writes', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: Response.json(
        { code: 'AUTH_FORBIDDEN', message: '権限がありません' },
        { status: 403 },
      ),
    });

    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'intake_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(requireWritablePatientMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
  });

  it('returns a fixed no-store 500 when prescription intake updates fail without exposing raw PHI', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_error',
      org_id: 'org_1',
      source_type: 'fax',
      cycle: {
        patient_id: 'patient_1',
        case_id: 'case_1',
      },
    });
    withOrgContextMock.mockRejectedValueOnce(
      new Error('prescription update failed for patient 山田 太郎 token secret raw JAHIS'),
    );

    const response = await PATCH(
      createRequest({
        original_collected_at: '2026-03-28T09:00:00.000Z',
      }),
      { params: Promise.resolve({ id: 'intake_error' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(bodyText).not.toContain('山田');
    expect(bodyText).not.toContain('token secret');
    expect(bodyText).not.toContain('JAHIS');
    expect(resolveOperationalTasksMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });

  it('records prescription original document retention evidence for uploaded files', async () => {
    const originalDocumentUrl =
      'http://localhost:3000/api/files/11111111-1111-4111-8111-111111111111/download';
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_doc_1',
      org_id: 'org_1',
      source_type: 'fax',
      original_document_url: null,
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
      id: 'intake_doc_1',
      source_type: 'fax',
      original_document_url: originalDocumentUrl,
      original_collected_at: null,
      original_collected_by: null,
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
        original_document_url: originalDocumentUrl,
      }),
      { params: Promise.resolve({ id: 'intake_doc_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_document_url: originalDocumentUrl,
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
        action: 'prescription_original_document_saved',
        targetType: 'prescription_intake',
        targetId: 'intake_doc_1',
        changes: expect.objectContaining({
          patient_id: 'patient_1',
          case_id: 'case_1',
          document_url_type: 'internal_file',
          file_id: '11111111-1111-4111-8111-111111111111',
          saved_at: expect.any(String),
          updated_by: 'user_1',
        }),
      },
    );
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
      original_collected_at: new Date('2026-03-28T09:30:00.000Z'),
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
        original_collected_at: '2026-03-28T09:30:00.000Z',
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
          original_collected_at: '2026-03-28T09:30:00.000Z',
          original_collected_by: 'user_1',
          reconciliation_checked_at: expect.any(String),
          reconciliation_checked_by: 'user_1',
          updated_by: 'user_1',
        }),
      }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          original_collected_at: new Date('2026-03-28T09:30:00.000Z'),
          original_collected_by: 'user_1',
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
          original_collected_at: '2026-03-28T09:30:00.000Z',
          original_collected_by: 'user_1',
          reconciliation_checked_at: expect.any(String),
          reconciliation_checked_by: 'user_1',
          updated_by: 'user_1',
        }),
      },
    );
  });

  it('does not mark a not-checked original management update as reconciled', async () => {
    prescriptionIntakeFindFirstMock.mockResolvedValue({
      id: 'intake_8',
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

    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        prescriptionIntake: {
          update: vi.fn().mockResolvedValue({
            id: 'intake_8',
            source_type: 'fax',
            original_collected_at: new Date('2026-03-28T09:30:00.000Z'),
            original_collected_by: 'user_1',
            lines: [],
          }),
        },
      }),
    );

    const response = await PATCH(
      createRequest({
        original_management: {
          reconciliation_result: 'not_checked',
          storage_location: 'not_stored',
          e_prescription_acquired_status: 'not_applicable',
          dispensing_result_registration: 'not_applicable',
        },
      }),
      { params: Promise.resolve({ id: 'intake_8' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(upsertOperationalTaskMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        metadata: expect.objectContaining({
          reconciliation_result: 'not_checked',
          reconciliation_checked_at: null,
          reconciliation_checked_by: null,
        }),
      }),
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

  it('rejects completed original management while the original is still not stored', async () => {
    const response = await PATCH(
      createRequest({
        original_management: {
          reconciliation_result: 'matched',
          storage_location: 'not_stored',
          e_prescription_acquired_status: 'not_applicable',
          dispensing_result_registration: 'registered',
        },
      }),
      { params: Promise.resolve({ id: 'intake_11' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: {
        original_management: expect.arrayContaining([
          '照合済みまたは調剤結果登録済みでは保管場所を記録してください',
        ]),
      },
    });
    expect(prescriptionIntakeFindFirstMock).not.toHaveBeenCalled();
    expect(upsertOperationalTaskMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
