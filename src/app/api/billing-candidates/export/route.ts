import { NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { recordDataExportAudit } from '@/server/services/export-audit';

function csvCell(value: string | number | null | undefined) {
  if (value == null) return '';
  const raw = String(value);
  const safe = /^[=+\-@\t\r\n]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function parseBillingMonth(value: string | null) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-01$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month - 1, 1));
}

function isSafeFilterId(value: string | null) {
  return !value || /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const billingMonth = searchParams.get('billing_month');
    const patientId = searchParams.get('patient_id');

    const billingMonthDate = parseBillingMonth(billingMonth);
    if (billingMonth && !billingMonthDate) {
      return validationError('billing_month は YYYY-MM-01 形式で指定してください');
    }
    if (!isSafeFilterId(patientId)) {
      return validationError('patient_id の形式が不正です');
    }

    const candidates = await withOrgContext(req.orgId, async (tx) => {
      const records = await tx.billingCandidate.findMany({
        where: {
          org_id: req.orgId,
          ...(billingMonthDate ? { billing_month: billingMonthDate } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
          status: { in: ['confirmed', 'exported'] },
        },
        orderBy: [{ billing_month: 'desc' }, { billing_code: 'asc' }],
        select: {
          id: true,
          patient_id: true,
          cycle_id: true,
          billing_month: true,
          billing_code: true,
          billing_name: true,
          points: true,
          status: true,
          source_snapshot: true,
        },
      });

      const patientIds = Array.from(new Set(records.map((candidate) => candidate.patient_id)));
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
        const patient = patientById.get(candidate.patient_id) ?? null;
        const residence = residenceByPatientId.get(candidate.patient_id) ?? null;
        return {
          ...candidate,
          patient_name: patient?.name ?? '',
          building_id: residence?.building_id ?? '',
          unit_name: residence?.unit_name ?? '',
          yj_codes: candidate.cycle_id ? (yjCodesByCycleId.get(candidate.cycle_id) ?? []) : [],
          effective_revision_code:
            typeof (candidate.source_snapshot as Record<string, unknown> | null)?.revision_code ===
            'string'
              ? ((candidate.source_snapshot as Record<string, unknown>).revision_code as string)
              : '',
          site_config_revision_code:
            typeof (candidate.source_snapshot as Record<string, unknown> | null)
              ?.site_config_revision_code === 'string'
              ? ((candidate.source_snapshot as Record<string, unknown>)
                  .site_config_revision_code as string)
              : '',
        };
      });

      await recordDataExportAudit(tx, {
        orgId: req.orgId,
        actorId: req.userId,
        targetType: 'billing_candidate',
        format: 'csv',
        recordCount: candidates.length,
        filters: {
          billing_month: billingMonth ?? null,
          patient_id: patientId ?? null,
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
      'building_id',
      'unit_name',
      'billing_month',
      'billing_code',
      'billing_name',
      'effective_revision_code',
      'site_config_revision_code',
      'yj_codes',
      'points',
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
        csvCell(c.building_id),
        csvCell(c.unit_name),
        csvCell(month),
        csvCell(c.billing_code),
        csvCell(c.billing_name),
        csvCell(c.effective_revision_code),
        csvCell(c.site_config_revision_code),
        csvCell(c.yj_codes.join('|')),
        csvCell(c.points ?? ''),
        csvCell(c.status),
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const filename = billingMonth
      ? `billing_${billingMonth.slice(0, 7)}.csv`
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
    permission: 'canReport',
    message: '請求候補のエクスポート権限がありません',
  },
);
