import { describe, expect, it } from 'vitest';
import {
  collectBillingValidationMessages,
  readBillingValidationLayers,
  safeBillingValidationMessage,
  summarizeBillingValidationLayers,
} from './validation-layers';

describe('billing validation layer helpers', () => {
  it('returns null for missing or malformed validation layer snapshots', () => {
    expect(readBillingValidationLayers(null)).toBeNull();
    expect(readBillingValidationLayers([])).toBeNull();
    expect(readBillingValidationLayers({})).toBeNull();
    expect(readBillingValidationLayers({ validation_layers: [] })).toBeNull();
  });

  it('treats invalid states as unknown instead of passed', () => {
    const layers = readBillingValidationLayers({
      validation_layers: {
        evidence: { state: 'skipped', message: '内部メモ' },
      },
    });

    expect(summarizeBillingValidationLayers(layers)).toEqual({
      state: 'unknown',
      layerKey: null,
      rawMessage: null,
    });
  });

  it('prioritizes blocked layers over manual review regardless of layer order', () => {
    const layers = readBillingValidationLayers({
      validation_layers: {
        evidence: { state: 'manual_review', message: '根拠確認' },
        close_review: { state: 'blocked', message: '締めレビューで除外' },
      },
    });

    expect(summarizeBillingValidationLayers(layers)).toEqual({
      state: 'blocked',
      layerKey: 'close_review',
      rawMessage: '締めレビューで除外',
    });
  });

  it('collects trimmed unique messages in validation layer order', () => {
    const layers = readBillingValidationLayers({
      validation_layers: {
        evidence: { state: 'manual_review', message: ' 根拠確認 ' },
        rule_engine: { state: 'manual_review', message: '根拠確認' },
        close_review: { state: 'blocked', message: '締めレビューで除外' },
      },
    });

    expect(collectBillingValidationMessages(layers)).toEqual(['根拠確認', '締めレビューで除外']);
  });

  it('does not expose raw validation messages in report-workspace safe labels', () => {
    const summary = summarizeBillingValidationLayers(
      readBillingValidationLayers({
        validation_layers: {
          close_review: {
            state: 'blocked',
            message: '山田太郎 090-1111-2222 内部請求メモ',
          },
        },
      }),
    );

    const label = safeBillingValidationMessage(summary);
    expect(label).toBe(
      '算定候補レビューでブロックされています。請求候補画面で根拠を確認してください。',
    );
    expect(label).not.toContain('山田太郎');
    expect(label).not.toContain('090-1111-2222');
    expect(label).not.toContain('内部請求メモ');
  });
});
