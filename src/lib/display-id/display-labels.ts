export type DisplayIdLabelSource = {
  id: string;
  display_id?: string | null;
};

type DisplayIdLabelOptions = {
  fallbackLength?: number;
  fallbackFrom?: 'start' | 'end';
  fallbackSuffix?: string;
};

export function formatDisplayEntityLabel(
  source: DisplayIdLabelSource,
  options: DisplayIdLabelOptions = {},
) {
  const displayId = source.display_id?.trim();
  if (displayId) return displayId;

  const fallbackLength = options.fallbackLength ?? 8;
  const fallback =
    options.fallbackFrom === 'start'
      ? source.id.slice(0, fallbackLength)
      : source.id.slice(-fallbackLength);
  return `${fallback}${options.fallbackSuffix ?? ''}`;
}
