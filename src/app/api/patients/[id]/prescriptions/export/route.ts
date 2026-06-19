import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { forbiddenResponse, notFound, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { formatDateKey, formatNullableDateKey } from '@/lib/date-key';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { listAccessiblePatientCaseIds } from '@/server/services/patient-access';
import { minimalCsvRow as buildCsvRow } from '@/lib/csv/safe-csv';

const BOM = '\uFEFF';

/**
 * GET /api/patients/[id]/prescriptions/export
 *
 * 患者の処方履歴を CSV 形式でエクスポートする（BOM 付き UTF-8、Excel 対応）。
 * 各処方の行は処方明細（lines）単位で展開する。
 */
export const GET = withAuthContext(
  async (_req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawPatientId } = await params;
    const patientId = normalizeRequiredRouteParam(rawPatientId);
    if (!patientId) return withSensitiveNoStore(validationError('患者IDが不正です'));

    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere(
        { id: patientId, org_id: ctx.orgId },
        { userId: ctx.userId, role: ctx.role },
      ),
      select: { id: true, name: true, name_kana: true },
    });
    if (!patient) return withSensitiveNoStore(notFound('患者が見つかりません'));
    const caseIds = await listAccessiblePatientCaseIds({
      db: prisma,
      orgId: ctx.orgId,
      patientId,
      accessContext: { userId: ctx.userId, role: ctx.role },
    });
    if (caseIds.length === 0) {
      return withSensitiveNoStore(
        await forbiddenResponse('割り当て済みのケースがないため処方履歴をエクスポートできません'),
      );
    }

    const EXPORT_LIMIT = 10000;
    const intakes = await prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: { patient_id: patientId, case_id: { in: caseIds } },
      },
      take: EXPORT_LIMIT,
      orderBy: { prescribed_date: 'desc' },
      select: {
        id: true,
        source_type: true,
        prescribed_date: true,
        prescriber_name: true,
        prescriber_institution: true,
        prescription_expiry_date: true,
        lines: {
          orderBy: { line_number: 'asc' },
          select: {
            line_number: true,
            drug_name: true,
            drug_code: true,
            dosage_form: true,
            dose: true,
            frequency: true,
            days: true,
            quantity: true,
            unit: true,
            is_generic: true,
            notes: true,
          },
        },
      },
    });

    const header = buildCsvRow([
      '患者ID',
      '患者氏名',
      '処方受付ID',
      '受付日',
      '処方元医師',
      '処方元医療機関',
      '処方有効期限',
      '受付種別',
      '行番号',
      '薬品名',
      '薬品コード',
      '剤形',
      '用量',
      '用法',
      '日数',
      '数量',
      '単位',
      '後発品',
      '備考',
    ]);

    const rows: string[] = [];
    for (const intake of intakes) {
      if (intake.lines.length === 0) {
        rows.push(
          buildCsvRow([
            patient.id,
            patient.name,
            intake.id,
            formatNullableDateKey(intake.prescribed_date),
            intake.prescriber_name,
            intake.prescriber_institution,
            formatNullableDateKey(intake.prescription_expiry_date),
            intake.source_type,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
          ]),
        );
      } else {
        for (const line of intake.lines) {
          rows.push(
            buildCsvRow([
              patient.id,
              patient.name,
              intake.id,
              formatNullableDateKey(intake.prescribed_date),
              intake.prescriber_name,
              intake.prescriber_institution,
              formatNullableDateKey(intake.prescription_expiry_date),
              intake.source_type,
              String(line.line_number),
              line.drug_name,
              line.drug_code,
              line.dosage_form,
              line.dose,
              line.frequency,
              line.days != null ? String(line.days) : null,
              line.quantity != null ? String(line.quantity) : null,
              line.unit,
              line.is_generic ? '後発' : '先発',
              line.notes,
            ]),
          );
        }
      }
    }

    const csv = BOM + [header, ...rows].join('\r\n') + '\r\n';
    const filename = `prescriptions_${formatDateKey(new Date())}.csv`;
    const truncated = intakes.length === EXPORT_LIMIT;

    await recordDataExportAudit(prisma, {
      orgId: ctx.orgId,
      actorId: ctx.userId,
      targetType: 'prescription_history',
      targetId: patientId,
      format: 'csv',
      recordCount: rows.length,
      filters: {
        intake_count: intakes.length,
        truncated,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    const encodedFileName = encodeURIComponent(filename);
    return withSensitiveNoStore(
      new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
          ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
        },
      }),
    );
  },
  {
    permission: 'canVisit',
    message: '患者処方履歴のエクスポート権限がありません',
  },
);
