import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientFindFirstInTxMock,
  patientUpdateManyMock,
  withOrgContextMock,
  createAuditLogEntryMock,
  writePatientFieldRevisionsMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindFirstInTxMock: vi.fn(),
  patientUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
  writePatientFieldRevisionsMock: vi.fn(),
  deleteManyMock: vi.fn(),
  createManyMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
    },
    patientCondition: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

vi.mock('@/server/services/patient-field-revision', async (importActual) => {
  const actual = await importActual<typeof import('@/server/services/patient-field-revision')>();
  return {
    ...actual,
    writePatientFieldRevisions: writePatientFieldRevisionsMock,
  };
});

import { GET, PUT } from './route';

const CURRENT_UPDATED_AT = '2026-03-30T09:00:00.000Z';
const STALE_UPDATED_AT = '2026-03-30T08:59:59.000Z';

function createRequest(body: unknown, headers?: Record<string, string>) {
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/patients/patient_1/conditions', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(requestBody),
  });
}

function createGetRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/patients/patient_1/conditions', {
    method: 'GET',
    headers,
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/conditions', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'corg1234567890123456789012',
    },
    body: '{"conditions":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/conditions PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    patientFindFirstInTxMock.mockResolvedValue({
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    patientUpdateManyMock.mockResolvedValue({ count: 1 });
    createManyMock.mockResolvedValue({ count: 2 });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    writePatientFieldRevisionsMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: 'condition_1',
        condition_type: 'disease',
        name: '高血圧',
        is_primary: true,
        is_active: true,
        noted_at: null,
        notes: null,
      },
    ]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          findFirst: patientFindFirstInTxMock,
          updateMany: patientUpdateManyMock,
        },
        patientCondition: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
          findMany: findManyMock,
        },
      }),
    );
  });

  it('rejects blank patient ids before loading conditions', async () => {
    const response = await GET(createGetRequest({ 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns no-store condition data on read', async () => {
    findManyMock.mockResolvedValue([{ id: 'condition_1', name: '高血圧' }]);

    const response = await GET(createGetRequest({ 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: 'condition_1', name: '高血圧' }],
      metadata: {
        expected_updated_at: CURRENT_UPDATED_AT,
        version_basis: 'patient_updated_at',
      },
    });
  });

  it('adds no-store headers to GET auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '患者情報の閲覧権限がありません' }),
        { status: 403 },
      ),
    });

    const response = await GET(createGetRequest({ 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers when GET cannot find an assigned patient', async () => {
    patientFindFirstMock.mockResolvedValueOnce(null);

    const response = await GET(createGetRequest({ 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_unknown' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者が見つかりません',
    });
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when condition reads fail', async () => {
    const rawError = '患者A ワルファリン condition read failure';
    findManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createGetRequest({ 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('ワルファリン');
  });

  it('rejects blank patient ids before parsing condition payloads or replacing conditions', async () => {
    const response = await PUT(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects non-object condition payloads before loading the patient', async () => {
    const response = await PUT(createRequest([], { 'x-org-id': 'corg1234567890123456789012' }), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON condition payloads before loading the patient', async () => {
    const response = await PUT(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'patient_1' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('rejects missing expected_updated_at before loading the patient', async () => {
    const response = await PUT(
      createRequest(
        {
          expected_updated_at: undefined,
          conditions: [
            {
              condition_type: 'disease',
              name: '高血圧',
              is_primary: true,
              is_active: true,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
      details: {
        expected_updated_at: expect.arrayContaining([expect.any(String)]),
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
  });

  it('replaces patient conditions and normalizes dates', async () => {
    const response = await PUT(
      createRequest(
        {
          conditions: [
            {
              condition_type: 'disease',
              name: '高血圧',
              is_primary: true,
              is_active: true,
              noted_at: '2026-03-01',
              notes: '内服継続',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(patientUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'corg1234567890123456789012',
        updated_at: new Date(CURRENT_UPDATED_AT),
      },
      data: { updated_at: expect.any(Date) },
    });
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { org_id: 'corg1234567890123456789012', patient_id: 'patient_1' },
    });
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          condition_type: 'disease',
          name: '高血圧',
          is_primary: true,
          is_active: true,
          noted_at: new Date('2026-03-01'),
          notes: '内服継続',
        },
      ],
    });
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'corg1234567890123456789012',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          orgId: 'corg1234567890123456789012',
          userId: 'user_1',
        }),
      }),
    );
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
      }),
      expect.objectContaining({
        action: 'patient_conditions_replaced',
        targetType: 'Patient',
        targetId: 'patient_1',
        patientId: 'patient_1',
      }),
    );
    expect(writePatientFieldRevisionsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'corg1234567890123456789012',
        patientId: 'patient_1',
        actorId: 'user_1',
        entries: [
          expect.objectContaining({
            category: 'conditions',
            field_key: 'conditions',
            field_label: '病名・問題',
          }),
        ],
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [expect.objectContaining({ id: 'condition_1', name: '高血圧' })],
      metadata: {
        expected_updated_at: expect.any(String),
        version_basis: 'patient_updated_at',
      },
    });
  });

  it('rejects stale condition replacements before deleting current rows', async () => {
    patientUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    patientFindFirstInTxMock.mockResolvedValueOnce({
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await PUT(
      createRequest(
        {
          expected_updated_at: STALE_UPDATED_AT,
          conditions: [
            {
              condition_type: 'disease',
              name: '高血圧',
              is_primary: true,
              is_active: true,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者病名・問題が他の操作で更新されています。再読み込みしてください',
      details: {
        conflict_type: 'stale_patient_conditions',
        expected_updated_at: STALE_UPDATED_AT,
        current_updated_at: CURRENT_UPDATED_AT,
      },
    });
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
  });

  it('adds no-store headers to PUT auth rejection responses', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(
        JSON.stringify({ code: 'FORBIDDEN', message: '患者情報の更新権限がありません' }),
        { status: 403 },
      ),
    });

    const response = await PUT(
      createRequest({ conditions: [] }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when condition updates fail unexpectedly', async () => {
    const rawError = '患者A ワルファリン condition update failure';
    findManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await PUT(
      createRequest(
        {
          conditions: [
            {
              condition_type: 'disease',
              name: '心不全',
              is_primary: true,
              is_active: true,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('ワルファリン');
    expect(patientUpdateManyMock).toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
  });

  it('records a redacted patient-condition replacement audit log', async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: 'old_condition',
          condition_type: 'disease',
          name: 'ワルファリン管理',
          is_primary: true,
          is_active: true,
          noted_at: new Date('2026-02-01T00:00:00.000Z'),
          notes: 'INR注意',
        },
        {
          id: 'old_problem',
          condition_type: 'problem',
          name: '転倒リスク',
          is_primary: false,
          is_active: false,
          noted_at: null,
          notes: '',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'new_condition',
          condition_type: 'disease',
          name: '心不全',
          is_primary: true,
          is_active: true,
          noted_at: new Date('2026-03-01T00:00:00.000Z'),
          notes: '利尿薬調整中',
        },
      ]);

    const response = await PUT(
      createRequest(
        {
          conditions: [
            {
              condition_type: 'disease',
              name: '心不全',
              is_primary: true,
              is_active: true,
              noted_at: '2026-03-01',
              notes: '利尿薬調整中',
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'corg1234567890123456789012',
        userId: 'user_1',
      }),
      {
        action: 'patient_conditions_replaced',
        targetType: 'Patient',
        targetId: 'patient_1',
        patientId: 'patient_1',
        changes: {
          before_count: 2,
          after_count: 1,
          active_count_before: 1,
          active_count_after: 1,
          primary_count_before: 1,
          primary_count_after: 1,
          condition_type_counts_before: { disease: 1, problem: 1 },
          condition_type_counts_after: { disease: 1 },
          before: [
            {
              condition_type: 'disease',
              is_primary: true,
              is_active: true,
              has_noted_at: true,
              has_notes: true,
            },
            {
              condition_type: 'problem',
              is_primary: false,
              is_active: false,
              has_noted_at: false,
              has_notes: false,
            },
          ],
          after: [
            {
              condition_type: 'disease',
              is_primary: true,
              is_active: true,
              has_noted_at: true,
              has_notes: true,
            },
          ],
        },
      },
    );
    expect(writePatientFieldRevisionsMock).toHaveBeenCalledWith(expect.anything(), {
      orgId: 'corg1234567890123456789012',
      patientId: 'patient_1',
      actorId: 'user_1',
      entries: [
        {
          category: 'conditions',
          field_key: 'conditions',
          field_label: '病名・問題',
          old_value: [
            {
              condition_type: 'disease',
              name: 'ワルファリン管理',
              is_primary: true,
              is_active: true,
              noted_at: '2026-02-01',
              notes: 'INR注意',
            },
            {
              condition_type: 'problem',
              name: '転倒リスク',
              is_primary: false,
              is_active: false,
              noted_at: null,
              notes: '',
            },
          ],
          new_value: [
            {
              condition_type: 'disease',
              name: '心不全',
              is_primary: true,
              is_active: true,
              noted_at: '2026-03-01',
              notes: '利尿薬調整中',
            },
          ],
        },
      ],
    });

    const auditPayload = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditPayload).not.toContain('ワルファリン管理');
    expect(auditPayload).not.toContain('INR注意');
    expect(auditPayload).not.toContain('転倒リスク');
    expect(auditPayload).not.toContain('心不全');
    expect(auditPayload).not.toContain('利尿薬調整中');
  });

  it('returns 404 when patient is not assigned to the requesting user', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await PUT(
      createRequest({ conditions: [] }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_unknown' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(404);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
  });

  it('rejects archived patients before replacing conditions', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const response = await PUT(
      createRequest({ conditions: [] }, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
    expect(writePatientFieldRevisionsMock).not.toHaveBeenCalled();
  });
});
