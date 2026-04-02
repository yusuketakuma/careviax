import { describe, expect, it } from 'vitest';
import { resolveQuickCreateTarget } from './app-shell';

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
