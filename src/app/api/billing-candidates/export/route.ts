import { NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { validationError } from '@/lib/api/response';
import { readJsonObject, readJsonObjectString } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from '../billing-month';

function csvCell(value: string | number | null | undefined) {
  if (value == null) return '';
  const raw = String(value);
  const safe = /^[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function isSafeFilterId(value: string | null) {
  return !value || /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

function parseBillingDomain(value: string | null) {
  if (value === null || value === '') return undefined;
  return value === 'home_care' || value === 'pca_rental' ? value : null;
}

function readBillingTargetName(candidate: {
  billing_target_name?: string | null;
  source_snapshot: unknown;
}) {
  if (candidate.billing_target_name) return candidate.billing_target_name;
  const target = readJsonObject(readJsonObject(candidate.source_snapshot)?.billing_target);
  return typeof target?.name === 'string' ? target.name : '';
}

function readAmountYen(source: unknown, calculationBreakdown: unknown) {
  const breakdown = readJsonObject(calculationBreakdown);
  if (typeof breakdown?.amount_yen === 'number') return breakdown.amount_yen;
  const sourceRental = readJsonObject(readJsonObject(source)?.pca_rental);
  return typeof sourceRental?.amount_yen === 'number' ? sourceRental.amount_yen : '';
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const billingMonth = searchParams.get('billing_month');
    const patientId = searchParams.get('patient_id');
    const billingDomain = parseBillingDomain(searchParams.get('billing_domain'));

    const parsedBillingMonth = billingMonth === null ? null : parseStrictBillingMonth(billingMonth);
    if (billingMonth !== null && !parsedBillingMonth) {
      return validationError(BILLING_MONTH_FORMAT_MESSAGE);
    }
    if (!isSafeFilterId(patientId)) {
      return validationError('patient_id の形式が不正です');
    }
    if (billingDomain === null) {
      return validationError('billing_domain は home_care または pca_rental を指定してください');
    }

    const candidates = await withOrgContext(req.orgId, async (tx) => {
      const records = await tx.billingCandidate.findMany({
        where: {
          org_id: req.orgId,
          ...(parsedBillingMonth ? { billing_month: parsedBillingMonth.start } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
          ...(billingDomain ? { billing_domain: billingDomain } : {}),
          status: { in: ['confirmed', 'exported'] },
        },
        orderBy: [{ billing_month: 'desc' }, { billing_code: 'asc' }],
        select: {
          id: true,
          patient_id: true,
          billing_domain: true,
          billing_target_type: true,
          billing_target_id: true,
          billing_target_name: true,
          cycle_id: true,
          billing_month: true,
          billing_code: true,
          billing_name: true,
          points: true,
          calculation_breakdown: true,
          status: true,
          source_snapshot: true,
        },
      });

      const patientIds = Array.from(
        new Set(
          records
            .map((candidate) => candidate.patient_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
      );
      const cycleIds = Array.from(
        new Set(
          records
            .map((candidate) => candidate.cycle_id)
            .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
      );

      const [patients, residences, intakes] = await Promise.all([
        patientIds.length === 0
          ? []
          : tx.patient.findMany({
              where: {
                org_id: req.orgId,
                id: { in: patientIds },
              },
              select: {
                id: true,
                name: true,
              },
            }),
        patientIds.length === 0
          ? []
          : tx.residence.findMany({
              where: {
                org_id: req.orgId,
                patient_id: { in: patientIds },
                is_primary: true,
              },
              select: {
                patient_id: true,
                building_id: true,
                unit_name: true,
              },
            }),
        cycleIds.length === 0
          ? []
          : tx.prescriptionIntake.findMany({
              where: {
                org_id: req.orgId,
                cycle_id: { in: cycleIds },
              },
              orderBy: [{ cycle_id: 'asc' }, { prescribed_date: 'desc' }, { created_at: 'desc' }],
              select: {
                cycle_id: true,
                lines: {
                  select: {
                    drug_code: true,
                  },
                },
              },
            }),
      ]);

      const patientById = new Map(patients.map((patient) => [patient.id, patient]));
      const residenceByPatientId = new Map(
        residences.map((residence) => [residence.patient_id, residence]),
      );
      const yjCodesByCycleId = new Map<string, string[]>();
      for (const intake of intakes) {
        if (yjCodesByCycleId.has(intake.cycle_id)) continue;
        const yjCodes = Array.from(
          new Set(
            intake.lines
              .map((line) => line.drug_code?.trim() ?? '')
              .filter((code) => code.length > 0),
          ),
        ).sort((left, right) => left.localeCompare(right, 'ja'));
        yjCodesByCycleId.set(intake.cycle_id, yjCodes);
      }

      const candidates = records.map((candidate) => {
        const patient = candidate.patient_id
          ? (patientById.get(candidate.patient_id) ?? null)
          : null;
        const residence = candidate.patient_id
          ? (residenceByPatientId.get(candidate.patient_id) ?? null)
          : null;
        return {
          ...candidate,
          patient_name: patient?.name ?? '',
          billing_target_label:
            candidate.billing_target_type === 'institution'
              ? readBillingTargetName(candidate)
              : (patient?.name ?? candidate.patient_id ?? ''),
          building_id: residence?.building_id ?? '',
          unit_name: residence?.unit_name ?? '',
          yj_codes: candidate.cycle_id ? (yjCodesByCycleId.get(candidate.cycle_id) ?? []) : [],
          effective_revision_code:
            readJsonObjectString(candidate.source_snapshot, 'revision_code') ?? '',
          site_config_revision_code:
            readJsonObjectString(candidate.source_snapshot, 'site_config_revision_code') ?? '',
          amount_yen: readAmountYen(candidate.source_snapshot, candidate.calculation_breakdown),
        };
      });

      await recordDataExportAudit(tx, {
        orgId: req.orgId,
        actorId: req.userId,
        targetType: 'billing_candidate',
        format: 'csv',
        recordCount: candidates.length,
        filters: {
          billing_month: parsedBillingMonth?.canonical ?? null,
          patient_id: patientId ?? null,
          billing_domain: billingDomain ?? null,
          statuses: ['confirmed', 'exported'],
        },
        ipAddress: req.ipAddress,
        userAgent: req.userAgent,
      });

      return candidates;
    });

    const header = [
      'id',
      'patient_id',
      'patient_name',
      'billing_domain',
      'billing_target_type',
      'billing_target_id',
      'billing_target_name',
      'building_id',
      'unit_name',
      'billing_month',
      'billing_code',
      'billing_name',
      'effective_revision_code',
      'site_config_revision_code',
      'yj_codes',
      'points',
      'amount_yen',
      'status',
    ].join(',');

    const rows = candidates.map((c) => {
      const month =
        c.billing_month instanceof Date
          ? c.billing_month.toISOString().slice(0, 7)
          : String(c.billing_month);
      return [
        csvCell(c.id),
        csvCell(c.patient_id),
        csvCell(c.patient_name),
        csvCell(c.billing_domain),
        csvCell(c.billing_target_type),
        csvCell(c.billing_target_id),
        csvCell(c.billing_target_label),
        csvCell(c.building_id),
        csvCell(c.unit_name),
        csvCell(month),
        csvCell(c.billing_code),
        csvCell(c.billing_name),
        csvCell(c.effective_revision_code),
        csvCell(c.site_config_revision_code),
        csvCell(c.yj_codes.join('|')),
        csvCell(c.points ?? ''),
        csvCell(c.amount_yen),
        csvCell(c.status),
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const filename = parsedBillingMonth
      ? `billing_${parsedBillingMonth.canonical.slice(0, 7)}.csv`
      : 'billing_candidates.csv';
    const encodedFilename = encodeURIComponent(filename);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
      },
    });
  },
  {
    permission: 'canManageBilling',
    message: '請求候補のエクスポート権限がありません',
  },
);
