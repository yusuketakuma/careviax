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
});
