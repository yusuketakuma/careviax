import type { VisitBillingStatus } from '@prisma/client';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { withOrgContext } from '@/lib/db/rls';
import {
  evaluateVisitBillingCandidate,
  findActivePatientShareConsent,
  resolvePharmacyVisitRequestTransition,
  type VisitBillingCandidateBlocker,
} from '@/server/services/pharmacy-partnerships';
import {
  BILLING_MONTH_FORMAT_MESSAGE,
  parseStrictBillingMonth,
} from '../billing-candidates/billing-month';

type VisitBillingCandidateGenerationBlocker = VisitBillingCandidateBlocker | 'amount_unresolved';

const visitBillingStatusValues: readonly VisitBillingStatus[] = [
  'candidate',
  'confirmed',
  'excluded',
  'invoiced',
  'voided',
];

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

function optionalBodyString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateVisitBillingStatus(value: string | undefined) {
  if (!value) return { ok: true as const, status: undefined };
  if (visitBillingStatusValues.includes(value as VisitBillingStatus)) {
    return { ok: true as const, status: value as VisitBillingStatus };
  }
  return { ok: false as const };
}

function candidateAmountSnapshot(args: {
  blockers: VisitBillingCandidateGenerationBlocker[];
  feeRule: {
    id: string;
    billing_model: string;
    unit_price: number | null;
    tax_category: string;
    tax_rate_bp: number | null;
  } | null;
}) {
  const feeRule = args.feeRule;
  const amount =
    feeRule?.billing_model === 'free'
      ? 0
      : feeRule?.billing_model === 'fixed_per_visit' ||
          feeRule?.billing_model === 'per_visit_with_addon'
        ? (feeRule.unit_price ?? null)
        : null;

  return {
    blockers: args.blockers,
    fee_rule_id: feeRule?.id ?? null,
    billing_model: feeRule?.billing_model ?? null,
    unit_price: feeRule?.unit_price ?? null,
    amount,
    tax_category: feeRule?.tax_category ?? null,
    tax_rate_bp: feeRule?.tax_rate_bp ?? null,
  };
}

function readCandidateAmountSnapshot(value: unknown) {
  const snapshot = readJsonObject(value);
  const blockers = snapshot?.blockers;
  return {
    billing_model: typeof snapshot?.billing_model === 'string' ? snapshot.billing_model : null,
    amount:
      typeof snapshot?.amount === 'number' && Number.isFinite(snapshot.amount)
        ? snapshot.amount
        : null,
    tax_category: typeof snapshot?.tax_category === 'string' ? snapshot.tax_category : null,
    tax_rate_bp:
      typeof snapshot?.tax_rate_bp === 'number' && Number.isFinite(snapshot.tax_rate_bp)
        ? snapshot.tax_rate_bp
        : null,
    blocker_codes: Array.isArray(blockers)
      ? blockers.filter((blocker): blocker is string => typeof blocker === 'string')
      : [],
  };
}

function toSafeVisitBillingCandidate<T extends object>(row: T) {
  const source = row as T & { amount_snapshot?: unknown };
  const { amount_snapshot: amountSnapshot, ...safe } = source;
  return {
    ...safe,
    amount_summary: readCandidateAmountSnapshot(amountSnapshot),
  };
}

function canUpdateExistingCandidate(candidate: {
  billing_status: VisitBillingStatus;
  invoice_items?: unknown[];
}) {
  return (
    (candidate.billing_status === 'candidate' || candidate.billing_status === 'excluded') &&
    (candidate.invoice_items?.length ?? 0) === 0
  );
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const billingMonthInput = searchParams.get('billing_month');
    const billingMonth =
      billingMonthInput === null ? null : parseStrictBillingMonth(billingMonthInput);
    if (billingMonthInput !== null && !billingMonth) {
      return withSensitiveNoStore(validationError(BILLING_MONTH_FORMAT_MESSAGE));
    }

    const rawStatusResult = readPresentOptionalSearchParam(
      searchParams,
      'status',
      'ステータスを指定してください',
    );
    if (!rawStatusResult.ok) return rawStatusResult.response;
    const statusResult = validateVisitBillingStatus(rawStatusResult.value);
    if (!statusResult.ok) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', {
          status: ['対応していないステータスです'],
        }),
      );
    }
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

    const rows = await withOrgContext(ctx.orgId, (tx) =>
      tx.visitBillingCandidate.findMany({
        where: {
          org_id: ctx.orgId,
          ...(billingMonth ? { billing_month: billingMonth.start } : {}),
          ...(statusResult.status ? { billing_status: statusResult.status } : {}),
          ...(shareCaseId || partnerPharmacyId
            ? {
                partner_visit_record: {
                  ...(shareCaseId ? { share_case_id: shareCaseId } : {}),
                  ...(partnerPharmacyId ? { owner_partner_pharmacy_id: partnerPharmacyId } : {}),
                },
              }
            : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        include: {
          partner_visit_record: {
            select: {
              id: true,
              share_case_id: true,
              owner_partner_pharmacy_id: true,
              visit_at: true,
              status: true,
              confirmed_at: true,
              owner_partner_pharmacy: { select: { id: true, name: true, status: true } },
            },
          },
          contract_version: { select: { id: true, version_no: true, effective_from: true } },
        },
      }),
    );

    const page = buildCursorPage(rows, limit, (row) => row.id);
    return withSensitiveNoStore(
      success({
        ...page,
        data: page.data.map(toSafeVisitBillingCandidate),
      }),
    );
  },
  {
    permission: 'canManageBilling',
    message: '薬局間協力訪問の請求候補閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const billingMonthValue = payload.billing_month;
    if (!billingMonthValue)
      return withSensitiveNoStore(validationError('billing_month は必須です'));
    const billingMonth = parseStrictBillingMonth(billingMonthValue);
    if (!billingMonth) return withSensitiveNoStore(validationError(BILLING_MONTH_FORMAT_MESSAGE));

    const shareCaseId = optionalBodyString(payload.share_case_id);
    const partnerPharmacyId = optionalBodyString(payload.partner_pharmacy_id);

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const records = await tx.partnerVisitRecord.findMany({
        where: {
          org_id: ctx.orgId,
          status: 'confirmed',
          confirmed_at: { not: null },
          visit_at: { gte: billingMonth.start, lt: billingMonth.nextStart },
          ...(shareCaseId ? { share_case_id: shareCaseId } : {}),
          ...(partnerPharmacyId ? { owner_partner_pharmacy_id: partnerPharmacyId } : {}),
          visit_request: {
            status: { in: ['confirmed', 'physician_report_created', 'claim_checked', 'completed'] },
          },
        },
        select: {
          id: true,
          status: true,
          visit_at: true,
          confirmed_at: true,
          visit_request: {
            select: {
              id: true,
              status: true,
              contract_version_id: true,
            },
          },
          share_case: {
            select: {
              partnership_id: true,
              consents: {
                select: {
                  consent_date: true,
                  valid_until: true,
                  revoked_at: true,
                },
                orderBy: { created_at: 'desc' },
              },
            },
          },
        },
      });

      const candidates = [];
      let billableCount = 0;
      let excludedCount = 0;
      let skippedLockedCount = 0;
      const recordIds = records.map((record) => record.id);
      const existingCandidates =
        recordIds.length === 0
          ? []
          : await tx.visitBillingCandidate.findMany({
              where: {
                org_id: ctx.orgId,
                partner_visit_record_id: { in: recordIds },
              },
              select: {
                id: true,
                partner_visit_record_id: true,
                billing_status: true,
                invoice_items: {
                  select: { id: true },
                  take: 1,
                },
              },
            });
      const existingCandidatesByRecordId = new Map(
        existingCandidates.map((candidate) => [candidate.partner_visit_record_id, candidate]),
      );

      for (const record of records) {
        const contractVersion = await tx.pharmacyContractVersion.findFirst({
          where: record.visit_request.contract_version_id
            ? {
                id: record.visit_request.contract_version_id,
                org_id: ctx.orgId,
                status: 'active',
              }
            : {
                org_id: ctx.orgId,
                status: 'active',
                effective_from: { lte: record.visit_at },
                OR: [{ effective_to: null }, { effective_to: { gte: record.visit_at } }],
                contract: {
                  partnership_id: record.share_case.partnership_id,
                  status: 'active',
                },
              },
          include: {
            fee_rules: {
              where: { is_active: true },
              orderBy: { created_at: 'asc' },
              take: 1,
            },
          },
        });
        const activeConsent = findActivePatientShareConsent(
          record.share_case.consents,
          record.visit_at,
        );
        const evaluation = evaluateVisitBillingCandidate({
          request: record.visit_request,
          record,
          activeConsent,
          contractVersion,
          billingMonth: billingMonth.start,
        });
        const blockers: VisitBillingCandidateGenerationBlocker[] = evaluation.billable
          ? []
          : [...evaluation.blockers];
        const amountSnapshot = candidateAmountSnapshot({
          blockers,
          feeRule: contractVersion?.fee_rules[0] ?? null,
        });
        const hasResolvedAmount =
          amountSnapshot.amount !== null || amountSnapshot.billing_model === 'free';
        if (evaluation.billable && !hasResolvedAmount) {
          blockers.push('amount_unresolved');
        }
        const isBillable = evaluation.billable && hasResolvedAmount;

        if (isBillable) billableCount += 1;
        else excludedCount += 1;

        const candidateKey = {
          org_id: ctx.orgId,
          partner_visit_record_id: record.id,
        };
        const candidateData = {
          contract_version_id: contractVersion?.id,
          billing_month: billingMonth.start,
          billing_status: isBillable ? ('candidate' as const) : ('excluded' as const),
          is_billable: isBillable,
          exclusion_reason: blockers.length > 0 ? blockers.join(',') : null,
          amount_snapshot: toPrismaJsonInput(amountSnapshot),
        };
        const existingCandidate = existingCandidatesByRecordId.get(record.id);

        let candidate;
        if (existingCandidate) {
          const canUpdate = canUpdateExistingCandidate(existingCandidate);
          candidate = canUpdate
            ? await tx.visitBillingCandidate.update({
                where: { id_org_id: { id: existingCandidate.id, org_id: ctx.orgId } },
                data: candidateData,
              })
            : existingCandidate;
          if (!canUpdate) skippedLockedCount += 1;
        } else {
          try {
            candidate = await tx.visitBillingCandidate.create({
              data: {
                org_id: ctx.orgId,
                partner_visit_record_id: record.id,
                ...candidateData,
              },
            });
          } catch (error) {
            if (!isPrismaUniqueConstraintError(error)) throw error;
            const concurrentCandidate = await tx.visitBillingCandidate.findUnique({
              where: {
                org_id_partner_visit_record_id: {
                  org_id: candidateKey.org_id,
                  partner_visit_record_id: candidateKey.partner_visit_record_id,
                },
              },
              select: {
                id: true,
                billing_status: true,
                invoice_items: {
                  select: { id: true },
                  take: 1,
                },
              },
            });
            if (!concurrentCandidate) throw error;
            const canUpdate = canUpdateExistingCandidate(concurrentCandidate);
            candidate = canUpdate
              ? await tx.visitBillingCandidate.update({
                  where: { id_org_id: { id: concurrentCandidate.id, org_id: ctx.orgId } },
                  data: candidateData,
                })
              : concurrentCandidate;
            if (!canUpdate) skippedLockedCount += 1;
          }
        }
        candidates.push(candidate);
        const claimCheckedTransition = resolvePharmacyVisitRequestTransition({
          currentStatus: record.visit_request.status,
          action: 'mark_claim_checked',
        });
        if (claimCheckedTransition.allowed) {
          await tx.pharmacyVisitRequest.updateMany({
            where: {
              id: record.visit_request.id,
              org_id: ctx.orgId,
              status: { in: [...claimCheckedTransition.allowedFrom] },
            },
            data: { status: claimCheckedTransition.nextStatus },
          });
        }
      }

      await createAuditLogEntry(tx, ctx, {
        action: 'visit_billing_candidates_generated',
        targetType: 'VisitBillingCandidate',
        targetId: billingMonth.canonical,
        changes: {
          billing_month: billingMonth.canonical,
          share_case_id: shareCaseId ?? null,
          partner_pharmacy_id: partnerPharmacyId ?? null,
          scanned_confirmed_records: records.length,
          generated_candidates: candidates.length,
          billable_count: billableCount,
          excluded_count: excludedCount,
          skipped_locked_count: skippedLockedCount,
        },
      });

      const candidateIds = candidates.map((candidate) => candidate.id);
      return {
        billing_month: billingMonth.canonical,
        scanned_confirmed_records: records.length,
        generated_candidates: candidates.length,
        billable_count: billableCount,
        excluded_count: excludedCount,
        skipped_locked_count: skippedLockedCount,
        candidate_ids: candidateIds.slice(0, 20),
        candidate_ids_truncated: candidateIds.length > 20,
      };
    });

    return withSensitiveNoStore(
      success({
        message: `${billingMonth.canonical} の薬局間協力訪問請求候補を生成しました`,
        ...result,
      }),
    );
  },
  {
    permission: 'canManageBilling',
    message: '薬局間協力訪問の請求候補作成権限がありません',
  },
);
