import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { error, success, validationError } from '@/lib/api/response';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { prisma } from '@/lib/db/client';
import {
  createPresignedUpload,
  FileStorageError,
} from '@/server/services/file-storage';

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
  });

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

  const referenceResult = await validateOrgReferences(ctx.orgId, {
    patient_id: parsed.data.patient_id,
    visit_record_id: parsed.data.visit_record_id,
  });
  if (!referenceResult.ok) {
    return referenceResult.response;
  }

  if (parsed.data.report_id) {
    const report = await prisma.careReport.findFirst({
      where: {
        id: parsed.data.report_id,
        org_id: ctx.orgId,
      },
      select: { id: true },
    });

    if (!report) {
      return validationError('指定された報告書が見つかりません');
    }
  }

  try {
    const data = await createPresignedUpload({
      orgId: ctx.orgId,
      purpose: parsed.data.purpose,
      fileName: parsed.data.file_name,
      mimeType: parsed.data.mime_type,
      sizeBytes: parsed.data.size_bytes,
      patientId: parsed.data.patient_id,
      visitRecordId: parsed.data.visit_record_id,
      reportId: parsed.data.report_id,
    });

    return success({ data }, 201);
  } catch (cause) {
    if (cause instanceof FileStorageError) {
      return error(cause.code, cause.message, cause.status);
    }

    return error('EXTERNAL_FILE_UPLOAD_FAILED', 'アップロードURLの発行に失敗しました', 502);
  }
}
