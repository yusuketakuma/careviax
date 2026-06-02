export function normalizeRequiredRouteParam(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
