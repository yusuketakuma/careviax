import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const {
  requireAuthContextMock,
  insuranceConfigFindFirstMock,
  insuranceConfigFindManyMock,
  insuranceConfigUpdateMock,
  insuranceConfigDeleteMock,
  auditLogCreateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  insuranceConfigFindFirstMock: vi.fn(),
  insuranceConfigFindManyMock: vi.fn(),
  insuranceConfigUpdateMock: vi.fn(),
  insuranceConfigDeleteMock: vi.fn(),
  auditLogCreateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    pharmacySiteInsuranceConfig: {
      findFirst: insuranceConfigFindFirstMock,
      findMany: insuranceConfigFindManyMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { DELETE, PATCH } from './route';

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-sites/site_1/insurance-configs/config_1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function createMalformedJsonPatchRequest() {
  return new NextRequest('http://localhost/api/pharmacy-sites/site_1/insurance-configs/config_1', {
    method: 'PATCH',
    body: '{bad-json',
    headers: { 'content-type': 'application/json' },
  });
}

function createDeleteRequest() {
  return new NextRequest('http://localhost/api/pharmacy-sites/site_1/insurance-configs/config_1', {
    method: 'DELETE',
  });
}

async function expectErrorEnvelope(
  response: Response,
  status: number,
  expected: Record<string, unknown>,
) {
  expect(response.status).toBe(status);
  expectSensitiveNoStore(response);
  const body = await response.json();
  expect(body).toMatchObject(expected);
  expect(body).not.toHaveProperty('data');
  return body as Record<string, unknown>;
}

describe('/api/pharmacy-sites/[id]/insurance-configs/[configId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      },
    });
    insuranceConfigFindFirstMock.mockResolvedValue({
      id: 'config_1',
      insurance_type: 'medical',
    });
    insuranceConfigFindManyMock.mockResolvedValue([]);
    insuranceConfigUpdateMock.mockResolvedValue({
      id: 'config_1',
      site_id: 'site_1',
      revision_code: '2024',
      revision_label: '更新版',
      insurance_type: 'medical',
      effective_from: new Date('2024-04-01T00:00:00.000Z'),
      effective_to: null,
      config: {
        base_fee: 1,
        operational_marker: 'admin-visible config value',
      },
      org_id: 'org_1',
      display_id: 'internal_display_1',
      created_at: new Date('2024-03-01T00:00:00.000Z'),
      updated_at: new Date('2024-04-02T00:00:00.000Z'),
      backend_only_marker: 'internal-only-marker',
    });
    insuranceConfigDeleteMock.mockResolvedValue({ id: 'config_1' });
    auditLogCreateMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacySiteInsuranceConfig: {
          update: insuranceConfigUpdateMock,
          delete: insuranceConfigDeleteMock,
        },
        auditLog: {
          create: auditLogCreateMock,
        },
      }),
    );
  });

  it('updates an insurance config', async () => {
    const response = (await PATCH(
      createPatchRequest({
        revision_label: '更新版',
        effective_from: '2024-04-01',
        effective_to: null,
        config: { base_fee: 1, raw_pii_marker: '患者 山田太郎 token=secret' },
      }),
      {
        params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['data']);
    expect(body).toEqual({
      data: {
        id: 'config_1',
        site_id: 'site_1',
        revision_code: '2024',
        revision_label: '更新版',
        insurance_type: 'medical',
        effective_from: '2024-04-01T00:00:00.000Z',
        effective_to: null,
        config: {
          base_fee: 1,
          operational_marker: 'admin-visible config value',
        },
      },
    });
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('ok');
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain('org_id');
    expect(responseText).not.toContain('display_id');
    expect(responseText).not.toContain('created_at');
    expect(responseText).not.toContain('updated_at');
    expect(responseText).not.toContain('backend_only_marker');
    expect(responseText).not.toContain('internal-only-marker');
    expect(insuranceConfigUpdateMock).toHaveBeenCalledWith({
      where: { id: 'config_1' },
      data: {
        revision_label: '更新版',
        effective_from: new Date('2024-04-01'),
        effective_to: null,
        config: { base_fee: 1, raw_pii_marker: '患者 山田太郎 token=secret' },
      },
    });
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        actor_id: 'user_1',
        action: 'insurance_config_updated',
        target_type: 'PharmacySiteInsuranceConfig',
        target_id: 'config_1',
        changes: {
          revision_label: '更新版',
          effective_from: '2024-04-01',
          effective_to: null,
          config_changed_keys: ['base_fee', 'raw_pii_marker'],
        },
      }),
    });
    const auditCallText = JSON.stringify(auditLogCreateMock.mock.calls[0]);
    expect(auditCallText).not.toContain('患者 山田太郎');
    expect(auditCallText).not.toContain('token=secret');
  });

  it('rejects non-object patch payloads before loading the insurance config', async () => {
    const response = (await PATCH(createPatchRequest([]), {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    await expectErrorEnvelope(response, 400, {
      message: 'リクエストボディが不正です',
    });
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the insurance config', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    await expectErrorEnvelope(response, 400, {
      message: 'リクエストボディが不正です',
    });
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects invalid effective_to dates before loading the insurance config', async () => {
    const response = (await PATCH(
      createPatchRequest({
        revision_label: '更新版',
        effective_from: '2024-04-01',
        effective_to: '2024-04-31',
        config: { base_fee: 1 },
      }),
      {
        params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
      },
    ))!;

    await expectErrorEnvelope(response, 400, {
      code: 'VALIDATION_ERROR',
      message: '入力値が不正です',
    });
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigUpdateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('rejects blank config route ids before loading the insurance config', async () => {
    const response = (await PATCH(
      createPatchRequest({
        revision_label: '更新版',
        effective_from: '2024-04-01',
        effective_to: null,
        config: { base_fee: 1 },
      }),
      {
        params: Promise.resolve({ id: 'site_1', configId: '   ' }),
      },
    ))!;

    await expectErrorEnvelope(response, 400, {
      message: '保険設定IDが不正です',
    });
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(insuranceConfigFindManyMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigUpdateMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the effective range overlaps another config', async () => {
    insuranceConfigFindFirstMock.mockResolvedValue({
      id: 'config_1',
      insurance_type: 'medical',
    });
    insuranceConfigFindManyMock.mockResolvedValue([
      {
        id: 'config_2',
        effective_from: new Date('2024-04-01T00:00:00.000Z'),
        effective_to: null,
      },
    ]);

    const response = (await PATCH(
      createPatchRequest({
        revision_label: '更新版',
        effective_from: '2024-06-01',
        effective_to: null,
        config: { base_fee: 1 },
      }),
      {
        params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    expect(insuranceConfigUpdateMock).not.toHaveBeenCalled();
  });

  it('wraps auth failures with no-store before updating', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN', message: 'forbidden' }), {
        status: 403,
      }),
    });

    const response = (await PATCH(
      createPatchRequest({
        revision_label: '更新版',
        effective_from: '2024-04-01',
        effective_to: null,
        config: { base_fee: 1 },
      }),
      {
        params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
      },
    ))!;

    await expectErrorEnvelope(response, 403, {
      code: 'AUTH_FORBIDDEN',
      message: 'forbidden',
    });
    expect(insuranceConfigUpdateMock).not.toHaveBeenCalled();
  });

  it('returns a sanitized no-store 500 when update fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw insurance config update failure token=secret'),
    );

    const response = (await PATCH(
      createPatchRequest({
        revision_label: '更新版',
        effective_from: '2024-04-01',
        effective_to: null,
        config: { base_fee: 1 },
      }),
      {
        params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
      },
    ))!;

    const body = await expectErrorEnvelope(response, 500, {
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('raw insurance config update failure');
    expect(JSON.stringify(body)).not.toContain('token=secret');
  });

  it('rejects blank config route ids before deleting the insurance config', async () => {
    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'site_1', configId: '   ' }),
    }))!;

    await expectErrorEnvelope(response, 400, {
      message: '保険設定IDが不正です',
    });
    expect(insuranceConfigFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(insuranceConfigDeleteMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('wraps auth failures with no-store before deleting', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_UNAUTHENTICATED', message: 'login' }), {
        status: 401,
      }),
    });

    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    await expectErrorEnvelope(response, 401, {
      code: 'AUTH_UNAUTHENTICATED',
      message: 'login',
    });
    expect(insuranceConfigDeleteMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).not.toHaveBeenCalled();
  });

  it('deletes an insurance config', async () => {
    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      data: { id: 'config_1' },
    });
    expect(insuranceConfigDeleteMock).toHaveBeenCalledWith({
      where: { id: 'config_1' },
    });
  });

  it('returns a sanitized no-store 500 when delete fails unexpectedly', async () => {
    withOrgContextMock.mockRejectedValueOnce(
      new Error('raw insurance config delete failure token=secret'),
    );

    const response = (await DELETE(createDeleteRequest(), {
      params: Promise.resolve({ id: 'site_1', configId: 'config_1' }),
    }))!;

    const body = await expectErrorEnvelope(response, 500, {
      code: 'INTERNAL_ERROR',
      message: 'サーバー内部でエラーが発生しました',
    });
    expect(JSON.stringify(body)).not.toContain('raw insurance config delete failure');
    expect(JSON.stringify(body)).not.toContain('token=secret');
  });
});
