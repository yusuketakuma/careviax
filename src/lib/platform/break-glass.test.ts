import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  BreakGlassScope,
  BreakGlassStatus,
  PlatformOperatorRole,
  type BreakGlassSession,
} from '@prisma/client';

vi.mock('server-only', () => ({}));

// operator.ts (imported transitively for platformRoleAtLeast) pulls in NextAuth +
// prisma; stub the heavy leaves so the module graph loads without side effects.
vi.mock('@/lib/auth/config', () => ({ auth: vi.fn() }));

const { withOrgContextMock } = vi.hoisted(() => ({ withOrgContextMock: vi.fn() }));
const { runWithRequestAuthContextMock } = vi.hoisted(() => ({
  runWithRequestAuthContextMock: vi.fn(),
}));
const { recordBreakGlassAuditMock } = vi.hoisted(() => ({
  recordBreakGlassAuditMock: vi.fn(async (_tx: unknown, _input: unknown) => {}),
}));
const prismaMocks = vi.hoisted(() => ({
  breakGlassSessionFindFirst: vi.fn(),
  breakGlassSessionFindMany: vi.fn(),
  breakGlassSessionFindUnique: vi.fn(),
  breakGlassSessionCreate: vi.fn(),
  breakGlassSessionUpdate: vi.fn(),
  organizationFindUnique: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    breakGlassSession: {
      findFirst: prismaMocks.breakGlassSessionFindFirst,
      findMany: prismaMocks.breakGlassSessionFindMany,
      findUnique: prismaMocks.breakGlassSessionFindUnique,
      create: prismaMocks.breakGlassSessionCreate,
      update: prismaMocks.breakGlassSessionUpdate,
    },
    organization: { findUnique: prismaMocks.organizationFindUnique },
  },
}));

vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));

vi.mock('@/lib/auth/request-context', () => ({
  runWithRequestAuthContext: runWithRequestAuthContextMock,
}));

// Keep the real action constants; only intercept the audit writer so we can
// track call ordering and force fail-closed rejections.
vi.mock('@/lib/audit/break-glass-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/audit/break-glass-audit')>();
  return { ...actual, recordBreakGlassAudit: recordBreakGlassAuditMock };
});

import {
  withBreakGlassOrgContext,
  readViaBreakGlass,
  createBreakGlassSession,
  revokeBreakGlassSession,
  getActiveBreakGlassSession,
  listActiveBreakGlassSessions,
  BreakGlassAccessError,
  BREAK_GLASS_DEFAULT_TTL_MS,
  BREAK_GLASS_MAX_TTL_MS,
} from './break-glass';
import type { PlatformOperatorContext } from './operator';
import {
  BREAK_GLASS_ACTIVATE_ACTION,
  BREAK_GLASS_READ_ACTION,
  BREAK_GLASS_REVOKE_ACTION,
  BREAK_GLASS_WRITE_ACTION,
} from '@/lib/audit/break-glass-audit';

const TARGET_ORG = 'org_target';

function makeOperator(overrides: Partial<PlatformOperatorContext> = {}): PlatformOperatorContext {
  return {
    operatorId: 'op_1',
    userId: 'user_1',
    email: 'op@example.com',
    role: PlatformOperatorRole.platform_admin,
    ipAddress: '203.0.113.5',
    userAgent: 'vitest-ua',
    ...overrides,
  };
}

function makeSession(overrides: Partial<BreakGlassSession> = {}): BreakGlassSession {
  const now = Date.now();
  return {
    id: 'bg_1',
    operator_id: 'op_1',
    target_org_id: TARGET_ORG,
    reason: 'incident-4711',
    reference_ticket: 'JIRA-1',
    scope: BreakGlassScope.read_only,
    status: BreakGlassStatus.active,
    mfa_verified_at: new Date(now - 1000),
    granted_at: new Date(now - 1000),
    expires_at: new Date(now + 10 * 60 * 1000),
    revoked_at: null,
    revoked_by: null,
    ip_address: '203.0.113.5',
    user_agent: 'vitest-ua',
    ...overrides,
  } as BreakGlassSession;
}

/** withOrgContext mock: capture the request context and run the work against a fake tx. */
function wireWithOrgContext() {
  withOrgContextMock.mockImplementation(async (_orgId, work, options) => {
    (wireWithOrgContext as unknown as { lastRequestContext?: unknown }).lastRequestContext =
      options?.requestContext;
    return work({ auditLog: { create: vi.fn() } });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  recordBreakGlassAuditMock.mockResolvedValue(undefined);
  runWithRequestAuthContextMock.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());
  wireWithOrgContext();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('assertSessionUsable (via withBreakGlassOrgContext / readViaBreakGlass)', () => {
  const access = { targetType: 'patient', targetId: 'patient_1' };

  it('rejects when the session belongs to another operator', async () => {
    const session = makeSession({ operator_id: 'op_other' });
    const fn = vi.fn();
    await expect(
      withBreakGlassOrgContext(makeOperator(), session, access, fn),
    ).rejects.toMatchObject({ name: 'BreakGlassAccessError', code: 'operator_mismatch' });
    expect(fn).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects a revoked session', async () => {
    const session = makeSession({ status: BreakGlassStatus.revoked });
    await expect(
      withBreakGlassOrgContext(makeOperator(), session, access, vi.fn()),
    ).rejects.toMatchObject({ code: 'revoked' });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('rejects a session whose expires_at is in the past', async () => {
    const session = makeSession({ expires_at: new Date(Date.now() - 1000) });
    await expect(
      withBreakGlassOrgContext(makeOperator(), session, access, vi.fn()),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('rejects an active session whose expires_at equals now (<= boundary)', async () => {
    const now = new Date('2026-07-03T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const session = makeSession({
      status: BreakGlassStatus.active,
      expires_at: new Date(now.getTime()),
    });
    await expect(
      withBreakGlassOrgContext(makeOperator(), session, access, vi.fn()),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('rejects a write when the session scope is read_only (scope_denied)', async () => {
    const session = makeSession({ scope: BreakGlassScope.read_only });
    await expect(
      withBreakGlassOrgContext(
        makeOperator(),
        session,
        { ...access, requireWrite: true },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: 'scope_denied' });
    expect(withOrgContextMock).not.toHaveBeenCalled();
  });

  it('surfaces the guard through readViaBreakGlass too (reader never runs)', async () => {
    const session = makeSession({ status: BreakGlassStatus.revoked });
    const reader = vi.fn();
    await expect(readViaBreakGlass(makeOperator(), session, access, reader)).rejects.toMatchObject(
      { code: 'revoked' },
    );
    expect(reader).not.toHaveBeenCalled();
    expect(recordBreakGlassAuditMock).not.toHaveBeenCalled();
  });

  it('exposes BreakGlassAccessError as an Error subtype', async () => {
    const session = makeSession({ operator_id: 'op_other' });
    const err = await withBreakGlassOrgContext(makeOperator(), session, access, vi.fn()).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(BreakGlassAccessError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('withBreakGlassOrgContext (happy path + fail-closed audit)', () => {
  const access = { targetType: 'patient', targetId: 'patient_1' };

  it('returns fn result and writes the audit AFTER fn, in the same tx', async () => {
    const order: string[] = [];
    const fn = vi.fn(async () => {
      order.push('fn');
      return { rows: 3 };
    });
    recordBreakGlassAuditMock.mockImplementation(async () => {
      order.push('audit');
    });

    const result = await withBreakGlassOrgContext(makeOperator(), makeSession(), access, fn);

    expect(result).toEqual({ rows: 3 });
    expect(order).toEqual(['fn', 'audit']);
    expect(withOrgContextMock).toHaveBeenCalledWith(
      TARGET_ORG,
      expect.any(Function),
      expect.objectContaining({
        requestContext: expect.objectContaining({ orgId: TARGET_ORG, userId: 'user_1' }),
      }),
    );
    const auditInput = recordBreakGlassAuditMock.mock.calls[0]?.[1];
    expect(auditInput).toMatchObject({
      action: BREAK_GLASS_READ_ACTION,
      targetOrgId: TARGET_ORG,
      operatorUserId: 'user_1',
      sessionId: 'bg_1',
    });
  });

  it('uses the write action when requireWrite is set on a read_write session', async () => {
    const session = makeSession({ scope: BreakGlassScope.read_write });
    await withBreakGlassOrgContext(
      makeOperator(),
      session,
      { ...access, requireWrite: true },
      vi.fn(async () => 'ok'),
    );
    expect(recordBreakGlassAuditMock.mock.calls[0]?.[1]).toMatchObject({
      action: BREAK_GLASS_WRITE_ACTION,
    });
  });

  it('is fail-closed: if the audit write throws, the whole call rejects and no result surfaces', async () => {
    const fn = vi.fn(async () => 'sensitive-data');
    recordBreakGlassAuditMock.mockRejectedValue(new Error('audit db down'));

    await expect(
      withBreakGlassOrgContext(makeOperator(), makeSession(), access, fn),
    ).rejects.toThrow('audit db down');
    // fn ran (inside the tx) but its result must not escape the failed transaction.
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('readViaBreakGlass', () => {
  const access = { targetType: 'patient', targetId: 'patient_1' };

  it('audits BEFORE running the reader and pins the reader context to the target org', async () => {
    const order: string[] = [];
    recordBreakGlassAuditMock.mockImplementation(async () => {
      order.push('audit');
    });
    let capturedCtx: { orgId?: string } | undefined;
    runWithRequestAuthContextMock.mockImplementation((ctx: { orgId?: string }, fn: () => unknown) => {
      capturedCtx = ctx;
      order.push('reader');
      return fn();
    });
    const reader = vi.fn(async () => ({ patient: 'redacted' }));

    const result = await readViaBreakGlass(makeOperator(), makeSession(), access, reader);

    expect(result).toEqual({ patient: 'redacted' });
    expect(order).toEqual(['audit', 'reader']);
    expect(capturedCtx?.orgId).toBe(TARGET_ORG);
    expect(recordBreakGlassAuditMock.mock.calls[0]?.[1]).toMatchObject({
      action: BREAK_GLASS_READ_ACTION,
    });
  });

  it('is fail-closed: if auditing rejects, the reader never runs', async () => {
    recordBreakGlassAuditMock.mockRejectedValue(new Error('audit failed'));
    const reader = vi.fn();

    await expect(
      readViaBreakGlass(makeOperator(), makeSession(), access, reader),
    ).rejects.toThrow('audit failed');
    expect(reader).not.toHaveBeenCalled();
    expect(runWithRequestAuthContextMock).not.toHaveBeenCalled();
  });
});

describe('createBreakGlassSession', () => {
  const baseInput = () => ({
    operator: makeOperator(),
    targetOrgId: TARGET_ORG,
    reason: 'incident-4711',
    referenceTicket: 'JIRA-1',
    mfaVerifiedAt: new Date('2026-07-03T00:00:00.000Z'),
  });

  it('(a) rejects with org_mismatch when the target tenant does not exist', async () => {
    prismaMocks.organizationFindUnique.mockResolvedValue(null);
    await expect(createBreakGlassSession(baseInput())).rejects.toMatchObject({
      code: 'org_mismatch',
    });
    expect(prismaMocks.breakGlassSessionCreate).not.toHaveBeenCalled();
  });

  it('(b) rejects read_write with scope_denied for platform_support', async () => {
    prismaMocks.organizationFindUnique.mockResolvedValue({ id: TARGET_ORG });
    await expect(
      createBreakGlassSession({
        ...baseInput(),
        operator: makeOperator({ role: PlatformOperatorRole.platform_support }),
        scope: BreakGlassScope.read_write,
      }),
    ).rejects.toMatchObject({ code: 'scope_denied' });
    // scope guard runs before the org lookup
    expect(prismaMocks.organizationFindUnique).not.toHaveBeenCalled();
    expect(prismaMocks.breakGlassSessionCreate).not.toHaveBeenCalled();
  });

  it('(c) creates an active session and writes an activate audit row', async () => {
    const now = new Date('2026-07-03T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    prismaMocks.organizationFindUnique.mockResolvedValue({ id: TARGET_ORG });
    const created = makeSession();
    prismaMocks.breakGlassSessionCreate.mockResolvedValue(created);

    const result = await createBreakGlassSession(baseInput());

    expect(result).toBe(created);
    expect(prismaMocks.breakGlassSessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operator_id: 'op_1',
        target_org_id: TARGET_ORG,
        reason: 'incident-4711',
        reference_ticket: 'JIRA-1',
        scope: BreakGlassScope.read_only,
        mfa_verified_at: now,
        status: BreakGlassStatus.active,
        expires_at: new Date(now.getTime() + BREAK_GLASS_DEFAULT_TTL_MS),
        ip_address: '203.0.113.5',
        user_agent: 'vitest-ua',
      }),
    });
    expect(recordBreakGlassAuditMock.mock.calls[0]?.[1]).toMatchObject({
      action: BREAK_GLASS_ACTIVATE_ACTION,
      targetType: 'break_glass_session',
    });
  });

  it('(d) caps ttlMs at the 60-minute maximum and defaults to 30 minutes', async () => {
    const now = new Date('2026-07-03T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    prismaMocks.organizationFindUnique.mockResolvedValue({ id: TARGET_ORG });
    prismaMocks.breakGlassSessionCreate.mockResolvedValue(makeSession());

    // over the cap → capped at MAX
    await createBreakGlassSession({ ...baseInput(), ttlMs: 5 * 60 * 60 * 1000 });
    expect(prismaMocks.breakGlassSessionCreate.mock.calls[0]?.[0]?.data?.expires_at).toEqual(
      new Date(now.getTime() + BREAK_GLASS_MAX_TTL_MS),
    );

    prismaMocks.breakGlassSessionCreate.mockClear();

    // default (no ttlMs) → 30 minutes
    await createBreakGlassSession(baseInput());
    expect(prismaMocks.breakGlassSessionCreate.mock.calls[0]?.[0]?.data?.expires_at).toEqual(
      new Date(now.getTime() + BREAK_GLASS_DEFAULT_TTL_MS),
    );
  });

  it('allows platform_admin to open a read_write session', async () => {
    prismaMocks.organizationFindUnique.mockResolvedValue({ id: TARGET_ORG });
    prismaMocks.breakGlassSessionCreate.mockResolvedValue(makeSession({ scope: BreakGlassScope.read_write }));
    await expect(
      createBreakGlassSession({ ...baseInput(), scope: BreakGlassScope.read_write }),
    ).resolves.toBeDefined();
    expect(prismaMocks.breakGlassSessionCreate.mock.calls[0]?.[0]?.data?.scope).toBe(
      BreakGlassScope.read_write,
    );
  });
});

describe('revokeBreakGlassSession', () => {
  it('(a) returns null when the session is not found', async () => {
    prismaMocks.breakGlassSessionFindUnique.mockResolvedValue(null);
    await expect(revokeBreakGlassSession(makeOperator(), 'missing')).resolves.toBeNull();
    expect(prismaMocks.breakGlassSessionUpdate).not.toHaveBeenCalled();
  });

  it("(b) returns null when a non-owner tries to revoke another operator's session", async () => {
    prismaMocks.breakGlassSessionFindUnique.mockResolvedValue(
      makeSession({ operator_id: 'op_other' }),
    );
    const result = await revokeBreakGlassSession(
      makeOperator({ role: PlatformOperatorRole.platform_admin }),
      'bg_1',
    );
    expect(result).toBeNull();
    expect(prismaMocks.breakGlassSessionUpdate).not.toHaveBeenCalled();
    expect(recordBreakGlassAuditMock).not.toHaveBeenCalled();
  });

  it("(c) lets a platform_owner revoke another operator's session", async () => {
    prismaMocks.breakGlassSessionFindUnique.mockResolvedValue(
      makeSession({ operator_id: 'op_other' }),
    );
    const updated = makeSession({ operator_id: 'op_other', status: BreakGlassStatus.revoked });
    prismaMocks.breakGlassSessionUpdate.mockResolvedValue(updated);

    const result = await revokeBreakGlassSession(
      makeOperator({ role: PlatformOperatorRole.platform_owner }),
      'bg_1',
    );
    expect(result).toBe(updated);
    expect(prismaMocks.breakGlassSessionUpdate).toHaveBeenCalledTimes(1);
  });

  it('(d) revokes the operator’s own active session and writes a revoke audit row', async () => {
    prismaMocks.breakGlassSessionFindUnique.mockResolvedValue(makeSession());
    const updated = makeSession({ status: BreakGlassStatus.revoked });
    prismaMocks.breakGlassSessionUpdate.mockResolvedValue(updated);

    const result = await revokeBreakGlassSession(makeOperator(), 'bg_1');

    expect(result).toBe(updated);
    expect(prismaMocks.breakGlassSessionUpdate).toHaveBeenCalledWith({
      where: { id: 'bg_1' },
      data: expect.objectContaining({
        status: BreakGlassStatus.revoked,
        revoked_by: 'user_1',
        revoked_at: expect.any(Date),
      }),
    });
    expect(recordBreakGlassAuditMock.mock.calls[0]?.[1]).toMatchObject({
      action: BREAK_GLASS_REVOKE_ACTION,
    });
  });

  it('(e) returns an already-revoked session unchanged without double-auditing', async () => {
    const existing = makeSession({ status: BreakGlassStatus.revoked });
    prismaMocks.breakGlassSessionFindUnique.mockResolvedValue(existing);

    const result = await revokeBreakGlassSession(makeOperator(), 'bg_1');

    expect(result).toBe(existing);
    expect(prismaMocks.breakGlassSessionUpdate).not.toHaveBeenCalled();
    expect(recordBreakGlassAuditMock).not.toHaveBeenCalled();
  });
});

describe('getActiveBreakGlassSession / listActiveBreakGlassSessions', () => {
  it('scopes getActive to status=active and expires_at > now', async () => {
    prismaMocks.breakGlassSessionFindFirst.mockResolvedValue(makeSession());
    await getActiveBreakGlassSession('op_1', TARGET_ORG);
    expect(prismaMocks.breakGlassSessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operator_id: 'op_1',
          target_org_id: TARGET_ORG,
          status: BreakGlassStatus.active,
          expires_at: { gt: expect.any(Date) },
        }),
      }),
    );
  });

  it('scopes listActive to status=active and expires_at > now', async () => {
    prismaMocks.breakGlassSessionFindMany.mockResolvedValue([makeSession()]);
    await listActiveBreakGlassSessions('op_1');
    expect(prismaMocks.breakGlassSessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operator_id: 'op_1',
          status: BreakGlassStatus.active,
          expires_at: { gt: expect.any(Date) },
        }),
      }),
    );
  });
});
