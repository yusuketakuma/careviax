export function normalizeRequiredRouteParam(value: string) {
  const normalized = value.trim();
  if (normalized === '.' || normalized === '..') return null;
  return normalized.length > 0 ? normalized : null;
}
