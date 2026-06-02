import { describe, expect, it } from 'vitest';
import { getMedicalConfigFields } from './site-config-fields';

describe('getMedicalConfigFields', () => {
  it('includes 2026 dispensing fee revision fields from the latest official notices', () => {
    const fields = getMedicalConfigFields('2026');
    const boolFieldLabels = Object.fromEntries(
      fields.boolFields.map((field) => [field.key, field.label]),
    );

    expect(boolFieldLabels).toMatchObject({
      cooperation_enhancement: '連携強化加算 (5点)',
      medical_dx_promotion: '医療DX推進体制整備加算 (8点)',
      dispensing_base_up_evaluation: '調剤ベースアップ評価料 (4点 / 2027年6月以降 8点)',
      dispensing_price_response: '調剤物価対応料 (1点 / 3月に1回・2027年6月以降 2点)',
    });

    const regionalSupport = fields.configFields.find(
      (field) => field.key === 'regional_support_level',
    );
    expect(regionalSupport?.options).toContainEqual(['level_5', '加算5 (59点)']);
  });
});
