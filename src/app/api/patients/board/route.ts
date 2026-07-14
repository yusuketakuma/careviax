import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { PackagingInstructionTag, Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { getAuthSecret } from '@/lib/auth/secret';
import { internalError, successWithMeasuredJsonPayload, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { boundedIntegerSearchParam, parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { withRoutePerformance } from '@/lib/utils/performance';
import { PACKAGING_INSTRUCTION_TAG_OPTIONS } from '@/lib/dispensing/packaging';
import {
  buildPatientBoardCardSortKey,
  comparePatientBoardCardSortKeys,
  derivePatientBoardCard,
  matchesPatientBoardFoundationIssue,
  type DerivedPatientBoardCard,
  type PatientBoardCardSortKey,
  type PatientBoardQueryRow,
} from './patient-board-card-model';
import { buildBlockedReasons } from '@/lib/workflow/blocked-reason-projection';
import {
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import type {
  PatientBoardBlockedReason,
  PatientBoardCardFilter,
  PatientBoardCountBasis,
  PatientBoardFacets,
  PatientBoardFoundationIssueCounts,
  PatientBoardPageResponse,
  PatientBoardSort,
} from '@/types/patient-board';

/**
 * new_02_patient_list(患者カード一覧)用 BFF。
 * フィルタチップ件数 / 患者カード(状態語彙・危険タグ・工程・自然文)/ 右レール
 * (次にやること / 止まっている理由 / 根拠・記録の集計)を 1 リクエストで賄う
 * 読み取り専用集計(docs/design-gap-analysis-new.md new_02_patient_list)。
 */

const DEFAULT_PATIENT_BOARD_PAGE_LIMIT = 60;
const MAX_PATIENT_BOARD_PAGE_LIMIT = 100;
const PATIENT_BOARD_QUERY_BATCH_SIZE = 80;
const PATIENT_BOARD_CURSOR_TTL_MS = 10 * 60 * 1000;
const PATIENT_BOARD_CURSOR_AAD = Buffer.from('ph-os:patient-board-cursor:v2', 'utf8');
const BLOCKED_REASONS_LIMIT = 2;
const PATIENT_BOARD_CONTACT_LIMIT = 10;
const PATIENT_BOARD_CARE_TEAM_LINK_LIMIT = 10;
const PATIENT_BOARD_PRESCRIPTION_LINE_LIMIT = 50;

const boardQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).optional(),
  q: z.string().trim().max(80, 'q は80文字以内で指定してください').optional(),
  foundation_issue: z
    .enum([
      'needs_confirmation',
      'missing_contact',
      'missing_consent_plan',
      'missing_parking',
      'missing_care_level',
      'missing_insurance',
      'missing_care_team',
    ])
    .optional(),
  card_filter: z.enum(['all', 'wait_release', 'external', 'visit_today', 'paused']).optional(),
  sort: z.enum(['priority', 'next_visit', 'name']).optional(),
  limit: boundedIntegerSearchParam(
    'limit',
    1,
    MAX_PATIENT_BOARD_PAGE_LIMIT,
    DEFAULT_PATIENT_BOARD_PAGE_LIMIT,
  ),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .optional(),
});

type BoardQuery = z.infer<typeof boardQuerySchema>;
type BoardFoundationIssue = BoardQuery['foundation_issue'];

const boardSingleValueQueryNames = [
  'scope',
  'q',
  'foundation_issue',
  'card_filter',
  'sort',
  'limit',
  'cursor',
] as const satisfies readonly (keyof z.infer<typeof boardQuerySchema>)[];

function findDuplicateBoardQueryParams(searchParams: URLSearchParams) {
  const fieldErrors: Record<string, string[]> = {};

  for (const name of boardSingleValueQueryNames) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

const patientBoardCursorPayloadSchema = z
  .object({
    v: z.literal(2),
    after: z
      .object({
        patient_id: z.string().min(1).max(512),
        name: z.string().min(1).max(512),
        attention: z.enum([
          'urgent_now',
          'wait_release',
          'acceptance',
          'visit_today',
          'external_wait',
          'checking',
          'reply_wait',
          'steady',
          'paused',
        ]),
        foundation_status: z.enum(['ready', 'needs_confirmation', 'missing']),
        next_visit_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        next_visit_time: z
          .string()
          .regex(/^\d{2}:\d{2}$/)
          .nullable(),
      })
      .strict(),
    limit: z.number().int().min(1).max(MAX_PATIENT_BOARD_PAGE_LIMIT),
    fh: z.string().min(1),
    iat_ms: z.number().int().nonnegative(),
  })
  .strict();

type PatientBoardCursorPayload = z.infer<typeof patientBoardCursorPayloadSchema>;

type PatientBoardCursorDecodeResult =
  | { ok: true; after: PatientBoardCardSortKey | null }
  | { ok: false; reason: 'malformed' | 'mismatch' | 'expired' };
type PatientBoardCursorFailureReason = Extract<
  PatientBoardCursorDecodeResult,
  { ok: false }
>['reason'];

const PATIENT_BOARD_COUNT_BASIS: PatientBoardCountBasis = {
  total_count: 'filtered_result_exact',
  chip_counts: 'scope_search_foundation_exact',
  foundation_issue_counts: 'scope_search_without_active_foundation_issue_exact',
  board_summary: 'scope_search_foundation_exact',
};

function buildPatientBoardCursorKey(secret: string) {
  return createHash('sha256')
    .update('ph-os:patient-board-cursor-key:v2\0', 'utf8')
    .update(secret, 'utf8')
    .digest();
}

function decodeCanonicalBase64Url(value: string) {
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

function buildPatientBoardFilterHash(args: {
  orgId: string;
  userId: string;
  role: string;
  scope: 'mine' | 'all';
  query: string | undefined;
  foundationIssue: BoardFoundationIssue | undefined;
  cardFilter: PatientBoardCardFilter;
  sort: PatientBoardSort;
  limit: number;
  secret: string;
}) {
  const payload = {
    org_id: args.orgId,
    user_id: args.userId,
    role: args.role,
    scope: args.scope,
    q: args.query?.trim() || null,
    foundation_issue: args.foundationIssue ?? null,
    card_filter: args.cardFilter,
    sort: args.sort,
    limit: args.limit,
  };
  return createHmac('sha256', args.secret).update(JSON.stringify(payload)).digest('base64url');
}

function encodePatientBoardCursor(args: {
  after: PatientBoardCardSortKey;
  limit: number;
  filterHash: string;
  now: Date;
  secret: string;
}) {
  const payload = {
    v: 2,
    after: args.after,
    limit: args.limit,
    fh: args.filterHash,
    iat_ms: args.now.getTime(),
  } satisfies PatientBoardCursorPayload;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', buildPatientBoardCursorKey(args.secret), iv);
  cipher.setAAD(PATIENT_BOARD_CURSOR_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher
    .getAuthTag()
    .toString('base64url')}`;
}

function decodePatientBoardCursor(args: {
  cursor: string | undefined;
  limit: number;
  filterHash: string;
  now: Date;
  secret: string;
}): PatientBoardCursorDecodeResult {
  if (!args.cursor) return { ok: true, after: null };
  const [ivPart, ciphertextPart, authTagPart, ...extra] = args.cursor.split('.');
  if (!ivPart || !ciphertextPart || !authTagPart || extra.length > 0) {
    return { ok: false, reason: 'malformed' };
  }
  try {
    const iv = decodeCanonicalBase64Url(ivPart);
    const ciphertext = decodeCanonicalBase64Url(ciphertextPart);
    const authTag = decodeCanonicalBase64Url(authTagPart);
    if (!iv || iv.length !== 12 || !ciphertext || !authTag || authTag.length !== 16) {
      return { ok: false, reason: 'malformed' };
    }
    const decipher = createDecipheriv('aes-256-gcm', buildPatientBoardCursorKey(args.secret), iv);
    decipher.setAAD(PATIENT_BOARD_CURSOR_AAD);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
    const parsed = patientBoardCursorPayloadSchema.safeParse(JSON.parse(plaintext) as unknown);
    if (!parsed.success) return { ok: false, reason: 'malformed' };
    const payload = parsed.data;
    if (args.now.getTime() - payload.iat_ms > PATIENT_BOARD_CURSOR_TTL_MS) {
      return { ok: false, reason: 'expired' };
    }
    if (payload.limit !== args.limit || payload.fh !== args.filterHash) {
      return { ok: false, reason: 'mismatch' };
    }
    return { ok: true, after: payload.after };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

function cursorValidationMessage(reason: PatientBoardCursorFailureReason) {
  if (reason === 'expired') return 'cursor の有効期限が切れています。先頭から再取得してください';
  if (reason === 'mismatch') return '検索条件が変わったため先頭から再取得してください';
  return 'cursor が無効です';
}

function buildPatientBoardSearchWhere(query: string | undefined): Prisma.PatientWhereInput {
  const term = query?.trim();
  if (!term) return {};

  const contains = { contains: term, mode: 'insensitive' as const };
  const normalizedTerm = term.toLocaleLowerCase('ja-JP');
  const matchingPackagingTags = PACKAGING_INSTRUCTION_TAG_OPTIONS.filter(
    (option) =>
      option.value.toLocaleLowerCase('ja-JP').includes(normalizedTerm) ||
      option.label.toLocaleLowerCase('ja-JP').includes(normalizedTerm),
  ).map((option) => option.value as PackagingInstructionTag);
  const prescriptionLineSearch: Prisma.PrescriptionLineWhereInput[] = [
    { dispensing_method: contains },
  ];
  if (matchingPackagingTags.length > 0) {
    prescriptionLineSearch.push({ packaging_instruction_tags: { hasSome: matchingPackagingTags } });
  }

  return {
    OR: [
      { name: contains },
      { name_kana: contains },
      {
        residences: {
          some: {
            OR: [
              { address: contains },
              { building_id: contains },
              { unit_name: contains },
              { facility: { is: { name: contains } } },
              { facility_unit: { is: { name: contains } } },
            ],
          },
        },
      },
      {
        contacts: {
          some: {
            OR: [{ name: contains }, { organization_name: contains }, { department: contains }],
          },
        },
      },
      {
        cases: {
          some: {
            OR: [
              { care_team_links: { some: { name: contains } } },
              { care_team_links: { some: { organization_name: contains } } },
              {
                medication_cycles: {
                  some: {
                    prescription_intakes: {
                      some: {
                        lines: {
                          some: {
                            OR: prescriptionLineSearch,
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
}

function getVisitSortKey(card: PatientBoardCardSortKey): string {
  const date = card.next_visit_date ?? '9999-12-31';
  const time = card.next_visit_time ?? '99:99';
  return `${date}T${time}`;
}

function comparePatientBoardSortKeys(
  left: PatientBoardCardSortKey,
  right: PatientBoardCardSortKey,
  sort: PatientBoardSort,
) {
  if (sort === 'next_visit') {
    const visitCompare = getVisitSortKey(left).localeCompare(getVisitSortKey(right));
    if (visitCompare !== 0) return visitCompare;
  } else if (sort === 'name') {
    const nameCompare = left.name.localeCompare(right.name, 'ja');
    if (nameCompare !== 0) return nameCompare;
  }

  const priorityCompare = comparePatientBoardCardSortKeys(left, right);
  if (priorityCompare !== 0) return priorityCompare;
  return left.patient_id.localeCompare(right.patient_id);
}

function compareForPatientBoardSort(
  left: DerivedPatientBoardCard,
  right: DerivedPatientBoardCard,
  sort: PatientBoardSort,
) {
  return comparePatientBoardSortKeys(
    buildPatientBoardCardSortKey(left),
    buildPatientBoardCardSortKey(right),
    sort,
  );
}

function matchesPatientBoardCardFilter(
  card: DerivedPatientBoardCard,
  filter: PatientBoardCardFilter,
  todayKey: string,
) {
  if (filter === 'all') return true;
  if (filter === 'wait_release') return card.attention === 'wait_release';
  if (filter === 'external') {
    return card.attention === 'external_wait' || card.attention === 'reply_wait';
  }
  if (filter === 'visit_today') return card.next_visit_date === todayKey;
  return card.attention === 'paused';
}

function createPatientBoardFoundationIssueCounts(): PatientBoardFoundationIssueCounts {
  return {
    needs_confirmation: 0,
    missing_contact: 0,
    missing_consent_plan: 0,
    missing_parking: 0,
    missing_care_level: 0,
    missing_insurance: 0,
    missing_care_team: 0,
  };
}

function observePatientBoardFoundationIssues(
  counts: PatientBoardFoundationIssueCounts,
  card: DerivedPatientBoardCard,
) {
  if (card.foundation_summary?.status !== 'ready') counts.needs_confirmation += 1;
  for (const issue of card.foundation_issue_keys ?? []) counts[issue] += 1;
}

type PatientBoardFacetAccumulator = {
  chip_counts: PatientBoardFacets['chip_counts'];
  facility_batch_sizes: Map<string, number>;
  today_visit_count: number;
  safety_tagged_count: number;
};

function createPatientBoardFacetAccumulator(): PatientBoardFacetAccumulator {
  return {
    chip_counts: { urgent_now: 0, external_wait: 0, visit_today: 0, paused: 0 },
    facility_batch_sizes: new Map(),
    today_visit_count: 0,
    safety_tagged_count: 0,
  };
}

function observePatientBoardFacets(
  accumulator: PatientBoardFacetAccumulator,
  card: DerivedPatientBoardCard,
  todayKey: string,
) {
  if (card.attention === 'urgent_now') accumulator.chip_counts.urgent_now += 1;
  if (card.attention === 'external_wait' || card.attention === 'reply_wait') {
    accumulator.chip_counts.external_wait += 1;
  }
  if (card.attention === 'paused') accumulator.chip_counts.paused += 1;
  if (card.safety_tags.length > 0) accumulator.safety_tagged_count += 1;
  if (card.next_visit_date !== todayKey) return;

  accumulator.chip_counts.visit_today += 1;
  if (card.facility_batch_id) {
    accumulator.facility_batch_sizes.set(card.facility_batch_id, card.facility_batch_patient_count);
  } else {
    accumulator.today_visit_count += 1;
  }
}

function buildPatientBoardFacets(
  accumulator: PatientBoardFacetAccumulator,
  foundationIssueCounts: PatientBoardFoundationIssueCounts,
): PatientBoardFacets {
  return {
    chip_counts: accumulator.chip_counts,
    foundation_issue_counts: foundationIssueCounts,
    today_facility_patient_count: Array.from(accumulator.facility_batch_sizes.values()).reduce(
      (sum, count) => sum + count,
      0,
    ),
    today_visit_count: accumulator.today_visit_count,
    safety_tagged_count: accumulator.safety_tagged_count,
  };
}

function insertBoundedPatientBoardCandidate(
  candidates: DerivedPatientBoardCard[],
  card: DerivedPatientBoardCard,
  sort: PatientBoardSort,
  capacity: number,
) {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareForPatientBoardSort(candidates[middle]!, card, sort) <= 0) low = middle + 1;
    else high = middle;
  }
  candidates.splice(low, 0, card);
  if (candidates.length > capacity) candidates.pop();
}

function toPublicPatientBoardCard(card: DerivedPatientBoardCard) {
  const { facility_batch_id, facility_batch_patient_count, ...publicCard } = card;
  void facility_batch_id;
  void facility_batch_patient_count;
  return publicCard;
}

const ACTIVE_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const duplicateFieldErrors = findDuplicateBoardQueryParams(searchParams);
    if (duplicateFieldErrors) {
      return validationError('クエリパラメータが不正です', duplicateFieldErrors);
    }

    const parsed = parseSearchParams(boardQuerySchema, searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }
    const scope = parsed.data.scope ?? 'mine';
    const query = parsed.data.q;
    const foundationIssue = parsed.data.foundation_issue;
    const cardFilter = parsed.data.card_filter ?? 'all';
    const sort = parsed.data.sort ?? 'priority';
    const limit = parsed.data.limit;

    const now = new Date();
    const todayKey = japanDateKey(now);
    // scheduled_date(@db.Date)は UTC 深夜で保存されるため、日本業務日キーの
    // UTC 深夜 Date で比較する(ローカル深夜 setHours(0,0,0,0) では JST で 1 日ずれる)
    const today = utcDateFromLocalKey(todayKey);

    const accessContext: VisitScheduleAccessContext = { userId: ctx.userId, role: ctx.role };
    const cursorSecret = getAuthSecret();
    if (!cursorSecret) {
      throw new Error('Patient board cursor secret is not configured');
    }
    const filterHash = buildPatientBoardFilterHash({
      orgId: ctx.orgId,
      userId: ctx.userId,
      role: ctx.role,
      scope,
      query,
      foundationIssue,
      cardFilter,
      sort,
      limit,
      secret: cursorSecret,
    });
    const decodedCursor = decodePatientBoardCursor({
      cursor: parsed.data.cursor,
      limit,
      filterHash,
      now,
      secret: cursorSecret,
    });
    if (!decodedCursor.ok) {
      return validationError('クエリパラメータが不正です', {
        cursor: [cursorValidationMessage(decodedCursor.reason)],
      });
    }

    // 「私の担当」: 担当ケース(主担当/副担当/訪問割当)に絞る。owner/admin は全件(コックピットと同じ規約)。
    const mineCaseWhere =
      scope === 'mine' && !canBypassVisitScheduleAssignmentAccess(accessContext)
        ? (buildCareCaseAssignmentWhere(accessContext) ?? {})
        : {};
    const caseScopeWhere: Prisma.CareCaseWhereInput = {
      status: { notIn: ['terminated' as const] },
      ...mineCaseWhere,
    };

    const basePatientWhere: Prisma.PatientWhereInput = {
      org_id: ctx.orgId,
      archived_at: null,
      cases: { some: caseScopeWhere },
      ...buildPatientBoardSearchWhere(query),
    };

    const patientBoardSelect = {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      medical_insurance_number: true,
      care_insurance_number: true,
      allergy_info: true,
      scheduling_preference: {
        select: {
          swallowing_route: true,
          preferred_contact_name: true,
          preferred_contact_phone: true,
          visit_before_contact_required: true,
          parking_available: true,
          care_level: true,
        },
      },
      contacts: {
        orderBy: [
          { is_primary: 'desc' },
          { is_emergency_contact: 'desc' },
          { created_at: 'asc' },
          { id: 'asc' },
        ],
        take: PATIENT_BOARD_CONTACT_LIMIT,
        select: {
          is_primary: true,
          is_emergency_contact: true,
          phone: true,
          email: true,
          fax: true,
        },
      },
      residences: {
        where: { is_primary: true },
        take: 1,
        select: {
          facility_id: true,
          building_id: true,
        },
      },
      lab_observations: {
        where: { analyte_code: 'egfr' },
        orderBy: [{ measured_at: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      },
      consents: {
        where: {
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
          OR: [{ expiry_date: null }, { expiry_date: { gte: now } }],
        },
        orderBy: [{ obtained_date: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      },
      cases: {
        where: caseScopeWhere,
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          status: true,
          management_plans: {
            where: {
              status: 'approved',
              approved_at: { not: null },
              OR: [{ effective_from: null }, { effective_from: { lte: now } }],
            },
            orderBy: [
              { effective_from: 'desc' },
              { version: 'desc' },
              { approved_at: 'desc' },
              { id: 'desc' },
            ],
            take: 1,
            select: {
              id: true,
              next_review_date: true,
            },
          },
          care_team_links: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
            take: PATIENT_BOARD_CARE_TEAM_LINK_LIMIT,
            select: {
              role: true,
              phone: true,
              email: true,
              fax: true,
              is_primary: true,
            },
          },
          care_reports: {
            where: { status: { in: ['response_waiting', 'failed'] } },
            orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              id: true,
              status: true,
            },
          },
          medication_cycles: {
            where: { overall_status: { not: 'cancelled' } },
            orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              id: true,
              overall_status: true,
              exception_status: true,
              updated_at: true,
              prescription_intakes: {
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: 1,
                select: {
                  lines: {
                    orderBy: [{ line_number: 'asc' }, { id: 'asc' }],
                    take: PATIENT_BOARD_PRESCRIPTION_LINE_LIMIT,
                    select: {
                      packaging_instruction_tags: true,
                      dispensing_method: true,
                    },
                  },
                },
              },
              inquiries: {
                orderBy: [{ inquired_at: 'desc' }, { id: 'desc' }],
                take: 1,
                select: { inquired_at: true, resolved_at: true },
              },
              dispense_tasks: {
                where: { status: 'completed' },
                orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
                take: 1,
                select: {
                  due_date: true,
                  audits: {
                    orderBy: [{ audited_at: 'desc' }, { id: 'desc' }],
                    take: 1,
                    select: { result: true },
                  },
                },
              },
              workflow_exceptions: {
                where: { status: 'open' },
                orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
                take: 1,
                select: {
                  exception_type: true,
                  description: true,
                  created_at: true,
                },
              },
            },
          },
          visit_schedules: {
            where: {
              scheduled_date: { gte: today },
              schedule_status: { in: [...ACTIVE_SCHEDULE_STATUSES] },
            },
            orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }, { id: 'asc' }],
            take: 1,
            select: {
              id: true,
              scheduled_date: true,
              time_window_start: true,
              carry_items_status: true,
              facility_batch_id: true,
              facility_batch: { select: { patient_ids: true } },
              preparation: {
                select: {
                  prepared_at: true,
                  medication_changes_reviewed: true,
                  carry_items_confirmed: true,
                  previous_issues_reviewed: true,
                  route_confirmed: true,
                  offline_synced: true,
                },
              },
            },
          },
        },
      },
    } satisfies Prisma.PatientSelect;

    const collectPatientBoardPage = async (where: Prisma.PatientWhereInput) => {
      const foundationIssueCounts = createPatientBoardFoundationIssueCounts();
      const facetAccumulator = createPatientBoardFacetAccumulator();
      const pageCandidates: DerivedPatientBoardCard[] = [];
      const candidateCapacity = limit + 1;
      let totalCount = 0;
      let cursor: string | undefined;

      // Exact facets and derived priority ordering require observing the complete filtered basis.
      // Keep both database and application memory bounded: hydrate at most one SLO-sized batch,
      // fold exact counters immediately, and retain only the next page plus one look-ahead card.
      while (true) {
        const batch: PatientBoardQueryRow[] = await prisma.patient.findMany({
          // Keep the raw-client tenant boundary explicit at every paginated callsite.
          // The callers already pass an org-scoped predicate; overriding it here makes
          // the invariant local and prevents a future caller from widening the scan.
          where: { ...where, org_id: ctx.orgId },
          orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
          take: PATIENT_BOARD_QUERY_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: patientBoardSelect,
        });

        for (const patient of batch) {
          const card = derivePatientBoardCard(patient, now);
          observePatientBoardFoundationIssues(foundationIssueCounts, card);
          if (!matchesPatientBoardFoundationIssue(card, foundationIssue)) continue;

          observePatientBoardFacets(facetAccumulator, card, todayKey);
          if (!matchesPatientBoardCardFilter(card, cardFilter, todayKey)) continue;
          totalCount += 1;

          const sortKey = buildPatientBoardCardSortKey(card);
          if (
            decodedCursor.after &&
            comparePatientBoardSortKeys(sortKey, decodedCursor.after, sort) <= 0
          ) {
            continue;
          }
          insertBoundedPatientBoardCandidate(pageCandidates, card, sort, candidateCapacity);
        }

        if (batch.length < PATIENT_BOARD_QUERY_BATCH_SIZE) break;
        cursor = batch[batch.length - 1]?.id;
        if (!cursor) break;
      }

      const hasMore = pageCandidates.length > limit;
      if (hasMore) pageCandidates.pop();
      return {
        pageCards: pageCandidates,
        totalCount,
        hasMore,
        facets: buildPatientBoardFacets(facetAccumulator, foundationIssueCounts),
      };
    };

    const [boardPage, assignedTotal, auditTasks, openExceptions] = await Promise.all([
      collectPatientBoardPage(basePatientWhere),
      prisma.patient.count({ where: basePatientWhere }),
      // 次にやること: 監査待ち(麻薬を最優先)の先頭 1 件
      prisma.dispenseTask.findMany({
        where: { org_id: ctx.orgId, status: 'completed' },
        orderBy: [{ priority: 'asc' }, { due_date: 'asc' }, { id: 'asc' }],
        take: 10,
        select: {
          due_date: true,
          audits: {
            orderBy: [{ audited_at: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { result: true },
          },
          cycle: {
            select: {
              case_: { select: { patient: { select: { name: true } } } },
              prescription_intakes: {
                orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
                take: 1,
                select: {
                  lines: {
                    orderBy: [{ line_number: 'asc' }, { id: 'asc' }],
                    take: PATIENT_BOARD_PRESCRIPTION_LINE_LIMIT,
                    select: { packaging_instruction_tags: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.workflowException.findMany({
        where: { org_id: ctx.orgId, status: 'open' },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: BLOCKED_REASONS_LIMIT,
        select: {
          id: true,
          exception_type: true,
          patient_id: true,
          description: true,
          severity: true,
          created_at: true,
        },
      }),
    ]);

    const nextCursor = boardPage.hasMore
      ? encodePatientBoardCursor({
          after: buildPatientBoardCardSortKey(boardPage.pageCards[boardPage.pageCards.length - 1]!),
          limit,
          filterHash,
          now,
          secret: cursorSecret,
        })
      : null;

    const auditQueue = auditTasks
      .filter((task) => {
        const latest = task.audits[0] ?? null;
        return latest == null || latest.result === 'hold';
      })
      .map((task) => ({
        patient_name: task.cycle.case_.patient.name,
        due_at: task.due_date?.toISOString() ?? null,
        has_narcotic: (task.cycle.prescription_intakes[0]?.lines ?? []).some((line) =>
          line.packaging_instruction_tags.includes('narcotic'),
        ),
      }))
      .sort((left, right) => {
        if (left.has_narcotic !== right.has_narcotic) return left.has_narcotic ? -1 : 1;
        return (left.due_at ?? '9999').localeCompare(right.due_at ?? '9999');
      });

    const blockedReasons: PatientBoardBlockedReason[] = buildBlockedReasons(openExceptions, now);

    const responseData: PatientBoardPageResponse = {
      data: boardPage.pageCards.map(toPublicPatientBoardCard),
      meta: {
        generated_at: now.toISOString(),
        scope,
        limit,
        returned_count: boardPage.pageCards.length,
        has_more: boardPage.hasMore,
        next_cursor: nextCursor,
        total_count: boardPage.totalCount,
        count_basis: PATIENT_BOARD_COUNT_BASIS,
        filters_applied: {
          scope,
          q_present: Boolean(query?.trim()),
          foundation_issue: foundationIssue ?? null,
          card_filter: cardFilter,
          sort,
        },
        facets: boardPage.facets,
        rail: {
          next_action: auditQueue[0] ?? null,
          blocked_reasons: blockedReasons,
        },
        assigned_total: assignedTotal,
      },
    };

    return successWithMeasuredJsonPayload({
      data: responseData.data,
      meta: responseData.meta,
    });
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req, routeContext));
    } catch (err) {
      unstable_rethrow(err);
      return withSensitiveNoStore(internalError());
    }
  });
};
