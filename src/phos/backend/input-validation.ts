import { isValidDateKey } from '@/lib/validations/date-key';
import { SOURCE_REF_KINDS, type SourceRef } from '@/phos/contracts/phos_contracts';
import type { PhosHttpEvent } from './lambda-handler';
import { PhosDomainError } from './cards-repository';

export function validationError(details: Record<string, unknown>): PhosDomainError {
  return new PhosDomainError({
    status: 400,
    error_code: 'VALIDATION_ERROR',
    message_key: 'api.error.validation.generic',
    details,
  });
}

export function parsePositiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw validationError({ field: 'client_version' });
  }
  return Number(value);
}

export function parseIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw validationError({ field: 'idempotency_key' });
  }
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(trimmed)) {
    throw validationError({
      field: 'idempotency_key',
      expected: '1-128 characters matching [A-Za-z0-9._:-]',
    });
  }
  return trimmed;
}

export function readQueryParam(event: PhosHttpEvent, key: string): string | undefined {
  const value = event.queryStringParameters?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseBoundedIntegerQuery(input: {
  value: string | undefined;
  field: string;
  defaultValue: number;
  max: number;
  min?: number;
}): number {
  if (input.value === undefined) return input.defaultValue;
  const parsed = Number(input.value);
  const min = input.min ?? 1;
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > input.max) {
    throw validationError({ field: input.field, min, max: input.max });
  }
  return parsed;
}

export function parseDateKeyQuery(value: string | undefined, field = 'date'): string {
  if (!value || !isValidDateKey(value)) {
    throw validationError({ field, expected: 'YYYY-MM-DD' });
  }
  return value;
}

export function parseOptionalIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError({ field });
  }
  const trimmed = value.trim();
  if (!Number.isFinite(Date.parse(trimmed))) {
    throw validationError({ field });
  }
  return trimmed;
}

export function parseSourceRefs(
  value: unknown,
  options: { field?: string; requireNonEmpty?: boolean } = {},
): SourceRef[] | undefined {
  const field = options.field ?? 'source_refs';
  if (value === undefined) {
    if (options.requireNonEmpty) throw validationError({ field });
    return undefined;
  }
  if (!Array.isArray(value) || (options.requireNonEmpty && value.length === 0)) {
    throw validationError({ field });
  }

  return value.map((item, index) => {
    const itemField = `${field}.${index}`;
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw validationError({ field: itemField });
    }
    const source = item as Partial<SourceRef>;
    if (
      typeof source.kind !== 'string' ||
      !SOURCE_REF_KINDS.includes(source.kind as SourceRef['kind']) ||
      typeof source.ref_id !== 'string' ||
      source.ref_id.trim().length === 0
    ) {
      throw validationError({ field: itemField });
    }
    if (typeof source.label !== 'string' || source.label.trim().length === 0) {
      throw validationError({ field: `${itemField}.label` });
    }

    const uri = typeof source.uri === 'string' ? source.uri.trim() : undefined;
    const captured_at = parseOptionalIsoDate(source.captured_at, `${itemField}.captured_at`);

    return {
      kind: source.kind as SourceRef['kind'],
      ref_id: source.ref_id.trim(),
      label: source.label.trim(),
      ...(uri ? { uri } : {}),
      ...(captured_at ? { captured_at } : {}),
    };
  });
}
