import { describe, expect, it } from 'vitest';
import { BlockerSeverity, Tag } from './phos_contracts';
import {
  CardTileDims,
  Radius,
  SeverityToken,
  Space,
  TagToken,
  TapTarget,
  TypeScale,
} from './phos_design_tokens';

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function luminance(hex: string): number {
  const channels = hexToRgb(hex).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe('PH-OS design tokens', () => {
  it('matches the required spacing, type, radius, tap target, and card tile values', () => {
    expect(TypeScale).toEqual({ xs: 12, sm: 14, base: 16, lg: 18, xl: 20, h2: 24, h1: 30 });
    expect(Space).toEqual({ x1: 4, x2: 8, x3: 12, x4: 16, x5: 24, x6: 32 });
    expect(Radius).toEqual({ sm: 6, md: 10, lg: 14 });
    expect(TapTarget.min).toBeGreaterThanOrEqual(24);
    expect(TapTarget.recommended).toBeGreaterThanOrEqual(44);
    expect(CardTileDims.primaryButtonHeight).toBe(44);
  });

  it('defines severity token colors with readable foreground/background contrast', () => {
    for (const token of Object.values(SeverityToken)) {
      expect(contrastRatio(token.fg, token.bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('maps tag tokens through canonical tags and severities', () => {
    expect(TagToken[Tag.NARCOTIC].severity).toBe(BlockerSeverity.CRITICAL);
    expect(Object.keys(TagToken).sort()).toEqual(Object.values(Tag).sort());
  });
});
