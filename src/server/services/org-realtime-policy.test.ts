import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const ALLOWED_REALTIME_ADAPTER_USERS = new Map([
  ['src/app/api/notifications/stream/route.ts', 'org/user subscriber with SSE sanitizer'],
  ['src/app/api/presence/route.ts', 'presence channel publisher'],
  ['src/server/adapters/realtime/in-memory-adapter.ts', 'adapter implementation'],
  ['src/server/adapters/realtime/index.ts', 'adapter factory'],
  ['src/server/adapters/realtime/redis-adapter.ts', 'adapter implementation'],
  ['src/server/services/org-realtime.ts', 'central sanitized org publisher'],
]);

const ORG_CHANNEL_PATTERN = /(?:`org:\$\{[^`]+`|["']org:[^"']*["'])/;
const ORG_CHANNEL_CONSTRUCTION_PATTERNS = [
  /`org:/,
  /["']org:/,
  /buildOrgRealtimeChannel/,
  /\[\s*["']org["']\s*,[\s\S]{0,120}\]\.join\(\s*["']:["']\s*\)/,
];

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.next' ||
        entry.name === '__snapshots__'
      ) {
        return [];
      }
      return listSourceFiles(absolutePath);
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return [];
    return [absolutePath];
  });
}

function toRepoPath(filePath: string) {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

describe('org realtime publisher policy', () => {
  it('keeps realtime adapter usage behind reviewed helpers and subscribers', () => {
    const violations = listSourceFiles(path.join(process.cwd(), 'src'))
      .map((filePath) => {
        const repoPath = toRepoPath(filePath);
        const source = readFileSync(filePath, 'utf8');
        const usesRealtimeAdapter =
          source.includes('getRealtimeAdapter') ||
          source.includes('@/server/adapters/realtime') ||
          source.includes('broadcastStatusUpdate');

        if (!usesRealtimeAdapter || ALLOWED_REALTIME_ADAPTER_USERS.has(repoPath)) return null;
        return `${repoPath}: use broadcastOrgRealtimeEvent for org-wide events; add a reviewed exception for non-org realtime channels.`;
      })
      .filter(Boolean);

    expect(violations).toEqual([]);
  });

  it('does not allow raw org:* publish calls outside the central helper', () => {
    const violations = listSourceFiles(path.join(process.cwd(), 'src'))
      .map((filePath) => {
        const repoPath = toRepoPath(filePath);
        const source = readFileSync(filePath, 'utf8');
        if (repoPath === 'src/server/services/org-realtime.ts') return null;
        if (!source.includes('broadcastStatusUpdate') || !ORG_CHANNEL_PATTERN.test(source)) {
          return null;
        }
        return `${repoPath}: raw org:* broadcastStatusUpdate is forbidden; use broadcastOrgRealtimeEvent.`;
      })
      .filter(Boolean);

    expect(violations).toEqual([]);
  });

  it('keeps allowed direct realtime adapter users constrained to reviewed channel families', () => {
    const presenceSource = readFileSync('src/app/api/presence/route.ts', 'utf8');
    const presenceViolations = [
      presenceSource.includes('broadcastOrgRealtimeEvent')
        ? 'presence route must not publish org-wide events through broadcastOrgRealtimeEvent'
        : null,
      presenceSource.includes('buildOrgRealtimeChannel')
        ? 'presence route must not build org-wide realtime channels'
        : null,
      ORG_CHANNEL_PATTERN.test(presenceSource)
        ? 'presence route must not contain raw org:* channels'
        : null,
      !presenceSource.includes('const channel = `presence:${room}`;')
        ? 'presence route must publish only the reviewed presence:${room} channel'
        : null,
    ].filter(Boolean);

    expect(presenceViolations).toEqual([]);
  });

  it('keeps org channel construction inside the central org realtime helper or stream subscriber', () => {
    const allowedOrgChannelFiles = new Set([
      'src/app/api/notifications/stream/route.ts',
      'src/server/services/org-realtime.ts',
    ]);
    const violations = listSourceFiles(path.join(process.cwd(), 'src'))
      .map((filePath) => {
        const repoPath = toRepoPath(filePath);
        if (allowedOrgChannelFiles.has(repoPath)) return null;
        const source = readFileSync(filePath, 'utf8');
        if (!ORG_CHANNEL_CONSTRUCTION_PATTERNS.some((pattern) => pattern.test(source))) return null;
        return `${repoPath}: org channel construction must stay in org-realtime.ts or the stream subscriber.`;
      })
      .filter(Boolean);

    expect(violations).toEqual([]);
  });
});
