import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const protectedRoutes = [
  ['patients/check-duplicate/route.ts', 1],
  ['patients/[id]/overview/route.ts', 1],
  ['dispense-tasks/[id]/route.ts', 1],
  ['admin/capacity/route.ts', 1],
  ['admin/data-explorer/[table]/route.ts', 1],
  ['admin/data-explorer/models/route.ts', 1],
  ['management-plans/[id]/route.ts', 1],
  ['qr-scan-drafts/route.ts', 2],
  ['qr-scan-drafts/[id]/route.ts', 2],
  ['medication-sets/workspace/route.ts', 1],
] as const;

describe('API route Next.js control-flow protection', () => {
  it.each(protectedRoutes)(
    '%s rethrows framework control-flow errors before its internal-error fallback',
    (routePath, expectedProtectedCatchCount) => {
      const source = readFileSync(path.join(process.cwd(), 'src/app/api', routePath), 'utf8');
      const protectedCatchPattern =
        /catch \((\w+)\) \{\s*unstable_rethrow\(\1\);\s*return withSensitiveNoStore\(internalError\(\)\);/g;

      expect(source).toContain("import { unstable_rethrow } from 'next/navigation';");
      expect(source.match(/internalError\(\)/g)).toHaveLength(expectedProtectedCatchCount);
      expect([...source.matchAll(protectedCatchPattern)]).toHaveLength(expectedProtectedCatchCount);
    },
  );
});
