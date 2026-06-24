// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { SafetyBoard, getHandlingTagBadgeClass, getHandlingTagLabel } from './safety-board';

setupDomTestEnv();

describe('SafetyBoard', () => {
  it('shows the heading with the always-visible supplement', () => {
    render(<SafetyBoard allergy="セフェム系(発疹 2019)" />);

    expect(screen.getByRole('heading', { name: 'セーフティボード' })).toBeTruthy();
    expect(screen.getByText('どの工程でも常時表示')).toBeTruthy();
  });

  it('renders allergy / renal / handling / swallowing / cautions rows when provided', () => {
    render(
      <SafetyBoard
        allergy="セフェム系(発疹 2019)"
        renal="eGFR 38(6/1)要減量"
        handlingTags={['narcotic', 'cold_storage', 'unit_dose']}
        swallowing="錠剤OK・大きい錠は半割"
        cautions={['ふらつき(6/5〜経過観察)']}
      />,
    );

    expect(screen.getByText('アレルギー')).toBeTruthy();
    expect(screen.getByText('セフェム系(発疹 2019)')).toBeTruthy();
    expect(screen.getByText('腎機能')).toBeTruthy();
    expect(screen.getByText('eGFR 38(6/1)要減量')).toBeTruthy();
    expect(screen.getByText('取扱')).toBeTruthy();
    expect(screen.getByText('嚥下')).toBeTruthy();
    expect(screen.getByText('錠剤OK・大きい錠は半割')).toBeTruthy();
    expect(screen.getByText('注意')).toBeTruthy();
    expect(screen.getByText('ふらつき(6/5〜経過観察)')).toBeTruthy();
  });

  it('maps PackagingInstructionTag keys to design labels and tones (麻薬=赤 / 冷所=ティール / 一包化=青)', () => {
    render(<SafetyBoard handlingTags={['narcotic', 'cold_storage', 'unit_dose']} />);

    const narcotic = screen.getByText('麻薬');
    expect(narcotic.className).toContain('border-red-500');
    expect(narcotic.className).toContain('text-red-700');

    const cold = screen.getByText('冷所');
    expect(cold.className).toContain('border-teal-400');
    expect(cold.className).toContain('text-teal-700');

    const unitDose = screen.getByText('一包化');
    expect(unitDose.className).toContain('border-blue-300');
    expect(unitDose.className).toContain('text-blue-700');
  });

  it('maps categorical home-visit safety tags without exposing unknown procedure tokens', () => {
    render(
      <SafetyBoard
        handlingTags={[
          'infection_isolation',
          'procedure:tpn',
          'procedure:free text should not render',
        ]}
      />,
    );

    const infection = screen.getByText('感染隔離');
    expect(infection.className).toContain('text-tag-hazard');

    const procedure = screen.getByText('TPN');
    expect(procedure.className).toContain('text-tag-hazard');
    expect(screen.getByText('医療処置').className).toContain('text-tag-hazard');
    expect(screen.queryByText('free text should not render')).toBeNull();
  });

  it('accepts Japanese tag labels directly and falls back to neutral tone for unknown tags', () => {
    render(<SafetyBoard handlingTags={['麻薬', '自費']} />);

    expect(screen.getByText('麻薬').className).toContain('border-red-500');
    expect(screen.getByText('自費').className).toContain('text-muted-foreground');
  });

  it('omits rows without data', () => {
    render(<SafetyBoard allergy="なし(確認済 6/1)" />);

    expect(screen.queryByText('腎機能')).toBeNull();
    expect(screen.queryByText('取扱')).toBeNull();
    expect(screen.queryByText('嚥下')).toBeNull();
    expect(screen.queryByText('注意')).toBeNull();
  });

  it('renders multiple cautions as separate lines', () => {
    render(<SafetyBoard cautions={['ふらつき(6/5〜慎重観察)', '割錠OK・大きい錠は半割']} />);

    expect(screen.getByText('ふらつき(6/5〜慎重観察)')).toBeTruthy();
    expect(screen.getByText('割錠OK・大きい錠は半割')).toBeTruthy();
  });

  it('renders nothing when no data is provided', () => {
    const { container } = render(<SafetyBoard />);
    expect(container.childElementCount).toBe(0);
  });
});

describe('handling tag helpers', () => {
  it('exposes the tag tone map for reuse (e.g. prescription table 安全 column)', () => {
    expect(getHandlingTagLabel('cold_storage')).toBe('冷所');
    expect(getHandlingTagLabel('infection_isolation')).toBe('感染隔離');
    expect(getHandlingTagLabel('procedure:home_oxygen')).toBe('在宅酸素');
    expect(getHandlingTagLabel('procedure:unknown free text')).toBe('医療処置');
    expect(getHandlingTagLabel('未知タグ')).toBe('未知タグ');
    expect(getHandlingTagBadgeClass('narcotic')).toContain('border-red-500');
    expect(getHandlingTagBadgeClass('infection_isolation')).toContain('text-tag-hazard');
    expect(getHandlingTagBadgeClass('procedure:home_oxygen')).toContain('text-tag-hazard');
    expect(getHandlingTagBadgeClass('未知タグ')).toContain('text-muted-foreground');
  });
});
