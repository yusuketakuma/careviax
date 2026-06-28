import { describe, expect, it, vi } from 'vitest';

import { dispatchFKeyAction, type FKeyActionDeps } from './dispensing-workbench.fkey';
import type { CellTarget, FKeyAction } from './dispensing-workbench.types';

const TARGET: CellTarget = { di: 0, tk: '朝' };

function makeDeps(onPrimaryReturn: ReturnType<FKeyActionDeps['onPrimary']> = null) {
  return {
    navBy: vi.fn(),
    onBulk: vi.fn(),
    openHold: vi.fn(),
    pushPhase: vi.fn(),
    onPrimary: vi.fn(() => onPrimaryReturn),
    target: TARGET,
  } satisfies FKeyActionDeps;
}

// FKeyAction の全列挙。新アクション追加時にこの配列が型エラーで漏れを知らせるよう網羅する。
const ALL_ACTIONS: readonly FKeyAction[] = [
  'prevPatient',
  'nextPatient',
  'bulk',
  'hold',
  'phaseDispense',
  'phaseAudit',
  'phaseSet',
  'phaseSetAudit',
  'next',
];

describe('dispatchFKeyAction', () => {
  describe('確認中（hasPendingConfirm=true）は全 F-key を無効化する', () => {
    it.each(ALL_ACTIONS)('%s は何もディスパッチせず false を返す', (action) => {
      const deps = makeDeps('audit');
      const dispatched = dispatchFKeyAction(action, true, deps);

      expect(dispatched).toBe(false);
      expect(deps.navBy).not.toHaveBeenCalled();
      expect(deps.onBulk).not.toHaveBeenCalled();
      expect(deps.openHold).not.toHaveBeenCalled();
      expect(deps.pushPhase).not.toHaveBeenCalled();
      expect(deps.onPrimary).not.toHaveBeenCalled();
    });
  });

  describe('非確認中（hasPendingConfirm=false）は各アクションをディスパッチする', () => {
    it('prevPatient/nextPatient は navBy を呼ぶ', () => {
      const deps = makeDeps();
      expect(dispatchFKeyAction('prevPatient', false, deps)).toBe(true);
      expect(deps.navBy).toHaveBeenCalledWith(-1);
      expect(dispatchFKeyAction('nextPatient', false, deps)).toBe(true);
      expect(deps.navBy).toHaveBeenCalledWith(1);
    });

    it('bulk は onBulk を呼ぶ', () => {
      const deps = makeDeps();
      expect(dispatchFKeyAction('bulk', false, deps)).toBe(true);
      expect(deps.onBulk).toHaveBeenCalledTimes(1);
    });

    it('hold は openHold を現在 target で呼ぶ', () => {
      const deps = makeDeps();
      expect(dispatchFKeyAction('hold', false, deps)).toBe(true);
      expect(deps.openHold).toHaveBeenCalledWith(TARGET);
    });

    it.each([
      ['phaseDispense', 'dispense'],
      ['phaseAudit', 'audit'],
      ['phaseSet', 'setp'],
      ['phaseSetAudit', 'seta'],
    ] as const)('%s は pushPhase(%s) を呼ぶ', (action, phase) => {
      const deps = makeDeps();
      expect(dispatchFKeyAction(action, false, deps)).toBe(true);
      expect(deps.pushPhase).toHaveBeenCalledWith(phase);
    });

    it('next は onPrimary の戻り phase へ pushPhase する', () => {
      const deps = makeDeps('setp');
      expect(dispatchFKeyAction('next', false, deps)).toBe(true);
      expect(deps.onPrimary).toHaveBeenCalledTimes(1);
      expect(deps.pushPhase).toHaveBeenCalledWith('setp');
    });

    it('next は onPrimary が null（confirm 要求）なら遷移しない', () => {
      const deps = makeDeps(null);
      expect(dispatchFKeyAction('next', false, deps)).toBe(true);
      expect(deps.onPrimary).toHaveBeenCalledTimes(1);
      expect(deps.pushPhase).not.toHaveBeenCalled();
    });
  });
});
