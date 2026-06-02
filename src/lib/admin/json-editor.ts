import { readJsonObject } from '@/lib/db/json';

export function parseJsonObjectText(
  input: string,
  message = 'JSON はオブジェクト形式で入力してください',
  rootMessage = message,
) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error(message);
  }

  const object = readJsonObject(parsed);
  if (!object) {
    throw new Error(rootMessage);
  }

  return object;
}
