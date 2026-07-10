import { apiAcknowledgementSchema } from './response-schemas';

type ApiJsonSchemaResult<T> = { success: true; data: T } | { success: false };

export type ApiJsonSchema<T> = {
  safeParse(value: unknown): ApiJsonSchemaResult<T>;
};

export type ReadApiJsonOptions<T> = {
  fallbackMessage?: string;
  schema?: ApiJsonSchema<T>;
};

function readApiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const object = payload as Record<string, unknown>;
  const nestedError = object.error;
  if (nestedError && typeof nestedError === 'object') {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage !== 'string') return null;
    const normalized = nestedMessage.trim();
    return normalized || null;
  }
  for (const key of ['message', 'error'] as const) {
    const value = object[key];
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized) return normalized;
    }
  }
  return null;
}

function normalizeOptions<T>(
  options: string | ReadApiJsonOptions<T> | undefined,
): Required<Pick<ReadApiJsonOptions<T>, 'fallbackMessage'>> &
  Pick<ReadApiJsonOptions<T>, 'schema'> {
  if (typeof options === 'string') {
    return { fallbackMessage: options };
  }
  return {
    fallbackMessage: options?.fallbackMessage ?? '処理に失敗しました',
    schema: options?.schema,
  };
}

async function parseResponseJson(response: Response): Promise<
  | {
      parsed: true;
      value: unknown;
    }
  | {
      parsed: false;
      value: null;
    }
> {
  const body = await response.text().catch(() => null);
  if (body === null || !body.trim()) return { parsed: false, value: null };
  try {
    return { parsed: true, value: JSON.parse(body) as unknown };
  } catch {
    return { parsed: false, value: null };
  }
}

export async function readApiJson<T>(
  response: Response,
  options?: string | ReadApiJsonOptions<T>,
): Promise<T> {
  const { fallbackMessage, schema } = normalizeOptions(options);
  const json = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(readApiErrorMessage(json.value) ?? fallbackMessage);
  }
  if (!json.parsed) {
    throw new Error(fallbackMessage);
  }
  if (schema) {
    const parsed = schema.safeParse(json.value);
    if (!parsed.success) {
      throw new Error(fallbackMessage);
    }
    return parsed.data;
  }
  return json.value as T;
}

export async function readApiAcknowledgement(
  response: Response,
  fallbackMessage = '処理に失敗しました',
): Promise<void> {
  await readApiJson(response, {
    fallbackMessage,
    schema: apiAcknowledgementSchema,
  });
}
