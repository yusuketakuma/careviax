// @vitest-environment node

/**
 * F-011 Stage1b color-token contract test。
 *
 * 緑のままでも token 移行の退行（raw hex 再混入 / 未定義 --wb-* 参照 / typo）を検出する静的契約。
 * 既存の focused vitest は色値を直接アサートしないため、ここで以下を固定する:
 *  1. use-workbench-view.ts（色生成 SSOT）の active コード（コメント除外）に raw hex literal が無い。
 *  2. use-workbench-view.ts が参照する全 var(--wb-*) が dispensing-workbench.module.css に定義済。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src/components/features/dispense-workbench');
const viewSrc = readFileSync(join(DIR, 'use-workbench-view.ts'), 'utf8');
const moduleCss = readFileSync(join(DIR, 'dispensing-workbench.module.css'), 'utf8');

/** 行コメント(//...)とブロックコメント(slash-star ... star-slash)を除いた active コード。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('workbench color-token contract (F-011 Stage1b)', () => {
  it('use-workbench-view.ts active code contains no raw hex color literals', () => {
    const active = stripComments(viewSrc);
    const hits = active.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hits, `raw hex must be tokenized: ${hits.join(', ')}`).toEqual([]);
  });

  it('every var(--wb-*) referenced in the view is defined in the workbench CSS module', () => {
    const referenced = new Set(
      [...viewSrc.matchAll(/var\(\s*(--wb-[a-z0-9-]+)\s*\)/g)].map((m) => m[1]),
    );
    const defined = new Set([...moduleCss.matchAll(/(--wb-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const missing = [...referenced].filter((token) => !defined.has(token));
    expect(missing, `undefined --wb-* tokens (typo?): ${missing.join(', ')}`).toEqual([]);
    // 退行時に空振りしないよう、参照が実在することも確認。
    expect(referenced.size).toBeGreaterThan(0);
  });

  it('every global token referenced by the view is from the approved 6-axis / brand allowlist', () => {
    // workbench が直接使ってよい globals。phase/category は --wb-* 経由のみ（ここには出ない）。
    const allow = new Set([
      '--primary',
      '--primary-foreground',
      '--foreground',
      '--background',
      '--card',
      '--muted',
      '--muted-foreground',
      '--secondary',
      '--accent',
      '--border',
      '--state-done',
      '--state-blocked',
      '--state-confirm',
      '--state-readonly',
      '--state-waiting',
      '--tag-info',
      '--tag-hazard',
    ]);
    const globalRefs = [...viewSrc.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)]
      .map((m) => m[1])
      .filter((token) => !token.startsWith('--wb-'));
    const unknown = [...new Set(globalRefs)].filter((token) => !allow.has(token));
    expect(unknown, `non-allowlisted global tokens: ${unknown.join(', ')}`).toEqual([]);
  });

  it('change-type colors follow the docs SSOT (追加/変更=info, 解除/中止=readonly), not workflow state', () => {
    // 退行（新規→done 等の混同）を固定する。
    expect(viewSrc).toContain("新規: 'var(--wb-info)'");
    expect(viewSrc).toContain("変更: 'var(--wb-info)'");
    expect(viewSrc).toContain("中止: 'var(--wb-state-readonly)'");
    expect(viewSrc).not.toContain("新規: 'var(--wb-state-done)'");
  });
});

// --- A-prime contrast contract: workbench data-plane tokens は theme 安定（light/dark 同値）。
// fill+白文字 / ink+淡tint / primary ボタン+白ラベル が WCAG AA(小文字 4.5:1)を満たすことを数値検証。---

/** module.css から `--name: <value>;` を取り出す。 */
function tokenValue(name: string): string {
  const m = moduleCss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!m) throw new Error(`token not defined: ${name}`);
  return m[1].trim();
}

/** sRGB 各チャネル(0..1, gamma)→ 線形。 */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** 色値(oklch(...) | #hex)→ WCAG 相対輝度 Y。 */
function luminance(value: string): number {
  const hex = value.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const ok = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (ok) {
    const L = parseFloat(ok[1]);
    const C = parseFloat(ok[2]);
    const H = (parseFloat(ok[3]) * Math.PI) / 180;
    const a = C * Math.cos(H);
    const bb = C * Math.sin(H);
    // oklab → LMS' → 立方 → 線形 sRGB（線形のまま輝度を取る）。
    const l_ = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
    const m_ = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
    const s_ = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
    const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
    const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
    const b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
  }
  throw new Error(`unparseable color: ${value}`);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';

describe('workbench color-token AA contrast (A-prime, theme-stable)', () => {
  it('state/info/hazard fills carry white text at >= AA 4.5:1', () => {
    for (const t of [
      '--wb-state-done',
      '--wb-state-blocked',
      '--wb-state-confirm',
      '--wb-state-readonly',
      '--wb-info',
      '--wb-hazard',
    ]) {
      const ratio = contrast(tokenValue(t), WHITE);
      expect(ratio, `${t} on white = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('state inks read on their light tints at >= AA 4.5:1', () => {
    const pairs: [string, string][] = [
      ['--wb-state-done', '--wb-done-bg'],
      ['--wb-state-blocked', '--wb-blocked-bg'],
      ['--wb-state-confirm', '--wb-confirm-bg-soft'],
      ['--wb-state-confirm', '--wb-confirm-bg-warm'],
      ['--wb-state-confirm', '--wb-confirm-bg-pale'],
    ];
    for (const [ink, tint] of pairs) {
      const ratio = contrast(tokenValue(ink), tokenValue(tint));
      expect(ratio, `${ink} on ${tint} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('phase primary fills carry white button labels at >= AA 4.5:1', () => {
    for (const t of [
      '--wb-phase-disp-strong',
      '--wb-phase-audit-strong',
      '--wb-phase-setp-strong',
      '--wb-phase-seta-strong',
    ]) {
      const ratio = contrast(tokenValue(t), WHITE);
      expect(ratio, `${t} on white = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('data-plane ink reads on workbench surfaces at >= AA 4.5:1', () => {
    for (const surface of ['--wb-surface', '--wb-surface-alt', '--wb-surface-selected']) {
      const ratio = contrast(tokenValue('--wb-ink'), tokenValue(surface));
      expect(ratio, `--wb-ink on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    const muted = contrast(tokenValue('--wb-ink-muted'), tokenValue('--wb-surface'));
    expect(muted, `--wb-ink-muted on --wb-surface = ${muted.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
