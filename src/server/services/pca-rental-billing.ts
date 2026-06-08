import type { Prisma } from '@prisma/client';
import { normalizeJsonInput } from '@/lib/db/json';
import {
  japanMonthRangeForBillingMonth,
  readBillingCandidateWorkflowState,
  startOfMonth,
  writeBillingCandidateWorkflowState,
  type Tx,
} from './billing-evidence';

type PcaRentalBillingTx = {
  pcaPumpRental: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        institution_id: string;
        rented_at: Date;
        due_at: Date | null;
        returned_at: Date | null;
        rental_fee_yen: number | null;
        contact_name: string | null;
        pump: {
          id: string;
          asset_code: string;
          model_name: string;
          serial_number: string | null;
        };
        institution: {
          id: string;
          name: string;
          institution_code: string | null;
        };
      }>
    >;
  };
  billingCandidate: {
    findMany(args: unknown): Promise<
      Array<{
        dedupe_key: string | null;
        source_snapshot: Prisma.JsonValue | null;
      }>
    >;
    upsert(args: unknown): Promise<{ status: string }>;
    deleteMany(args: unknown): Promise<unknown>;
  };
};

type GeneratedPcaRentalBillingCandidate = { status: string };

function toInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const normalized = normalizeJsonInput(value);
  return typeof normalized === 'object' &&
    normalized !== null &&
    !Array.isArray(normalized) &&
    !('toJSON' in normalized)
    ? (normalized as Prisma.InputJsonObject)
    : {};
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function generatePcaRentalBillingCandidatesForMonth(
  tx: Tx,
  args: { orgId: string; billingMonth: Date },
): Promise<GeneratedPcaRentalBillingCandidate[]>;
export async function generatePcaRentalBillingCandidatesForMonth(
  tx: PcaRentalBillingTx,
  args: { orgId: string; billingMonth: Date },
): Promise<GeneratedPcaRentalBillingCandidate[]>;
export async function generatePcaRentalBillingCandidatesForMonth(
  tx: Tx | PcaRentalBillingTx,
  args: { orgId: string; billingMonth: Date },
): Promise<GeneratedPcaRentalBillingCandidate[]> {
  const db = tx as PcaRentalBillingTx;
  const billingMonth = startOfMonth(args.billingMonth);
  const monthRange = japanMonthRangeForBillingMonth(billingMonth);
  const monthKey = dateKey(billingMonth);

  const rentals = await db.pcaPumpRental.findMany({
    where: {
      org_id: args.orgId,
      status: { not: 'cancelled' },
      rental_fee_yen: { gt: 0 },
      rented_at: { lt: monthRange.nextStart },
      OR: [{ returned_at: null }, { returned_at: { gte: monthRange.start } }],
    },
    orderBy: [{ rented_at: 'asc' }, { created_at: 'asc' }],
    select: {
      id: true,
      institution_id: true,
      rented_at: true,
      due_at: true,
      returned_at: true,
      rental_fee_yen: true,
      contact_name: true,
      pump: {
        select: {
          id: true,
          asset_code: true,
          model_name: true,
          serial_number: true,
        },
      },
      institution: {
        select: {
          id: true,
          name: true,
          institution_code: true,
        },
      },
    },
  });

  const dedupeKeys = rentals.map((rental) => `pca-rental:${monthKey}:${rental.id}`);
  const existingCandidates =
    dedupeKeys.length === 0
      ? []
      : await db.billingCandidate.findMany({
          where: {
            org_id: args.orgId,
            billing_month: billingMonth,
            billing_domain: 'pca_rental',
            dedupe_key: { in: dedupeKeys },
          },
          select: {
            dedupe_key: true,
            source_snapshot: true,
          },
        });
  const existingByKey = new Map(
    existingCandidates
      .filter((candidate) => candidate.dedupe_key)
      .map((candidate) => [candidate.dedupe_key as string, candidate]),
  );

  const generated: GeneratedPcaRentalBillingCandidate[] = [];
  for (const rental of rentals) {
    if (!rental.rental_fee_yen || rental.rental_fee_yen <= 0) continue;

    const dedupeKey = `pca-rental:${monthKey}:${rental.id}`;
    const existing = existingByKey.get(dedupeKey);
    const workflow = readBillingCandidateWorkflowState(existing?.source_snapshot);
    const status = workflow.closed_at
      ? 'exported'
      : workflow.resolution_state === 'confirmed'
        ? 'confirmed'
        : workflow.resolution_state === 'excluded'
          ? 'excluded'
          : 'candidate';
    const calculationBreakdown = toInputJsonObject({
      calculation_unit: 'yen',
      amount_yen: rental.rental_fee_yen,
      rental_month: monthKey,
      rental_period: {
        rented_at: dateKey(rental.rented_at),
        due_at: rental.due_at ? dateKey(rental.due_at) : null,
        returned_at: rental.returned_at ? dateKey(rental.returned_at) : null,
      },
    });
    const sourceSnapshot = writeBillingCandidateWorkflowState(
      {
        source_type: 'pca_pump_rental',
        source_entity_id: rental.id,
        billing_scope: 'pca_pump_rental',
        selection_mode: 'manual',
        source_note: 'PCAポンプレンタルの医療機関向け請求候補',
        billing_target: {
          type: 'institution',
          id: rental.institution.id,
          name: rental.institution.name,
          institution_code: rental.institution.institution_code,
        },
        pca_rental: {
          rental_id: rental.id,
          pump_id: rental.pump.id,
          pump_asset_code: rental.pump.asset_code,
          pump_model_name: rental.pump.model_name,
          pump_serial_number: rental.pump.serial_number,
          contact_name: rental.contact_name,
        },
        validation_layers: {
          evidence: {
            label: 'PCA貸出台帳',
            state: 'passed',
            message: '貸出期間と請求予定額を確認済み',
          },
          rule_engine: {
            label: 'レンタル請求',
            state: 'manual_review',
            message: '医療機関向けレンタル請求として月次レビューで確定してください',
          },
          close_review: {
            label: '月次締めレビュー',
            state: status === 'confirmed' || status === 'exported' ? 'passed' : 'manual_review',
            message:
              status === 'confirmed' || status === 'exported' ? 'レビュー完了' : 'レビュー待ち',
          },
        },
      },
      workflow,
    );

    const candidate = await db.billingCandidate.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: args.orgId,
          dedupe_key: dedupeKey,
        },
      },
      create: {
        org_id: args.orgId,
        patient_id: null,
        billing_domain: 'pca_rental',
        billing_target_type: 'institution',
        billing_target_id: rental.institution.id,
        billing_target_name: rental.institution.name,
        cycle_id: null,
        evidence_id: null,
        rule_id: null,
        dedupe_key: dedupeKey,
        billing_month: billingMonth,
        billing_code: 'PCA_PUMP_RENTAL',
        billing_name: 'PCAポンプレンタル料',
        points: null,
        quantity: 1,
        calculation_breakdown: calculationBreakdown,
        source_snapshot: sourceSnapshot,
        status,
        exclusion_reason:
          status === 'excluded' ? (workflow.note ?? 'PCAレンタル請求から除外') : null,
      },
      update: {
        billing_domain: 'pca_rental',
        billing_target_type: 'institution',
        billing_target_id: rental.institution.id,
        billing_target_name: rental.institution.name,
        billing_name: 'PCAポンプレンタル料',
        points: null,
        quantity: 1,
        calculation_breakdown: calculationBreakdown,
        source_snapshot: sourceSnapshot,
        status,
        exclusion_reason:
          status === 'excluded' ? (workflow.note ?? 'PCAレンタル請求から除外') : null,
      },
    });

    generated.push(candidate);
  }

  await db.billingCandidate.deleteMany({
    where: {
      org_id: args.orgId,
      billing_month: billingMonth,
      billing_domain: 'pca_rental',
      source_snapshot: {
        path: ['source_type'],
        equals: 'pca_pump_rental',
      },
      status: { not: 'exported' },
      ...(dedupeKeys.length > 0 ? { dedupe_key: { notIn: dedupeKeys } } : {}),
    },
  });

  return generated;
}
