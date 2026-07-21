import { z } from 'zod';
import { validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import {
  MEDICATION_CYCLE_STATUSES,
  PRESCRIPTION_SOURCE_TYPES,
} from '@/lib/prescription/intake-filters';
import { QR_DRAFT_PACKAGING_TAG_VALUES } from '@/lib/prescription/qr-draft-line-readers';

const prescriptionSourceTypeSchema = z.enum(PRESCRIPTION_SOURCE_TYPES);
const medicationCycleStatusSchema = z.enum(MEDICATION_CYCLE_STATUSES);
const prescriptionCareTagSchema = z.enum(QR_DRAFT_PACKAGING_TAG_VALUES);

type PrescriptionCareTag = z.infer<typeof prescriptionCareTagSchema>;
type PrescriptionIntakeQueryName =
  | 'q'
  | 'status'
  | 'source_type'
  | 'care_tags'
  | 'include_total'
  | 'facets';

function createPrescriptionIntakeFilterError(message: string, details: Record<string, string[]>) {
  return {
    ok: false as const,
    response: withSensitiveNoStore(validationError(message, details)),
  };
}

function readSinglePrescriptionIntakeQueryValue(
  searchParams: URLSearchParams,
  name: PrescriptionIntakeQueryName,
  messages: { blank: string; invalid: string },
) {
  const values = searchParams.getAll(name);
  if (values.length === 0) return { ok: true as const, value: undefined };
  if (values.length > 1) {
    return {
      ok: false as const,
      details: { [name]: [`${name} は1つだけ指定してください`] },
    };
  }

  const value = values[0];
  if (value.trim().length === 0) {
    return {
      ok: false as const,
      details: { [name]: [messages.blank] },
    };
  }
  if (value !== value.trim()) {
    return {
      ok: false as const,
      details: { [name]: [messages.invalid] },
    };
  }

  return { ok: true as const, value };
}

function parsePrescriptionCareTags(value: string | undefined) {
  if (value === undefined) return { ok: true as const, data: [] as PrescriptionCareTag[] };
  if (value.length > 100) {
    return createPrescriptionIntakeFilterError('注意ポイントの絞り込みが不正です', {
      care_tags: ['対応していない注意ポイントです'],
    });
  }

  const tags = value.split(',');
  if (tags.some((tag) => tag.trim().length === 0)) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', {
      care_tags: ['注意ポイントを指定してください'],
    });
  }
  if (tags.some((tag) => tag !== tag.trim())) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', {
      care_tags: ['注意ポイントの形式が不正です'],
    });
  }

  const parsed = z.array(prescriptionCareTagSchema).safeParse([...new Set(tags)]);
  if (!parsed.success) {
    return createPrescriptionIntakeFilterError('注意ポイントの絞り込みが不正です', {
      care_tags: ['対応していない注意ポイントです'],
    });
  }
  return { ok: true as const, data: parsed.data };
}

export function parsePrescriptionIntakeListFilters(searchParams: URLSearchParams) {
  const qResult = readSinglePrescriptionIntakeQueryValue(searchParams, 'q', {
    blank: '検索語を指定してください',
    invalid: '検索語の形式が不正です',
  });
  if (!qResult.ok) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', qResult.details);
  }
  if (qResult.value && qResult.value.length > 100) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', {
      q: ['検索語の形式が不正です'],
    });
  }

  const statusResult = readSinglePrescriptionIntakeQueryValue(searchParams, 'status', {
    blank: 'ステータスを指定してください',
    invalid: '対応していないステータスです',
  });
  if (!statusResult.ok) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', statusResult.details);
  }

  const sourceTypeResult = readSinglePrescriptionIntakeQueryValue(searchParams, 'source_type', {
    blank: '受付ソース種別を指定してください',
    invalid: '対応していないソース種別です',
  });
  if (!sourceTypeResult.ok) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', sourceTypeResult.details);
  }

  const careTagResult = readSinglePrescriptionIntakeQueryValue(searchParams, 'care_tags', {
    blank: '注意ポイントを指定してください',
    invalid: '注意ポイントの形式が不正です',
  });
  if (!careTagResult.ok) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', careTagResult.details);
  }

  const includeTotalResult = readSinglePrescriptionIntakeQueryValue(searchParams, 'include_total', {
    blank: 'include_total を指定してください',
    invalid: 'include_total は0または1を指定してください',
  });
  if (!includeTotalResult.ok) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', includeTotalResult.details);
  }

  const facetsResult = readSinglePrescriptionIntakeQueryValue(searchParams, 'facets', {
    blank: 'facets を指定してください',
    invalid: 'facets は0または1を指定してください',
  });
  if (!facetsResult.ok) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', facetsResult.details);
  }

  const status = statusResult.value
    ? medicationCycleStatusSchema.safeParse(statusResult.value)
    : null;
  if (status && !status.success) {
    return createPrescriptionIntakeFilterError('処方受付ステータスが不正です', {
      status: ['対応していないステータスです'],
    });
  }

  const sourceType = sourceTypeResult.value
    ? prescriptionSourceTypeSchema.safeParse(sourceTypeResult.value)
    : null;
  if (sourceType && !sourceType.success) {
    return createPrescriptionIntakeFilterError('処方受付ソース種別が不正です', {
      source_type: ['対応していないソース種別です'],
    });
  }

  const careTags = parsePrescriptionCareTags(careTagResult.value);
  if (!careTags.ok) return careTags;

  if (includeTotalResult.value !== undefined && !['0', '1'].includes(includeTotalResult.value)) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', {
      include_total: ['include_total は0または1を指定してください'],
    });
  }
  if (facetsResult.value !== undefined && !['0', '1'].includes(facetsResult.value)) {
    return createPrescriptionIntakeFilterError('検索条件が不正です', {
      facets: ['facets は0または1を指定してください'],
    });
  }

  return {
    ok: true as const,
    searchQuery: qResult.value ?? null,
    status: status?.data ?? null,
    sourceType: sourceType?.data ?? null,
    careTags: careTags.data,
    includeTotal: includeTotalResult.value === '1',
    includeFacets: facetsResult.value === '1',
  };
}

export type ParsedPrescriptionIntakeListFilters = Extract<
  ReturnType<typeof parsePrescriptionIntakeListFilters>,
  { ok: true }
>;
