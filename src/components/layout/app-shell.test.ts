import { describe, expect, it } from 'vitest';
import {
  deriveShellViewport,
  resolveQuickCreateTarget,
  resolveSidebarSheetOpen,
  shouldUseMinimalShell,
  shouldUseMobileImmersiveShell,
  shouldRenderCompactSidebarSheet,
} from './app-shell';

describe('resolveQuickCreateTarget', () => {
  it('maps reports and schedules to existing reachable screens', () => {
    expect(resolveQuickCreateTarget('/reports/analytics')).toEqual({
      href: '/reports',
      notice: '報告書は一覧から対象記録を選択して開始します',
    });
    expect(resolveQuickCreateTarget('/schedules/proposals')).toEqual({
      href: '/schedules#planner',
      notice: 'スケジュールは一覧画面の新規予定エリアを開きます',
    });
  });

  it('falls back to patient registration for modules without a dedicated quick-create screen', () => {
    expect(resolveQuickCreateTarget('/billing/candidates')).toEqual({
      href: '/patients/new',
      notice: 'この画面には専用の新規作成先がないため、患者新規登録を開きます',
    });
  });
});

describe('resolveSidebarSheetOpen', () => {
  it('keeps the sidebar sheet closed on desktop even when sidebarOpen is persisted', () => {
    expect(resolveSidebarSheetOpen(false, true)).toBe(false);
  });

  it('allows the sidebar sheet to open on compact viewports only when requested', () => {
    expect(resolveSidebarSheetOpen(true, true)).toBe(true);
    expect(resolveSidebarSheetOpen(true, false)).toBe(false);
  });
});

describe('shouldUseMinimalShell', () => {
  it('routes print pages through the minimal shell', () => {
    expect(shouldUseMinimalShell('/reports/r1/print')).toBe(true);
    expect(shouldUseMinimalShell('/patients/p1/visit-records/print')).toBe(true);
  });

  it('routes the mobile evidence capture page (p0_48) through the minimal shell', () => {
    expect(shouldUseMinimalShell('/visits/v1/capture')).toBe(true);
  });

  it('does not collapse standard dashboard pages', () => {
    expect(shouldUseMinimalShell('/reports')).toBe(false);
    expect(shouldUseMinimalShell('/workflow')).toBe(false);
    expect(shouldUseMinimalShell('/visits/v1/record')).toBe(false);
    expect(shouldUseMinimalShell('/visits/evidence')).toBe(false);
  });
});

describe('shouldUseMobileImmersiveShell', () => {
  it('marks the visit record route (p0_23) for mobile-immersive chrome', () => {
    expect(shouldUseMobileImmersiveShell('/visits/v1/record')).toBe(true);
  });

  it('keeps every other route on the standard chrome', () => {
    expect(shouldUseMobileImmersiveShell('/visits')).toBe(false);
    expect(shouldUseMobileImmersiveShell('/visits/v1')).toBe(false);
    expect(shouldUseMobileImmersiveShell('/visits/v1/capture')).toBe(false);
    expect(shouldUseMobileImmersiveShell('/visits/evidence')).toBe(false);
    expect(shouldUseMobileImmersiveShell('/patients/p1/record')).toBe(false);
  });
});

describe('deriveShellViewport', () => {
  it('marks desktop widths as non-compact', () => {
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

  it('marks tablet widths as compact and tablet-specific', () => {
    const viewport = deriveShellViewport({
      matchMedia: (query) =>
        ({
          matches: query === '(min-width: 768px) and (max-width: 1279px)',
        }) as MediaQueryList,
    });

    expect(viewport).toEqual({
      isReady: true,
      isDesktopLayout: false,
      isTabletLayout: true,
      isCompactLayout: true,
    });
  });
});

describe('shouldRenderCompactSidebarSheet', () => {
  it('waits for viewport hydration before mounting the compact sheet', () => {
    expect(
      shouldRenderCompactSidebarSheet({
        isReady: false,
        isDesktopLayout: false,
        isTabletLayout: false,
        isCompactLayout: false,
      }),
    ).toBe(false);
  });

  it('renders the compact sheet only after a compact viewport is confirmed', () => {
    expect(
      shouldRenderCompactSidebarSheet({
        isReady: true,
        isDesktopLayout: false,
        isTabletLayout: true,
        isCompactLayout: true,
      }),
    ).toBe(true);
  });
});
