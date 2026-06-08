import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const canonicalRoot = join(process.cwd(), 'src/phos');
const phosAppRoot = join(process.cwd(), 'src/app/(phos)');

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function productionFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return listFiles(root).filter(
    (file) =>
      !file.endsWith('.test.ts') &&
      !file.endsWith('.test.tsx') &&
      !file.endsWith('src/phos/contracts/phos_contracts.ts'),
  );
}

describe('PH-OS static contract checks', () => {
  it('does not contain the prohibited double-L cancellation spelling in canonical PH-OS files', () => {
    const prohibitedCanceledSpelling = ['CANCEL', 'LED'].join('');

    for (const file of listFiles(canonicalRoot)) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(prohibitedCanceledSpelling);
    }
  });

  it('does not introduce a forbidden disabled property in canonical PH-OS files', () => {
    const forbiddenProp = /(^|[,{]\s*)disabled\??\s*:/m;

    for (const file of listFiles(canonicalRoot)) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toMatch(forbiddenProp);
    }
  });

  it('does not call Next.js API routes from PH-OS UI or app files', () => {
    const roots = [join(canonicalRoot, 'ui'), phosAppRoot].filter((root) => existsSync(root));
    const forbiddenApiPatterns = [
      /fetch\(\s*['"]\/api\//,
      /['"]\/api\/phos/,
      /baseUrl:\s*['"]\/api/,
    ];

    for (const root of roots) {
      for (const file of listFiles(root)) {
        const content = readFileSync(file, 'utf8');
        for (const pattern of forbiddenApiPatterns) {
          expect(content, file).not.toMatch(pattern);
        }
      }
    }
  });

  it('does not import legacy dashboard offline sync stores from canonical PH-OS files', () => {
    const forbiddenLegacyOfflineImports = [
      /@\/lib\/stores\/sync-engine/,
      /@\/lib\/stores\/offline-store/,
      /@\/lib\/stores\/offline-db/,
    ];

    for (const file of listFiles(canonicalRoot)) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenLegacyOfflineImports) {
        expect(content, file).not.toMatch(pattern);
      }
    }
  });

  it('keeps SourceRef kind enum literals centralized in phos_contracts.ts', () => {
    const sourceRefKindLiterals = [
      ['PRESCRIPTION'].join(''),
      ['PREVIOUS', '_VISIT'].join(''),
      ['MEDICATION', '_HISTORY'].join(''),
      ['OTHER', '_PRO', '_MESSAGE'].join(''),
      ['RULE', '_DOCUMENT'].join(''),
      ['EVIDENCE', '_FILE'].join(''),
      ['CARE', '_PLAN'].join(''),
    ];

    for (const file of [...productionFiles(canonicalRoot), ...productionFiles(phosAppRoot)]) {
      const content = readFileSync(file, 'utf8');
      for (const literal of sourceRefKindLiterals) {
        expect(content, file).not.toMatch(new RegExp(`['"]${literal}['"]`));
      }
    }
  });

  it('keeps claim and handoff status enum literals centralized in phos_contracts.ts', () => {
    const statusLiterals = [
      ['APPROVED'].join(''),
      ['EXCLUDED'].join(''),
      ['MISSING', '_EVIDENCE'].join(''),
      ['OPEN'].join(''),
      ['IN', '_REVIEW'].join(''),
      ['RESOLVED'].join(''),
      ['RETURNED'].join(''),
    ];

    for (const file of [...productionFiles(canonicalRoot), ...productionFiles(phosAppRoot)]) {
      const content = readFileSync(file, 'utf8');
      for (const literal of statusLiterals) {
        expect(content, file).not.toMatch(new RegExp(`['"]${literal}['"]`));
      }
    }
  });

  it('does not import dashboard org-scoped RLS helpers from canonical PH-OS backend files', () => {
    const backendRoot = join(canonicalRoot, 'backend');
    const forbiddenDashboardRlsImports = [/@\/lib\/db\/rls/, /from ['"].*\/lib\/db\/rls['"]/];

    for (const file of listFiles(backendRoot)) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenDashboardRlsImports) {
        expect(content, file).not.toMatch(pattern);
      }
    }
  });

  it('keeps PH-OS handler RBAC checks routed through the API Gateway manifest policy', () => {
    const backendRoot = join(canonicalRoot, 'backend');
    const handlerFiles = listFiles(backendRoot).filter((file) => file.endsWith('-handlers.ts'));
    const forbiddenDirectAuthorizationHelpers = [
      new RegExp(['assertRequired', 'Scopes'].join('')),
      new RegExp(['assertAllowed', 'Role'].join('')),
    ];

    for (const file of handlerFiles) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenDirectAuthorizationHelpers) {
        expect(content, file).not.toMatch(pattern);
      }
      expect(content, file).toMatch(/assertRouteAccess/);
    }
  });
});
