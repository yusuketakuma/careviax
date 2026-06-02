import { readJsonObject } from '@/lib/db/json';

type JsonBodyResponse = {
  json(): Promise<unknown>;
};

export async function readJsonResponseBody(response: JsonBodyResponse) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function readJsonObjectResponseBody(response: JsonBodyResponse) {
  return readJsonObject(await readJsonResponseBody(response));
}
