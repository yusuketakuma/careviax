import { readJsonObject } from '@/lib/db/json';
import {
  PACKAGING_INSTRUCTION_TAG_OPTIONS,
  PACKAGING_METHOD_OPTIONS,
  type PackagingInstructionTagValue,
  type PackagingMethodValue,
} from '@/lib/dispensing/packaging';

export const QR_DRAFT_PACKAGING_METHOD_VALUES = PACKAGING_METHOD_OPTIONS.map(
  (option) => option.value,
) as [PackagingMethodValue, ...PackagingMethodValue[]];
export const QR_DRAFT_PACKAGING_TAG_VALUES = PACKAGING_INSTRUCTION_TAG_OPTIONS.map(
  (option) => option.value,
) as [PackagingInstructionTagValue, ...PackagingInstructionTagValue[]];
export const QR_DRAFT_ROUTE_VALUES = ['internal', 'external', 'injection', 'other'] as const;
export const QR_DRAFT_DISPENSING_METHOD_VALUES = [
  'standard',
  'unit_dose',
  'crushed',
  'other',
] as const;

const QR_DRAFT_DRUG_CODE_RESOLUTION_STATUS_VALUES = [
  'resolved',
  'review_required',
  'unresolved',
] as const;

type QrDraftParsedData = Record<string, unknown> | null | undefined;
type QrDraftRawInput = Record<string, unknown> | null | undefined;
type QrDraftRouteValue = (typeof QR_DRAFT_ROUTE_VALUES)[number];
type QrDraftDispensingMethodValue = (typeof QR_DRAFT_DISPENSING_METHOD_VALUES)[number];

type QrDraftComparableLine = {
  drug_code?: string | null;
  drug_name: string;
  drug_master_id?: string | null;
  dosage_form?: string;
  dose: string;
  frequency: string;
  days: number;
  quantity?: number;
  unit?: string;
  is_generic?: boolean;
  packaging_method?: PackagingMethodValue;
  packaging_instructions?: string;
  packaging_instruction_tags?: PackagingInstructionTagValue[];
  route?: QrDraftRouteValue;
  dispensing_method?: QrDraftDispensingMethodValue;
  start_date?: string;
  end_date?: string;
  notes?: string;
};

type QrDraftLineInput<TLine extends QrDraftComparableLine = QrDraftComparableLine> = {
  lines: TLine[];
};

type QrDraftEnrichedLine<TLine extends QrDraftComparableLine> = TLine & {
  drug_code?: string | null;
  source_drug_code?: string | null;
  source_drug_code_type?: string;
  dosage_form?: string;
  quantity?: number;
  unit?: string;
  is_generic?: boolean;
  packaging_method?: PackagingMethodValue;
  packaging_instructions?: string;
  packaging_instruction_tags?: PackagingInstructionTagValue[];
  route?: QrDraftRouteValue;
  dispensing_method?: QrDraftDispensingMethodValue;
  start_date?: string;
  end_date?: string;
  notes?: string;
};

function readQrDraftLineAt(parsedData: QrDraftParsedData, index: number) {
  const lines = Array.isArray(parsedData?.lines) ? parsedData.lines : [];
  return readJsonObject(lines[index]);
}

function readQrDraftRequestLineAt(payload: QrDraftRawInput, index: number) {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  return readJsonObject(lines[index]);
}

function hasRequestLineValue(line: Record<string, unknown> | null | undefined, key: string) {
  return line ? Object.prototype.hasOwnProperty.call(line, key) && line[key] !== undefined : false;
}

function readQrDraftLines(parsedData: QrDraftParsedData) {
  if (!Array.isArray(parsedData?.lines)) return [];
  return parsedData.lines.flatMap((line) => {
    const object = readJsonObject(line);
    return object ? [object] : [];
  });
}

export function readQrDraftString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

function readQrDraftBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readQrDraftPositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function readQrDraftStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.flatMap((item): string[] => {
    const text = readQrDraftString(item);
    return text ? [text] : [];
  });
  return values.length > 0 ? values : undefined;
}

function readQrDraftEnumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  const text = readQrDraftString(value);
  return text && (allowed as readonly string[]).includes(text) ? (text as T[number]) : undefined;
}

function readQrDraftEnumArray<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number][] | undefined {
  const values = readQrDraftStringArray(value)?.filter((item): item is T[number] =>
    (allowed as readonly string[]).includes(item),
  );
  return values && values.length > 0 ? values : undefined;
}

function normalizeQrDraftLineComparableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeQrDraftLineComparableValue(item))
      .sort()
      .join(',');
  }
  if (value == null) return '';
  return String(value).trim().replace(/\s+/g, '').toLocaleLowerCase('ja-JP');
}

export function findQrDraftLineMismatches<TLine extends QrDraftComparableLine>(
  input: QrDraftLineInput<TLine>,
  parsedData: QrDraftParsedData,
  rawInput?: QrDraftRawInput,
) {
  const draftLines = readQrDraftLines(parsedData);
  const mismatches: string[] = [];

  if (draftLines.length !== input.lines.length) {
    mismatches.push('line_count');
  }

  input.lines.forEach((line, index) => {
    const draftLine = draftLines[index];
    if (!draftLine) return;
    const rawLine = rawInput === undefined ? undefined : readQrDraftRequestLineAt(rawInput, index);

    const comparisons = [
      {
        key: 'drug_code',
        requestValue: line.drug_code,
        draftValue: readQrDraftString(draftLine.drugCode),
      },
      {
        key: 'drug_name',
        requestValue: line.drug_name,
        draftValue: readQrDraftString(draftLine.drugName),
      },
      {
        key: 'dosage_form',
        requestValue: line.dosage_form,
        draftValue: readQrDraftString(draftLine.dosageForm),
      },
      { key: 'dose', requestValue: line.dose, draftValue: readQrDraftString(draftLine.dose) },
      {
        key: 'frequency',
        requestValue: line.frequency,
        draftValue: readQrDraftString(draftLine.frequency),
      },
      { key: 'days', requestValue: line.days, draftValue: draftLine.days },
      { key: 'quantity', requestValue: line.quantity, draftValue: draftLine.quantity },
      { key: 'unit', requestValue: line.unit, draftValue: readQrDraftString(draftLine.unit) },
      {
        key: 'is_generic',
        requestValue:
          rawLine === undefined
            ? line.is_generic
            : hasRequestLineValue(rawLine, 'is_generic')
              ? line.is_generic
              : undefined,
        draftValue: readQrDraftBoolean(draftLine.isGeneric),
      },
      {
        key: 'packaging_method',
        requestValue: line.packaging_method,
        draftValue: readQrDraftEnumValue(
          draftLine.packagingMethod,
          QR_DRAFT_PACKAGING_METHOD_VALUES,
        ),
      },
      {
        key: 'packaging_instructions',
        requestValue: line.packaging_instructions,
        draftValue: readQrDraftString(draftLine.packagingInstructions),
      },
      {
        key: 'packaging_instruction_tags',
        requestValue: line.packaging_instruction_tags,
        draftValue: readQrDraftEnumArray(
          draftLine.packagingInstructionTags,
          QR_DRAFT_PACKAGING_TAG_VALUES,
        ),
      },
      {
        key: 'route',
        requestValue: line.route,
        draftValue: readQrDraftEnumValue(draftLine.route, QR_DRAFT_ROUTE_VALUES),
      },
      {
        key: 'dispensing_method',
        requestValue: line.dispensing_method,
        draftValue: readQrDraftEnumValue(
          draftLine.dispensingMethod,
          QR_DRAFT_DISPENSING_METHOD_VALUES,
        ),
      },
      {
        key: 'start_date',
        requestValue: line.start_date,
        draftValue: readQrDraftString(draftLine.startDate),
      },
      {
        key: 'end_date',
        requestValue: line.end_date,
        draftValue: readQrDraftString(draftLine.endDate),
      },
      { key: 'notes', requestValue: line.notes, draftValue: readQrDraftString(draftLine.notes) },
    ];

    for (const comparison of comparisons) {
      if (comparison.requestValue === undefined) continue;
      const requestValue = normalizeQrDraftLineComparableValue(comparison.requestValue);
      const draftValue = normalizeQrDraftLineComparableValue(comparison.draftValue);
      if (requestValue !== draftValue) {
        mismatches.push(`line_${index + 1}_${comparison.key}`);
      }
    }
  });

  return mismatches;
}

export function collectDrugCodeResolutionReviewDetails<TLine extends QrDraftComparableLine>(
  parsedData: QrDraftParsedData,
  input: QrDraftLineInput<TLine>,
) {
  const draftLines = readQrDraftLines(parsedData);
  const details: Record<string, string[]> = {};

  draftLines.forEach((draftLine, index) => {
    const status = readQrDraftEnumValue(
      draftLine.drugCodeResolutionStatus,
      QR_DRAFT_DRUG_CODE_RESOLUTION_STATUS_VALUES,
    );
    const drugCode = readQrDraftString(draftLine.drugCode);
    if (status === 'resolved' && drugCode) return;
    if (status === 'review_required' && input.lines[index]?.drug_master_id) return;

    details[`line_${index + 1}_drug_code`] = ['薬剤コードを医薬品マスターコードで確認してください'];
  });

  return Object.keys(details).length > 0 ? details : null;
}

export function enrichQrDraftLineFromParsedData<TLine extends QrDraftComparableLine>(
  line: TLine,
  parsedData: QrDraftParsedData,
  index: number,
  rawInput?: QrDraftRawInput,
): QrDraftEnrichedLine<TLine> {
  const draftLine = readQrDraftLineAt(parsedData, index);
  const rawLine = rawInput === undefined ? undefined : readQrDraftRequestLineAt(rawInput, index);
  const draftIsGeneric = readQrDraftBoolean(draftLine?.isGeneric);
  const isGeneric =
    rawLine === undefined
      ? (line.is_generic ?? draftIsGeneric)
      : hasRequestLineValue(rawLine, 'is_generic')
        ? line.is_generic
        : (draftIsGeneric ?? line.is_generic);

  return {
    ...line,
    drug_code: line.drug_code ?? readQrDraftString(draftLine?.drugCode),
    source_drug_code:
      readQrDraftString(draftLine?.sourceDrugCode) ??
      line.drug_code ??
      readQrDraftString(draftLine?.drugCode),
    source_drug_code_type: readQrDraftString(draftLine?.sourceDrugCodeType),
    dosage_form: line.dosage_form ?? readQrDraftString(draftLine?.dosageForm),
    quantity: line.quantity ?? readQrDraftPositiveNumber(draftLine?.quantity),
    unit: line.unit ?? readQrDraftString(draftLine?.unit),
    is_generic: isGeneric,
    packaging_method:
      line.packaging_method ??
      readQrDraftEnumValue(draftLine?.packagingMethod, QR_DRAFT_PACKAGING_METHOD_VALUES),
    packaging_instructions:
      line.packaging_instructions ?? readQrDraftString(draftLine?.packagingInstructions),
    packaging_instruction_tags:
      line.packaging_instruction_tags ??
      readQrDraftEnumArray(draftLine?.packagingInstructionTags, QR_DRAFT_PACKAGING_TAG_VALUES),
    route: line.route ?? readQrDraftEnumValue(draftLine?.route, QR_DRAFT_ROUTE_VALUES),
    dispensing_method:
      line.dispensing_method ??
      readQrDraftEnumValue(draftLine?.dispensingMethod, QR_DRAFT_DISPENSING_METHOD_VALUES),
    start_date: line.start_date ?? readQrDraftString(draftLine?.startDate),
    end_date: line.end_date ?? readQrDraftString(draftLine?.endDate),
    notes: line.notes ?? readQrDraftString(draftLine?.notes),
  };
}
