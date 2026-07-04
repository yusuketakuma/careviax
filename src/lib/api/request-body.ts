import { parseJsonObjectOrNull, readJsonObject } from '@/lib/db/json';
import { validationError } from '@/lib/api/response';

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

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { flatten(): { fieldErrors: unknown } } };

type SafeParseSchema<T> = {
  safeParse(value: unknown): SafeParseResult<T>;
};

export async function parseJsonObjectRequestBodyOrError<T>(
  req: JsonBodyRequest,
  schema: SafeParseSchema<T>,
  messages: {
    invalidBody?: string;
    invalidInput?: string;
  } = {},
) {
  const payload = await readJsonObjectRequestBody(req);
  if (payload == null) {
    return {
      ok: false as const,
      response: validationError(messages.invalidBody ?? 'リクエストボディが不正です'),
    };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError(
        messages.invalidInput ?? '入力値が不正です',
        parsed.error.flatten().fieldErrors,
      ),
    };
  }

  return { ok: true as const, data: parsed.data };
}

export async function readOptionalJsonObjectRequestBody(req: TextBodyRequest) {
  const body = await req.text().catch(() => null);
  if (body == null) return null;
  if (body.trim() === '') return {};

  return parseJsonObjectOrNull(body);
}
