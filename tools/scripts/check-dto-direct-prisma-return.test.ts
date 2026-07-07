import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-dto-direct-prisma-return.mjs');

function createFixtureRepo(files: Record<string, string>, allowlist: unknown = { entries: [] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-dto-prisma-'));
  for (const dir of ['tools/scripts', 'src/app/api/example']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-dto-direct-prisma-return.mjs'));
  writeFileSync(
    path.join(root, 'tools/dto-direct-prisma-return-allowlist.json'),
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
  return execFileSync(process.execPath, ['tools/scripts/check-dto-direct-prisma-return.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-dto-direct-prisma-return', () => {
  it('allows serialized DTO responses', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const patient = await prisma.patient.findFirst({ select: { id: true } });
        return success({ data: serializePatient(patient) });
      `,
    });

    expect(runCheck(root)).toContain('DTO direct Prisma return check passed');
  });

  it('rejects direct Prisma result variables returned through success', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const patient = await prisma.patient.findFirst({ select: { id: true, name: true } });
        return success(patient);
      `,
    });

    expect(() => runCheck(root)).toThrow(/patient/);
  });

  it('rejects top-level data wrappers around direct Prisma result variables', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const updated = await tx.patient.update({ data: {}, where: { id } });
        return success({ data: updated });
      `,
    });

    expect(() => runCheck(root)).toThrow(/updated/);
  });

  it('rejects inline awaited Prisma delegates inside success', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return success({ data: await db.patient.findMany({}) });
      `,
    });

    expect(() => runCheck(root)).toThrow(/await prisma delegate/);
  });

  it('allows current debt through the allowlist and fails stale entries', () => {
    const allowlist = {
      entries: [
        {
          path: 'src/app/api/example/route.ts',
          expectedCount: 1,
          owner: 'API-DTO-001',
          debtId: 'DTO-DIRECT-001',
          reason: 'Existing route still returns a Prisma row directly.',
          plannedAction: 'Move response through a presenter.',
        },
      ],
    };
    const root = createFixtureRepo(
      {
        'src/app/api/example/route.ts': `
          const patient = await prisma.patient.findFirst({});
          return success(patient);
        `,
      },
      allowlist,
    );

    expect(runCheck(root)).toContain('0 new violations');

    const staleRoot = createFixtureRepo(
      {
        'src/app/api/example/route.ts': `
          const patient = await prisma.patient.findFirst({});
          return success({ data: serializePatient(patient) });
        `,
      },
      allowlist,
    );

    expect(() => runCheck(staleRoot)).toThrow(/expected 1, found 0/);
  });
});
