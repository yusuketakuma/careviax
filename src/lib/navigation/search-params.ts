export function mergeSearchParams(args: {
  params: URLSearchParams;
  patch: Record<string, string | null | undefined>;
}) {
  const next = new URLSearchParams(args.params.toString());

  for (const [key, value] of Object.entries(args.patch)) {
    if (value == null || value === '') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }

  return next;
}
