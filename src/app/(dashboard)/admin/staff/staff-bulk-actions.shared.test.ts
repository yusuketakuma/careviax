import { describe, expect, it } from 'vitest';
import { getImportFeedback, resolveImportOutcome } from './staff-bulk-actions.shared';

describe('staff bulk import feedback helpers', () => {
  it('uses the explicit created outcome for successful imports', () => {
    const result = {
      created_count: 3,
      failed_count: 0,
      outcome: 'created' as const,
    };

    expect(resolveImportOutcome(result)).toBe('created');
    expect(getImportFeedback(result)).toEqual({
      tone: 'success',
      message: '3件のスタッフを取込しました',
    });
  });

  it('warns for partial failures', () => {
    const result = {
      created_count: 2,
      failed_count: 1,
      outcome: 'partial_failed' as const,
    };

    expect(resolveImportOutcome(result)).toBe('partial_failed');
    expect(getImportFeedback(result)).toEqual({
      tone: 'warning',
      message: '2件を取込しました。1件は確認が必要です',
    });
  });

  it('treats all-row failures as errors instead of success', () => {
    const result = {
      created_count: 0,
      failed_count: 4,
      outcome: 'failed' as const,
    };

    expect(resolveImportOutcome(result)).toBe('failed');
    expect(getImportFeedback(result)).toEqual({
      tone: 'error',
      message: 'スタッフを取込できませんでした（失敗 4件）',
    });
  });

  it('derives outcome for older API responses without the outcome field', () => {
    expect(resolveImportOutcome({ created_count: 1, failed_count: 0 })).toBe('created');
    expect(resolveImportOutcome({ created_count: 1, failed_count: 1 })).toBe('partial_failed');
    expect(resolveImportOutcome({ created_count: 0, failed_count: 1 })).toBe('failed');
  });
});
