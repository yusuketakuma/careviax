import { describe, expect, it } from 'vitest';

import {
  deprecationCatalog,
  findDeprecationEntry,
  MINIMUM_MIGRATION_WINDOW_DAYS,
  type DeprecationEntry,
} from './deprecation-catalog';

describe('deprecationCatalog', () => {
  it('starts empty (Phase 14-5 is scaffolding only)', () => {
    expect(deprecationCatalog).toEqual([]);
  });
});

describe('MINIMUM_MIGRATION_WINDOW_DAYS', () => {
  it('grants internal CRUD API immediate deprecation (same-deploy)', () => {
    expect(MINIMUM_MIGRATION_WINDOW_DAYS.internal).toBe(0);
  });

  it('grants external-share new-issuance-only application (no forced window)', () => {
    expect(MINIMUM_MIGRATION_WINDOW_DAYS['external-share']).toBe(0);
  });

  it('requires at least 6 months (183 days) for webhook, mcs, and claims connectors', () => {
    expect(MINIMUM_MIGRATION_WINDOW_DAYS.webhook).toBeGreaterThanOrEqual(183);
    expect(MINIMUM_MIGRATION_WINDOW_DAYS.mcs).toBeGreaterThanOrEqual(183);
    expect(MINIMUM_MIGRATION_WINDOW_DAYS.claims).toBeGreaterThanOrEqual(183);
  });
});

describe('findDeprecationEntry', () => {
  const sampleEntry: DeprecationEntry = {
    routePath: '/api/patients/:id/legacy-summary',
    methods: ['GET'],
    connectorType: 'internal',
    deprecatedAt: '2026-07-01',
    sunsetDate: '2027-01-01',
    migrationGuideUrl: 'https://example.internal/docs/migrate-legacy-summary',
  };

  it('returns undefined when the catalog is empty', () => {
    expect(findDeprecationEntry('/api/patients/:id/legacy-summary')).toBeUndefined();
  });

  it('does not match a different routePath', () => {
    expect(findDeprecationEntry('/api/patients/:id/overview')).toBeUndefined();
  });

  // 以下は deprecationCatalog（module-level 配列）へ一時的にエントリを push/pop して
  // 実際の検索ロジックを検証する。catalog は現時点で常に空なので、この push/pop で
  // 他テストに副作用が漏れないよう afterEach 相当で必ず pop する。
  it('matches by routePath when no method filter is given', () => {
    deprecationCatalog.push(sampleEntry);
    try {
      expect(findDeprecationEntry('/api/patients/:id/legacy-summary')).toEqual(sampleEntry);
    } finally {
      deprecationCatalog.pop();
    }
  });

  it('matches by routePath + method when the entry restricts methods', () => {
    deprecationCatalog.push(sampleEntry);
    try {
      expect(findDeprecationEntry('/api/patients/:id/legacy-summary', 'GET')).toEqual(
        sampleEntry,
      );
      expect(findDeprecationEntry('/api/patients/:id/legacy-summary', 'POST')).toBeUndefined();
    } finally {
      deprecationCatalog.pop();
    }
  });
});
