import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientFindFirstInTxMock,
  patientUpdateManyMock,
  withOrgContextMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindFirstInTxMock: vi.fn(),
  patientUpdateManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
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
    contactParty: {
      findMany: findManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: vi.fn(),
}));

import { GET, PUT } from './route';

const CURRENT_UPDATED_AT = '2026-03-30T09:00:00.000Z';
const STALE_UPDATED_AT = '2026-03-30T08:59:59.000Z';

function createRequest(body: unknown, headers?: Record<string, string>) {
  const requestBody =
    body && typeof body === 'object' && !Array.isArray(body) && !('expected_updated_at' in body)
      ? { expected_updated_at: CURRENT_UPDATED_AT, ...body }
      : body;
  return new NextRequest('http://localhost/api/patients/patient_1/contacts', {
    method: requestBody === undefined ? 'GET' : 'PUT',
    headers: {
      ...(requestBody === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) }),
  });
}

function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/patients/patient_1/contacts', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'corg1234567890123456789012',
    },
    body: '{"contacts":',
  });
}

function expectSensitiveNoStore(response: Response) {
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('Pragma')).toBe('no-cache');
}

describe('/api/patients/[id]/contacts PUT', () => {
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
      scheduling_preference: null,
    });
    patientFindFirstInTxMock.mockResolvedValue({
      updated_at: new Date(CURRENT_UPDATED_AT),
    });
    patientUpdateManyMock.mockResolvedValue({ count: 1 });
    createManyMock.mockResolvedValue({ count: 1 });
    findManyMock.mockResolvedValue([{ id: 'contact_1', name: '田中花子' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patient: {
          findFirst: patientFindFirstInTxMock,
          updateMany: patientUpdateManyMock,
        },
        contactParty: {
          deleteMany: deleteManyMock,
          createMany: createManyMock,
          findMany: findManyMock,
        },
      }),
    );
  });

  it('rejects blank patient ids before loading contacts', async () => {
    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: '   ' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when contact reads fail', async () => {
    const rawError = '患者A 090-1111-1111 contact read failure';
    findManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
    expect(JSON.stringify(body)).not.toContain('患者A');
    expect(JSON.stringify(body)).not.toContain('090-1111-1111');
  });

  it('rejects blank patient ids before parsing contact payloads or replacing contacts', async () => {
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

  it('rejects non-object contact payloads before loading the patient', async () => {
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

  it('rejects malformed JSON contact payloads before loading the patient', async () => {
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

  it('rejects malformed contact phone and fax before loading the patient', async () => {
    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'care_manager',
              name: '田中花子',
              phone: '090-ABCD-1234',
              fax: 'FAX-9999',
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
          contacts: [
            {
              relation: 'care_manager',
              name: '田中花子',
              phone: '03-1234-5678',
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
        expected_updated_at: ['Invalid input: expected string, received undefined'],
      },
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('replaces patient contacts with expanded fields', async () => {
    findManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '田中花子',
        relation: 'care_manager',
        phone: '03-1234-5678',
        email: 'care@example.com',
        fax: '03-9999-9999',
        organization_name: '居宅支援事業所',
        department: '在宅支援課',
        address: '東京都千代田区4-5-6',
        is_primary: true,
        is_emergency_contact: false,
        notes: '平日日中に連絡',
      },
    ]);
    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'care_manager',
              name: '田中花子',
              phone: ' 03-1234-5678 ',
              email: 'care@example.com',
              fax: ' 03-9999-9999 ',
              organization_name: '居宅支援事業所',
              department: '在宅支援課',
              address: '東京都千代田区4-5-6',
              is_primary: true,
              is_emergency_contact: false,
              notes: '平日日中に連絡',
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
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        {
          org_id: 'corg1234567890123456789012',
          patient_id: 'patient_1',
          name: '田中花子',
          relation: 'care_manager',
          phone: '03-1234-5678',
          email: 'care@example.com',
          fax: '03-9999-9999',
          organization_name: '居宅支援事業所',
          department: '在宅支援課',
          address: '東京都千代田区4-5-6',
          is_primary: true,
          is_emergency_contact: false,
          notes: '平日日中に連絡',
        },
      ],
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [
        expect.objectContaining({
          id: 'contact_1',
          phone: '03-1234-5678',
        }),
      ],
      warnings: [],
      metadata: {
        contact_readiness: {
          ready: true,
          detail: '電話可能な主連絡先または緊急連絡先があります。',
        },
        expected_updated_at: expect.any(String),
        version_basis: 'patient_updated_at',
      },
    });
  });

  it('returns contact readiness warnings without raw contact values when saved contacts are still not callable', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: null,
      updated_at: new Date(CURRENT_UPDATED_AT),
      scheduling_preference: {
        preferred_contact_name: '長男',
        preferred_contact_phone: null,
        visit_before_contact_required: true,
      },
    });
    findManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '長男',
        relation: 'child',
        phone: null,
        email: 'family@example.com',
        fax: null,
        organization_name: null,
        department: null,
        address: '東京都千代田区1-2-3',
        is_primary: true,
        is_emergency_contact: false,
        notes: null,
      },
    ]);

    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'child',
              name: '長男',
              email: 'family@example.com',
              address: '東京都千代田区1-2-3',
              is_primary: true,
              is_emergency_contact: false,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toMatchObject({
      data: [expect.objectContaining({ id: 'contact_1', name: '長男' })],
      warnings: [
        {
          code: 'PATIENT_CONTACT_UNREADY',
          severity: 'warning',
          message: '訪問前連絡が必要ですが電話可能な連絡先が未確認です。',
        },
      ],
      metadata: {
        contact_readiness: {
          ready: false,
          detail: '訪問前連絡が必要ですが電話可能な連絡先が未確認です。',
        },
      },
    });
    expect(JSON.stringify(json.warnings)).not.toMatch(
      /family@example.com|東京都千代田区1-2-3|長男/,
    );
    expect(JSON.stringify(json.metadata)).not.toMatch(
      /family@example.com|東京都千代田区1-2-3|長男/,
    );
  });

  it('normalizes primary contact flags before replacing patient contacts', async () => {
    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
            },
            {
              relation: 'child',
              name: '長女',
              phone: '090-2222-2222',
              is_primary: true,
              is_emergency_contact: false,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: '長男', is_primary: true }),
        expect.objectContaining({ name: '長女', is_primary: false }),
      ],
    });
  });

  it('assigns the first saved contact as primary when none is marked primary', async () => {
    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: false,
              is_emergency_contact: true,
            },
            {
              relation: 'child',
              name: '長女',
              phone: '090-2222-2222',
              is_primary: false,
              is_emergency_contact: false,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expect(createManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ name: '長男', is_primary: true }),
        expect.objectContaining({ name: '長女', is_primary: false }),
      ],
    });
  });

  it('returns 409 when primary contact uniqueness is hit by a concurrent update', async () => {
    createManyMock.mockRejectedValueOnce({ code: 'P2002' });

    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
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
      message: '連絡先が同時に更新されました。再読み込みしてください',
    });
  });

  it('returns a sanitized no-store 500 when contact replacement fails unexpectedly', async () => {
    const rawError = '患者A 090-1111-1111 contact replacement failure';
    deleteManyMock.mockRejectedValueOnce(new Error(rawError));

    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
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
    expect(JSON.stringify(body)).not.toContain('090-1111-1111');
  });

  it('rejects stale expected_updated_at before replacing patient contacts', async () => {
    const response = await PUT(
      createRequest(
        {
          expected_updated_at: STALE_UPDATED_AT,
          contacts: [
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
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
      message: '患者連絡先が他の操作で更新されています。再読み込みしてください',
      details: {
        conflict_type: 'stale_patient_contacts',
        expected_updated_at: STALE_UPDATED_AT,
        current_updated_at: CURRENT_UPDATED_AT,
      },
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('does not delete contacts when the patient version claim loses the race', async () => {
    patientUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    patientFindFirstInTxMock.mockResolvedValueOnce({
      updated_at: new Date('2026-03-30T09:01:00.000Z'),
    });

    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
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
      details: {
        conflict_type: 'stale_patient_contacts',
        expected_updated_at: CURRENT_UPDATED_AT,
        current_updated_at: '2026-03-30T09:01:00.000Z',
      },
    });
    expect(patientFindFirstInTxMock).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'corg1234567890123456789012',
      },
      select: { updated_at: true },
    });
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('returns duplicate contact warnings without raw contact values', async () => {
    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: true,
              is_emergency_contact: true,
            },
            {
              relation: 'child',
              name: '長男',
              phone: '090-1111-1111',
              is_primary: false,
              is_emergency_contact: false,
            },
          ],
        },
        { 'x-org-id': 'corg1234567890123456789012' },
      ),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_CONTACT',
          severity: 'warning',
          contact_indexes: [0, 1],
        }),
      ]),
    );
    expect(json.metadata.duplicate_contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_CONTACT',
          contact_indexes: [0, 1],
        }),
      ]),
    );
    expect(JSON.stringify(json.warnings)).not.toMatch(/090-1111-1111|長男/);
    expect(JSON.stringify(json.metadata.duplicate_contacts)).not.toMatch(/090-1111-1111|長男/);
  });

  it('returns 409 for an archived patient before replacing contacts', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-04-01T00:00:00.000Z'),
    });

    const response = await PUT(
      createRequest(
        {
          contacts: [
            {
              relation: 'care_manager',
              name: '田中花子',
              is_primary: true,
              is_emergency_contact: false,
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
      message: 'アーカイブ中の患者は復元するまで更新できません',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(patientUpdateManyMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('masks contact channels and address for external viewers on read', async () => {
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'corg1234567890123456789012',
        userId: 'user_ext',
        role: 'external_viewer',
      },
    });
    findManyMock.mockResolvedValue([
      {
        id: 'contact_1',
        name: '田中花子',
        phone: '03-1234-5678',
        fax: '03-9999-9999',
        email: 'care@example.com',
        address: '東京都千代田区4-5-6',
      },
    ]);
    vi.mocked(patientFindFirstMock).mockResolvedValue({
      id: 'patient_1',
      updated_at: new Date(CURRENT_UPDATED_AT),
    });

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      data: [
        {
          id: 'contact_1',
          phone: '***-****-5678',
          fax: '***-****-9999',
          email: 'c***@example.com',
          address: '東京都千代田***',
        },
      ],
      metadata: {
        expected_updated_at: CURRENT_UPDATED_AT,
        version_basis: 'patient_updated_at',
      },
    });
  });
});
