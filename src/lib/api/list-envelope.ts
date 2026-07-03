export type CountedListEnvelope<T> = {
  data: readonly T[];
  total_count: number;
  visible_count: number;
  hidden_count: number;
  truncated: boolean;
};

export function buildCountedListEnvelope<T>(
  data: readonly T[],
  totalCount: number,
): CountedListEnvelope<T> {
  const visibleCount = data.length;
  const hiddenCount = Math.max(totalCount - visibleCount, 0);

  return {
    data,
    total_count: totalCount,
    visible_count: visibleCount,
    hidden_count: hiddenCount,
    truncated: hiddenCount > 0,
  };
}
