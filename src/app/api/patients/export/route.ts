import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import type { CaseStatus } from '@prisma/client';

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

const VALID_CASE_STATUSES: CaseStatus[] = [
  'referral_received',
  'assessment',
  'active',
  'on_hold',
  'discharged',
  'terminated',
];

/**
 * GET /api/patients/export
 *
 * 患者一覧を CSV 形式でエクスポートする（BOM 付き UTF-8、Excel 対応）。
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報のエクスポート権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { searchParams } = new URL(req.url);
  const caseStatusParam = searchParams.get('case_status') ?? undefined;
  const caseStatus =
    caseStatusParam && (VALID_CASE_STATUSES as string[]).includes(caseStatusParam)
      ? (caseStatusParam as CaseStatus)
      : undefined;

  const EXPORT_LIMIT = 10000;
  const patients = await prisma.patient.findMany({
    where: {
      org_id: ctx.orgId,
      ...(caseStatus ? { cases: { some: { status: caseStatus } } } : {}),
    },
    take: EXPORT_LIMIT,
    orderBy: [{ name_kana: 'asc' }, { name: 'asc' }],
    include: {
      residences: {
        where: { is_primary: true },
        select: { address: true },
        take: 1,
      },
      cases: {
        ...(caseStatus ? { where: { status: caseStatus } } : {}),
        orderBy: { created_at: 'desc' },
        select: { status: true },
        take: 1,
      },
    },
  });

  const header = buildCsvRow([
    '患者ID',
    '氏名',
    'フリガナ',
    '生年月日',
    '性別',
    '電話番号',
    '医療保険番号',
    '介護保険番号',
    '住所',
    'ケース状態',
    '登録日',
  ]);

  const rows = patients.map((patient) => {
    const residence = patient.residences[0] ?? null;
    const latestCase = patient.cases[0] ?? null;
    return buildCsvRow([
      patient.id,
      patient.name,
      patient.name_kana,
      patient.birth_date.toISOString().slice(0, 10),
      patient.gender,
      patient.phone,
      patient.medical_insurance_number,
      patient.care_insurance_number,
      residence?.address,
      latestCase?.status,
      patient.created_at.toISOString().slice(0, 10),
    ]);
  });

  const csv = BOM + [header, ...rows].join('\r\n') + '\r\n';
  const truncated = patients.length === EXPORT_LIMIT;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="patients_${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
      ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
    },
  });
}
