import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-raw-read-org-guard.mjs');

function createFixtureRepo(files: Record<string, string>, allowlist: unknown = { entries: [] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-raw-read-org-guard-'));
  for (const dir of ['tools/scripts', 'src/app/api/example', 'src/server/services']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-raw-read-org-guard.mjs'));
  writeFileSync(
    path.join(root, 'tools/raw-read-org-guard-allowlist.json'),
    JSON.stringify(allowlist),
  );
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-raw-read-org-guard.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-raw-read-org-guard', () => {
  it('allows raw reads with an inline org_id filter', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const rows = await prisma.patient.findMany({
          where: { org_id: ctx.orgId },
          select: { id: true },
        });
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('accepts orgId camelCase filters as well as org_id', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await prisma.task.count({ where: { orgId: ctx.orgId } });
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('resolves org scope through a hoisted where variable', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const where = { org_id: ctx.orgId, patient_id: patientId };
        const records = await prisma.consentRecord.findMany({ where, take: 20 });
        const total = await prisma.consentRecord.count({ where });
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('resolves org scope through a spread of a base where variable', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const baseWhere = { org_id: ctx.orgId, site_id: site.id };
        const recentWhere = { ...baseWhere, drug_master: { yj_code: { in: codes } } };
        const rows = await prisma.pharmacyDrugStock.findMany({
          where: recentWhere,
          take: 10,
        });
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('resolves org scope when the whole args object is a variable', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        const args = { where: { org_id: orgId }, select: { id: true } };
        const rows = await prisma.patient.findMany(args);
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('ignores scoped tx reads (only the raw prisma client is checked)', () => {
    const root = createFixtureRepo({
      'src/server/services/example.ts': `
        await withOrgContext(orgId, async (tx) => {
          return tx.patient.findMany({ where: { id } });
        });
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('flags a read whose org_id token appears only in the select projection', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const rows = await prisma.visitRecord.findMany({
          where: { visit_date: range },
          select: { org_id: true, id: true },
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/missing_org_scope/);
  });

  it('flags a read whose org_id token appears only in a comment', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const rows = await prisma.patient.findMany({
          where: { site_id: siteId } /* org_id enforced elsewhere */,
          take: 20,
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/missing_org_scope/);
  });

  it('flags a read whose org_id token appears only in a comment inside where', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const rows = await prisma.patient.findMany({
          where: { site_id: siteId /* org_id later */ },
          take: 20,
        });
      `,
    });

    expect(() => runCheck(root)).toThrow(/missing_org_scope/);
  });

  it('rejects a raw read with no org filter', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const rows = await prisma.patient.findMany({ where: { name: q }, take: 20 });
      `,
    });

    expect(() => runCheck(root)).toThrow(/missing_org_scope/);
  });

  it('rejects a raw read whose where variable lacks org scope', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const where = { patient_id: patientId };
        const rows = await prisma.consentRecord.findMany({ where, take: 20 });
      `,
    });

    expect(() => runCheck(root)).toThrow(/missing_org_scope/);
  });

  it('flags reads whose args cannot be statically verified', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const rows = await prisma.drugMaster.count(buildCountArgs());
      `,
    });

    expect(() => runCheck(root)).toThrow(/unverifiable_org_scope/);
  });

  it('does not scan test files', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.test.ts': `
        const rows = await prisma.patient.findMany({ where: { name: q } });
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('only scans route.ts under src/app/api', () => {
    const root = createFixtureRepo({
      'src/app/api/example/helpers.ts': `
        const rows = await prisma.patient.findMany({ where: { name: q } });
      `,
    });

    expect(runCheck(root)).toContain('Raw read org-guard check passed');
  });

  it('allows current debt through the allowlist and fails stale entries', () => {
    const allowlist = {
      entries: [
        {
          path: 'src/app/api/example/route.ts',
          rule: 'missing_org_scope',
          owner: 'RLS-RAW-READ-GUARD-001',
          debtId: 'RAW-READ-ORG-001',
          reason: 'Global master table read, no org_id column.',
          plannedAction: 'No org filter applicable.',
          expectedCount: 1,
        },
      ],
    };
    const root = createFixtureRepo(
      {
        'src/app/api/example/route.ts': `
          const rows = await prisma.drugMaster.findMany({ where: { yj_code: yj } });
        `,
      },
      allowlist,
    );

    expect(runCheck(root)).toContain('0 new violations');

    const staleRoot = createFixtureRepo(
      {
        'src/app/api/example/route.ts': `
          const rows = await prisma.drugMaster.findMany({ where: { org_id: orgId } });
        `,
      },
      allowlist,
    );

    expect(() => runCheck(staleRoot)).toThrow(/expected 1, found 0/);
  });
});
