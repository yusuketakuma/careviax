import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { PACKAGING_INSTRUCTION_TAG_OPTIONS } from '@/lib/dispensing/packaging';
import {
  buildPatientBoardFoundationIssueCounts,
  comparePatientBoardCards,
  derivePatientBoardCard,
  matchesPatientBoardFoundationIssue,
  type DerivedPatientBoardCard,
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
const PATIENT_BOARD_CURSOR_TTL_MS = 10 * 60 * 1000;
const BLOCKED_REASONS_LIMIT = 2;

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
    .max(512)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
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

type PatientBoardCursorPayload = {
  v: 1;
  offset: number;
  limit: number;
  fh: string;
  iat_ms: number;
};

type PatientBoardCursorDecodeResult =
  | { ok: true; offset: number }
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

function encodeBase64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPatientBoardCursor(payloadPart: string, secret: string) {
  return createHmac('sha256', secret).update(payloadPart).digest('base64url');
}

function safeEqualSignature(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'base64url');
  const rightBuffer = Buffer.from(right, 'base64url');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readPatientBoardCursorPayload(value: unknown): PatientBoardCursorPayload | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (!Number.isSafeInteger(record.offset) || (record.offset as number) < 0) return null;
  if (!Number.isSafeInteger(record.limit) || (record.limit as number) < 1) return null;
  if (typeof record.fh !== 'string' || !record.fh) return null;
  if (!Number.isSafeInteger(record.iat_ms) || (record.iat_ms as number) < 0) return null;
  return {
    v: 1,
    offset: record.offset as number,
    limit: record.limit as number,
    fh: record.fh,
    iat_ms: record.iat_ms as number,
  };
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
  offset: number;
  limit: number;
  filterHash: string;
  now: Date;
  secret: string;
}) {
  const payloadPart = encodeBase64UrlJson({
    v: 1,
    offset: args.offset,
    limit: args.limit,
    fh: args.filterHash,
    iat_ms: args.now.getTime(),
  } satisfies PatientBoardCursorPayload);
  return `${payloadPart}.${signPatientBoardCursor(payloadPart, args.secret)}`;
}

function decodePatientBoardCursor(args: {
  cursor: string | undefined;
  limit: number;
  filterHash: string;
  now: Date;
  secret: string;
}): PatientBoardCursorDecodeResult {
  if (!args.cursor) return { ok: true, offset: 0 };
  const [payloadPart, signature, ...extra] = args.cursor.split('.');
  if (!payloadPart || !signature || extra.length > 0) return { ok: false, reason: 'malformed' };
  const expectedSignature = signPatientBoardCursor(payloadPart, args.secret);
  if (!safeEqualSignature(signature, expectedSignature)) {
    return { ok: false, reason: 'malformed' };
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as unknown;
    const payload = readPatientBoardCursorPayload(parsed);
    if (!payload) return { ok: false, reason: 'malformed' };
    if (args.now.getTime() - payload.iat_ms > PATIENT_BOARD_CURSOR_TTL_MS) {
      return { ok: false, reason: 'expired' };
    }
    if (payload.limit !== args.limit || payload.fh !== args.filterHash) {
      return { ok: false, reason: 'mismatch' };
    }
    return { ok: true, offset: payload.offset };
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

function getVisitSortKey(card: DerivedPatientBoardCard): string {
  const date = card.next_visit_date ?? '9999-12-31';
  const time = card.next_visit_time ?? '99:99';
  return `${date}T${time}`;
}

function compareForPatientBoardSort(
  left: DerivedPatientBoardCard,
  right: DerivedPatientBoardCard,
  sort: PatientBoardSort,
) {
  if (sort === 'next_visit') {
    const visitCompare = getVisitSortKey(left).localeCompare(getVisitSortKey(right));
    if (visitCompare !== 0) return visitCompare;
  } else if (sort === 'name') {
    const nameCompare = left.name.localeCompare(right.name, 'ja');
    if (nameCompare !== 0) return nameCompare;
  }

  const priorityCompare = comparePatientBoardCards(left, right);
  if (priorityCompare !== 0) return priorityCompare;
  return left.patient_id.localeCompare(right.patient_id);
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

function buildPatientBoardFacets(
  cards: readonly DerivedPatientBoardCard[],
  foundationIssueCounts: ReturnType<typeof buildPatientBoardFoundationIssueCounts>,
  todayKey: string,
): PatientBoardFacets {
  const visitTodayCards = cards.filter((card) => card.next_visit_date === todayKey);
  const facilityBatchSizes = new Map<string, number>();
  let todayVisitCount = 0;

  for (const card of visitTodayCards) {
    if (card.facility_batch_id) {
      facilityBatchSizes.set(card.facility_batch_id, card.facility_batch_patient_count);
    } else {
      todayVisitCount += 1;
    }
  }

  return {
    chip_counts: {
      urgent_now: cards.filter((card) => card.attention === 'urgent_now').length,
      external_wait: cards.filter(
        (card) => card.attention === 'external_wait' || card.attention === 'reply_wait',
      ).length,
      visit_today: visitTodayCards.length,
      paused: cards.filter((card) => card.attention === 'paused').length,
    },
    foundation_issue_counts: foundationIssueCounts,
    today_facility_patient_count: Array.from(facilityBatchSizes.values()).reduce(
      (sum, count) => sum + count,
      0,
    ),
    today_visit_count: todayVisitCount,
    safety_tagged_count: cards.filter((card) => card.safety_tags.length > 0).length,
  };
}

function toPublicPatientBoardCard(card: DerivedPatientBoardCard) {
  const { facility_batch_id, facility_batch_patient_count, ...publicCard } = card;
  void facility_batch_id;
  void facility_batch_patient_count;
  return publicCard;
}

function activeVisitConsentWhere(now: Date): Prisma.ConsentRecordWhereInput {
  return {
    consent_type: 'visit_medication_management',
    is_active: true,
    revoked_date: null,
    OR: [{ expiry_date: null }, { expiry_date: { gte: now } }],
  };
}

function approvedManagementPlanWhere(now: Date): Prisma.ManagementPlanWhereInput {
  return {
    status: 'approved',
    approved_at: { not: null },
    OR: [{ effective_from: null }, { effective_from: { lte: now } }],
  };
}

function hasBoardWhereClause(where: Prisma.PatientWhereInput): boolean {
  return Object.keys(where).length > 0;
}

function buildPatientBoardFoundationPrefilterWhere(args: {
  issue: z.infer<typeof boardQuerySchema>['foundation_issue'];
  caseScopeWhere: Prisma.CareCaseWhereInput;
  now: Date;
  today: Date;
}): Prisma.PatientWhereInput {
  switch (args.issue) {
    case 'missing_parking':
      return {
        OR: [
          { scheduling_preference: { is: null } },
          { scheduling_preference: { is: { parking_available: null } } },
        ],
      };
    case 'missing_care_level':
      return {
        OR: [
          { scheduling_preference: { is: null } },
          { scheduling_preference: { is: { care_level: null } } },
          { scheduling_preference: { is: { care_level: '' } } },
        ],
      };
    case 'missing_insurance':
      return {
        AND: [
          { OR: [{ medical_insurance_number: null }, { medical_insurance_number: '' }] },
          { OR: [{ care_insurance_number: null }, { care_insurance_number: '' }] },
        ],
      };
    case 'missing_consent_plan': {
      const planWhere = approvedManagementPlanWhere(args.now);
      return {
        OR: [
          { consents: { none: activeVisitConsentWhere(args.now) } },
          {
            cases: {
              some: {
                ...args.caseScopeWhere,
                management_plans: { none: planWhere },
              },
            },
          },
          {
            cases: {
              some: {
                ...args.caseScopeWhere,
                management_plans: {
                  some: {
                    ...planWhere,
                    next_review_date: { lt: args.today },
                  },
                },
              },
            },
          },
        ],
      };
    }
    default:
      return {};
  }
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

    const foundationPrefilterWhere = buildPatientBoardFoundationPrefilterWhere({
      issue: foundationIssue,
      caseScopeWhere,
      now,
      today,
    });
    const basePatientWhere: Prisma.PatientWhereInput = {
      org_id: ctx.orgId,
      archived_at: null,
      cases: { some: caseScopeWhere },
      ...buildPatientBoardSearchWhere(query),
    };
    const patientWhere: Prisma.PatientWhereInput = { ...basePatientWhere };
    if (hasBoardWhereClause(foundationPrefilterWhere)) {
      patientWhere.AND = [foundationPrefilterWhere];
    }

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
        orderBy: [{ obtained_date: 'desc' }],
        take: 1,
        select: { id: true },
      },
      cases: {
        where: caseScopeWhere,
        orderBy: { updated_at: 'desc' },
        select: {
          id: true,
          status: true,
          management_plans: {
            where: {
              status: 'approved',
              approved_at: { not: null },
              OR: [{ effective_from: null }, { effective_from: { lte: now } }],
            },
            orderBy: [{ effective_from: 'desc' }, { version: 'desc' }, { approved_at: 'desc' }],
            take: 1,
            select: {
              id: true,
              next_review_date: true,
            },
          },
          care_team_links: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
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
            orderBy: { updated_at: 'desc' },
            take: 1,
            select: {
              id: true,
              status: true,
            },
          },
          medication_cycles: {
            where: { overall_status: { not: 'cancelled' } },
            orderBy: { updated_at: 'desc' },
            take: 1,
            select: {
              id: true,
              overall_status: true,
              exception_status: true,
              updated_at: true,
              prescription_intakes: {
                orderBy: { created_at: 'desc' },
                take: 1,
                select: {
                  lines: {
                    select: {
                      packaging_instruction_tags: true,
                      dispensing_method: true,
                    },
                  },
                },
              },
              inquiries: {
                orderBy: { inquired_at: 'desc' },
                take: 1,
                select: { inquired_at: true, resolved_at: true },
              },
              dispense_tasks: {
                where: { status: 'completed' },
                orderBy: [{ due_date: 'asc' }],
                take: 1,
                select: {
                  due_date: true,
                  audits: {
                    orderBy: { audited_at: 'desc' },
                    take: 1,
                    select: { result: true },
                  },
                },
              },
              workflow_exceptions: {
                where: { status: 'open' },
                orderBy: { created_at: 'asc' },
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
            orderBy: [{ scheduled_date: 'asc' }, { time_window_start: 'asc' }],
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

    const shouldFetchFoundationCountBasis =
      foundationIssue != null && hasBoardWhereClause(foundationPrefilterWhere);

    const [patients, foundationCountPatients, assignedTotal, auditTasks, openExceptions] =
      await Promise.all([
        prisma.patient.findMany({
          where: patientWhere,
          orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
          select: patientBoardSelect,
        }),
        shouldFetchFoundationCountBasis
          ? prisma.patient.findMany({
              where: basePatientWhere,
              orderBy: [{ name_kana: 'asc' }, { id: 'asc' }],
              select: patientBoardSelect,
            })
          : Promise.resolve(null),
        prisma.patient.count({ where: basePatientWhere }),
        // 次にやること: 監査待ち(麻薬を最優先)の先頭 1 件
        prisma.dispenseTask.findMany({
          where: { org_id: ctx.orgId, status: 'completed' },
          orderBy: [{ priority: 'asc' }, { due_date: 'asc' }],
          take: 10,
          select: {
            due_date: true,
            audits: { orderBy: { audited_at: 'desc' }, take: 1, select: { result: true } },
            cycle: {
              select: {
                case_: { select: { patient: { select: { name: true } } } },
                prescription_intakes: {
                  orderBy: { created_at: 'desc' },
                  take: 1,
                  select: {
                    lines: { select: { packaging_instruction_tags: true } },
                  },
                },
              },
            },
          },
        }),
        prisma.workflowException.findMany({
          where: { org_id: ctx.orgId, status: 'open' },
          orderBy: { created_at: 'asc' },
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

    const allCards = patients.map((patient) => derivePatientBoardCard(patient, now));
    const foundationCountCards = (foundationCountPatients ?? patients).map((patient) =>
      derivePatientBoardCard(patient, now),
    );
    const foundationIssueCounts = buildPatientBoardFoundationIssueCounts(foundationCountCards);
    const foundationFilteredCards = allCards.filter((card) =>
      matchesPatientBoardFoundationIssue(card, foundationIssue),
    );
    const facets = buildPatientBoardFacets(
      foundationFilteredCards,
      foundationIssueCounts,
      todayKey,
    );
    const filteredCards = foundationFilteredCards
      .filter((card) => matchesPatientBoardCardFilter(card, cardFilter, todayKey))
      .sort((left, right) => compareForPatientBoardSort(left, right, sort));
    const pageStart = decodedCursor.offset;
    const pageCards = filteredCards.slice(pageStart, pageStart + limit);
    const nextOffset = pageStart + pageCards.length;
    const hasMore = nextOffset < filteredCards.length;
    const nextCursor = hasMore
      ? encodePatientBoardCursor({
          offset: nextOffset,
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
      data: pageCards.map(toPublicPatientBoardCard),
      meta: {
        generated_at: now.toISOString(),
        scope,
        limit,
        returned_count: pageCards.length,
        has_more: hasMore,
        next_cursor: nextCursor,
        total_count: filteredCards.length,
        count_basis: PATIENT_BOARD_COUNT_BASIS,
        filters_applied: {
          scope,
          q_present: Boolean(query?.trim()),
          foundation_issue: foundationIssue ?? null,
          card_filter: cardFilter,
          sort,
        },
        facets,
        rail: {
          next_action: auditQueue[0] ?? null,
          blocked_reasons: blockedReasons,
        },
        assigned_total: assignedTotal,
      },
    };

    return successWithMeasuredJsonPayload(responseData);
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
