import { z } from 'zod';
import type { PackagingInstructionTag, Prisma } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';
import { japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { PACKAGING_INSTRUCTION_TAG_OPTIONS } from '@/lib/dispensing/packaging';
import {
  buildPatientBoardFoundationIssueCounts,
  comparePatientBoardCards,
  derivePatientBoardCard,
  matchesPatientBoardFoundationIssue,
} from './patient-board-card-model';
import { buildBlockedReasons } from '@/lib/workflow/blocked-reason-projection';
import {
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import type { PatientBoardBlockedReason, PatientBoardResponse } from '@/types/patient-board';

/**
 * new_02_patient_list(患者カード一覧)用 BFF。
 * フィルタチップ件数 / 患者カード(状態語彙・危険タグ・工程・自然文)/ 右レール
 * (次にやること / 止まっている理由 / 根拠・記録の集計)を 1 リクエストで賄う
 * 読み取り専用集計(docs/design-gap-analysis-new.md new_02_patient_list)。
 */

const PATIENT_FETCH_LIMIT = 80;
const PATIENT_FILTERED_FETCH_LIMIT = 500;
const BLOCKED_REASONS_LIMIT = 2;
const jsonPayloadEncoder = new TextEncoder();

function successWithMeasuredJsonPayload<T>(data: T, status = 200) {
  const response = success(data, status);
  response.headers.set(
    'Content-Length',
    String(jsonPayloadEncoder.encode(JSON.stringify(data)).length),
  );
  return response;
}

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
});

const boardSingleValueQueryNames = [
  'scope',
  'q',
  'foundation_issue',
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

    const now = new Date();
    const todayKey = japanDateKey(now);
    // scheduled_date(@db.Date)は UTC 深夜で保存されるため、日本業務日キーの
    // UTC 深夜 Date で比較する(ローカル深夜 setHours(0,0,0,0) では JST で 1 日ずれる)
    const today = utcDateFromLocalKey(todayKey);

    const accessContext: VisitScheduleAccessContext = { userId: ctx.userId, role: ctx.role };
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
          orderBy: { name_kana: 'asc' },
          take: foundationIssue ? PATIENT_FILTERED_FETCH_LIMIT : PATIENT_FETCH_LIMIT,
          select: patientBoardSelect,
        }),
        shouldFetchFoundationCountBasis
          ? prisma.patient.findMany({
              where: basePatientWhere,
              orderBy: { name_kana: 'asc' },
              take: PATIENT_FILTERED_FETCH_LIMIT,
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
    const filteredCards = allCards
      .filter((card) => matchesPatientBoardFoundationIssue(card, foundationIssue))
      .sort(comparePatientBoardCards);
    const cards = filteredCards.slice(0, PATIENT_FETCH_LIMIT);

    // 本日訪問は対応カテゴリに関わらず「今日訪問がある患者」を数える
    // (今すぐ対応のカードも本日訪問に含まれ得る。例: 麻薬監査待ち × 14:00 訪問)
    const visitTodayCards = cards.filter((card) => card.next_visit_date === todayKey);

    const chipCounts = {
      urgent_now: cards.filter((card) => card.attention === 'urgent_now').length,
      external_wait: cards.filter(
        (card) => card.attention === 'external_wait' || card.attention === 'reply_wait',
      ).length,
      visit_today: visitTodayCards.length,
      paused: cards.filter((card) => card.attention === 'paused').length,
    };

    const facilityBatchSizes = new Map<string, number>();
    let todayVisitCount = 0;
    for (const card of visitTodayCards) {
      if (card.facility_batch_id) {
        facilityBatchSizes.set(card.facility_batch_id, card.facility_batch_patient_count);
      } else {
        todayVisitCount += 1;
      }
    }
    const todayFacilityPatientCount = Array.from(facilityBatchSizes.values()).reduce(
      (sum, count) => sum + count,
      0,
    );

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

    const responseData: PatientBoardResponse = {
      generated_at: now.toISOString(),
      scope,
      assigned_total: assignedTotal,
      // 取得上限で実際に打ち切られたか = 母数 > 取得行数(フィルタ/slice 前の patients)。
      // foundation_issue 等の絞り込みで cards が減るのは truncation ではないため、
      // cards.length ではなく patients.length と比較する(誤検知防止)。
      truncated: assignedTotal > patients.length || filteredCards.length > PATIENT_FETCH_LIMIT,
      cards: cards.map((card) => {
        const { facility_batch_id, facility_batch_patient_count, ...publicCard } = card;
        void facility_batch_id;
        void facility_batch_patient_count;
        return publicCard;
      }),
      chip_counts: chipCounts,
      foundation_issue_counts: foundationIssueCounts,
      today_facility_patient_count: todayFacilityPatientCount,
      today_visit_count: todayVisitCount,
      safety_tagged_count: cards.filter((card) => card.safety_tags.length > 0).length,
      next_action: auditQueue[0] ?? null,
      blocked_reasons: blockedReasons,
    };

    return successWithMeasuredJsonPayload({ data: responseData });
  },
  {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch {
    return withSensitiveNoStore(internalError());
  }
};
