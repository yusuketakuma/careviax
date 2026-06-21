import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MemberRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { hasPermission, type PermissionKey } from '@/lib/auth/permissions';
import {
  STATISTICS_CATEGORIES,
  STATISTICS_RECON_PROVENANCE,
  STATISTICS_SURFACES,
  canEnterStatisticsHub,
  filterStatisticsSurfaces,
  type StatisticsCategory,
} from './statistics-surfaces';

const canFor = (role: MemberRole) => (permission: PermissionKey) => hasPermission(role, permission);

// The single frozen source of the navigable manifest. Each requiredPermission is matched to the
// destination's actual server/API permission (or a documented stricter access-minimization choice).
// A same-category route swap OR a permission drift weaker/stronger than this list fails the contract.
const EXPECTED_MANIFEST: Array<{
  id: string;
  href: string;
  category: StatisticsCategory;
  requiredPermission: PermissionKey;
}> = [
  {
    id: 'management-metrics',
    href: '/admin/metrics',
    category: '経営',
    requiredPermission: 'canAdmin',
  },
  {
    id: 'billing-analytics',
    href: '/admin/analytics',
    category: '請求',
    requiredPermission: 'canManageBilling',
  },
  {
    id: 'billing-check',
    href: '/billing',
    category: '請求',
    requiredPermission: 'canManageBilling',
  },
  {
    id: 'operations-insights',
    href: '/admin/operations-insights',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  { id: 'capacity', href: '/admin/capacity', category: '運用', requiredPermission: 'canAdmin' },
  {
    id: 'performance',
    href: '/admin/performance',
    category: '運用',
    requiredPermission: 'canAdmin',
  },
  { id: 'realtime', href: '/admin/realtime', category: '運用', requiredPermission: 'canAdmin' },
  { id: 'master-hub', href: '/admin', category: '運用', requiredPermission: 'canAdmin' },
  { id: 'cockpit', href: '/dashboard', category: '運用', requiredPermission: 'canViewDashboard' },
  { id: 'pilot-readiness', href: '/admin/uat', category: '運用', requiredPermission: 'canAdmin' },
  {
    id: 'clerk-support',
    href: '/clerk-support',
    category: '運用',
    requiredPermission: 'canViewDashboard',
  },
  {
    id: 'workflow-outcomes',
    href: '/workflow',
    category: '運用',
    requiredPermission: 'canViewDashboard',
  },
  { id: 'schedule-metrics', href: '/schedules', category: '運用', requiredPermission: 'canVisit' },
  {
    id: 'intake-triage',
    href: '/prescriptions/intake',
    category: '運用',
    requiredPermission: 'canViewDashboard',
  },
  { id: 'job-monitoring', href: '/admin/jobs', category: '運用', requiredPermission: 'canAdmin' },
  {
    id: 'inventory-forecast',
    href: '/admin/inventory-forecast',
    category: '在庫',
    requiredPermission: 'canAdmin',
  },
  { id: 'staff-workload', href: '/tasks', category: '人員', requiredPermission: 'canVisit' },
  {
    id: 'dispense-audit-stats',
    href: '/admin/dispense-audit-stats',
    category: '品質',
    requiredPermission: 'canAdmin',
  },
  { id: 'incidents', href: '/admin/incidents', category: '品質', requiredPermission: 'canAdmin' },
  {
    id: 'report-delivery',
    href: '/reports/analytics',
    category: '連携',
    requiredPermission: 'canSendCareReport',
  },
  {
    id: 'audit-logs',
    href: '/admin/audit-logs',
    category: 'コンプライアンス',
    requiredPermission: 'canAdmin',
  },
  { id: 'patients-board', href: '/patients', category: '患者', requiredPermission: 'canVisit' },
  { id: 'visit-preparation', href: '/visits', category: '患者', requiredPermission: 'canVisit' },
];

describe('statistics surface registry', () => {
  it('has a unique id for every surface', () => {
    const ids = STATISTICS_SURFACES.map((surface) => surface.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses internal hrefs only (no external links)', () => {
    for (const surface of STATISTICS_SURFACES) {
      expect(surface.href.startsWith('/')).toBe(true);
      expect(surface.href).not.toMatch(/^https?:\/\//);
    }
  });

  it('assigns a valid category to every surface', () => {
    const valid = new Set<StatisticsCategory>(STATISTICS_CATEGORIES);
    for (const surface of STATISTICS_SURFACES) {
      expect(valid.has(surface.category)).toBe(true);
    }
  });

  it('covers every category (no empty category)', () => {
    for (const category of STATISTICS_CATEGORIES) {
      const count = STATISTICS_SURFACES.filter((surface) => surface.category === category).length;
      expect(count).toBeGreaterThan(0);
    }
  });

  it('points every href at an existing dashboard route', () => {
    for (const surface of STATISTICS_SURFACES) {
      const base = join(process.cwd(), 'src/app/(dashboard)', surface.href);
      const exists = existsSync(join(base, 'page.tsx')) || existsSync(join(base, 'page.ts'));
      expect(exists, `missing route page for ${surface.href}`).toBe(true);
    }
  });

  // --- contract: freeze the manifest so omissions are caught (not just self-consistency) ---

  it('freezes the manifest at exactly 23 navigable surfaces', () => {
    expect(STATISTICS_SURFACES.length).toBe(23);
  });

  it('matches the expected per-category counts (exact coverage)', () => {
    const expected: Record<StatisticsCategory, number> = {
      経営: 1,
      請求: 2,
      運用: 12,
      在庫: 1,
      人員: 1,
      品質: 2,
      連携: 1,
      コンプライアンス: 1,
      患者: 2,
    };
    for (const category of STATISTICS_CATEGORIES) {
      const count = STATISTICS_SURFACES.filter((surface) => surface.category === category).length;
      expect(count, category).toBe(expected[category]);
    }
  });

  it('includes the /admin/jobs monitoring surface', () => {
    expect(STATISTICS_SURFACES.some((surface) => surface.href === '/admin/jobs')).toBe(true);
  });

  it('reconciles the raw 64 recon items to the 23-page manifest', () => {
    const excludedTotal = STATISTICS_RECON_PROVENANCE.excluded.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    expect(STATISTICS_RECON_PROVENANCE.navigable_pages).toBe(STATISTICS_SURFACES.length);
    expect(STATISTICS_RECON_PROVENANCE.navigable_pages + excludedTotal).toBe(
      STATISTICS_RECON_PROVENANCE.raw_recon_items,
    );
    expect(STATISTICS_RECON_PROVENANCE.raw_recon_items).toBe(64);
  });

  // --- exact frozen manifest: catches same-category route swaps AND permission drift ---

  it('freezes the exact 23-entry {id, href, category, requiredPermission} manifest', () => {
    const actual = STATISTICS_SURFACES.map((surface) => ({
      id: surface.id,
      href: surface.href,
      category: surface.category,
      requiredPermission: surface.requiredPermission,
    }));
    expect(actual).toEqual(EXPECTED_MANIFEST);
  });

  it('freezes the exact reconciliation provenance {kind, count} entries', () => {
    const actual = STATISTICS_RECON_PROVENANCE.excluded.map((entry) => ({
      kind: entry.kind,
      count: entry.count,
    }));
    expect(actual).toEqual([
      { kind: 'api-endpoint', count: 22 },
      { kind: 'nav-alias', count: 8 },
      { kind: 'embedded-widget-absorbed', count: 11 },
    ]);
  });
});

describe('statistics hub access by role', () => {
  it('lets dashboard-permitted roles enter, and admins see every card', () => {
    expect(canEnterStatisticsHub(canFor(MemberRole.admin))).toBe(true);
    expect(filterStatisticsSurfaces(STATISTICS_SURFACES, canFor(MemberRole.admin))).toHaveLength(
      23,
    );
  });

  it('forbids driver / external_viewer (no dashboard permission, no cards)', () => {
    for (const role of [MemberRole.driver, MemberRole.external_viewer]) {
      expect(canEnterStatisticsHub(canFor(role))).toBe(false);
      // no card may exceed their (empty statistics) permissions
      expect(filterStatisticsSurfaces(STATISTICS_SURFACES, canFor(role))).toHaveLength(0);
    }
  });

  it('lets clerk see exactly the canViewDashboard cards (incl. its clerk-oriented destination)', () => {
    const can = canFor(MemberRole.clerk);
    expect(canEnterStatisticsHub(can)).toBe(true);
    const visible = filterStatisticsSurfaces(STATISTICS_SURFACES, can);

    // clerk (canViewDashboard:true, canVisit:false) sees exactly the canViewDashboard destinations —
    // including /clerk-support, the clerk-oriented tool that must NOT be hidden behind canVisit.
    expect(visible.map((surface) => surface.href).sort()).toEqual(
      ['/clerk-support', '/dashboard', '/prescriptions/intake', '/workflow'].sort(),
    );
    expect(visible.every((surface) => surface.requiredPermission === 'canViewDashboard')).toBe(
      true,
    );
    // and none of the admin / billing / visit-only / care-report cards
    expect(visible.some((surface) => surface.requiredPermission === 'canAdmin')).toBe(false);
    expect(visible.some((surface) => surface.requiredPermission === 'canManageBilling')).toBe(
      false,
    );
    expect(visible.some((surface) => surface.requiredPermission === 'canVisit')).toBe(false);
    expect(visible.some((surface) => surface.requiredPermission === 'canSendCareReport')).toBe(
      false,
    );
  });

  it('hides the report-delivery card from pharmacist_trainee (canVisit but not canSendCareReport)', () => {
    const can = canFor(MemberRole.pharmacist_trainee);
    expect(canEnterStatisticsHub(can)).toBe(true);
    const visible = filterStatisticsSurfaces(STATISTICS_SURFACES, can);

    // report-delivery's destination requires canSendCareReport; a trainee (canVisit:true,
    // canSendCareReport:false) can reach visit cards but must NOT see the report-delivery card.
    expect(visible.some((surface) => surface.href === '/reports/analytics')).toBe(false);
    expect(visible.some((surface) => surface.href === '/patients')).toBe(true);
    // no card the trainee lacks permission for
    expect(visible.every((surface) => can(surface.requiredPermission))).toBe(true);
  });
});
