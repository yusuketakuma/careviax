import { SOURCE_REF_KINDS, type SourceRef } from '@/phos/contracts/phos_contracts';
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
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError({ field: 'idempotency_key' });
  }
  return value.trim();
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
