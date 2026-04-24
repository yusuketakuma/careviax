import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_ADMIN_NAV_GROUPS } from '@/components/layout/navigation-config';
import { ADMIN_MASTER_READINESS_GROUPS, listAdminMasterReadinessHrefs } from './master-readiness';

describe('admin master readiness catalog', () => {
  it('covers the settings and master surfaces required for home-visit operations', () => {
    expect(ADMIN_MASTER_READINESS_GROUPS.map((group) => group.title)).toEqual([
      '薬局・運用設定',
      '訪問先・同時訪問マスター',
      '他職種連携マスター',
      '薬剤・調剤マスター',
      'スタッフ・請求・監査',
    ]);
    expect(listAdminMasterReadinessHrefs()).toEqual(
      expect.arrayContaining([
        '/admin/settings',
        '/admin/pharmacy-sites',
        '/admin/facilities',
        '/admin/external-professionals',
        '/admin/contact-profiles',
        '/admin/institutions',
        '/admin/formulary',
        '/admin/packaging-methods',
        '/admin/drug-masters',
        '/admin/alert-rules',
        '/admin/billing-rules',
        '/admin/document-templates',
      ]),
    );
  });

  it('only points to admin pages that are present in the sidebar admin navigation', () => {
    const sidebarAdminHrefs = new Set(
      SIDEBAR_ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)),
    );

    expect(listAdminMasterReadinessHrefs().filter((href) => !sidebarAdminHrefs.has(href))).toEqual([]);
  });

  it('only points to admin pages that exist in the app router', () => {
    const missingPages = listAdminMasterReadinessHrefs().filter((href) => {
      const relativePagePath = join(
        'src/app/(dashboard)',
        href.replace(/^\//, ''),
        'page.tsx',
      );
      return !existsSync(join(process.cwd(), relativePagePath));
    });

    expect(missingPages).toEqual([]);
  });
});
