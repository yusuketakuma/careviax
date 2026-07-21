import { parseOptionalBoundedIntegerParam } from '@/lib/api/pagination';
import { validationError } from '@/lib/api/response';
import { dateKeySchema } from '@/lib/validations/date-key';
import { Prisma, ReportStatus, ReportType } from '@prisma/client';
import { z } from 'zod';

export const CARE_REPORT_KEYWORD_SCAN_LIMIT = 500;
export const CARE_REPORT_KEYWORD_SCAN_READ_LIMIT = CARE_REPORT_KEYWORD_SCAN_LIMIT + 1;
export const CARE_REPORT_PATIENT_SEARCH_CANDIDATE_LIMIT = 100;
export const DEFAULT_CARE_REPORT_PALETTE_LIMIT = 8;
export const CARE_REPORT_PALETTE_QUERY_SCAN_LIMIT = 500;
export const CARE_REPORT_PALETTE_QUERY_SCAN_READ_LIMIT = CARE_REPORT_PALETTE_QUERY_SCAN_LIMIT + 1;
export const careReportPatientSearchOrderBy = [
  { name_kana: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.PatientOrderByWithRelationInput[];

const MAX_CARE_REPORT_PALETTE_LIMIT = 50;
const reportStatusSchema = z.nativeEnum(ReportStatus);
const reportTypeSchema = z.nativeEnum(ReportType);
const optionalDateParamSchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）').optional();

export const careReportQuerySchema = z.object({
  view: z.enum(['palette']).optional(),
  patient_id: z.string().trim().min(1).optional(),
  visit_record_id: z.string().trim().min(1).optional(),
  include_content: z.enum(['1', 'true']).optional(),
  status: reportStatusSchema.optional(),
  report_type: reportTypeSchema.optional(),
  delivery_status: reportStatusSchema.optional(),
  recipient: z.string().min(1).optional(),
  q: z.string().min(1).optional(),
  keyword: z.string().min(1).optional(),
  date_from: optionalDateParamSchema,
  date_to: optionalDateParamSchema,
  sent_from: optionalDateParamSchema,
  sent_to: optionalDateParamSchema,
});

const careReportPresentQueryFields = [
  ['view', '表示形式を指定してください'],
  ['patient_id', '患者IDを指定してください'],
  ['visit_record_id', '訪問記録IDを指定してください'],
  ['include_content', '本文取得指定を指定してください'],
  ['status', 'ステータスを指定してください'],
  ['report_type', '報告書種別を指定してください'],
  ['delivery_status', '送付ステータスを指定してください'],
  ['recipient', '送付先を指定してください'],
  ['q', '検索語を指定してください'],
  ['keyword', '本文検索語を指定してください'],
  ['date_from', '開始日を指定してください'],
  ['date_to', '終了日を指定してください'],
  ['sent_from', '送付開始日を指定してください'],
  ['sent_to', '送付終了日を指定してください'],
] as const;

function optionalTrimmedSearchParam(value: string | null) {
  return value?.trim() || undefined;
}

export function readPresentOptionalSearchParams(searchParams: URLSearchParams) {
  const values: Record<string, string | undefined> = {};
  const fieldErrors: Record<string, string[]> = {};

  for (const [name, message] of careReportPresentQueryFields) {
    const value = optionalTrimmedSearchParam(searchParams.get(name));
    if (searchParams.has(name) && !value) {
      fieldErrors[name] = [message];
    }
    values[name] = value;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', fieldErrors),
    };
  }

  return { ok: true as const, values };
}

export function parseCareReportPaletteLimit(value: string | null) {
  const parsed = parseOptionalBoundedIntegerParam(value, 1, MAX_CARE_REPORT_PALETTE_LIMIT);
  if (!parsed.ok) {
    return {
      ok: false as const,
      response: validationError('limit は 1〜50 の整数で指定してください', {
        limit: ['limit は 1〜50 の整数で指定してください'],
      }),
    };
  }

  return {
    ok: true as const,
    value: parsed.value ?? DEFAULT_CARE_REPORT_PALETTE_LIMIT,
  };
}

export function findUnsupportedPaletteCareReportFilters(args: {
  cursor?: string;
  visitRecordId?: string;
  includeContent?: string;
  deliveryStatus?: ReportStatus;
  recipient?: string;
  keyword?: string;
  sentFrom?: string;
  sentTo?: string;
}) {
  const entries = [
    ['cursor', args.cursor],
    ['visit_record_id', args.visitRecordId],
    ['include_content', args.includeContent],
    ['delivery_status', args.deliveryStatus],
    ['recipient', args.recipient],
    ['keyword', args.keyword],
    ['sent_from', args.sentFrom],
    ['sent_to', args.sentTo],
  ] as const;

  return entries.filter(([, value]) => value !== undefined).map(([key]) => key);
}
