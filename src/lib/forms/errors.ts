export type FormErrorSummaryItem = {
  path: string;
  label: string;
  message: string;
};

type ErrorLabelMap = Record<string, string>;

const ignoredKeys = new Set(['ref', 'type', 'types']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toWildcardPath(path: string) {
  return path.replace(/\.\d+(?=\.|$)/g, '.*');
}

function formatFallbackLabel(path: string) {
  const parts = path
    .split('.')
    .filter((part) => part.length > 0 && !/^\d+$/.test(part))
    .map((part) => part.replaceAll('_', ' '));
  return parts.join(' / ') || path;
}

function formatLabel(path: string, labels: ErrorLabelMap) {
  const segments = path.split('.');
  const firstIndex = segments.find((segment) => /^\d+$/.test(segment));
  const baseLabel = labels[path] ?? labels[toWildcardPath(path)] ?? formatFallbackLabel(path);

  if (!firstIndex) return baseLabel;
  return `${Number(firstIndex) + 1}行目: ${baseLabel}`;
}

function walkErrors(
  value: unknown,
  path: string,
  labels: ErrorLabelMap,
  items: FormErrorSummaryItem[],
) {
  if (!isObject(value)) return;

  const message = typeof value.message === 'string' ? value.message : null;
  if (message && path) {
    items.push({
      path,
      label: formatLabel(path, labels),
      message,
    });
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (ignoredKeys.has(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    walkErrors(child, childPath, labels, items);
  }
}

export function collectFormErrorSummaryItems(
  errors: unknown,
  labels: ErrorLabelMap = {},
): FormErrorSummaryItem[] {
  const items: FormErrorSummaryItem[] = [];
  walkErrors(errors, '', labels, items);

  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) return false;
    seen.add(item.path);
    return true;
  });
}
