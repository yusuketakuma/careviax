import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/db/client';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { CASE_STATUSES } from '@/lib/patient/case-status';
import { validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { formatDateKey } from '@/lib/date-key';
import { maskAddressDetail, maskInsuranceNumber, maskPhoneNumber } from '@/lib/patient/privacy';
import { minimalCsvRow as buildCsvRow } from '@/lib/csv/safe-csv';
import { z } from 'zod';

const BOM = '\uFEFF';

const caseStatusSchema = z.enum(CASE_STATUSES);

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
  const caseStatus = caseStatusParam ? caseStatusSchema.safeParse(caseStatusParam) : null;
  if (caseStatus && !caseStatus.success) {
    return withSensitiveNoStore(
      validationError('ケースステータスが不正です', {
        case_status: ['対応していないステータスです'],
      }),
    );
  }

  const EXPORT_LIMIT = 10000;
  const patientWhere = applyPatientAssignmentWhere(
    {
      org_id: ctx.orgId,
      ...(caseStatus ? { cases: { some: { status: caseStatus.data } } } : {}),
    },
    {
      userId: ctx.userId,
      role: ctx.role,
    },
  );
  const caseAssignmentWhere = buildCareCaseAssignmentWhere({
    userId: ctx.userId,
    role: ctx.role,
  });
  const exportedCaseWhere =
    caseStatus || caseAssignmentWhere
      ? {
          AND: [
            ...(caseStatus ? [{ status: caseStatus.data }] : []),
            ...(caseAssignmentWhere ? [caseAssignmentWhere] : []),
          ],
        }
      : undefined;

  const patients = await prisma.patient.findMany({
    where: patientWhere,
    take: EXPORT_LIMIT,
    orderBy: [{ name_kana: 'asc' }, { name: 'asc' }],
    include: {
      residences: {
        where: { is_primary: true },
        select: { address: true },
        take: 1,
      },
      cases: {
        ...(exportedCaseWhere ? { where: exportedCaseWhere } : {}),
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

  const canExportDirectIdentifiers = hasPermission(ctx.role, 'canSendCareReport');
  const rows = patients.map((patient) => {
    const residence = patient.residences[0] ?? null;
    const latestCase = patient.cases[0] ?? null;
    return buildCsvRow([
      patient.id,
      patient.name,
      patient.name_kana,
      formatDateKey(patient.birth_date),
      patient.gender,
      canExportDirectIdentifiers ? patient.phone : maskPhoneNumber(patient.phone),
      canExportDirectIdentifiers
        ? patient.medical_insurance_number
        : maskInsuranceNumber(patient.medical_insurance_number),
      canExportDirectIdentifiers
        ? patient.care_insurance_number
        : maskInsuranceNumber(patient.care_insurance_number),
      canExportDirectIdentifiers
        ? residence?.address
        : maskAddressDetail(residence?.address ?? null),
      latestCase?.status,
      formatDateKey(patient.created_at),
    ]);
  });

  const csv = BOM + [header, ...rows].join('\r\n') + '\r\n';
  const truncated = patients.length === EXPORT_LIMIT;

  await recordDataExportAudit(prisma, {
    orgId: ctx.orgId,
    actorId: ctx.userId,
    targetType: 'patient_list',
    targetId: ctx.orgId,
    format: 'csv',
    recordCount: rows.length,
    filters: {
      case_status: caseStatus?.data ?? null,
      truncated,
    },
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  return withSensitiveNoStore(
    new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="patients_${formatDateKey(new Date())}.csv"`,
        ...(truncated ? { 'X-Export-Truncated': 'true' } : {}),
      },
    }),
  );
}
