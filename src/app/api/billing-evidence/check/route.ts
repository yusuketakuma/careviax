import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { buildPatientHref } from '@/lib/patient/navigation';
import { todayUtcRange } from '@/lib/utils/date-boundary';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { billingMonthForJapanTimestamp } from '@/server/services/billing-evidence';
import { buildTodayOpsRail } from '@/server/services/today-ops-rail';
import type { BillingCheckResponse, BillingCheckReviewRow } from '@/types/billing-check';

/**
 * 11_billing(算定チェック)用 BFF。
 * 上部 3 KPI(自動チェック合格 / 疑義 / 本日訪問の算定候補)+
 * 疑義テーブル(根拠とセット)+ 右レール(次にやること / 止まっている理由 / 根拠・記録)を
 * 1 リクエストで返す読み取り専用集計(docs/design-gap-analysis-new.md 11_billing)。
 */

const querySchema = z.object({
  month: z.enum(['current', 'previous']).default('current'),
});

const REVIEW_ROWS_LIMIT = 10;
const BILLING_CHECK_READ_TIMEOUT_MS = 10_000;

/** 訪問完了後に算定候補へ確定する、当日の未完了予定ステータス。 */
const TODAY_PENDING_SCHEDULE_STATUSES = [
  'planned',
  'in_preparation',
  'ready',
  'departed',
  'in_progress',
] as const;

/**
 * 疑義行の戻り先アクション。SSOT 算定項目ごとの確認先(現場語)を既定で割り当てる。
 * 該当しない場合は患者カード(または候補一覧)へ戻す。
 */
type CheckActionPresetContext = {
  patientSafetyHref: string | null;
};

type CheckActionPreset = {
  pattern: RegExp;
  label: string;
  href: string | ((context: CheckActionPresetContext) => string);
};

const CHECK_ACTION_PRESETS: CheckActionPreset[] = [
  { pattern: /退院時共同指導/, label: '病院へ確認', href: '/admin/institutions' },
  { pattern: /在宅移行初期/, label: '→ ダッシュボードへ', href: '/dashboard' },
  {
    pattern: /麻薬管理指導/,
    label: '→ 訪問へ',
    href: ({ patientSafetyHref }) => patientSafetyHref ?? '/visits',
  },
];

function resolveCheckActionPresetHref(
  preset: CheckActionPreset | undefined,
  context: CheckActionPresetContext,
): string | null {
  if (!preset) return null;
  return typeof preset.href === 'function' ? preset.href(context) : preset.href;
}

function previousUtcMonth(monthStart: Date): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 1, 1));
}

/** 2026 → 令和8。令和元年(2019)より前は西暦表示にフォールバック。 */
function formatReiwaRevisionLabel(date: Date | null): string {
  if (!date) return '—';
  const year = date.getUTCFullYear();
  const reiwa = year - 2018;
  return reiwa >= 1 ? `令和${reiwa}年改定` : `${year}年改定`;
}

function buildPatientLabel(
  patientName: string | null,
  targetName: string | null,
  caseStatus: string | null,
): string {
  if (!patientName) return targetName ?? '対象未設定';
  // 現場語の状態注記: 受入判断前 = 新規 / 保留(入院由来が大半) = 入院中
  if (caseStatus === 'referral_received' || caseStatus === 'assessment') {
    return `新規 ${patientName} 様`;
  }
  if (caseStatus === 'on_hold') {
    return `${patientName} 様(入院中)`;
  }
  return `${patientName} 様`;
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canReport',
    message: '算定チェックの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
      month: searchParams.get('month') ?? undefined,
    });
    if (!parsed.success) {
      return validationError('検索条件が不正です', parsed.error.flatten().fieldErrors);
    }

    const now = new Date();
    const currentMonthStart = billingMonthForJapanTimestamp(now);
    const monthStart =
      parsed.data.month === 'previous' ? previousUtcMonth(currentMonthStart) : currentMonthStart;
    // scheduled_date(@db.Date)比較用: ローカル日付の UTC 深夜レンジ
    const todayRange = todayUtcRange(now);

    const base = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const passedCount = await tx.billingEvidence.count({
          where: { org_id: ctx.orgId, billing_month: monthStart, claimable: true },
        });
        const reviewCount = await tx.billingCandidate.count({
          where: { org_id: ctx.orgId, billing_month: monthStart, status: 'candidate' },
        });
        const reviewCandidates = await tx.billingCandidate.findMany({
          where: { org_id: ctx.orgId, billing_month: monthStart, status: 'candidate' },
          orderBy: { created_at: 'asc' },
          take: REVIEW_ROWS_LIMIT,
          select: {
            id: true,
            patient_id: true,
            cycle_id: true,
            rule_id: true,
            billing_name: true,
            billing_target_name: true,
            exclusion_reason: true,
          },
        });
        const todayPendingCount = await tx.visitSchedule.count({
          where: {
            org_id: ctx.orgId,
            scheduled_date: todayRange,
            schedule_status: { in: [...TODAY_PENDING_SCHEDULE_STATUSES] },
          },
        });
        const latestRevisionRule = await tx.billingRule.findFirst({
          where: {
            org_id: ctx.orgId,
            billing_scope: 'home_care_ssot',
            is_active: true,
            effective_from: { not: null },
          },
          orderBy: { effective_from: 'desc' },
          select: { effective_from: true },
        });
        const rejectionCount = await tx.billingCandidate.count({
          where: {
            org_id: ctx.orgId,
            status: 'excluded',
            exclusion_reason: { contains: '返戻' },
          },
        });
        const templateKinds = await tx.template.groupBy({
          by: ['template_type'],
          where: { org_id: ctx.orgId },
        });
        const rail = await buildTodayOpsRail(tx, ctx.orgId, now);

        return {
          passedCount,
          reviewCount,
          reviewCandidates,
          todayPendingCount,
          latestRevisionRule,
          rejectionCount,
          templateKindCount: templateKinds.length,
          rail,
        };
      },
      { timeoutMs: BILLING_CHECK_READ_TIMEOUT_MS },
    );

    const patientIds = Array.from(
      new Set(
        base.reviewCandidates
          .map((candidate) => candidate.patient_id)
          .filter((value): value is string => value != null),
      ),
    );
    const cycleIds = Array.from(
      new Set(
        base.reviewCandidates
          .map((candidate) => candidate.cycle_id)
          .filter((value): value is string => value != null),
      ),
    );
    const ruleIds = Array.from(
      new Set(
        base.reviewCandidates
          .map((candidate) => candidate.rule_id)
          .filter((value): value is string => value != null),
      ),
    );

    const details =
      patientIds.length === 0 && cycleIds.length === 0 && ruleIds.length === 0
        ? { patients: [], cycles: [], rules: [] }
        : await withOrgContext(
            ctx.orgId,
            async (tx) => {
              const patients =
                patientIds.length === 0
                  ? []
                  : await tx.patient.findMany({
                      where: { org_id: ctx.orgId, id: { in: patientIds } },
                      select: { id: true, name: true },
                    });
              const cycles =
                cycleIds.length === 0
                  ? []
                  : await tx.medicationCycle.findMany({
                      where: { org_id: ctx.orgId, id: { in: cycleIds } },
                      select: { id: true, case_: { select: { status: true } } },
                    });
              const rules =
                ruleIds.length === 0
                  ? []
                  : await tx.billingRule.findMany({
                      where: { org_id: ctx.orgId, id: { in: ruleIds } },
                      select: { id: true, source_note: true, source_url: true },
                    });

              return { patients, cycles, rules };
            },
            { timeoutMs: BILLING_CHECK_READ_TIMEOUT_MS },
          );

    const data = (() => {
      const patientNameById = new Map(
        details.patients.map((patient) => [patient.id, patient.name]),
      );
      const caseStatusByCycleId = new Map(
        details.cycles.map((cycle) => [cycle.id, cycle.case_.status as string]),
      );
      const ruleById = new Map(details.rules.map((rule) => [rule.id, rule]));

      const reviewRows: BillingCheckReviewRow[] = base.reviewCandidates.map((candidate) => {
        const patientName = candidate.patient_id
          ? (patientNameById.get(candidate.patient_id) ?? null)
          : null;
        const caseStatus = candidate.cycle_id
          ? (caseStatusByCycleId.get(candidate.cycle_id) ?? null)
          : null;
        const rule = candidate.rule_id ? (ruleById.get(candidate.rule_id) ?? null) : null;
        const preset = CHECK_ACTION_PRESETS.find((item) =>
          item.pattern.test(candidate.billing_name),
        );
        const patientHref = candidate.patient_id ? buildPatientHref(candidate.patient_id) : null;
        const patientSafetyHref = candidate.patient_id
          ? buildPatientHref(candidate.patient_id, '/safety-check')
          : null;
        const fallbackAction = patientHref
          ? { label: '→ カードへ', href: patientHref }
          : { label: '→ 候補一覧へ', href: '/billing/candidates' };
        const presetHref = resolveCheckActionPresetHref(preset, { patientSafetyHref });

        return {
          id: candidate.id,
          patient_label: buildPatientLabel(patientName, candidate.billing_target_name, caseStatus),
          patient_href: patientHref,
          billing_name: candidate.billing_name,
          confirm_text: candidate.exclusion_reason ?? '算定要件の事実確認が必要です',
          evidence_label: rule?.source_note?.trim() || '算定要件',
          evidence_href: rule?.source_url?.trim() || '/admin/billing-rules',
          action_label: preset?.label ?? fallbackAction.label,
          action_href: presetHref ?? fallbackAction.href,
        };
      });

      const monthYear = monthStart.getUTCFullYear();
      const monthNumber = monthStart.getUTCMonth() + 1;

      return {
        generated_at: now.toISOString(),
        month: parsed.data.month,
        month_label: `${monthYear}年${monthNumber}月分`,
        month_short_label: `${monthNumber}月分`,
        passed_count: base.passedCount,
        review_count: base.reviewCount,
        today_pending_count: base.todayPendingCount,
        review_rows: reviewRows,
        records: {
          rule_revision_label: formatReiwaRevisionLabel(
            base.latestRevisionRule?.effective_from ?? null,
          ),
          rejection_count: base.rejectionCount,
          summary_template_kind_count: base.templateKindCount,
        },
        rail: base.rail,
      } satisfies BillingCheckResponse;
    })();

    return success({ data });
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'billing_evidence_check_unhandled_error',
          route: req.nextUrl?.pathname ?? '/api/billing-evidence/check',
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
