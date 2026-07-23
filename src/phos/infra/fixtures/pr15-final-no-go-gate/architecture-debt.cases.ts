import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  repoRoot,
  canonicalRoot,
  phosAppRoot,
  listFiles,
  readRelative,
  expectMissingFiles,
} from './test-support';

describe('PH-OS Final No-Go gate', () => {
  it('does not keep obsolete PH-OS deployment/status concepts after the Lambda route manifest change', () => {
    const forbiddenMarkers = [
      ['PHOS_IMPLEMENTED', '_API_ROUTES'].join(''),
      ['PhosApiRoute', 'Status'].join(''),
      ['route.', 'status'].join(''),
      ['status !== ', "'IMPLEMENTED'"].join(''),
      ['PLAN', 'NED'].join(''),
      ['Planned', 'View'].join(''),
    ];

    for (const file of listFiles(canonicalRoot)) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const marker of forbiddenMarkers) {
        expect(content, relativePath).not.toContain(marker);
      }
    }
  });

  it('does not keep unused helper exports left behind by PH-OS route/client consolidation', () => {
    const obsoleteSymbols = [
      ['PhosApiError', 'Status'].join(''),
      ['handoffUrgency', 'Rank'].join(''),
      ['assigneeGsi', 'Sk'].join(''),
      ['patientGsi', 'Sk'].join(''),
      ['PhosTag', 'Label'].join(''),
    ];

    for (const file of listFiles(canonicalRoot)) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const symbol of obsoleteSymbols) {
        expect(content, relativePath).not.toContain(symbol);
      }
    }
  });

  it('keeps PH-OS UI and app code isolated from legacy Next API route calls', () => {
    const forbiddenApiPatterns = [/fetch\(\s*['"]\/api\//, /baseUrl:\s*['"]\/api/];

    for (const root of [join(canonicalRoot, 'ui'), phosAppRoot]) {
      for (const file of listFiles(root)) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        for (const pattern of forbiddenApiPatterns) {
          expect(content, relativePath).not.toMatch(pattern);
        }
      }
    }

    expectMissingFiles([
      'src/app/(phos)/board/page.tsx',
      'src/app/(phos)/capacity/page.tsx',
      'src/app/(phos)/handoffs/page.tsx',
      'src/app/(phos)/visit/[packetId]/page.tsx',
    ]);
  });

  it('keeps PH-OS app, UI, and API client code away from server-side business data access', () => {
    const clientBoundaryRoots = [
      join(canonicalRoot, 'api'),
      join(canonicalRoot, 'ui'),
      phosAppRoot,
    ];
    const forbiddenServerSideAccessPatterns = [
      /from ['"]@\/phos\/backend(?:\/|['"])/,
      /from ['"]@\/lib\/db(?:\/|['"])/,
      /from ['"]@aws-sdk\//,
      /from ['"]@prisma\/client['"]/,
      /import\(\s*['"]@\/phos\/backend(?:\/|['"])/,
      /import\(\s*['"]@\/lib\/db(?:\/|['"])/,
      /import\(\s*['"]@aws-sdk\//,
      /import\(\s*['"]@prisma\/client['"]\s*\)/,
      /require\(\s*['"]@\/phos\/backend(?:\/|['"])/,
      /require\(\s*['"]@\/lib\/db(?:\/|['"])/,
      /require\(\s*['"]@aws-sdk\//,
      /require\(\s*['"]@prisma\/client['"]\s*\)/,
      /\bprisma\./,
      /\bnew\s+PrismaClient\b/,
      /\b(?:S3Client|DynamoDBClient|DynamoDBDocumentClient)\b/,
      /\bprocess\.env\.PHOS_[A-Z0-9_]+\b/,
      /\bprocess\.env\.DATABASE_URL\b/,
      /['"]use server['"]/,
    ];

    for (const root of clientBoundaryRoots) {
      for (const file of listFiles(root).filter((path) => /\.(?:ts|tsx)$/.test(path))) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        for (const pattern of forbiddenServerSideAccessPatterns) {
          expect(content, relativePath).not.toMatch(pattern);
        }
      }
    }
  });

  it('keeps final no-go UI logic outside presentation components', () => {
    const uiFiles = listFiles(join(canonicalRoot, 'ui')).filter((file) => file.endsWith('.tsx'));
    const forbiddenLogicPatterns = [
      /ACTION_TRANSITION_MATRIX/,
      /assertRouteAccess/,
      /client_version\s*[+<>=-]/,
      /blocking_unsynced_count\s*[<>=]/,
      /applicable_steps\s*=\s*\[/,
    ];

    for (const file of uiFiles) {
      const relativePath = relative(repoRoot, file);
      const content = readFileSync(file, 'utf8');
      for (const pattern of forbiddenLogicPatterns) {
        expect(content, relativePath).not.toMatch(pattern);
      }
    }
  });

  it('keeps PH-OS feedback colors on design tokens instead of direct Tailwind color classes', () => {
    const feedbackClassPattern =
      /\b(?:border|bg|text)-(?:red|amber|emerald|sky)(?:-\d{2,3})?(?:\/\d{2,3})?\b/;

    for (const root of [join(canonicalRoot, 'ui'), phosAppRoot]) {
      for (const file of listFiles(root).filter((path) => path.endsWith('.tsx'))) {
        const relativePath = relative(repoRoot, file);
        const content = readFileSync(file, 'utf8');
        expect(content, relativePath).not.toMatch(feedbackClassPattern);
      }
    }
  });

  it('keeps refactoring debt and legacy API isolation documented for PR review', () => {
    const doc = readRelative('docs/phos-legacy-api-isolation.md');

    expect(doc).toContain('PH-OS v1.1 business APIs');
    expect(doc).toContain('Current Legacy Next API Debt');
    expect(doc).toContain('/api/handoff-board');
    expect(doc).toContain('/api/care-reports');
    expect(doc).toContain('/api/billing-candidates');
  });
});
