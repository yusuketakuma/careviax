import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, conflict } from '@/lib/api/response';
import {
  updateVisitRecordSchema,
  type VisitRecordAttachmentRefInput,
} from '@/lib/validations/visit-record';
import { prisma } from '@/lib/db/client';
import {
  getStoredFileRecord,
  toVisitRecordAttachment,
  type VisitRecordAttachment,
} from '@/server/services/file-storage';
import { getHomeVisitIntake, buildBaselineContext } from '@/lib/patient/home-visit-intake';

function parseStoredVisitRecordAttachments(value: unknown): VisitRecordAttachment[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];

    const record = entry as Record<string, unknown>;
    if (
      typeof record.file_id !== 'string' ||
      typeof record.file_name !== 'string' ||
      typeof record.mime_type !== 'string' ||
      typeof record.size_bytes !== 'number'
    ) {
      return [];
    }

    return [
      {
        file_id: record.file_id,
        file_name: record.file_name,
        mime_type: record.mime_type,
        size_bytes: record.size_bytes,
        uploaded_at: typeof record.uploaded_at === 'string' ? record.uploaded_at : null,
        kind: record.kind === 'attachment' ? 'attachment' : 'photo',
      } satisfies VisitRecordAttachment,
    ];
  });
}

async function resolveVisitRecordAttachments(
  orgId: string,
  recordId: string,
  attachments: VisitRecordAttachmentRefInput[]
) {
  const seen = new Set<string>();
  const resolved: VisitRecordAttachment[] = [];

  for (const attachment of attachments) {
    if (seen.has(attachment.file_id)) continue;
    seen.add(attachment.file_id);

    const file = await getStoredFileRecord(orgId, attachment.file_id);

    if (file.status !== 'uploaded') {
      throw new Error('アップロードが完了していない添付ファイルがあります');
    }

    if (file.purpose !== 'visit-photo') {
      throw new Error('訪問記録に紐づけできない添付ファイルが含まれています');
    }

    if (file.visitRecordId !== recordId) {
      throw new Error('添付ファイルの訪問記録IDが一致しません');
    }

    resolved.push(toVisitRecordAttachment(file));
  }

  return resolved;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const record = await prisma.visitRecord.findFirst({
    where: { id, org_id: ctx.orgId },
    include: {
      schedule: {
        select: {
          id: true,
          case_id: true,
          site_id: true,
          pharmacist_id: true,
          visit_type: true,
          scheduled_date: true,
          recurrence_rule: true,
          time_window_start: true,
          time_window_end: true,
        },
      },
    },
  });

  if (!record) return notFound('訪問記録が見つかりません');

  const caseId = record.schedule?.case_id ?? null;
  const patientId = record.patient_id;
  const [latestAudit, activeCase, patientSchedulePref] = await Promise.all([
    prisma.auditLog.findFirst({
      where: {
        org_id: ctx.orgId,
        target_type: 'visit_record',
        target_id: id,
      },
      orderBy: { created_at: 'desc' },
      select: {
        actor_id: true,
      },
    }),
    caseId
      ? prisma.careCase.findFirst({
          where: { id: caseId, org_id: ctx.orgId },
          select: { required_visit_support: true },
        })
      : Promise.resolve(null),
    prisma.patientSchedulePreference.findFirst({
      where: { patient_id: patientId, org_id: ctx.orgId },
      select: { visit_before_contact_required: true },
    }),
  ]);

  const userIds = Array.from(
    new Set([record.pharmacist_id, latestAudit?.actor_id].filter(Boolean) as string[])
  );
  const users =
    userIds.length === 0
      ? []
      : await prisma.user.findMany({
          where: {
            org_id: ctx.orgId,
            id: { in: userIds },
          },
          select: {
            id: true,
            name: true,
          },
        });
  const userById = new Map(users.map((user) => [user.id, user.name]));

  const intakeData = getHomeVisitIntake(activeCase?.required_visit_support ?? null);
  const visitBeforeContactRequired =
    patientSchedulePref?.visit_before_contact_required ?? null;
  const baselineContext = buildBaselineContext(intakeData, visitBeforeContactRequired);

  return success({
    ...record,
    attachments: parseStoredVisitRecordAttachments(record.attachments),
    pharmacist_name: userById.get(record.pharmacist_id) ?? null,
    last_modified_by_id: latestAudit?.actor_id ?? record.pharmacist_id,
    last_modified_by_name:
      (latestAudit?.actor_id ? userById.get(latestAudit.actor_id) : null) ??
      userById.get(record.pharmacist_id) ??
      null,
    baseline_context: baselineContext,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '訪問記録の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = updateVisitRecordSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { version, next_visit_suggestion_date, visit_date, attachments, ...rest } = parsed.data;
  let normalizedAttachments: VisitRecordAttachment[] | undefined;

  if (attachments) {
    try {
      normalizedAttachments = await resolveVisitRecordAttachments(ctx.orgId, id, attachments);
    } catch (cause) {
      return validationError(
        cause instanceof Error ? cause.message : '添付ファイル情報が不正です'
      );
    }
  }

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    // Optimistic lock: check version
    const existing = await tx.visitRecord.findFirst({
      where: { id, org_id: ctx.orgId },
      select: { id: true, version: true },
    });
    if (!existing) return null;
    if (existing.version !== version) return 'conflict' as const;

    return tx.visitRecord.update({
      where: { id },
      data: {
        ...rest,
        ...(visit_date ? { visit_date: new Date(visit_date) } : {}),
        ...(next_visit_suggestion_date
          ? { next_visit_suggestion_date: new Date(next_visit_suggestion_date) }
          : {}),
        ...(normalizedAttachments
          ? { attachments: normalizedAttachments as Prisma.InputJsonValue }
          : {}),
        version: { increment: 1 },
      } as Prisma.VisitRecordUncheckedUpdateInput,
    });
  }, { requestContext: ctx });

  if (!updated) return notFound('訪問記録が見つかりません');
  if (updated === 'conflict') {
    return conflict('他のユーザーによって更新されました。最新データを取得してから再試行してください');
  }

  return success(updated);
}
