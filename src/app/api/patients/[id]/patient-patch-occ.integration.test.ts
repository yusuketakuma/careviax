import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import type { AuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { executeAuthenticatedPatientPatch } from './patient-patch-handler';

const appDatabaseUrl = process.env.PATIENT_PATCH_OCC_DATABASE_URL;
const adminDatabaseUrl =
  process.env.RLS_PROOF_ADMIN_DATABASE_URL ?? process.env.POSTGRES_INTEGRATION_ADMIN_DATABASE_URL;

function assertSafeLocalDatabaseUrl(value: string, environmentName: string, expectedUser?: string) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.hostname !== 'localhost' ||
    parsed.port !== '5433' ||
    parsed.pathname !== '/ph_os_e2e' ||
    (parsed.searchParams.get('schema') !== null &&
      parsed.searchParams.get('schema') !== 'public') ||
    (expectedUser !== undefined && decodeURIComponent(parsed.username) !== expectedUser)
  ) {
    throw new Error(
      `${environmentName} must use ${expectedUser ?? 'a privileged role'} on postgresql://localhost:5433/ph_os_e2e?schema=public`,
    );
  }
}

if (appDatabaseUrl) {
  assertSafeLocalDatabaseUrl(appDatabaseUrl, 'PATIENT_PATCH_OCC_DATABASE_URL', 'ph_os_app');
  if (!adminDatabaseUrl) {
    throw new Error(
      'RLS_PROOF_ADMIN_DATABASE_URL or POSTGRES_INTEGRATION_ADMIN_DATABASE_URL is required for seed and proof reads',
    );
  }
  assertSafeLocalDatabaseUrl(adminDatabaseUrl, 'patient PATCH OCC admin database URL');
  if (adminDatabaseUrl === appDatabaseUrl) {
    throw new Error('patient PATCH OCC admin and app database URLs must be distinct');
  }
}

const describeDatabase = appDatabaseUrl ? describe : describe.skip;
const runId = `occ_${randomUUID().replaceAll('-', '')}`;
const orgAId = `${runId}_a`;
const orgBId = `${runId}_b`;
const actorId = `${runId}_actor`;
const patientIds = {
  concurrent: `${runId}_concurrent`,
  staleCase: `${runId}_stale_case`,
  authorityInsert: `${runId}_authority_insert`,
  authorityReorder: `${runId}_authority_reorder`,
  crossOrg: `${runId}_cross_org`,
  authorized: `${runId}_authorized`,
  caseNull: `${runId}_case_null`,
} as const;
const staleCaseId = `${runId}_case`;
const authorityInsertCaseId = `${runId}_authority_insert_case`;
const authorityInsertedCaseId = `${runId}_authority_inserted_case`;
const authorityCurrentCaseId = `${runId}_authority_current_case`;
const authorityOlderCaseId = `${runId}_authority_older_case`;
const authorizedCaseId = `${runId}_authorized_case`;
const seedUpdatedAt = new Date('2026-07-22T00:00:00.000Z');
let admin: PrismaClient | null = null;
let racePool: Pool | null = null;

function adminDb() {
  if (!admin) throw new Error('admin integration database is not initialized');
  return admin;
}

function authContext(orgId: string): AuthContext {
  return {
    userId: actorId,
    orgId,
    role: 'pharmacist',
  };
}

function patchRequest(patientId: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/patients/${encodeURIComponent(patientId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function executePatch(args: {
  orgId: string;
  patientId: string;
  body: Record<string, unknown>;
  now: Date;
  testOnlyBeforeCareCaseClaim?: (tx: Prisma.TransactionClient) => Promise<void>;
}) {
  return executeAuthenticatedPatientPatch(
    patchRequest(args.patientId, args.body),
    authContext(args.orgId),
    { params: Promise.resolve({ id: args.patientId }) },
    {
      now: () => args.now,
      testOnlyBeforeCareCaseClaim: args.testOnlyBeforeCareCaseClaim,
    },
  );
}

async function readPatient(patientId: string) {
  return adminDb().patient.findUniqueOrThrow({
    where: { id: patientId },
    select: { notes: true, updated_at: true },
  });
}

async function countPatientWrites(patientId: string) {
  const [revisions, preferences, audits] = await Promise.all([
    adminDb().patientFieldRevision.count({ where: { patient_id: patientId } }),
    adminDb().patientSchedulePreference.count({ where: { patient_id: patientId } }),
    adminDb().auditLog.count({ where: { target_id: patientId } }),
  ]);
  return { revisions, preferences, audits };
}

async function startBlockedCaseMutation(text: string, values: unknown[]) {
  if (!racePool) throw new Error('patient PATCH OCC race pool is not initialized');
  const client = await racePool.connect();
  await client.query('BEGIN');
  const pidResult = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
  const pid = pidResult.rows[0]!.pid;
  const mutation = client.query(text, values);
  try {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const state = await adminDb().$queryRaw<Array<{ wait_event_type: string | null }>>(
        Prisma.sql`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`,
      );
      if (state[0]?.wait_event_type === 'Lock') {
        return async () => {
          await mutation;
          await client.query('COMMIT');
          client.release();
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('concurrent CareCase mutation did not block on the PATCH authority locks');
  } catch (error) {
    await adminDb().$executeRaw(Prisma.sql`SELECT pg_cancel_backend(${pid})`);
    await mutation.catch(() => undefined);
    await client.query('ROLLBACK');
    client.release();
    throw error;
  }
}

describeDatabase('patient PATCH optimistic concurrency on PostgreSQL with FORCE RLS', () => {
  beforeAll(async () => {
    const appPool = new Pool({ connectionString: appDatabaseUrl!, max: 1 });
    try {
      const appRole = await appPool.query<{
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(`
        SELECT current_user,
               role.rolsuper,
               role.rolbypassrls
          FROM pg_roles AS role
         WHERE role.rolname = current_user
      `);
      expect(appRole.rows[0]).toEqual({
        current_user: 'ph_os_app',
        rolsuper: false,
        rolbypassrls: false,
      });
    } finally {
      await appPool.end();
    }

    const adminPool = new Pool({ connectionString: adminDatabaseUrl!, max: 1 });
    try {
      const adminRole = await adminPool.query<{
        current_user: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(`
        SELECT current_user,
               role.rolsuper,
               role.rolbypassrls
          FROM pg_roles AS role
         WHERE role.rolname = current_user
      `);
      const role = adminRole.rows[0];
      expect(role).toBeDefined();
      expect(role!.current_user).not.toBe('ph_os_app');
      expect(role!.rolsuper || role!.rolbypassrls).toBe(true);
    } finally {
      await adminPool.end();
    }

    admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: adminDatabaseUrl! }),
    });
    racePool = new Pool({ connectionString: adminDatabaseUrl!, max: 2 });
    await adminDb().organization.createMany({
      data: [
        { id: orgAId, name: 'Patient OCC integration org A' },
        { id: orgBId, name: 'Patient OCC integration org B' },
      ],
    });
    await adminDb().patient.createMany({
      data: [
        {
          id: patientIds.concurrent,
          org_id: orgAId,
          name: 'OCC Concurrent',
          name_kana: 'オーシーシー コンカレント',
          birth_date: new Date('1950-01-01T00:00:00.000Z'),
          gender: 'other',
          notes: 'concurrent-before',
          updated_at: seedUpdatedAt,
        },
        {
          id: patientIds.staleCase,
          org_id: orgAId,
          name: 'OCC Stale Case',
          name_kana: 'オーシーシー ステイルケース',
          birth_date: new Date('1951-01-01T00:00:00.000Z'),
          gender: 'other',
          notes: 'stale-case-before',
          updated_at: seedUpdatedAt,
        },
        {
          id: patientIds.authorityInsert,
          org_id: orgAId,
          name: 'OCC Authority Insert',
          name_kana: 'オーシーシー オーソリティインサート',
          birth_date: new Date('1951-02-01T00:00:00.000Z'),
          gender: 'other',
          notes: 'authority-insert-before',
          updated_at: seedUpdatedAt,
        },
        {
          id: patientIds.authorityReorder,
          org_id: orgAId,
          name: 'OCC Authority Reorder',
          name_kana: 'オーシーシー オーソリティリオーダー',
          birth_date: new Date('1951-03-01T00:00:00.000Z'),
          gender: 'other',
          notes: 'authority-reorder-before',
          updated_at: seedUpdatedAt,
        },
        {
          id: patientIds.crossOrg,
          org_id: orgBId,
          name: 'OCC Cross Org',
          name_kana: 'オーシーシー クロスオルグ',
          birth_date: new Date('1952-01-01T00:00:00.000Z'),
          gender: 'other',
          notes: 'cross-org-before',
          updated_at: seedUpdatedAt,
        },
        {
          id: patientIds.authorized,
          org_id: orgAId,
          name: 'OCC Authorized',
          name_kana: 'オーシーシー オーソライズド',
          birth_date: new Date('1953-01-01T00:00:00.000Z'),
          gender: 'other',
          notes: 'authorized-before',
          updated_at: seedUpdatedAt,
        },
        {
          id: patientIds.caseNull,
          org_id: orgAId,
          name: 'OCC Case Null',
          name_kana: 'オーシーシー ケースヌル',
          birth_date: new Date('1954-01-01T00:00:00.000Z'),
          gender: 'other',
          notes: 'case-null-before',
          updated_at: seedUpdatedAt,
        },
      ],
    });
    await adminDb().careCase.createMany({
      data: [
        {
          id: staleCaseId,
          org_id: orgAId,
          patient_id: patientIds.staleCase,
          required_visit_support: { home_visit_intake: { primary_disease: 'before' } },
          version: 1,
        },
        {
          id: authorizedCaseId,
          org_id: orgAId,
          patient_id: patientIds.authorized,
          required_visit_support: { home_visit_intake: { care_level: 'before' } },
          version: 1,
        },
        {
          id: authorityInsertCaseId,
          org_id: orgAId,
          patient_id: patientIds.authorityInsert,
          required_visit_support: { home_visit_intake: { primary_disease: 'original' } },
          version: 1,
        },
        {
          id: authorityCurrentCaseId,
          org_id: orgAId,
          patient_id: patientIds.authorityReorder,
          required_visit_support: { home_visit_intake: { primary_disease: 'current' } },
          version: 1,
          updated_at: new Date('2026-07-22T00:00:02.000Z'),
        },
        {
          id: authorityOlderCaseId,
          org_id: orgAId,
          patient_id: patientIds.authorityReorder,
          required_visit_support: { home_visit_intake: { primary_disease: 'older' } },
          version: 1,
          updated_at: new Date('2026-07-22T00:00:01.000Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    if (!admin) return;
    try {
      await admin.patientFieldRevision.deleteMany({ where: { org_id: { in: [orgAId, orgBId] } } });
      await admin.patientSchedulePreference.deleteMany({
        where: { org_id: { in: [orgAId, orgBId] } },
      });
      await admin.careCase.deleteMany({ where: { org_id: { in: [orgAId, orgBId] } } });
      await admin.patient.deleteMany({ where: { org_id: { in: [orgAId, orgBId] } } });
      await admin.auditLog.deleteMany({ where: { org_id: { in: [orgAId, orgBId] } } });
      await admin.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
    } finally {
      await admin.$disconnect();
      await prisma.$disconnect();
      await racePool?.end();
      racePool = null;
      admin = null;
    }
  }, 30_000);

  it('allows exactly one winner for concurrent requests with the same Patient token', async () => {
    const token = (await readPatient(patientIds.concurrent)).updated_at.toISOString();
    const now = new Date('2026-07-22T00:01:00.000Z');
    const responses = await Promise.all([
      executePatch({
        orgId: orgAId,
        patientId: patientIds.concurrent,
        body: { expected_updated_at: token, notes: 'concurrent-winner-a' },
        now,
      }),
      executePatch({
        orgId: orgAId,
        patientId: patientIds.concurrent,
        body: { expected_updated_at: token, notes: 'concurrent-winner-b' },
        now,
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const row = await readPatient(patientIds.concurrent);
    expect(['concurrent-winner-a', 'concurrent-winner-b']).toContain(row.notes);
    expect(row.updated_at).toEqual(now);
    expect(
      await adminDb().patientFieldRevision.count({
        where: { patient_id: patientIds.concurrent, field_key: 'notes' },
      }),
    ).toBe(1);
  });

  it('fully rolls back a fresh Patient claim when the CareCase token is stale', async () => {
    const patientBefore = await readPatient(patientIds.staleCase);
    const caseBefore = await adminDb().careCase.findUniqueOrThrow({
      where: { id: staleCaseId },
      select: { version: true, required_visit_support: true, updated_at: true },
    });
    const writesBefore = await countPatientWrites(patientIds.staleCase);
    const caseAuditsBefore = await adminDb().auditLog.count({
      where: { target_id: staleCaseId },
    });

    let patientClaimObserved = false;
    const response = await executePatch({
      orgId: orgAId,
      patientId: patientIds.staleCase,
      body: {
        expected_updated_at: patientBefore.updated_at.toISOString(),
        care_case_id: staleCaseId,
        expected_care_case_version: caseBefore.version,
        notes: 'must-rollback',
        intake: { primary_disease: 'must-rollback' },
      },
      now: new Date('2026-07-22T00:02:00.000Z'),
      testOnlyBeforeCareCaseClaim: async (tx) => {
        const claimedPatient = await tx.patient.findUniqueOrThrow({
          where: { id: patientIds.staleCase },
          select: { notes: true, updated_at: true },
        });
        expect(claimedPatient).toEqual({
          notes: 'must-rollback',
          updated_at: new Date('2026-07-22T00:02:00.000Z'),
        });
        patientClaimObserved = true;

        const racedCase = await tx.careCase.updateMany({
          where: { id: staleCaseId, version: caseBefore.version },
          data: {
            required_visit_support: { home_visit_intake: { primary_disease: 'raced' } },
            version: { increment: 1 },
          },
        });
        expect(racedCase.count).toBe(1);
      },
    });

    expect(patientClaimObserved).toBe(true);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      details: { conflict_type: 'stale_care_case' },
    });
    await expect(readPatient(patientIds.staleCase)).resolves.toEqual(patientBefore);
    await expect(
      adminDb().careCase.findUniqueOrThrow({
        where: { id: staleCaseId },
        select: { version: true, required_visit_support: true, updated_at: true },
      }),
    ).resolves.toEqual(caseBefore);
    await expect(countPatientWrites(patientIds.staleCase)).resolves.toEqual(writesBefore);
    expect(await adminDb().auditLog.count({ where: { target_id: staleCaseId } })).toBe(
      caseAuditsBefore,
    );
  });

  it('holds canonical authority while a concurrent newer CareCase insert waits on the Patient lock', async () => {
    const patientBefore = await readPatient(patientIds.authorityInsert);
    let finishInsert: (() => Promise<void>) | null = null;
    const response = await executePatch({
      orgId: orgAId,
      patientId: patientIds.authorityInsert,
      body: {
        expected_updated_at: patientBefore.updated_at.toISOString(),
        care_case_id: authorityInsertCaseId,
        expected_care_case_version: 1,
        intake: { primary_disease: 'patched-before-insert' },
      },
      now: new Date('2026-07-22T00:02:10.000Z'),
      testOnlyBeforeCareCaseClaim: async () => {
        finishInsert = await startBlockedCaseMutation(
          `INSERT INTO "CareCase" ("id", "org_id", "patient_id", "status", "version", "created_at", "updated_at")
           VALUES ($1, $2, $3, 'active', 1, NOW(), NOW())`,
          [authorityInsertedCaseId, orgAId, patientIds.authorityInsert],
        );
      },
    });

    expect(finishInsert).not.toBeNull();
    await finishInsert!();
    expect(response.status).toBe(200);
    await expect(
      adminDb().careCase.findUniqueOrThrow({
        where: { id: authorityInsertCaseId },
        select: { version: true, required_visit_support: true },
      }),
    ).resolves.toEqual({
      version: 2,
      required_visit_support: {
        home_visit_intake: expect.objectContaining({ primary_disease: 'patched-before-insert' }),
      },
    });
    expect(await adminDb().careCase.count({ where: { id: authorityInsertedCaseId } })).toBe(1);
  });

  it('holds canonical authority while a concurrent older Case reorder waits on its row lock', async () => {
    const patientBefore = await readPatient(patientIds.authorityReorder);
    let finishReorder: (() => Promise<void>) | null = null;
    const response = await executePatch({
      orgId: orgAId,
      patientId: patientIds.authorityReorder,
      body: {
        expected_updated_at: patientBefore.updated_at.toISOString(),
        care_case_id: authorityCurrentCaseId,
        expected_care_case_version: 1,
        intake: { primary_disease: 'patched-before-reorder' },
      },
      now: new Date('2026-07-22T00:02:20.000Z'),
      testOnlyBeforeCareCaseClaim: async () => {
        finishReorder = await startBlockedCaseMutation(
          `UPDATE "CareCase" SET "updated_at" = $1 WHERE "id" = $2`,
          [new Date('2026-07-22T00:10:00.000Z'), authorityOlderCaseId],
        );
      },
    });

    expect(finishReorder).not.toBeNull();
    await finishReorder!();
    expect(response.status).toBe(200);
    await expect(
      adminDb().careCase.findUniqueOrThrow({
        where: { id: authorityCurrentCaseId },
        select: { version: true, required_visit_support: true },
      }),
    ).resolves.toEqual({
      version: 2,
      required_visit_support: {
        home_visit_intake: expect.objectContaining({ primary_disease: 'patched-before-reorder' }),
      },
    });
  });

  it('keeps a cross-org Patient invisible and performs zero writes', async () => {
    const patientBefore = await readPatient(patientIds.crossOrg);
    const writesBefore = await countPatientWrites(patientIds.crossOrg);

    const response = await executePatch({
      orgId: orgAId,
      patientId: patientIds.crossOrg,
      body: {
        expected_updated_at: patientBefore.updated_at.toISOString(),
        notes: 'must-not-cross-org',
      },
      now: new Date('2026-07-22T00:03:00.000Z'),
    });

    expect(response.status).toBe(404);
    await expect(readPatient(patientIds.crossOrg)).resolves.toEqual(patientBefore);
    await expect(countPatientWrites(patientIds.crossOrg)).resolves.toEqual(writesBefore);
  });

  it('allows a same-org authorized request through the NOBYPASSRLS app connection', async () => {
    const patientBefore = await readPatient(patientIds.authorized);
    const response = await executePatch({
      orgId: orgAId,
      patientId: patientIds.authorized,
      body: {
        expected_updated_at: patientBefore.updated_at.toISOString(),
        care_case_id: authorizedCaseId,
        expected_care_case_version: 1,
        notes: 'authorized-after',
        intake: { care_level: '要介護2' },
      },
      now: new Date('2026-07-22T00:04:00.000Z'),
    });

    expect(response.status).toBe(200);
    const responsePayload = await response.json();
    const patientAfter = await readPatient(patientIds.authorized);
    expect(patientAfter).toEqual({
      notes: 'authorized-after',
      updated_at: new Date('2026-07-22T00:04:00.000Z'),
    });
    await expect(
      adminDb().patientFieldRevision.findMany({
        where: { patient_id: patientIds.authorized, field_key: 'notes' },
        select: { org_id: true, old_value: true, new_value: true, updated_by: true },
      }),
    ).resolves.toEqual([
      {
        org_id: orgAId,
        old_value: 'authorized-before',
        new_value: 'authorized-after',
        updated_by: actorId,
      },
    ]);
    const caseAfter = await adminDb().careCase.findUniqueOrThrow({
      where: { id: authorizedCaseId },
      select: { version: true, required_visit_support: true },
    });
    expect(caseAfter).toEqual({
      version: 2,
      required_visit_support: {
        home_visit_intake: expect.objectContaining({ care_level: '要介護2' }),
      },
    });
    expect(responsePayload).toMatchObject({
      data: { id: patientIds.authorized, updated_at: patientAfter.updated_at.toISOString() },
    });
    expect(responsePayload.meta.version_basis).toEqual({
      patient_updated_at: patientAfter.updated_at.toISOString(),
      care_case_id: authorizedCaseId,
      care_case_version: caseAfter.version,
    });
    await expect(
      adminDb().patientSchedulePreference.findUniqueOrThrow({
        where: { patient_id: patientIds.authorized },
        select: { care_level: true },
      }),
    ).resolves.toEqual({ care_level: '要介護2' });
  });

  it('allows case-null A-only intake and rejects B intake with zero B writes', async () => {
    const patientBefore = await readPatient(patientIds.caseNull);
    const aResponse = await executePatch({
      orgId: orgAId,
      patientId: patientIds.caseNull,
      body: {
        expected_updated_at: patientBefore.updated_at.toISOString(),
        care_case_id: null,
        expected_care_case_version: null,
        intake: { parking_available: true },
      },
      now: new Date('2026-07-22T00:05:00.000Z'),
    });

    expect(aResponse.status).toBe(200);
    const patientAfterA = await readPatient(patientIds.caseNull);
    const aPayload = await aResponse.json();
    expect(aPayload).toMatchObject({
      data: { id: patientIds.caseNull, updated_at: patientAfterA.updated_at.toISOString() },
      meta: { version_basis: expect.any(Object) },
    });
    expect(aPayload.meta.version_basis).toEqual({
      patient_updated_at: patientAfterA.updated_at.toISOString(),
      care_case_id: null,
      care_case_version: null,
    });
    const preferenceAfterA = await adminDb().patientSchedulePreference.findUniqueOrThrow({
      where: { patient_id: patientIds.caseNull },
      select: { parking_available: true, org_id: true },
    });
    expect(preferenceAfterA).toEqual({ parking_available: true, org_id: orgAId });
    const writesAfterA = await countPatientWrites(patientIds.caseNull);

    const bResponse = await executePatch({
      orgId: orgAId,
      patientId: patientIds.caseNull,
      body: {
        expected_updated_at: patientAfterA.updated_at.toISOString(),
        care_case_id: null,
        expected_care_case_version: null,
        intake: { primary_disease: 'must-not-write-without-case' },
      },
      now: new Date('2026-07-22T00:06:00.000Z'),
    });

    expect(bResponse.status).toBe(400);
    await expect(readPatient(patientIds.caseNull)).resolves.toEqual(patientAfterA);
    await expect(
      adminDb().patientSchedulePreference.findUniqueOrThrow({
        where: { patient_id: patientIds.caseNull },
        select: { parking_available: true, org_id: true },
      }),
    ).resolves.toEqual(preferenceAfterA);
    expect(await adminDb().careCase.count({ where: { patient_id: patientIds.caseNull } })).toBe(0);
    await expect(countPatientWrites(patientIds.caseNull)).resolves.toEqual(writesAfterA);
  });
});
