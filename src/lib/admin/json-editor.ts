export function parseJsonObjectText(
  input: string,
  message = 'JSON はオブジェクト形式で入力してください',
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(message);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(message);
  }

  return parsed as Record<string, unknown>;
}
