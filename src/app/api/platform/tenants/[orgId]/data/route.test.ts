import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const {
  requirePlatformOperatorMock,
  getActiveSessionMock,
  readViaBreakGlassMock,
  listDataExplorerModelsMock,
  listDataExplorerRowsMock,
} = vi.hoisted(() => ({
  requirePlatformOperatorMock: vi.fn(),
  getActiveSessionMock: vi.fn(),
  readViaBreakGlassMock: vi.fn(),
  listDataExplorerModelsMock: vi.fn(),
  listDataExplorerRowsMock: vi.fn(),
}));

vi.mock('@/lib/platform/operator', () => ({
  requirePlatformOperator: requirePlatformOperatorMock,
}));

vi.mock('@/lib/platform/break-glass', () => ({
  getActiveBreakGlassSession: getActiveSessionMock,
  readViaBreakGlass: readViaBreakGlassMock,
}));

vi.mock('@/server/services/data-explorer', () => ({
  DATA_EXPLORER_MAX_OFFSET: 999_900,
  listDataExplorerModels: listDataExplorerModelsMock,
  listDataExplorerRows: listDataExplorerRowsMock,
}));

import { GET } from './route';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const operator = {
  operatorId: 'operator_1',
  userId: 'user_1',
  email: 'operator@example.invalid',
  role: 'platform_operator',
};
const session = {
  id: 'bg_1',
  operator_id: 'operator_1',
  target_org_id: 'org_1',
  status: 'active',
  scope: 'read_only',
};

function createRequest(query = '') {
  return new NextRequest(`http://localhost/api/platform/tenants/org_1/data${query}`);
}

function routeContext(orgId = 'org_1') {
  return { params: Promise.resolve({ orgId }) };
}

describe('GET /api/platform/tenants/[orgId]/data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlatformOperatorMock.mockResolvedValue({ operator });
    getActiveSessionMock.mockResolvedValue(session);
    readViaBreakGlassMock.mockImplementation(async (_operator, _session, _access, reader) =>
      reader(),
    );
    listDataExplorerModelsMock.mockResolvedValue([
      {
        modelName: 'Patient',
        tableName: 'Patient',
        coverageLabel: '患者',
        rowCount: 3,
      },
    ]);
    listDataExplorerRowsMock.mockResolvedValue({
      modelName: 'Patient',
      tableName: 'Patient',
      columns: [{ name: 'id', type: 'String', isRequired: true }],
      totalCount: 1,
      totalCountIsExact: true,
      hasMore: false,
      limit: 10,
      offset: 20,
      rows: [{ id: 'patient_1' }],
    });
  });

  it('does not inspect sessions or explorer data when the platform guard rejects the request', async () => {
    requirePlatformOperatorMock.mockResolvedValueOnce({
      response: NextResponse.json({ code: 'AUTH_FORBIDDEN' }, { status: 403 }),
    });

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(getActiveSessionMock).not.toHaveBeenCalled();
    expect(readViaBreakGlassMock).not.toHaveBeenCalled();
    expect(listDataExplorerModelsMock).not.toHaveBeenCalled();
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it('fails closed before the audited reader when there is no active session', async () => {
    getActiveSessionMock.mockResolvedValueOnce(null);

    const response = await GET(createRequest(), routeContext('org_2'));

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    expect(getActiveSessionMock).toHaveBeenCalledWith('operator_1', 'org_2');
    expect(readViaBreakGlassMock).not.toHaveBeenCalled();
    expect(listDataExplorerModelsMock).not.toHaveBeenCalled();
  });

  it('returns the audited model catalog in an exact data envelope', async () => {
    const models = [
      {
        modelName: 'Patient',
        tableName: 'Patient',
        coverageLabel: '患者',
        rowCount: 3,
      },
    ];
    listDataExplorerModelsMock.mockResolvedValueOnce(models);

    const response = await GET(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(getActiveSessionMock).toHaveBeenCalledWith('operator_1', 'org_1');
    expect(readViaBreakGlassMock).toHaveBeenCalledWith(
      operator,
      session,
      {
        targetType: 'data_explorer_models',
        targetId: 'org_1',
        metadata: { view: 'models' },
      },
      expect.any(Function),
    );
    expect(listDataExplorerModelsMock).toHaveBeenCalledWith('org_1');
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ data: models });
  });

  it('returns audited model rows in an exact data envelope', async () => {
    const rows = {
      modelName: 'Patient',
      tableName: 'Patient',
      columns: [{ name: 'id', type: 'String', isRequired: true }],
      totalCount: 1,
      totalCountIsExact: true,
      hasMore: false,
      limit: 10,
      offset: 20,
      rows: [{ id: 'patient_1' }],
    };
    listDataExplorerRowsMock.mockResolvedValueOnce(rows);

    const response = await GET(
      createRequest('?model=Patient&limit=10&offset=20&search=%20%E8%8A%B1%E5%AD%90%20'),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
    expect(readViaBreakGlassMock).toHaveBeenCalledWith(
      operator,
      session,
      {
        targetType: 'data_explorer',
        targetId: 'Patient',
        metadata: { model: 'Patient', limit: 10, offset: 20 },
      },
      expect.any(Function),
    );
    expect(listDataExplorerModelsMock).not.toHaveBeenCalled();
    expect(listDataExplorerRowsMock).toHaveBeenCalledWith('org_1', 'Patient', {
      limit: 10,
      offset: 20,
      search: '花子',
    });
    await expect(response.json()).resolves.toEqual({ data: rows });
  });

  it('returns a no-store validation error for a non-allowlisted model', async () => {
    listDataExplorerRowsMock.mockRejectedValueOnce(new Error('Unknown table: SecretModel'));

    const response = await GET(createRequest('?model=SecretModel'), routeContext());

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toEqual({
      code: 'VALIDATION_ERROR',
      message: '指定されたモデルは参照できません',
    });
  });

  it.each([
    ['model', '?model=Patient&model=AuditLog'],
    ['limit', '?model=Patient&limit=10&limit=25'],
    ['offset', '?model=Patient&offset=0&offset=25'],
    ['search', '?model=Patient&search=one&search=two'],
  ])('rejects duplicate %s parameters before the audited reader', async (fieldName, query) => {
    const response = await GET(createRequest(query), routeContext());

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { [fieldName]: [`${fieldName} は1つだけ指定してください`] },
    });
    expect(readViaBreakGlassMock).not.toHaveBeenCalled();
    expect(listDataExplorerModelsMock).not.toHaveBeenCalled();
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['non-integer limit', '?model=Patient&limit=1e2'],
    ['zero limit', '?model=Patient&limit=0'],
    ['oversized limit', '?model=Patient&limit=101'],
    ['negative offset', '?model=Patient&offset=-1'],
    ['oversized offset', '?model=Patient&offset=999901'],
    ['oversized search', `?model=Patient&search=${'a'.repeat(101)}`],
    ['oversized model', `?model=${'a'.repeat(101)}`],
  ])('rejects %s instead of silently normalizing it', async (_label, query) => {
    const response = await GET(createRequest(query), routeContext());

    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(readViaBreakGlassMock).not.toHaveBeenCalled();
    expect(listDataExplorerModelsMock).not.toHaveBeenCalled();
    expect(listDataExplorerRowsMock).not.toHaveBeenCalled();
  });

  it('uses canonical pagination defaults in both audit metadata and service arguments', async () => {
    const response = await GET(createRequest('?model=%20Patient%20&search=%20%20'), routeContext());

    expect(response.status).toBe(200);
    expect(readViaBreakGlassMock).toHaveBeenCalledWith(
      operator,
      session,
      {
        targetType: 'data_explorer',
        targetId: 'Patient',
        metadata: { model: 'Patient', limit: 25, offset: 0 },
      },
      expect.any(Function),
    );
    expect(listDataExplorerRowsMock).toHaveBeenCalledWith('org_1', 'Patient', {
      limit: 25,
      offset: 0,
      search: undefined,
    });
  });

  it('returns a sanitized no-store 500 for unexpected reader failures', async () => {
    const rawError = 'raw platform data explorer model read failed';
    listDataExplorerRowsMock.mockRejectedValueOnce(new Error(rawError));

    const response = await GET(createRequest('?model=Patient'), routeContext());

    expect(response.status).toBe(500);
    expectSensitiveNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain(rawError);
  });
});
