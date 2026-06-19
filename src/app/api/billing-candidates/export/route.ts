import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, error, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject, readJsonObjectString } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { recordDataExportAudit } from '@/server/services/export-audit';
import {
  ClaimsExportAdapterError,
  createClaimsExportAdapter,
  resolveClaimsExportConfig,
  type ClaimsExportRecord,
} from '@/server/adapters/claims-export';
import { resolveClaimsExportSiteId } from '@/server/services/claims-export-site';
import { BILLING_DOMAIN_ERROR_MESSAGE, parseOptionalBillingDomain } from '../billing-domain';
import { BILLING_MONTH_FORMAT_MESSAGE, parseStrictBillingMonth } from '../billing-month';
import { quotedCsvCell as csvCell } from '@/lib/csv/safe-csv';

type ExportFormat = 'csv' | 'claims-xml';

type ExportPreviewRecord = {
  billing_domain: string;
  points: number | null;
  quantity: number;
  status: string;
  exclusion_reason: string | null;
  calculation_breakdown: unknown;
  source_snapshot: unknown;
};

function parseExportFormat(value: string | null): ExportFormat | null {
  if (value === null || value === '') return 'csv';
  return value === 'csv' || value === 'claims-xml' ? value : null;
}

function parsePreviewMode(value: string | null) {
  return value === '1' || value === 'true';
}

function filenamePrefixFor(billingDomain: string) {
  return billingDomain === 'pca_rental' ? 'billing_pca_rental' : 'billing_home_care';
}

/**
 * 請求候補の billing_domain / payer_basis から CLAIMS-XML の保険区分を導出する。
 * pca_rental は自費（self）、home_care は payer_basis に応じて care / medical に振り分ける。
 */
function resolveInsuranceType(
  billingDomain: string,
  sourceSnapshot: unknown,
): ClaimsExportRecord['insuranceType'] {
  if (billingDomain === 'pca_rental') return 'self';
  return readJsonObjectString(sourceSnapshot, 'payer_basis') === 'care' ? 'care' : 'medical';
}

function isSafeFilterId(value: string | null) {
  return !value || /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

function hashBillingExportFilterId(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
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

function buildExportPreview(records: ExportPreviewRecord[]) {
  const statusCounts: Record<string, number> = {};
  const insuranceTypeCounts: Record<ClaimsExportRecord['insuranceType'], number> = {
    medical: 0,
    care: 0,
    self: 0,
  };
  const exclusionReasonCounts = new Map<string, number>();
  let exportableCount = 0;
  let totalPoints = 0;
  let totalAmountYen = 0;

  for (const record of records) {
    statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
    if (record.status === 'excluded' && record.exclusion_reason) {
      exclusionReasonCounts.set(
        record.exclusion_reason,
        (exclusionReasonCounts.get(record.exclusion_reason) ?? 0) + 1,
      );
    }
    if (record.status !== 'confirmed' && record.status !== 'exported') continue;

    exportableCount += 1;
    insuranceTypeCounts[resolveInsuranceType(record.billing_domain, record.source_snapshot)] += 1;
    if (typeof record.points === 'number') {
      totalPoints += record.points * record.quantity;
    }
    const amountYen = readAmountYen(record.source_snapshot, record.calculation_breakdown);
    if (typeof amountYen === 'number') {
      totalAmountYen += amountYen;
    }
  }

  return {
    total_count: records.length,
    exportable_count: exportableCount,
    total_points: totalPoints,
    total_amount_yen: totalAmountYen,
    status_counts: statusCounts,
    insurance_type_counts: insuranceTypeCounts,
    exclusion_reasons: Array.from(exclusionReasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)),
  };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const billingMonth = searchParams.get('billing_month');
    const patientId = searchParams.get('patient_id');
    const requestedBillingDomain = parseOptionalBillingDomain(searchParams.get('billing_domain'));
    const exportFormat = parseExportFormat(searchParams.get('format'));
    const preview = parsePreviewMode(searchParams.get('preview'));

    const parsedBillingMonth = billingMonth === null ? null : parseStrictBillingMonth(billingMonth);
    if (billingMonth !== null && !parsedBillingMonth) {
      return withSensitiveNoStore(validationError(BILLING_MONTH_FORMAT_MESSAGE));
    }
    if (!isSafeFilterId(patientId)) {
      return withSensitiveNoStore(validationError('patient_id の形式が不正です'));
    }
    if (requestedBillingDomain === null) {
      return withSensitiveNoStore(validationError(BILLING_DOMAIN_ERROR_MESSAGE));
    }
    if (exportFormat === null) {
      return withSensitiveNoStore(
        validationError('format は csv または claims-xml を指定してください'),
      );
    }
    const billingDomain = requestedBillingDomain ?? 'home_care';

    if (preview) {
      const previewData = await withOrgContext(ctx.orgId, async (tx) => {
        const records = await tx.billingCandidate.findMany({
          where: {
            org_id: ctx.orgId,
            ...(parsedBillingMonth ? { billing_month: parsedBillingMonth.start } : {}),
            ...(patientId ? { patient_id: patientId } : {}),
            billing_domain: billingDomain,
          },
          select: {
            billing_domain: true,
            points: true,
            quantity: true,
            status: true,
            exclusion_reason: true,
            calculation_breakdown: true,
            source_snapshot: true,
          },
        });

        return buildExportPreview(records);
      });

      return withSensitiveNoStore(
        NextResponse.json({
          data: {
            ...previewData,
            billing_month: parsedBillingMonth?.canonical ?? null,
            billing_domain: billingDomain,
            generated_at: new Date().toISOString(),
          },
        }),
      );
    }

    const exportResult = await withOrgContext(ctx.orgId, async (tx) => {
      const records = await tx.billingCandidate.findMany({
        where: {
          org_id: ctx.orgId,
          ...(parsedBillingMonth ? { billing_month: parsedBillingMonth.start } : {}),
          ...(patientId ? { patient_id: patientId } : {}),
          billing_domain: billingDomain,
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
      if (records.length === 0) return { kind: 'empty' as const };

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
                org_id: ctx.orgId,
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
                org_id: ctx.orgId,
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
                org_id: ctx.orgId,
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

      return { kind: 'records' as const, candidates };
    });
    if (exportResult.kind === 'empty') {
      return withSensitiveNoStore(
        conflict('確定済みまたは締め済みの請求候補がないためエクスポートできません', {
          billing_month: parsedBillingMonth?.canonical ?? null,
          patient_filter: patientId ? 'specified' : null,
          billing_domain: billingDomain,
          statuses: ['confirmed', 'exported'],
        }),
      );
    }
    const candidates = exportResult.candidates;

    const recordExportAudit = async (metadata?: Record<string, unknown>) => {
      try {
        await withOrgContext(ctx.orgId, (tx) =>
          recordDataExportAudit(tx, {
            orgId: ctx.orgId,
            actorId: ctx.userId,
            targetType: 'billing_candidate',
            format: exportFormat,
            recordCount: candidates.length,
            filters: {
              billing_month: parsedBillingMonth?.canonical ?? null,
              patient_filter: patientId ? 'specified' : null,
              billing_domain: billingDomain,
              statuses: ['confirmed', 'exported'],
            },
            metadata: {
              export_format: exportFormat,
              patient_filter_hash: patientId ? hashBillingExportFilterId(patientId) : null,
              ...metadata,
            },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          }),
        );
        return null;
      } catch {
        return withSensitiveNoStore(
          error(
            'BILLING_EXPORT_AUDIT_FAILED',
            '請求候補のエクスポート監査を記録できませんでした',
            500,
          ),
        );
      }
    };

    const monthOf = (value: Date | string) =>
      value instanceof Date ? value.toISOString().slice(0, 7) : String(value).slice(0, 7);

    if (exportFormat === 'claims-xml') {
      const siteResolution = resolveClaimsExportSiteId(candidates);
      if (!siteResolution.ok) {
        return withSensitiveNoStore(
          error(
            'CLAIMS_EXPORT_SITE_UNRESOLVED',
            siteResolution.reason === 'missing_site_id'
              ? 'CLAIMS-XML の薬局拠点を解決できません'
              : 'CLAIMS-XML は単一薬局拠点の候補だけをエクスポートできます',
            422,
            {
              reason: siteResolution.reason,
              missing_count: siteResolution.missingCount,
              site_count: siteResolution.siteCount,
            },
          ),
        );
      }
      const records: ClaimsExportRecord[] = candidates.map((c) => ({
        patientId: c.patient_id ?? '',
        patientName: c.patient_name,
        billingMonth: monthOf(c.billing_month),
        insuranceType: resolveInsuranceType(c.billing_domain, c.source_snapshot),
        billingCode: c.billing_code ?? '',
        billingName: c.billing_name ?? '',
        points: typeof c.points === 'number' ? c.points : 0,
        status: c.status,
      }));

      const auditFailureResponse = await recordExportAudit({ audit_phase: 'attempt' });
      if (auditFailureResponse) return auditFailureResponse;

      const adapter = createClaimsExportAdapter(resolveClaimsExportConfig());
      let result;
      try {
        result = await adapter.exportClaims({
          orgId: ctx.orgId,
          siteId: siteResolution.siteId,
          billingMonth: parsedBillingMonth ? parsedBillingMonth.canonical.slice(0, 7) : '',
          records,
        });
      } catch (cause) {
        if (cause instanceof ClaimsExportAdapterError) {
          return withSensitiveNoStore(
            error(
              'CLAIMS_EXPORT_FAILED',
              'CLAIMS-XML の生成に失敗しました',
              cause.retriable ? 502 : 422,
              { code: cause.code },
            ),
          );
        }
        throw cause;
      }

      const successAuditFailureResponse = await recordExportAudit({
        audit_phase: 'success',
        claims_record_count: result.recordCount,
        site_id: siteResolution.siteId,
      });
      if (successAuditFailureResponse) return successAuditFailureResponse;

      const xmlFilename = parsedBillingMonth
        ? `${filenamePrefixFor(billingDomain)}_${parsedBillingMonth.canonical.slice(0, 7)}.xml`
        : `${filenamePrefixFor(billingDomain)}_candidates.xml`;
      const encodedXmlFilename = encodeURIComponent(xmlFilename);

      return withSensitiveNoStore(
        new NextResponse(result.content, {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Content-Disposition': `attachment; filename="${encodedXmlFilename}"; filename*=UTF-8''${encodedXmlFilename}`,
          },
        }),
      );
    }

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
    const filenamePrefix = filenamePrefixFor(billingDomain);
    const filename = parsedBillingMonth
      ? `${filenamePrefix}_${parsedBillingMonth.canonical.slice(0, 7)}.csv`
      : `${filenamePrefix}_candidates.csv`;
    const encodedFilename = encodeURIComponent(filename);

    const auditFailureResponse = await recordExportAudit();
    if (auditFailureResponse) return auditFailureResponse;

    return withSensitiveNoStore(
      new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`,
        },
      }),
    );
  },
  {
    permission: 'canManageBilling',
    message: '請求候補のエクスポート権限がありません',
  },
);
