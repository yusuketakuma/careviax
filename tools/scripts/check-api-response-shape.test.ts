import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-api-response-shape.mjs');

function createFixtureRepo(files: Record<string, string>, allowlist: unknown = { entries: [] }) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-api-response-'));
  for (const dir of ['tools/scripts', 'src/app/api/example']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-api-response-shape.mjs'));
  writeFileSync(
    path.join(root, 'tools/api-response-shape-allowlist.json'),
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
  return execFileSync(process.execPath, ['tools/scripts/check-api-response-shape.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-api-response-shape', () => {
  it('allows success responses wrapped in data', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return success({ data: serializePatient(patient), meta: { generated_at: now } });
      `,
    });

    expect(runCheck(root)).toContain('API response shape check passed');
  });

  it('allows success responses using data shorthand', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const data = serializePatient(patient);
        return success({ data, meta: { generated_at: now } });
      `,
    });

    expect(runCheck(root)).toContain('API response shape check passed');
  });

  it('allows success responses using bare data shorthand', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const data = serializePatient(patient);
        return success({ data });
      `,
    });

    expect(runCheck(root)).toContain('API response shape check passed');
  });

  it('allows measured success responses with exact data and meta keys', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return successWithMeasuredJsonPayload({ data: rows, meta: { returned_count: rows.length } });
      `,
    });

    expect(runCheck(root)).toContain('API response shape check passed');
  });

  it('rejects direct success payloads', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return success(patient);
      `,
    });

    expect(() => runCheck(root)).toThrow(/success\(\) response is not wrapped/);
  });

  it('rejects non-envelope object success payloads', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return success({ patient, generated_at: now });
      `,
    });

    expect(() => runCheck(root)).toThrow(/success\(\) response is not wrapped/);
  });

  it('rejects root keys outside data and meta', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return success({ data: rows, warnings: ['legacy-root-field'] });
      `,
    });

    expect(() => runCheck(root)).toThrow(/non-envelope root keys: warnings/);
  });

  it('rejects top-level spreads because the exact envelope cannot be proven', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return success({ data: rows, ...legacyMetadata });
      `,
    });

    expect(() => runCheck(root)).toThrow(/non-envelope root keys: <spread>/);
  });

  it('rejects variable measured payloads because their exact envelope is not static', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        const payload = buildTimelinePayload();
        return successWithMeasuredJsonPayload(payload);
      `,
    });

    expect(() => runCheck(root)).toThrow(
      /successWithMeasuredJsonPayload\(\) response is not a static/,
    );
  });

  it('rejects route-local legacy error JSON shapes', () => {
    const root = createFixtureRepo({
      'src/app/api/example/route.ts': `
        return NextResponse.json({ code: 'BAD', message: 'Bad request' }, { status: 400 });
      `,
    });

    expect(() => runCheck(root)).toThrow(/route-local error response/);
  });

  it('allows current debt through the allowlist and fails stale entries', () => {
    const allowlist = {
      entries: [
        {
          path: 'src/app/api/example/route.ts',
          expectedCount: 1,
          owner: 'API-CONTRACT-001',
          debtId: 'API-RESPONSE-SHAPE-001',
          reason: 'Existing route still returns a legacy response shape.',
          plannedAction: 'Move response to ApiSuccess/ApiError envelope.',
        },
      ],
    };
    const root = createFixtureRepo(
      {
        'src/app/api/example/route.ts': `
          return success(patient);
        `,
      },
      allowlist,
    );

    expect(runCheck(root)).toContain('0 new violations');

    const staleRoot = createFixtureRepo(
      {
        'src/app/api/example/route.ts': `
          return success({ data: serializePatient(patient) });
        `,
      },
      allowlist,
    );

    expect(() => runCheck(staleRoot)).toThrow(/expected 1, found 0/);
  });
});
