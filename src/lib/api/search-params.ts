export type SingleSearchParamResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export type ExactIntegerSearchParamResult =
  | { ok: true; value: number | undefined }
  | { ok: false; message: string };

export type StrictOptionalSearchParamMessages = {
  blank: string;
  invalid: string;
};

export type StrictOptionalSearchParamResult<Field extends string = string> =
  | { ok: true; value: string | undefined }
  | { ok: false; fieldErrors: Record<Field, string[]> };

export function readSingleSearchParam(
  params: URLSearchParams,
  field: string,
): SingleSearchParamResult {
  const values = params.getAll(field);
  if (values.length === 0) return { ok: true, value: null };
  if (values.length > 1) {
    return {
      ok: false,
      message: `${field} は1つだけ指定してください`,
    };
  }
  return { ok: true, value: values[0] ?? '' };
}

export function parseExactIntegerSearchParam(
  params: URLSearchParams,
  field: string,
  min: number,
  max: number,
  defaultValue?: number,
): ExactIntegerSearchParamResult {
  const parsed = readSingleSearchParam(params, field);
  if (!parsed.ok) return parsed;
  if (parsed.value === null) return { ok: true, value: defaultValue };
  if (!/^-?\d+$/.test(parsed.value)) {
    return {
      ok: false,
      message: `${field} は整数で指定してください`,
    };
  }

  const value = Number(parsed.value);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    return {
      ok: false,
      message: `${field} は${min}以上${max}以下で指定してください`,
    };
  }

  return { ok: true, value };
}

export function readStrictOptionalSearchParam<Field extends string>(
  params: URLSearchParams,
  field: Field,
  messages: StrictOptionalSearchParamMessages,
  options: { maxLength?: number } = {},
): StrictOptionalSearchParamResult<Field> {
  const parsed = readSingleSearchParam(params, field);
  if (!parsed.ok) {
    return {
      ok: false,
      fieldErrors: { [field]: [parsed.message] } as Record<Field, string[]>,
    };
  }
  if (parsed.value === null) return { ok: true, value: undefined };

  const value = parsed.value;
  if (value.trim().length === 0) {
    return {
      ok: false,
      fieldErrors: { [field]: [messages.blank] } as Record<Field, string[]>,
    };
  }

  if (value !== value.trim() || value.length > (options.maxLength ?? 100)) {
    return {
      ok: false,
      fieldErrors: { [field]: [messages.invalid] } as Record<Field, string[]>,
    };
  }

  return { ok: true, value };
}
