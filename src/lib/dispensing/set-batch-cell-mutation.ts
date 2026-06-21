import { z } from 'zod';

export const setBatchCellRefSchema = z.object({
  batch_id: z.string().min(1, 'セルIDは必須です'),
  expected_version: z.number().int().min(1),
});

export type SetBatchCellRef = z.infer<typeof setBatchCellRefSchema>;

export function findDuplicateSetBatchCellId(
  cells: readonly Pick<SetBatchCellRef, 'batch_id'>[],
): string | null {
  const seen = new Set<string>();
  for (const cell of cells) {
    if (seen.has(cell.batch_id)) return cell.batch_id;
    seen.add(cell.batch_id);
  }
  return null;
}
