import { describe, expect, it } from 'vitest';
import {
  deriveShellViewport,
  resolveQuickCreateTarget,
  resolveSidebarSheetOpen,
  shouldUseMinimalShell,
  shouldRenderCompactSidebarSheet,
} from './app-shell';

describe('resolveQuickCreateTarget', () => {
  it('keeps real create routes for primary modules', () => {
    expect(resolveQuickCreateTarget('/patients')).toEqual({ href: '/patients/new' });
    expect(resolveQuickCreateTarget('/prescriptions')).toEqual({ href: '/prescriptions/new' });
  });

  it('avoids dead routes for reports and schedules', () => {
    expect(resolveQuickCreateTarget('/reports')).toEqual({
      href: '/reports',
      notice: '報告書は一覧から対象記録を選択して開始します',
    });
    expect(resolveQuickCreateTarget('/schedules')).toEqual({
      href: '/schedules#planner',
      notice: 'スケジュールは一覧画面の新規予定エリアを開きます',
    });
  });

  it('falls back to patient creation when a module has no dedicated create screen', () => {
    expect(resolveQuickCreateTarget('/workflow')).toEqual({
      href: '/patients/new',
      notice: 'この画面には専用の新規作成先がないため、患者新規登録を開きます',
    });
  });
});

describe('resolveSidebarSheetOpen', () => {
  it('keeps the mobile sidebar sheet closed on desktop even when sidebar state is open', () => {
    expect(resolveSidebarSheetOpen(false, true)).toBe(false);
  });

  it('allows the sheet only for compact viewports when the sidebar is open', () => {
    expect(resolveSidebarSheetOpen(true, true)).toBe(true);
    expect(resolveSidebarSheetOpen(true, false)).toBe(false);
  });
});

describe('shouldUseMinimalShell', () => {
  it('switches print routes to the minimal shell', () => {
    expect(shouldUseMinimalShell('/reports/report_1/print')).toBe(true);
    expect(shouldUseMinimalShell('/patients/p1/medications/print')).toBe(true);
  });

  it('keeps normal workflow routes on the full shell', () => {
    expect(shouldUseMinimalShell('/reports/report_1')).toBe(false);
    expect(shouldUseMinimalShell('/patients/p1')).toBe(false);
  });
});

describe('deriveShellViewport', () => {
  it('flags resolved desktop viewports as ready and non-compact', () => {
    const viewport = deriveShellViewport({
      matchMedia: (query) =>
        ({
          matches: query === '(min-width: 1280px)',
        }) as MediaQueryList,
    });

    expect(viewport).toEqual({
      isReady: true,
      isDesktopLayout: true,
      isTabletLayout: false,
      isCompactLayout: false,
    });
  });
});

describe('shouldRenderCompactSidebarSheet', () => {
  it('keeps the compact sheet unmounted until viewport hydration completes', () => {
    expect(
      shouldRenderCompactSidebarSheet({
        isReady: false,
        isDesktopLayout: false,
        isTabletLayout: false,
        isCompactLayout: false,
      })
    ).toBe(false);
  });
});
