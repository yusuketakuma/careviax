import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { error, forbiddenResponse, success, validationError } from '@/lib/api/response';
import { hasPermission } from '@/lib/auth/permissions';
import {
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { createPresignedUpload, FileStorageError } from '@/server/services/file-storage';

const presignedUploadSchema = z
  .object({
    purpose: z.enum(['prescription', 'visit-photo', 'report']),
    file_name: z.string().min(1, 'ファイル名は必須です'),
    mime_type: z.string().min(1, 'MIME タイプは必須です'),
    size_bytes: z.number().int().positive('ファイルサイズは正の整数で指定してください'),
    patient_id: z.string().optional(),
    visit_record_id: z.string().optional(),
    report_id: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.purpose === 'prescription' && !value.patient_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['patient_id'],
        message: '処方箋アップロードには patient_id が必要です',
      });
    }

    if (value.purpose === 'visit-photo' && !value.visit_record_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['visit_record_id'],
        message: '訪問写真アップロードには visit_record_id が必要です',
      });
    }

    if (value.purpose === 'report' && !value.report_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['report_id'],
        message: '報告書アップロードには report_id が必要です',
      });
    }

    if (value.purpose !== 'prescription' && value.patient_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['patient_id'],
        message: 'patient_id は処方箋アップロードでのみ指定できます',
      });
    }

    if (value.purpose !== 'visit-photo' && value.visit_record_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['visit_record_id'],
        message: 'visit_record_id は訪問写真アップロードでのみ指定できます',
      });
    }

    if (value.purpose !== 'report' && value.report_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['report_id'],
        message: 'report_id は報告書アップロードでのみ指定できます',
      });
    }
  });

async function canAccessPrescriptionPatient(args: {
  orgId: string;
  patientId: string;
  userId: string;
}) {
  const accessibleSchedule = await prisma.visitSchedule.findFirst({
    where: {
      org_id: args.orgId,
      case_: {
        patient_id: args.patientId,
      },
      OR: [
        { pharmacist_id: args.userId },
        { case_: { primary_pharmacist_id: args.userId } },
        { case_: { backup_pharmacist_id: args.userId } },
      ],
    },
    select: { id: true },
  });
  if (accessibleSchedule) return true;

  const accessibleCase = await prisma.careCase.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      OR: [{ primary_pharmacist_id: args.userId }, { backup_pharmacist_id: args.userId }],
    },
    select: { id: true },
  });

  return Boolean(accessibleCase);
}

async function canAccessReportFile(args: {
  orgId: string;
  report: {
    patient_id: string;
    case_id: string | null;
    visit_record_id: string | null;
  };
  userId: string;
}) {
  if (args.report.visit_record_id) {
    const visitRecord = await prisma.visitRecord.findFirst({
      where: {
        id: args.report.visit_record_id,
        org_id: args.orgId,
      },
      select: {
        schedule: {
          select: {
            pharmacist_id: true,
            case_: {
              select: {
                primary_pharmacist_id: true,
                backup_pharmacist_id: true,
              },
            },
          },
        },
      },
    });

    return canAccessVisitScheduleAssignment(
      { userId: args.userId, role: 'pharmacist' },
      visitRecord?.schedule,
    );
  }

  if (args.report.case_id) {
    const careCase = await prisma.careCase.findFirst({
      where: {
        id: args.report.case_id,
        org_id: args.orgId,
      },
      select: {
        primary_pharmacist_id: true,
        backup_pharmacist_id: true,
      },
    });

    return canAccessVisitScheduleAssignment(
      { userId: args.userId, role: 'pharmacist' },
      {
        pharmacist_id: null,
        case_: careCase,
      },
    );
  }

  return canAccessPrescriptionPatient({
    orgId: args.orgId,
    patientId: args.report.patient_id,
    userId: args.userId,
  });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = presignedUploadSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  if (parsed.data.purpose === 'report') {
    if (!hasPermission(ctx.role, 'canReport')) {
      return forbiddenResponse('報告書ファイルのアップロード権限がありません');
    }

    const report = await prisma.careReport.findFirst({
      where: {
        id: parsed.data.report_id,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        patient_id: true,
        case_id: true,
        visit_record_id: true,
      },
    });

    if (!report) {
      return validationError('指定された報告書が見つかりません');
    }

    if (
      !canBypassVisitScheduleAssignmentAccess(ctx) &&
      !(await canAccessReportFile({
        orgId: ctx.orgId,
        report,
        userId: ctx.userId,
      }))
    ) {
      return forbiddenResponse('この報告書へのアップロード権限がありません');
    }
  }

  if (parsed.data.purpose === 'prescription') {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbiddenResponse('処方箋ファイルのアップロード権限がありません');
    }

    const patientId = parsed.data.patient_id;
    if (!patientId) {
      return validationError('処方箋アップロードには patient_id が必要です');
    }

    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        org_id: ctx.orgId,
      },
      select: { id: true },
    });

    if (!patient) {
      return validationError('指定された患者が見つかりません');
    }

    if (
      !canBypassVisitScheduleAssignmentAccess(ctx) &&
      !(await canAccessPrescriptionPatient({
        orgId: ctx.orgId,
        patientId,
        userId: ctx.userId,
      }))
    ) {
      return forbiddenResponse('この患者への処方箋アップロード権限がありません');
    }
  }

  if (parsed.data.purpose === 'visit-photo') {
    if (!hasPermission(ctx.role, 'canVisit')) {
      return forbiddenResponse('訪問写真ファイルのアップロード権限がありません');
    }

    const visitRecord = await prisma.visitRecord.findFirst({
      where: {
        id: parsed.data.visit_record_id,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        schedule: {
          select: {
            pharmacist_id: true,
            case_: {
              select: {
                primary_pharmacist_id: true,
                backup_pharmacist_id: true,
              },
            },
          },
        },
      },
    });

    if (!visitRecord) {
      return validationError('指定された訪問記録が見つかりません');
    }

    if (!canAccessVisitScheduleAssignment(ctx, visitRecord.schedule)) {
      return forbiddenResponse('この訪問記録へのアップロード権限がありません');
    }
  }

  try {
    const data = await createPresignedUpload({
      orgId: ctx.orgId,
      purpose: parsed.data.purpose,
      fileName: parsed.data.file_name,
      mimeType: parsed.data.mime_type,
      sizeBytes: parsed.data.size_bytes,
      patientId: parsed.data.purpose === 'prescription' ? parsed.data.patient_id : undefined,
      visitRecordId:
        parsed.data.purpose === 'visit-photo' ? parsed.data.visit_record_id : undefined,
      reportId: parsed.data.purpose === 'report' ? parsed.data.report_id : undefined,
    });

    return success({ data }, 201);
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_FILE_UPLOAD_FAILED', 'アップロードURLの発行に失敗しました', 502);
  }
}
