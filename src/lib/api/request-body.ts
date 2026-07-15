import { parseJsonObjectOrNull } from '@/lib/db/json';
import { registeredError, validationError } from '@/lib/api/response';
import {
  readBoundedBody,
  resolveBoundedBodyReadPolicy,
  type BoundedBodyReadFailureReason,
  type BoundedBodyReadOptions,
  type BoundedBodySource,
} from '@/lib/http/bounded-body';

type JsonObjectBodyReadResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: BoundedBodyReadFailureReason | 'invalid' };

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function decodeUtf8OrNull(bytes: Uint8Array) {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    return null;
  }
}

async function readJsonObjectRequestBodyResult(
  req: BoundedBodySource,
  options: BoundedBodyReadOptions = {},
): Promise<JsonObjectBodyReadResult> {
  const body = await readBoundedBody(req, options);
  if (!body.ok) return body;

  const text = decodeUtf8OrNull(body.bytes);
  if (text == null) return { ok: false, reason: 'invalid' };
  const data = parseJsonObjectOrNull(text);
  if (data == null) return { ok: false, reason: 'invalid' };
  return { ok: true, data };
}

export async function readJsonObjectRequestBody(
  req: BoundedBodySource,
  options: BoundedBodyReadOptions = {},
) {
  const result = await readJsonObjectRequestBodyResult(req, options);
  return result.ok ? result.data : null;
}

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { flatten(): { fieldErrors: unknown } } };

type SafeParseSchema<T> = {
  safeParse(value: unknown): SafeParseResult<T>;
};

export async function parseJsonObjectRequestBodyOrError<T>(
  req: BoundedBodySource,
  schema: SafeParseSchema<T>,
  messages: {
    invalidBody?: string;
    invalidInput?: string;
  } = {},
  bodyOptions: BoundedBodyReadOptions = {},
) {
  const policy = resolveBoundedBodyReadPolicy(bodyOptions);
  const body = await readJsonObjectRequestBodyResult(req, { ...bodyOptions, ...policy });
  if (!body.ok) {
    if (body.reason === 'too_large') {
      return {
        ok: false as const,
        response: registeredError(
          'REQUEST_BODY_TOO_LARGE',
          'リクエストボディが上限を超えています',
          { max_bytes: policy.maxBytes },
        ),
      };
    }
    if (body.reason === 'timeout') {
      return {
        ok: false as const,
        response: registeredError(
          'REQUEST_BODY_TIMEOUT',
          'リクエストボディの受信がタイムアウトしました',
          { timeout_ms: policy.deadlineMs },
        ),
      };
    }
    return {
      ok: false as const,
      response: validationError(messages.invalidBody ?? 'リクエストボディが不正です'),
    };
  }

  const parsed = schema.safeParse(body.data);
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

export async function readOptionalJsonObjectRequestBody(
  req: BoundedBodySource,
  options: BoundedBodyReadOptions = {},
) {
  const result = await readBoundedBody(req, options);
  if (!result.ok) return null;

  const body = decodeUtf8OrNull(result.bytes);
  if (body == null) return null;
  if (body.trim() === '') return {};

  return parseJsonObjectOrNull(body);
}
