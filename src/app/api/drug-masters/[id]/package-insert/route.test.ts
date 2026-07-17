import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectNoStore } from '@/test/api-response-assertions';

const {
  authMock,
  membershipFindFirstMock,
  prismaMock,
  withOrgContextMock,
  drugMasterFindUniqueMock,
  drugPackageInsertFindManyMock,
  drugInteractionFindManyMock,
  drugAlertRuleFindManyMock,
  loggerErrorMock,
  runWithRequestAuthContextMock,
  securityEventExecuteRawMock,
  unstableRethrowMock,
} = vi.hoisted(() => {
  const membershipFindFirstMock = vi.fn();
  const auditLogCreateMock = vi.fn();
  const securityEventExecuteRawMock = vi.fn();
  const drugMasterFindUniqueMock = vi.fn();
  const drugPackageInsertFindManyMock = vi.fn();
  const drugInteractionFindManyMock = vi.fn();
  const drugAlertRuleFindManyMock = vi.fn();
  const prismaMock = {
    membership: { findFirst: membershipFindFirstMock },
    auditLog: { create: auditLogCreateMock },
    $transaction: vi.fn(
      (
        fn: (tx: {
          $executeRaw: typeof securityEventExecuteRawMock;
          auditLog: { create: typeof auditLogCreateMock };
        }) => unknown,
      ) =>
        fn({
          $executeRaw: securityEventExecuteRawMock,
          auditLog: { create: auditLogCreateMock },
        }),
    ),
  };

  return {
    authMock: vi.fn(),
    membershipFindFirstMock,
    prismaMock,
    withOrgContextMock: vi.fn((_orgId, fn) =>
      fn({
        drugMaster: { findUnique: drugMasterFindUniqueMock },
        drugPackageInsert: { findMany: drugPackageInsertFindManyMock },
        drugInteraction: { findMany: drugInteractionFindManyMock },
        drugAlertRule: { findMany: drugAlertRuleFindManyMock },
      }),
    ),
    drugMasterFindUniqueMock,
    drugPackageInsertFindManyMock,
    drugInteractionFindManyMock,
    drugAlertRuleFindManyMock,
    loggerErrorMock: vi.fn(),
    runWithRequestAuthContextMock: vi.fn((_ctx, callback: () => unknown) => callback()),
    securityEventExecuteRawMock,
    unstableRethrowMock: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ unstable_rethrow: unstableRethrowMock }));

vi.mock('@/lib/auth/request-context', () => ({
  clearRequestAuthContext: vi.fn(),
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

vi.mock('@/lib/auth/config', () => ({
  auth: authMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { GET, type DrugPackageInsertResponse } from './route';

type DrugPackageInsert = NonNullable<DrugPackageInsertResponse['package_insert']>;

function createRequest(headers: Record<string, string> = { 'x-org-id': 'org_1' }) {
  return new NextRequest('http://localhost/api/drug-masters/drug_1/package-insert', {
    headers,
  });
}

async function invokeGet(id = 'drug_1') {
  return (await GET(createRequest(), {
    params: Promise.resolve({ id }),
  })) as Response;
}

async function readPackageInsertPayload(response: Response): Promise<DrugPackageInsertResponse> {
  expectNoStore(response);
  const payload: unknown = await response.json();

  expect(payload).toMatchObject({
    data: {
      drug: expect.objectContaining({
        id: expect.any(String),
        yj_code: expect.any(String),
        drug_name: expect.any(String),
      }),
      version_history: expect.any(Array),
      interactions: expect.any(Array),
      applicable_alert_rules: expect.any(Array),
    },
  });

  return (payload as { data: DrugPackageInsertResponse }).data;
}

function requirePackageInsert(body: DrugPackageInsertResponse): DrugPackageInsert {
  if (!body.package_insert) throw new Error('package_insert is required');
  return body.package_insert;
}

function alertRuleIds(body: DrugPackageInsertResponse) {
  return body.applicable_alert_rules.map((rule) => rule.id);
}

const mockDrug = {
  id: 'drug_1',
  yj_code: '1234567890123',
  drug_name: 'テスト薬A錠',
  drug_name_kana: 'テストヤクエーJョウ',
  generic_name: 'テスト一般名',
  drug_price: 100,
  unit: '錠',
  dosage_form: '錠剤',
  therapeutic_category: 'C03',
  manufacturer: 'テスト製薬',
  is_generic: false,
  is_narcotic: false,
  is_psychotropic: false,
  max_administration_days: 30,
  transitional_expiry_date: null,
};

const mockPackageInsert = {
  id: 'pi_1',
  contraindications: [{ text: '重篤な腎障害', severity: 'high' }],
  interactions: [{ text: 'ワルファリンとの併用注意' }],
  adverse_effects: ['発疹', '発熱'],
  dosage_adjustment_renal: null,
  precautions_elderly: [{ text: '高齢者には減量すること', detail: '標準用量の半量から開始' }],
  document_version: '第5版',
  revised_at: new Date('2025-01-01T00:00:00.000Z'),
  source_format: 'xml',
  created_at: new Date('2025-01-10T00:00:00.000Z'),
};

describe('GET /api/drug-masters/[id]/package-insert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    prismaMock.auditLog.create.mockResolvedValue({ id: 'audit_1' });
    securityEventExecuteRawMock.mockResolvedValue(0);
    drugMasterFindUniqueMock.mockResolvedValue(mockDrug);
    drugPackageInsertFindManyMock.mockResolvedValue([mockPackageInsert]);
    drugInteractionFindManyMock.mockResolvedValue([]);
    drugAlertRuleFindManyMock.mockResolvedValue([]);
  });

  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValueOnce(null);

    const response = await invokeGet();

    expect(response.status).toBe(401);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });

  it('preserves auth-only access for a non-admin active member', async () => {
    membershipFindFirstMock.mockResolvedValueOnce({ role: 'clerk', site_id: null });

    const response = await invokeGet();

    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
  });

  it('returns a generated-trace safe 500 before reads when auth dependencies fail', async () => {
    const unsafeError = new Error('raw package insert auth secret');
    unsafeError.name = 'PackageInsertAuthSecretError';
    authMock.mockRejectedValueOnce(unsafeError);

    const response = await invokeGet();
    const body = await response.json();

    expect(response.status).toBe(500);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
    expect(drugPackageInsertFindManyMock).not.toHaveBeenCalled();
    expect(drugInteractionFindManyMock).not.toHaveBeenCalled();
    expect(drugAlertRuleFindManyMock).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toMatch(
      /package insert auth secret|PackageInsertAuthSecretError/,
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_auth_unhandled_error',
        route: '/api/drug-masters/drug_1/package-insert',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
  });

  it('returns 404 when drug is not found', async () => {
    drugMasterFindUniqueMock.mockResolvedValue(null);

    const response = await invokeGet('nonexistent');

    expect(response.status).toBe(404);
    expectNoStore(response);
    const body = await response.json();
    expect(body.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('returns 200 with drug and package insert data on success', async () => {
    const response = await invokeGet('  drug_1  ');

    expect(response.status).toBe(200);
    const body = await readPackageInsertPayload(response);
    expect(response.headers.get('X-Request-Id')).toBeTruthy();
    expect(response.headers.get('X-Correlation-Id')).toBeTruthy();
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(withOrgContextMock).toHaveBeenCalledWith(
      'org_1',
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({
          userId: 'user_1',
          orgId: 'org_1',
          role: 'pharmacist',
        }),
        maxWaitMs: 10_000,
        timeoutMs: 20_000,
      }),
    );
    expect(drugMasterFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'drug_1' },
      select: expect.any(Object),
    });

    expect(body.drug).toMatchObject({
      id: 'drug_1',
      yj_code: '1234567890123',
      drug_name: 'テスト薬A錠',
    });

    expect(body.package_insert).toMatchObject({
      id: 'pi_1',
      document_version: '第5版',
      source_format: 'xml',
    });
  });

  it('rejects blank drug master ids before package insert and interaction reads', async () => {
    const response = await invokeGet('   ');

    expect(response.status).toBe(400);
    expectNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      message: '医薬品IDが不正です',
    });
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
    expect(drugPackageInsertFindManyMock).not.toHaveBeenCalled();
    expect(drugInteractionFindManyMock).not.toHaveBeenCalled();
    expect(drugAlertRuleFindManyMock).not.toHaveBeenCalled();
  });

  it.each(['.', '..'])('rejects unsafe route id %s before RLS', async (id) => {
    const response = await invokeGet(id);

    expect(response.status).toBe(400);
    expectNoStore(response);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(drugMasterFindUniqueMock).not.toHaveBeenCalled();
  });

  it('returns null package_insert when no package insert exists', async () => {
    drugPackageInsertFindManyMock.mockResolvedValue([]);

    const response = await invokeGet();

    expect(response.status).toBe(200);
    const body = await readPackageInsertPayload(response);
    expect(body.package_insert).toBeNull();
    expect(body.drug.id).toBe('drug_1');
  });

  it('returns structured sections from package insert', async () => {
    const response = await invokeGet();

    const body = await readPackageInsertPayload(response);
    const sections = requirePackageInsert(body).sections;

    expect(sections.contraindications).toEqual([
      { text: '重篤な腎障害', severity: 'high', detail: undefined },
    ]);
    expect(sections.interactions).toEqual([
      { text: 'ワルファリンとの併用注意', severity: undefined, detail: undefined },
    ]);
    expect(sections.adverse_effects).toEqual([{ text: '発疹' }, { text: '発熱' }]);
    expect(sections.precautions_elderly).toEqual([
      { text: '高齢者には減量すること', severity: undefined, detail: '標準用量の半量から開始' },
    ]);
    expect(sections.dosage_adjustment_renal).toEqual([]);
  });

  it('formats object-root and mixed package insert sections without unsafe casts', async () => {
    drugPackageInsertFindManyMock.mockResolvedValue([
      {
        ...mockPackageInsert,
        contraindications: {
          renal: ' 重篤な腎障害 ',
          notes: ['脱水に注意', 42, { text: '転倒注意' }],
          empty: '',
          malformed: null,
        },
        interactions: [
          { description: '併用注意', recommendation: 'INRを確認' },
          ['unexpected'],
          null,
          42,
          { unsupported_marker: true },
        ],
        adverse_effects: [
          ' 発疹 ',
          '',
          null,
          42,
          { summary: '発熱' },
          { unsupported_marker: true },
        ],
      },
    ]);

    const response = await invokeGet();

    const body = await readPackageInsertPayload(response);
    const sections = requirePackageInsert(body).sections;
    expect(sections.contraindications).toEqual([
      { text: 'renal: 重篤な腎障害' },
      { text: 'notes: 脱水に注意 / 転倒注意' },
    ]);
    expect(sections.interactions).toEqual([
      { text: '併用注意', severity: undefined, detail: 'INRを確認' },
    ]);
    expect(sections.adverse_effects).toEqual([{ text: '発疹' }, { text: '発熱' }]);
  });

  it('returns version_history with all package insert versions', async () => {
    const olderInsert = {
      ...mockPackageInsert,
      id: 'pi_old',
      document_version: '第4版',
      revised_at: new Date('2024-01-01T00:00:00.000Z'),
    };
    drugPackageInsertFindManyMock.mockResolvedValue([mockPackageInsert, olderInsert]);

    const response = await invokeGet();

    const body = await readPackageInsertPayload(response);
    expect(body.version_history).toHaveLength(2);
    expect(body.version_history[0].id).toBe('pi_1');
    expect(body.version_history[1].id).toBe('pi_old');
  });

  it('returns interactions from both directions merged into a unified list', async () => {
    const drugB = { id: 'drug_2', drug_name: '薬B錠', yj_code: '9876543210987' };
    drugInteractionFindManyMock
      .mockResolvedValueOnce([
        {
          id: 'ix_1',
          drug_b: drugB,
          severity: 'high',
          mechanism: '代謝阻害',
          clinical_effect: 'QT延長',
          source: 'pmda',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'ix_2',
          drug_a: { id: 'drug_3', drug_name: '薬C錠', yj_code: '1111111111111' },
          severity: 'moderate',
          mechanism: '競合阻害',
          clinical_effect: '血中濃度上昇',
          source: 'pmda',
        },
      ]);

    const response = await invokeGet();

    const body = await readPackageInsertPayload(response);
    expect(body.interactions).toHaveLength(2);
    expect(body.interactions[0]).toMatchObject({
      id: 'ix_1',
      counterpart: drugB,
      severity: 'high',
    });
    expect(body.interactions[1]).toMatchObject({
      id: 'ix_2',
      severity: 'moderate',
    });
  });

  it('starts both directional interaction reads before awaiting either result', async () => {
    let releaseBarrier: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    drugInteractionFindManyMock.mockImplementation(() => barrier.then(() => []));

    const responsePromise = invokeGet();

    await vi.waitFor(() => {
      expect(drugInteractionFindManyMock).toHaveBeenCalledTimes(2);
    });
    expect(drugInteractionFindManyMock).toHaveBeenNthCalledWith(1, {
      where: { drug_a_id: 'drug_1' },
      include: { drug_b: { select: { id: true, drug_name: true, yj_code: true } } },
      orderBy: { severity: 'asc' },
    });
    expect(drugInteractionFindManyMock).toHaveBeenNthCalledWith(2, {
      where: { drug_b_id: 'drug_1' },
      include: { drug_a: { select: { id: true, drug_name: true, yj_code: true } } },
      orderBy: { severity: 'asc' },
    });
    releaseBarrier?.();

    const response = await responsePromise;
    expect(response.status).toBe(200);
  });

  it('returns applicable alert rules matching yj_code or therapeutic category', async () => {
    drugAlertRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_1',
        alert_type: 'elderly_pim',
        severity: 'high',
        message: '高齢者への投与に注意',
        is_active: true,
        condition: { yj_codes: ['1234567890123'] },
      },
      {
        id: 'rule_2',
        alert_type: 'renal_adjustment',
        severity: 'moderate',
        message: '腎機能低下患者に注意',
        is_active: true,
        condition: { therapeutic_categories: ['C03'] },
      },
      {
        id: 'rule_3',
        alert_type: 'other',
        severity: 'low',
        message: '無関係なルール',
        is_active: true,
        condition: { yj_codes: ['9999999999999'], therapeutic_categories: ['Z99'] },
      },
    ]);

    const response = await invokeGet();

    const body = await readPackageInsertPayload(response);
    expect(drugAlertRuleFindManyMock).toHaveBeenCalledWith({
      where: { is_active: true, OR: [{ org_id: 'org_1' }, { org_id: null }] },
    });
    expect(body.applicable_alert_rules).toHaveLength(2);
    expect(alertRuleIds(body)).toEqual(['rule_1', 'rule_2']);
  });

  it('ignores malformed alert rule conditions without matching string-like fields', async () => {
    drugAlertRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_array_condition',
        alert_type: 'other',
        severity: 'low',
        message: '配列ルートは無視',
        is_active: true,
        condition: ['unexpected'],
      },
      {
        id: 'rule_string_codes',
        alert_type: 'other',
        severity: 'low',
        message: '文字列コードは配列扱いしない',
        is_active: true,
        condition: { yj_codes: '1234567890123', therapeutic_categories: 'C03' },
      },
      {
        id: 'rule_mixed_codes',
        alert_type: 'elderly_pim',
        severity: 'high',
        message: '有効なコードだけで判定',
        is_active: true,
        condition: { yj_codes: ['1234567890123', 123], therapeutic_categories: [false] },
      },
    ]);

    const response = await invokeGet();

    const body = await readPackageInsertPayload(response);
    expect(alertRuleIds(body)).toEqual(['rule_mixed_codes']);
  });

  it('returns empty applicable_alert_rules when no rules match', async () => {
    drugAlertRuleFindManyMock.mockResolvedValue([
      {
        id: 'rule_unrelated',
        alert_type: 'other',
        severity: 'low',
        message: '無関係',
        is_active: true,
        condition: { yj_codes: ['0000000000000'] },
      },
    ]);

    const response = await invokeGet();

    const body = await readPackageInsertPayload(response);
    expect(body.applicable_alert_rules).toHaveLength(0);
  });

  it('returns a sanitized no-store 500 when package insert lookup fails unexpectedly', async () => {
    const unsafeError = new Error('raw package insert safety secret');
    unsafeError.name = 'PackageInsertSecretError';
    drugPackageInsertFindManyMock.mockRejectedValueOnce(unsafeError);

    const response = await invokeGet();

    expect(response.status).toBe(500);
    expectNoStore(response);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(JSON.stringify(body)).not.toContain('safety secret');
    expect(loggerErrorMock).toHaveBeenCalledWith(
      {
        event: 'route_handler_unhandled_error',
        route: '/api/drug-masters/drug_1/package-insert',
        method: 'GET',
        requestId: response.headers.get('X-Request-Id'),
        correlationId: response.headers.get('X-Correlation-Id'),
      },
      unsafeError,
    );
    const [logContext, logError] = loggerErrorMock.mock.calls[0] ?? [];
    expect(logError).toBe(unsafeError);
    expect(logContext).not.toHaveProperty('error_name');
    const logged = JSON.stringify(logContext);
    expect(logged).not.toContain('safety secret');
    expect(logged).not.toContain('PackageInsertSecretError');
  });

  it('rethrows auth and handler control flow without logging', async () => {
    const authControl = new Error('NEXT_REDIRECT');
    authMock.mockRejectedValueOnce(authControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(invokeGet()).rejects.toBe(authControl);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'user_1' } });
    membershipFindFirstMock.mockResolvedValue({ role: 'pharmacist', site_id: null });
    const handlerControl = new Error('NEXT_NOT_FOUND');
    withOrgContextMock.mockRejectedValueOnce(handlerControl);
    unstableRethrowMock.mockImplementationOnce((error) => {
      throw error;
    });

    await expect(invokeGet()).rejects.toBe(handlerControl);
    expect(runWithRequestAuthContextMock).toHaveBeenCalledOnce();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
