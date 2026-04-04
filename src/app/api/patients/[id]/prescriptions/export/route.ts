import { NextRequest, NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { notFound } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';

const BOM = '\uFEFF';

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return '';
  let str = String(value);
  // Prevent CSV formula injection (Excel/Sheets interpret leading =, +, -, @, tab, CR as formulas)
  if (str.length > 0 && /^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(values: (string | null | undefined)[]): string {
  return values.map(escapeCsv).join(',');
}

/**
 * GET /api/patients/[id]/prescriptions/export
 *
 * 患者の処方履歴を CSV 形式でエクスポートする（BOM 付き UTF-8、Excel 対応）。
 * 各処方の行は処方明細（lines）単位で展開する。
 */
export const GET = withAuthContext(
  async (
    _req: NextRequest,
    ctx,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    const { id: patientId } = await params;

    const patient = await prisma.patient.findFirst({
      where: { id: patientId, org_id: ctx.orgId },
      select: { id: true, name: true, name_kana: true },
    });
    if (!patient) return notFound('患者が見つかりません');

    const EXPORT_LIMIT = 10000;
    const intakes = await prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: { patient_id: patientId },
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
            intake.prescribed_date?.toISOString().slice(0, 10),
            intake.prescriber_name,
            intake.prescriber_institution,
            intake.prescription_expiry_date?.toISOString().slice(0, 10),
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
          ])
        );
      } else {
        for (const line of intake.lines) {
          rows.push(
            buildCsvRow([
              patient.id,
              patient.name,
              intake.id,
              intake.prescribed_date?.toISOString().slice(0, 10),
              intake.prescriber_name,
              intake.prescriber_institution,
              intake.prescription_expiry_date?.toISOString().slice(0, 10),
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
            ])
          );
        }
      }
    }

    const csv = BOM + [header, ...rows].join('\r\n') + '\r\n';
    const filename = `prescriptions_${patient.name}_${new Date().toISOString().slice(0, 10)}.csv`;
    const truncated = intakes.length === EXPORT_LIMIT;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Cache-Control': 'no-store',
        ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
      },
    });
  }
);
