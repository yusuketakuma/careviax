import type { BulkCompleteTaskFailure } from './bulk-completion-contract';

export function summarizeBulkCompleteTaskFailures(
  failures: readonly BulkCompleteTaskFailure[] | undefined,
): string | null {
  if (!failures || failures.length === 0) return null;
  const messages = Array.from(new Set(failures.map((failure) => failure.message).filter(Boolean)));
  if (messages.length === 0) return null;
  const visibleMessages = messages.slice(0, 3);
  const hiddenCount = messages.length - visibleMessages.length;
  return [
    `失敗理由: ${visibleMessages.join(' / ')}`,
    hiddenCount > 0 ? `ほか${hiddenCount}件` : null,
  ]
    .filter(Boolean)
    .join('。');
}
