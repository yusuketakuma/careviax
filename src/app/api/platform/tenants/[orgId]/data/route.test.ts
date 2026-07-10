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
});
