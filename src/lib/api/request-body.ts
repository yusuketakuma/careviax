import { parseJsonObjectOrNull, readJsonObject } from '@/lib/db/json';

type JsonBodyRequest = {
  json(): Promise<unknown>;
};

type TextBodyRequest = {
  text(): Promise<string>;
};

export async function readJsonObjectRequestBody(req: JsonBodyRequest) {
  const body = await req.json().catch(() => null);
  return readJsonObject(body);
}

export async function readOptionalJsonObjectRequestBody(req: TextBodyRequest) {
  const body = await req.text().catch(() => null);
  if (body == null) return null;
  if (body.trim() === '') return {};

  return parseJsonObjectOrNull(body);
}
