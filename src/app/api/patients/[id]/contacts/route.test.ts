import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  withOrgContextMock,
  deleteManyMock,
  createManyMock,
  findManyMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
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

function createRequest(body: unknown, headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/patients/patient_1/contacts', {
    method: body === undefined ? 'GET' : 'PUT',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    createManyMock.mockResolvedValue({ count: 1 });
    findManyMock.mockResolvedValue([{ id: 'contact_1', name: '田中花子' }]);
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
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
    await expect(response.json()).resolves.toMatchObject({
      message: '患者IDが不正です',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('rejects blank patient ids before parsing contact payloads or replacing contacts', async () => {
    const response = await PUT(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: '\t\n' }),
    });

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
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
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(createManyMock).not.toHaveBeenCalled();
  });

  it('replaces patient contacts with expanded fields', async () => {
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
    vi.mocked(patientFindFirstMock).mockResolvedValue({ id: 'patient_1' });

    const response = await GET(
      createRequest(undefined, { 'x-org-id': 'corg1234567890123456789012' }),
      { params: Promise.resolve({ id: 'patient_1' }) },
    );

    if (!response) throw new Error('response is required');
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
    });
  });
});
