// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PhaseHeader } from './phase-header';
import type { Phase, WorkbenchView } from './dispensing-workbench.types';

/**
 * 静的 PhaseHeader の契約テスト。
 *
 * 4 工程は分離された独立画面（工程切替は左メニュー）であり、ヘッダは現工程のみを表示する。
 * 旧 PhaseTabs の「4 工程の clickable Link バー」は撤去済みであることを検証する:
 *  - 現工程ラベルが表示される
 *  - 他工程へのリンク（<a>）が存在しない
 * jest-dom マッチャは使わず、plain-DOM（textContent / querySelectorAll / queryByText）でアサートする。
 */

function makeView(phase: Phase, phaseLabel: string): WorkbenchView {
  return {
    phase,
    phaseLabel,
    flowHint: '調剤 → 調剤監査 → セット → セット監査',
  } as unknown as WorkbenchView;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PhaseHeader（静的・現工程のみ）', () => {
  it('現工程ラベルと工程フローを表示する', () => {
    const { container } = render(
      <PhaseHeader view={makeView('audit', '調剤監査')} phase="audit" />,
    );
    const text = container.textContent ?? '';
    expect(text.includes('調剤監査')).toBe(true);
    expect(text.includes('調剤 → 調剤監査 → セット → セット監査')).toBe(true);
  });

  it('他工程への遷移リンク（アンカー）を一切持たない', () => {
    const { container } = render(
      <PhaseHeader view={makeView('dispense', '調剤')} phase="dispense" />,
    );
    // 旧 PhaseTabs は next/link の <a> を 4 つ描画していた。静的ヘッダはアンカーを持たない。
    const anchors = container.querySelectorAll('a');
    expect(anchors.length).toBe(0);
  });

  it('現工程を aria-current="page" で示す（クリック可能なタブではない）', () => {
    const { container } = render(<PhaseHeader view={makeView('setp', 'セット')} phase="setp" />);
    const current = container.querySelectorAll('[aria-current="page"]');
    // 現工程のラベル要素のみが aria-current を持つ（1 件）。
    expect(current.length).toBe(1);
    expect((current[0].textContent ?? '').includes('セット')).toBe(true);
    // アンカー（遷移リンク）ではないこと。
    expect(current[0].tagName.toLowerCase()).not.toBe('a');
  });

  it('各 phase で対応するラベルを表示する', () => {
    const cases: Array<[Phase, string]> = [
      ['dispense', '調剤'],
      ['audit', '調剤監査'],
      ['setp', 'セット'],
      ['seta', 'セット監査'],
    ];
    for (const [phase, label] of cases) {
      const { container } = render(<PhaseHeader view={makeView(phase, label)} phase={phase} />);
      expect((container.textContent ?? '').includes(label)).toBe(true);
    }
  });
});
