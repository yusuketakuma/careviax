import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  claimFirstVisitDocumentVersion,
  FirstVisitDocumentVersionConflictError,
} from './first-visit-document-version';

const databaseUrl = process.env.FIRST_VISIT_DOCUMENT_VERSION_DATABASE_URL;
const isSafeLocalE2eDatabase =
  !databaseUrl ||
  /^postgresql:\/\/[^@/]+@(?:localhost|127\.0\.0\.1|\[::1\]):5433\/ph_os_e2e(?:\?|$)/.test(
    databaseUrl,
  );

if (!isSafeLocalE2eDatabase) {
  throw new Error(
    'FIRST_VISIT_DOCUMENT_VERSION_DATABASE_URL must point to local ph_os_e2e on port 5433',
  );
}

const describeDatabase = databaseUrl ? describe : describe.skip;
const runId = `fvd_version_${randomUUID()}`;
const orgId = `${runId}_org`;
const patientId = `${runId}_patient`;
const caseId = `${runId}_case`;
const actorId = `${runId}_actor`;
const documentIds = [`${runId}_doc_a`, `${runId}_doc_b`];
let client: PrismaClient | null = null;

function db() {
  if (!client) throw new Error('integration database is not initialized');
  return client;
}

function asVersionClaims(documents: Array<{ id: string; updated_at: Date }>) {
  return documents.map((document) => ({ id: document.id, updatedAt: document.updated_at }));
}

async function resetDocuments() {
  await db().auditLog.deleteMany({ where: { org_id: orgId } });
  await db().firstVisitDocument.deleteMany({ where: { org_id: orgId } });
  await db().firstVisitDocument.createMany({
    data: documentIds.map((id) => ({
      id,
      org_id: orgId,
      patient_id: patientId,
      case_id: caseId,
      emergency_contacts: [],
    })),
  });
  return db().firstVisitDocument.findMany({
    where: { id: { in: documentIds }, org_id: orgId },
    orderBy: { id: 'asc' },
    select: { id: true, updated_at: true },
  });
}

async function claimOne(args: { documentId: string; expectedUpdatedAt: Date; action: string }) {
  return db().$transaction(
    async (tx) => {
      await claimFirstVisitDocumentVersion(tx, {
        id: args.documentId,
        orgId,
        expectedUpdatedAt: args.expectedUpdatedAt,
      });
      await tx.auditLog.create({
        data: {
          org_id: orgId,
          actor_id: actorId,
          action: args.action,
          target_type: 'first_visit_document',
          target_id: args.documentId,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function claimBatch(args: {
  documents: Array<{ id: string; updatedAt: Date }>;
  action: string;
  forceConflictId?: string;
}) {
  return db().$transaction(
    async (tx) => {
      const sorted = [...args.documents].sort((left, right) => left.id.localeCompare(right.id));
      for (const document of sorted) {
        await claimFirstVisitDocumentVersion(tx, {
          id: document.id,
          orgId,
          expectedUpdatedAt:
            document.id === args.forceConflictId
              ? new Date(document.updatedAt.getTime() - 1)
              : document.updatedAt,
        });
      }
      for (const document of sorted) {
        await tx.auditLog.create({
          data: {
            org_id: orgId,
            actor_id: actorId,
            action: args.action,
            target_type: 'first_visit_document',
            target_id: document.id,
          },
        });
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

describeDatabase('FirstVisitDocument version claims (PostgreSQL)', () => {
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    await db().organization.create({ data: { id: orgId, name: 'FVD version integration' } });
    await db().patient.create({
      data: {
        id: patientId,
        org_id: orgId,
        name: 'Version Test Patient',
        name_kana: 'バージョン テスト',
        birth_date: new Date('1950-01-01T00:00:00.000Z'),
        gender: 'other',
      },
    });
    await db().careCase.create({ data: { id: caseId, org_id: orgId, patient_id: patientId } });
  });

  afterAll(async () => {
    if (!client) return;
    try {
      await client.auditLog.deleteMany({ where: { org_id: orgId } });
      await client.firstVisitDocument.deleteMany({ where: { org_id: orgId } });
      await client.careCase.deleteMany({ where: { org_id: orgId } });
      await client.patient.deleteMany({ where: { org_id: orgId } });
      await client.organization.deleteMany({ where: { id: orgId } });
    } finally {
      await client.$disconnect();
    }
  });

  it.each([
    ['detail/detail', 'first_visit_document.detail_a', 'first_visit_document.detail_b'],
    ['PATCH/visit', 'first_visit_document.patched', 'first_visit_document.visit_saved'],
    ['print/visit', 'first_visit_document.printed', 'first_visit_document.visit_saved'],
  ])('allows only one exact-version winner for %s', async (_label, firstAction, secondAction) => {
    const [document] = await resetDocuments();
    const results = await Promise.allSettled([
      claimOne({
        documentId: document!.id,
        expectedUpdatedAt: document!.updated_at,
        action: firstAction,
      }),
      claimOne({
        documentId: document!.id,
        expectedUpdatedAt: document!.updated_at,
        action: secondAction,
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db().auditLog.count({ where: { org_id: orgId } })).toBe(1);
  });

  it('rolls back a detail claim when an overlapping batch wins', async () => {
    const documents = await resetDocuments();
    const target = documents[0]!;
    const results = await Promise.allSettled([
      claimOne({
        documentId: target.id,
        expectedUpdatedAt: target.updated_at,
        action: 'first_visit_document.patched',
      }),
      claimBatch({
        documents: asVersionClaims([target]),
        action: 'first_visit_document.printed',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db().auditLog.count({ where: { org_id: orgId } })).toBe(1);
  });

  it('uses deterministic id order for reverse-input overlapping batches without partial audits', async () => {
    const documents = await resetDocuments();
    const results = await Promise.allSettled([
      claimBatch({ documents: asVersionClaims(documents), action: 'first_visit_document.batch_a' }),
      claimBatch({
        documents: asVersionClaims([...documents].reverse()),
        action: 'first_visit_document.batch_b',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db().auditLog.count({ where: { org_id: orgId } })).toBe(2);
  });

  it('rolls back the first claim and writes zero audits when a later claim conflicts', async () => {
    const documents = await resetDocuments();
    const before = new Map(documents.map((document) => [document.id, document.updated_at]));

    await expect(
      claimBatch({
        documents: asVersionClaims(documents),
        action: 'first_visit_document.printed',
        forceConflictId: documents[1]!.id,
      }),
    ).rejects.toBeInstanceOf(FirstVisitDocumentVersionConflictError);

    const after = await db().firstVisitDocument.findMany({
      where: { id: { in: documentIds }, org_id: orgId },
      orderBy: { id: 'asc' },
      select: { id: true, updated_at: true },
    });
    expect(
      after.every(
        (document) => document.updated_at.getTime() === before.get(document.id)!.getTime(),
      ),
    ).toBe(true);
    expect(await db().auditLog.count({ where: { org_id: orgId } })).toBe(0);
  });

  it.each(['PATCH/visit', 'print/visit'])(
    'rolls back a visit-related sentinel write when %s loses the document claim',
    async () => {
      const [document] = await resetDocuments();
      const caseBefore = await db().careCase.findUniqueOrThrow({
        where: { id: caseId },
        select: { version: true },
      });

      await claimOne({
        documentId: document!.id,
        expectedUpdatedAt: document!.updated_at,
        action: 'first_visit_document.concurrent_winner',
      });

      let rejection: unknown;
      try {
        await db().$transaction(async (tx) => {
          await tx.careCase.update({
            where: { id: caseId },
            data: { version: { increment: 1 } },
          });
          await claimFirstVisitDocumentVersion(tx, {
            id: document!.id,
            orgId,
            expectedUpdatedAt: document!.updated_at,
          });
          await tx.auditLog.create({
            data: {
              org_id: orgId,
              actor_id: actorId,
              action: 'first_visit_document.visit_loser',
              target_type: 'first_visit_document',
              target_id: document!.id,
            },
          });
        });
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(FirstVisitDocumentVersionConflictError);
      await expect(
        db().careCase.findUniqueOrThrow({ where: { id: caseId }, select: { version: true } }),
      ).resolves.toEqual(caseBefore);
      expect(
        await db().auditLog.count({
          where: { org_id: orgId, action: 'first_visit_document.visit_loser' },
        }),
      ).toBe(0);
    },
  );

  it('rolls back claimed data and version when the audit insert fails', async () => {
    const [document] = await resetDocuments();
    const duplicateAuditId = `${runId}_duplicate_audit`;
    await db().auditLog.create({
      data: {
        id: duplicateAuditId,
        org_id: orgId,
        actor_id: actorId,
        action: 'first_visit_document.audit_seed',
        target_type: 'first_visit_document',
        target_id: document!.id,
      },
    });

    await expect(
      db().$transaction(async (tx) => {
        await claimFirstVisitDocumentVersion(tx, {
          id: document!.id,
          orgId,
          expectedUpdatedAt: document!.updated_at,
          data: { document_url: '/must-rollback' },
        });
        await tx.auditLog.create({
          data: {
            id: duplicateAuditId,
            org_id: orgId,
            actor_id: actorId,
            action: 'first_visit_document.audit_failure',
            target_type: 'first_visit_document',
            target_id: document!.id,
          },
        });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await expect(
      db().firstVisitDocument.findUniqueOrThrow({
        where: { id: document!.id },
        select: { document_url: true, updated_at: true },
      }),
    ).resolves.toEqual({ document_url: null, updated_at: document!.updated_at });
    expect(
      await db().auditLog.count({
        where: { org_id: orgId, action: 'first_visit_document.audit_failure' },
      }),
    ).toBe(0);
  });
});
