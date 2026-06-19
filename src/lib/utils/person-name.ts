export function familyNameOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.split(/[\s　]+/)[0] ?? trimmed;
}
