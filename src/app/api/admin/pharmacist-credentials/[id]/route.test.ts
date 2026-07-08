import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  authCtx,
  withAuthContextMock,
  withOrgContextMock,
  createAuditLogEntryMock,
  pharmacistCredentialFindFirstMock,
  pharmacistCredentialUpdateMock,
  pharmacistCredentialDeleteMock,
  validateOrgReferencesMock,
} = vi.hoisted(() => {
  const authCtx = {
    orgId: 'org_1',
    userId: 'user_1',
    role: 'admin',
  };
  return {
    authCtx,
    withAuthContextMock: vi.fn(
      (
        handler: (
          req: NextRequest,
          ctx: typeof authCtx,
          routeContext: { params: Promise<{ id: string }> },
        ) => Promise<Response>,
      ) =>
        async (req: NextRequest, routeContext: { params: Promise<{ id: string }> }) =>
          handler(req, authCtx, routeContext),
    ),
    withOrgContextMock: vi.fn(),
    createAuditLogEntryMock: vi.fn(),
    pharmacistCredentialFindFirstMock: vi.fn(),
    pharmacistCredentialUpdateMock: vi.fn(),
    pharmacistCredentialDeleteMock: vi.fn(),
    validateOrgReferencesMock: vi.fn(),
  };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/api/org-reference', () => ({
  validateOrgReferences: validateOrgReferencesMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { DELETE, PATCH } from './route';

function createRequest(init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest('http://localhost/api/admin/pharmacist-credentials/cred_1', init);
}

function createJsonRequest(body: unknown) {
  return createRequest({
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonRequest() {
  return createRequest({
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: '{bad json',
  });
}

describe('/api/admin/pharmacist-credentials/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacistCredential: {
          findFirst: pharmacistCredentialFindFirstMock,
          update: pharmacistCredentialUpdateMock,
          delete: pharmacistCredentialDeleteMock,
        },
        auditLog: {
          create: vi.fn(),
        },
      }),
    );
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    validateOrgReferencesMock.mockResolvedValue({ ok: true });
    pharmacistCredentialFindFirstMock.mockResolvedValue({
      id: 'cred_1',
      org_id: 'org_1',
      user_id: 'user_2',
      certification_type: '研修認定',
      expiry_date: new Date('2026-04-01T00:00:00.000Z'),
      user: {
        id: 'user_2',
        name: '鈴木 一郎',
      },
    });
    pharmacistCredentialUpdateMock.mockResolvedValue({
      id: 'cred_1',
      certification_type: '専門薬剤師',
      certification_number: 'A-123',
      issued_date: new Date('2025-04-01T00:00:00.000Z'),
      expiry_date: new Date('2027-04-01T00:00:00.000Z'),
      tenure_years: 8,
      weekly_work_hours: 32,
      user: {
        id: 'user_2',
        name: '鈴木 一郎',
      },
    });
    pharmacistCredentialDeleteMock.mockResolvedValue({ id: 'cred_1' });
  });

  it('updates a credential and validates pharmacist ownership', async () => {
    const response = await PATCH(
      createJsonRequest({
        user_id: ' user_2 ',
        certification_type: ' 専門薬剤師 ',
        certification_number: ' A-123 ',
        issued_date: ' 2025-04-01 ',
        expiry_date: ' 2027-04-01 ',
        tenure_years: ' 8 ',
        weekly_work_hours: ' 32 ',
      }),
      {
        params: Promise.resolve({ id: 'cred_1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(validateOrgReferencesMock).toHaveBeenCalledWith('org_1', {
      pharmacist_id: 'user_2',
    });
    expect(pharmacistCredentialUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cred_1' },
      data: expect.objectContaining({
        user_id: 'user_2',
        certification_type: '専門薬剤師',
        certification_number: 'A-123',
        issued_date: new Date('2025-04-01'),
        expiry_date: new Date('2027-04-01'),
        tenure_years: 8,
        weekly_work_hours: 32,
      }),
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pharmacistCredential: expect.any(Object),
      }),
      authCtx,
      expect.objectContaining({
        action: 'pharmacist_credential_updated',
        targetType: 'PharmacistCredential',
        targetId: 'cred_1',
        changes: expect.objectContaining({
          previous_user_id: 'user_2',
          user_id: 'user_2',
          certification_type: '専門薬剤師',
          expiry_date: '2027-04-01T00:00:00.000Z',
        }),
      }),
    );
  });

  it('rejects non-object patch payloads before loading the credential', async () => {
    const response = await PATCH(createJsonRequest([]), {
      params: Promise.resolve({ id: 'cred_1' }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(pharmacistCredentialFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the credential', async () => {
    const response = await PATCH(createMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'cred_1' }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(pharmacistCredentialFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank patch route ids before loading the credential', async () => {
    const response = await PATCH(
      createJsonRequest({
        certification_type: '専門薬剤師',
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: '薬剤師認定情報IDが不正です',
    });
    expect(pharmacistCredentialFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialUpdateMock).not.toHaveBeenCalled();
  });

  it('normalizes blank optional patch fields to explicit null clears', async () => {
    const response = await PATCH(
      createJsonRequest({
        certification_number: ' ',
        issued_date: '',
        expiry_date: ' ',
        tenure_years: '',
        weekly_work_hours: ' ',
      }),
      {
        params: Promise.resolve({ id: 'cred_1' }),
      },
    );

    expect(response.status).toBe(200);
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialUpdateMock).toHaveBeenCalledWith({
      where: { id: 'cred_1' },
      data: expect.objectContaining({
        certification_number: null,
        issued_date: null,
        expiry_date: null,
        tenure_years: null,
        weekly_work_hours: null,
      }),
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  });

  it('rejects non-plain numeric patch fields before loading the credential', async () => {
    const response = await PATCH(
      createJsonRequest({
        tenure_years: '1e1',
        weekly_work_hours: '32hours',
      }),
      {
        params: Promise.resolve({ id: 'cred_1' }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
    });
    expect(pharmacistCredentialFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects reversed credential dates before loading the credential', async () => {
    const response = await PATCH(
      createJsonRequest({
        issued_date: '2027-04-01',
        expiry_date: '2025-04-01',
      }),
      {
        params: Promise.resolve({ id: 'cred_1' }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: '入力値が不正です',
    });
    expect(pharmacistCredentialFindFirstMock).not.toHaveBeenCalled();
    expect(validateOrgReferencesMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank delete route ids before loading the credential', async () => {
    const response = await DELETE(createRequest({ method: 'DELETE' }), {
      params: Promise.resolve({ id: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      message: '薬剤師認定情報IDが不正です',
    });
    expect(pharmacistCredentialFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacistCredentialDeleteMock).not.toHaveBeenCalled();
  });

  it('deletes an existing credential', async () => {
    const response = await DELETE(createRequest({ method: 'DELETE' }), {
      params: Promise.resolve({ id: 'cred_1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0');
    const body = await response.json();
    expect(body).toEqual({ data: { id: 'cred_1' } });
    expect(body).not.toHaveProperty('message');
    expect(withOrgContextMock).toHaveBeenCalledWith('org_1', expect.any(Function));
    expect(pharmacistCredentialDeleteMock).toHaveBeenCalledWith({
      where: { id: 'cred_1' },
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pharmacistCredential: expect.any(Object),
      }),
      authCtx,
      expect.objectContaining({
        action: 'pharmacist_credential_deleted',
        targetType: 'PharmacistCredential',
        targetId: 'cred_1',
        changes: expect.objectContaining({
          user_id: 'user_2',
          certification_type: '研修認定',
          expiry_date: '2026-04-01T00:00:00.000Z',
        }),
      }),
    );
  });
});
