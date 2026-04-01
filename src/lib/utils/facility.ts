export function deriveFacilityLabel(
  residence: { building_id?: string | null; address?: string | null } | null
): string | null {
  return residence?.building_id ?? residence?.address ?? null;
}
