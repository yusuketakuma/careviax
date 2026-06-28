import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { internalError, validationError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import {
  BILLING_MONTH_FORMAT_MESSAGE,
  parseStrictBillingMonth,
} from '../../billing-candidates/billing-month';

const ROUTE_PATH = '/api/visit-billing-candidates/summary';
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'AggregateError',
]);

function safeErrorName(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  return SAFE_ERROR_NAMES.has(err.name) ? err.name : 'Error';
}

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const value = optionalSearchParam(searchParams.get(name));
  if (searchParams.has(name) && !value) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(validationError('検索条件が不正です', { [name]: [message] })),
    };
  }
  return { ok: true as const, value };
}

function readAmountSnapshot(value: unknown) {
  const object = readJsonObject(value);
  const amount = object?.amount;
  const billingModel = object?.billing_model;
  return {
    amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
    billingModel: typeof billingModel === 'string' ? billingModel : null,
  };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canManageBilling',
    message: '薬局間協力訪問の月次実績閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const { searchParams } = new URL(req.url);
    const billingMonthInput = searchParams.get('billing_month');
    if (!billingMonthInput)
      return withSensitiveNoStore(validationError('billing_month は必須です'));
    const billingMonth = parseStrictBillingMonth(billingMonthInput);
    if (!billingMonth) return withSensitiveNoStore(validationError(BILLING_MONTH_FORMAT_MESSAGE));

    const shareCaseIdResult = readPresentOptionalSearchParam(
      searchParams,
      'share_case_id',
      '患者共有ケースIDを指定してください',
    );
    if (!shareCaseIdResult.ok) return shareCaseIdResult.response;
    const partnerPharmacyIdResult = readPresentOptionalSearchParam(
      searchParams,
      'partner_pharmacy_id',
      '協力薬局IDを指定してください',
    );
    if (!partnerPharmacyIdResult.ok) return partnerPharmacyIdResult.response;
    const shareCaseId = shareCaseIdResult.value;
    const partnerPharmacyId = partnerPharmacyIdResult.value;
    const recordFilter =
      shareCaseId || partnerPharmacyId
        ? {
            ...(shareCaseId ? { share_case_id: shareCaseId } : {}),
            ...(partnerPharmacyId ? { owner_partner_pharmacy_id: partnerPharmacyId } : {}),
          }
        : {};

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const [totalVisitRecords, confirmedVisitRecords, candidateRows] = await Promise.all([
          tx.partnerVisitRecord.count({
            where: {
              org_id: ctx.orgId,
              visit_at: { gte: billingMonth.start, lt: billingMonth.nextStart },
              ...recordFilter,
            },
          }),
          tx.partnerVisitRecord.count({
            where: {
              org_id: ctx.orgId,
              status: 'confirmed',
              confirmed_at: { not: null },
              visit_at: { gte: billingMonth.start, lt: billingMonth.nextStart },
              ...recordFilter,
            },
          }),
          tx.visitBillingCandidate.findMany({
            where: {
              org_id: ctx.orgId,
              billing_month: billingMonth.start,
              ...(shareCaseId || partnerPharmacyId
                ? {
                    partner_visit_record: recordFilter,
                  }
                : {}),
            },
            select: {
              id: true,
              billing_status: true,
              is_billable: true,
              amount_snapshot: true,
            },
          }),
        ]);

        let freeCount = 0;
        let paidCount = 0;
        let plannedAmount = 0;
        let billableCount = 0;
        let excludedCount = 0;
        let invoicedCount = 0;

        for (const candidate of candidateRows) {
          if (candidate.billing_status === 'excluded') excludedCount += 1;
          if (candidate.billing_status === 'invoiced') invoicedCount += 1;
          if (!candidate.is_billable) continue;

          billableCount += 1;
          const snapshot = readAmountSnapshot(candidate.amount_snapshot);
          if (snapshot.billingModel === 'free') {
            freeCount += 1;
            continue;
          }
          paidCount += 1;
          plannedAmount += snapshot.amount ?? 0;
        }

        return {
          billing_month: billingMonth.canonical,
          filters: {
            share_case_id: shareCaseId ?? null,
            partner_pharmacy_id: partnerPharmacyId ?? null,
          },
          visit_record_count: totalVisitRecords,
          confirmed_visit_record_count: confirmedVisitRecords,
          unconfirmed_visit_record_count: Math.max(totalVisitRecords - confirmedVisitRecords, 0),
          generated_candidate_count: candidateRows.length,
          billable_candidate_count: billableCount,
          excluded_candidate_count: excludedCount,
          invoiced_candidate_count: invoicedCount,
          free_candidate_count: freeCount,
          paid_candidate_count: paidCount,
          planned_invoice_amount: plannedAmount,
          pending_candidate_generation_count: Math.max(
            confirmedVisitRecords - candidateRows.length,
            0,
          ),
        };
      },
      { requestContext: ctx },
    );

    return withSensitiveNoStore(success(result));
  });
}

export async function GET(req: NextRequest, routeContext?: unknown) {
  void routeContext;

  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error('visit_billing_candidates_summary_unhandled_error', undefined, {
        event: 'visit_billing_candidates_summary_unhandled_error',
        route: ROUTE_PATH,
        method: req.method,
        status: 500,
        error_name: safeErrorName(err),
      });
      return withSensitiveNoStore(internalError());
    }
  });
}
