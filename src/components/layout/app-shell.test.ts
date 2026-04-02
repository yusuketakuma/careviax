import { describe, expect, it } from 'vitest';
import { resolveQuickCreateTarget } from './app-shell';

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
