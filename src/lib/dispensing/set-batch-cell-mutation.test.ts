import { describe, expect, it } from 'vitest';
import { findDuplicateSetBatchCellId, setBatchCellRefSchema } from './set-batch-cell-mutation';

describe('set batch cell mutation contract', () => {
  it('validates the shared batch cell reference payload', () => {
    expect(
      setBatchCellRefSchema.safeParse({ batch_id: 'batch_1', expected_version: 1 }).success,
    ).toBe(true);
    expect(setBatchCellRefSchema.safeParse({ batch_id: '', expected_version: 1 }).success).toBe(
      false,
    );
    expect(setBatchCellRefSchema.safeParse({ batch_id: 'batch_1' }).success).toBe(false);
    expect(
      setBatchCellRefSchema.safeParse({ batch_id: 'batch_1', expected_version: 0 }).success,
    ).toBe(false);
  });

  it('returns the first duplicate batch id in request order', () => {
    expect(
      findDuplicateSetBatchCellId([
        { batch_id: 'batch_1' },
        { batch_id: 'batch_2' },
        { batch_id: 'batch_1' },
      ]),
    ).toBe('batch_1');
    expect(findDuplicateSetBatchCellId([{ batch_id: 'batch_1' }, { batch_id: 'batch_2' }])).toBe(
      null,
    );
  });
});
