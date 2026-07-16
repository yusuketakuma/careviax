import { assertJahisShiftJisByteLimit } from './jahis-shift-jis';

export type JahisFieldType = '9' | 'X' | 'N';

export type JahisExportFieldContract = {
  key: string;
  type: JahisFieldType;
  maxBytes: number;
  required: boolean;
  pattern?: RegExp;
};

export type JahisExportRecordType =
  | '1'
  | '2'
  | '3'
  | '31'
  | '4'
  | '5'
  | '11'
  | '15'
  | '51'
  | '55'
  | '201'
  | '281'
  | '291'
  | '301'
  | '311'
  | '391'
  | '911';

export type JahisExportRecordContract = {
  recordType: JahisExportRecordType;
  fields: readonly JahisExportFieldContract[];
  validateValues?: (values: readonly string[]) => void;
};

const DIGITS = /^\d+$/u;
const ASCII_X = /^[A-Za-z0-9.-]+$/u;
const JAHIS_DATE = /^(?:\d{8}|[MTSHR]\d{6})$/u;
const CREATOR = /^[1289]$/u;
const PREFECTURE = /^\d{2}$/u;
const INSTITUTION_CODE = /^\d{7}$/u;
const DECIMAL = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,5})?$/u;
const POSITIVE_THREE_DIGITS = /^(?:[1-9]|[1-9]\d|[1-9]\d{2})$/u;
const JAN_CODE = /^\d{13}$/u;

function createRpTextRecordContract<const T extends '281' | '291' | '311' | '391'>(
  recordType: T,
  key: string,
  maxBytes: number,
) {
  return {
    recordType,
    fields: [
      {
        key: 'rp_number',
        type: '9',
        maxBytes: 3,
        required: true,
        pattern: POSITIVE_THREE_DIGITS,
      },
      { key, type: 'N', maxBytes, required: true },
      { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
    ],
  } as const satisfies JahisExportRecordContract;
}

export const JAHIS_EXPORT_CONTRACT_V2_6 = {
  documentId: 'JAHIS-24-104',
  version: '2.6',
  header: 'JAHISTC08',
  outputType: '1',
  recordOrder: ['1', '5', '11', '51', '55', '201', '301'] as const,
  records: {
    '1': {
      recordType: '1',
      fields: [
        { key: 'patient_name', type: 'N', maxBytes: 40, required: true },
        { key: 'patient_gender', type: '9', maxBytes: 1, required: true, pattern: /^[12]$/u },
        {
          key: 'patient_birth_date',
          type: 'X',
          maxBytes: 8,
          required: true,
          pattern: JAHIS_DATE,
        },
        { key: 'patient_postal_code', type: 'X', maxBytes: 8, required: false },
        { key: 'patient_address', type: 'N', maxBytes: 800, required: false },
        { key: 'patient_phone', type: 'X', maxBytes: 13, required: false },
        { key: 'emergency_contact', type: 'N', maxBytes: 800, required: false },
        { key: 'blood_type', type: 'N', maxBytes: 20, required: false },
        { key: 'weight', type: 'X', maxBytes: 7, required: false },
        { key: 'patient_name_kana', type: 'N', maxBytes: 40, required: false },
      ],
    },
    '2': {
      recordType: '2',
      fields: [
        { key: 'patient_note_type', type: '9', maxBytes: 1, required: true, pattern: /^[1239]$/u },
        { key: 'patient_note', type: 'N', maxBytes: 120, required: true },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '3': {
      recordType: '3',
      fields: [
        { key: 'drug_name', type: 'N', maxBytes: 120, required: true },
        { key: 'start_date', type: 'X', maxBytes: 8, required: false, pattern: JAHIS_DATE },
        { key: 'end_date', type: 'X', maxBytes: 8, required: false, pattern: JAHIS_DATE },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
        {
          key: 'otc_sequence',
          type: '9',
          maxBytes: 3,
          required: false,
          pattern: POSITIVE_THREE_DIGITS,
        },
        { key: 'jan_code', type: '9', maxBytes: 13, required: false, pattern: JAN_CODE },
      ],
    },
    '31': {
      recordType: '31',
      fields: [
        {
          key: 'otc_sequence',
          type: '9',
          maxBytes: 3,
          required: true,
          pattern: POSITIVE_THREE_DIGITS,
        },
        { key: 'ingredient_name', type: 'N', maxBytes: 256, required: true },
        { key: 'code_type', type: '9', maxBytes: 1, required: true, pattern: /^[12]$/u },
        { key: 'ingredient_code', type: 'X', maxBytes: 20, required: false },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
      validateValues: (values) => {
        if (values[2] === '1' && values[3]) {
          throw new RangeError('JAHIS_FIELD_VALUE_INVALID:31:ingredient_code');
        }
      },
    },
    '4': {
      recordType: '4',
      fields: [
        { key: 'memo', type: 'N', maxBytes: 400, required: true },
        { key: 'memo_date', type: 'X', maxBytes: 8, required: false, pattern: JAHIS_DATE },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '5': {
      recordType: '5',
      fields: [
        {
          key: 'dispensing_date',
          type: 'X',
          maxBytes: 8,
          required: true,
          pattern: JAHIS_DATE,
        },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '11': {
      recordType: '11',
      fields: [
        { key: 'institution_name', type: 'N', maxBytes: 120, required: true },
        { key: 'prefecture_code', type: 'X', maxBytes: 2, required: true, pattern: PREFECTURE },
        { key: 'score_table_code', type: 'X', maxBytes: 1, required: true, pattern: /^4$/u },
        {
          key: 'institution_code',
          type: 'X',
          maxBytes: 7,
          required: true,
          pattern: INSTITUTION_CODE,
        },
        { key: 'postal_code', type: 'X', maxBytes: 8, required: false },
        { key: 'address', type: 'N', maxBytes: 800, required: false },
        { key: 'phone', type: 'X', maxBytes: 13, required: false },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '15': {
      recordType: '15',
      fields: [
        { key: 'clinician_name', type: 'N', maxBytes: 40, required: true },
        { key: 'clinician_contact', type: 'N', maxBytes: 800, required: false },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '51': {
      recordType: '51',
      fields: [
        { key: 'institution_name', type: 'N', maxBytes: 120, required: true },
        { key: 'prefecture_code', type: 'X', maxBytes: 2, required: true, pattern: PREFECTURE },
        { key: 'score_table_code', type: 'X', maxBytes: 1, required: true, pattern: /^[13]$/u },
        {
          key: 'institution_code',
          type: 'X',
          maxBytes: 7,
          required: true,
          pattern: INSTITUTION_CODE,
        },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '55': {
      recordType: '55',
      fields: [
        { key: 'doctor_name', type: 'N', maxBytes: 40, required: true },
        { key: 'department_name', type: 'N', maxBytes: 80, required: false },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '201': {
      recordType: '201',
      fields: [
        {
          key: 'rp_number',
          type: '9',
          maxBytes: 3,
          required: true,
          pattern: POSITIVE_THREE_DIGITS,
        },
        { key: 'drug_name', type: 'N', maxBytes: 120, required: true },
        { key: 'dose', type: 'X', maxBytes: 12, required: true, pattern: DECIMAL },
        { key: 'unit', type: 'N', maxBytes: 12, required: true },
        { key: 'drug_code_type', type: '9', maxBytes: 1, required: true, pattern: /^[12346]$/u },
        { key: 'drug_code', type: 'X', maxBytes: 13, required: false },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
        { key: 'generic_name', type: 'N', maxBytes: 120, required: false },
        { key: 'generic_code_type', type: '9', maxBytes: 1, required: false, pattern: /^[12]$/u },
        { key: 'generic_code', type: 'X', maxBytes: 12, required: false },
      ],
    },
    '281': createRpTextRecordContract('281', 'drug_supplement', 100),
    '291': createRpTextRecordContract('291', 'drug_usage_note', 400),
    '301': {
      recordType: '301',
      fields: [
        {
          key: 'rp_number',
          type: '9',
          maxBytes: 3,
          required: true,
          pattern: POSITIVE_THREE_DIGITS,
        },
        { key: 'usage_name', type: 'N', maxBytes: 100, required: true },
        {
          key: 'dispensing_quantity',
          type: '9',
          maxBytes: 3,
          required: true,
          pattern: POSITIVE_THREE_DIGITS,
        },
        { key: 'dispensing_unit', type: 'N', maxBytes: 100, required: true },
        { key: 'form_code', type: 'X', maxBytes: 2, required: true, pattern: /^(?:[1-9]|10)$/u },
        { key: 'usage_code_type', type: '9', maxBytes: 1, required: true, pattern: /^[12]$/u },
        { key: 'usage_code', type: 'X', maxBytes: 16, required: false },
        { key: 'creator', type: '9', maxBytes: 1, required: true, pattern: CREATOR },
      ],
    },
    '311': createRpTextRecordContract('311', 'usage_supplement', 100),
    '391': createRpTextRecordContract('391', 'prescription_usage_note', 400),
    '911': {
      recordType: '911',
      fields: [
        { key: 'data_id', type: '9', maxBytes: 14, required: true, pattern: /^\d{14}$/u },
        {
          key: 'split_count',
          type: '9',
          maxBytes: 3,
          required: true,
          pattern: POSITIVE_THREE_DIGITS,
        },
        {
          key: 'sequence_number',
          type: '9',
          maxBytes: 3,
          required: true,
          pattern: POSITIVE_THREE_DIGITS,
        },
      ],
    },
  } satisfies Record<string, JahisExportRecordContract>,
} as const;

function throwFieldError(code: string, recordType: string, fieldKey: string): never {
  throw new RangeError(`${code}:${recordType}:${fieldKey}`);
}

function validateField(recordType: string, contract: JahisExportFieldContract, value: string) {
  if (!value) {
    if (contract.required) throwFieldError('JAHIS_FIELD_REQUIRED', recordType, contract.key);
    return;
  }

  try {
    assertJahisShiftJisByteLimit(value, contract.maxBytes);
  } catch (error) {
    if (error instanceof RangeError && error.message === 'JAHIS_SHIFT_JIS_UNREPRESENTABLE') {
      throw error;
    }
    throwFieldError('JAHIS_FIELD_BYTE_LIMIT_EXCEEDED', recordType, contract.key);
  }

  if (contract.type === '9' && !DIGITS.test(value)) {
    throwFieldError('JAHIS_FIELD_TYPE_INVALID', recordType, contract.key);
  }
  if (contract.type === 'X' && !ASCII_X.test(value)) {
    throwFieldError('JAHIS_FIELD_TYPE_INVALID', recordType, contract.key);
  }
  if (contract.pattern && !contract.pattern.test(value)) {
    throwFieldError('JAHIS_FIELD_VALUE_INVALID', recordType, contract.key);
  }
}

export function serializeJahisExportRecord(
  contract: JahisExportRecordContract,
  values: readonly string[],
): string {
  if (values.length !== contract.fields.length) {
    throw new RangeError(`JAHIS_RECORD_FIELD_COUNT_INVALID:${contract.recordType}`);
  }

  values.forEach((value, index) => {
    const field = contract.fields[index];
    if (!field) throw new RangeError(`JAHIS_RECORD_FIELD_COUNT_INVALID:${contract.recordType}`);
    validateField(contract.recordType, field, value);
  });
  contract.validateValues?.(values);
  return [contract.recordType, ...values].join(',');
}

export function assertJahisExportRecordOrder(recordTypes: readonly string[]): void {
  const expectedPrefix = ['1', '5', '11', '51'];
  if (!expectedPrefix.every((recordType, index) => recordTypes[index] === recordType)) {
    throw new RangeError('JAHIS_RECORD_ORDER_INVALID');
  }

  let index = expectedPrefix.length;
  if (recordTypes[index] === '55') index += 1;
  if (index >= recordTypes.length) throw new RangeError('JAHIS_REQUIRED_RECORD_MISSING:201');

  while (index < recordTypes.length) {
    if (recordTypes[index] !== '201' || recordTypes[index + 1] !== '301') {
      throw new RangeError('JAHIS_RECORD_ORDER_INVALID');
    }
    index += 2;
  }
}
