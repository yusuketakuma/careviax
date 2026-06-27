import { Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { internalError, success, validationError, notFound } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { normalizeJsonInput, readJsonObject } from '@/lib/db/json';
import { ConferenceDataSyncService } from '@/server/services/conference-data-sync';
import {
  buildConferenceContent,
  buildConferenceMetadata,
  createConferenceNoteSchema,
  normalizeConferenceStructuredContent,
  resolveConferenceNoteType,
  updateConferenceNoteSchema,
} from '@/lib/validations/conference';

function normalizeInputJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const normalized = normalizeJsonInput(value);
  return normalized === null || normalized === undefined ? Prisma.JsonNull : normalized;
}

function normalizeInputJsonArray(value: unknown): Prisma.InputJsonArray {
  const normalized = normalizeJsonInput(value);
  return Array.isArray(normalized) ? normalized : [];
}

function readConferenceSyncSummary(metadata: unknown) {
  const value = readJsonObject(metadata);
  const syncSummary = readJsonObject(value?.sync_summary);
  return syncSummary ?? null;
}

const authenticatedGET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('カンファレンス記録IDが不正です');

    const note = await prisma.conferenceNote.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        org_id: true,
        case_id: true,
        patient_id: true,
        facility_id: true,
        note_type: true,
        title: true,
        content: true,
        structured_content: true,
        metadata: true,
        billing_eligible: true,
        billing_code: true,
        follow_up_date: true,
        follow_up_completed: true,
        generated_report_id: true,
        participants: true,
        conference_date: true,
        action_items: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!note) {
      return notFound('カンファレンス記録が見つかりません');
    }

    const metadata = readJsonObject(note.metadata);
    const billing = readJsonObject(metadata?.billing);
    const syncSummary = readConferenceSyncSummary(note.metadata);

    return success({
      data: {
        ...note,
        conference_type: note.note_type,
        billing_eligible:
          note.billing_eligible ||
          note.note_type === 'service_manager' ||
          billing?.link_status === 'candidate' ||
          billing?.link_status === 'linked',
        billing_code:
          note.billing_code ?? (typeof billing?.code === 'string' ? billing.code : null),
        sync_summary: syncSummary,
        generated_report_id:
          note.generated_report_id ??
          (typeof metadata?.generated_report_id === 'string' ? metadata.generated_report_id : null),
      },
    });
  },
  {
    permission: 'canReport',
    message: 'カンファレンス記録の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};

export const PATCH = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id: rawId } = await routeContext.params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('カンファレンス記録IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateConferenceNoteSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const existing = await prisma.conferenceNote.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        case_id: true,
        patient_id: true,
        facility_id: true,
        note_type: true,
        title: true,
        content: true,
        structured_content: true,
        metadata: true,
        billing_eligible: true,
        billing_code: true,
        follow_up_date: true,
        follow_up_completed: true,
        generated_report_id: true,
        participants: true,
        conference_date: true,
        action_items: true,
      },
    });

    if (!existing) {
      return notFound('カンファレンス記録が見つかりません');
    }

    const hasRequestedNoteType =
      parsed.data.note_type !== undefined || parsed.data.conference_type !== undefined;
    const candidateNoteType = hasRequestedNoteType
      ? resolveConferenceNoteType(parsed.data)
      : undefined;
    if (candidateNoteType === null) {
      return validationError('conference_type と note_type が一致していません');
    }

    const existingStructuredContent = readJsonObject(existing.structured_content);
    const existingMetadata = readJsonObject(existing.metadata);

    const mergedPayload = {
      case_id: existing.case_id ?? undefined,
      patient_id: parsed.data.patient_id ?? existing.patient_id ?? undefined,
      facility_id: parsed.data.facility_id ?? existing.facility_id ?? undefined,
      note_type: candidateNoteType ?? existing.note_type,
      title: parsed.data.title ?? existing.title,
      content: parsed.data.content ?? existing.content,
      structured_content: parsed.data.structured_content ?? existingStructuredContent ?? undefined,
      metadata: parsed.data.metadata ?? existingMetadata ?? undefined,
      billing_eligible: parsed.data.billing_eligible ?? existing.billing_eligible,
      billing_code: parsed.data.billing_code ?? existing.billing_code ?? undefined,
      follow_up_date:
        parsed.data.follow_up_date ??
        (existing.follow_up_date ? existing.follow_up_date.toISOString() : undefined),
      follow_up_completed: parsed.data.follow_up_completed ?? existing.follow_up_completed,
      participants:
        parsed.data.participants ??
        (Array.isArray(existing.participants) ? existing.participants : []),
      conference_date: parsed.data.conference_date ?? existing.conference_date.toISOString(),
      action_items:
        parsed.data.action_items ??
        (Array.isArray(existing.action_items) ? existing.action_items : undefined),
    };

    const mergedValidation = createConferenceNoteSchema.safeParse(mergedPayload);
    if (!mergedValidation.success) {
      return validationError('入力値が不正です', mergedValidation.error.issues);
    }

    const resolvedNoteType = resolveConferenceNoteType(mergedValidation.data);
    if (!resolvedNoteType) {
      return validationError('conference_type と note_type が一致していません');
    }

    const normalizedContent = buildConferenceContent(
      mergedValidation.data.content,
      mergedValidation.data.structured_content,
    );
    const normalizedMetadata = buildConferenceMetadata(
      resolvedNoteType,
      mergedValidation.data.metadata,
    );
    const normalizedStructuredContent = normalizeConferenceStructuredContent(
      resolvedNoteType,
      mergedValidation.data.structured_content,
    );
    const existingMetadataExtras = existingMetadata
      ? Object.fromEntries(
          Object.entries(existingMetadata).filter(
            ([key]) => key !== 'billing' && key !== 'visit_brief' && key !== 'generated_report_id',
          ),
        )
      : null;

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const careCase = mergedValidation.data.case_id
        ? await tx.careCase.findFirst({
            where: {
              id: mergedValidation.data.case_id,
              org_id: ctx.orgId,
            },
            select: {
              patient_id: true,
            },
          })
        : null;
      if (mergedValidation.data.case_id && !careCase) {
        return { error: validationError('ケースが見つかりません') };
      }
      const requestedPatientId =
        mergedValidation.data.patient_id ??
        (mergedValidation.data.metadata?.visit_brief?.patient_id?.trim()
          ? mergedValidation.data.metadata.visit_brief.patient_id.trim()
          : null);
      if (
        careCase?.patient_id &&
        requestedPatientId &&
        requestedPatientId !== careCase.patient_id
      ) {
        return { error: validationError('ケースと患者が一致していません') };
      }
      const resolvedPatientId =
        careCase?.patient_id ??
        mergedValidation.data.patient_id ??
        (mergedValidation.data.metadata?.visit_brief?.patient_id?.trim()
          ? mergedValidation.data.metadata.visit_brief.patient_id.trim()
          : null);
      const primaryResidence = resolvedPatientId
        ? await tx.residence.findFirst({
            where: {
              org_id: ctx.orgId,
              patient_id: resolvedPatientId,
              is_primary: true,
            },
            select: {
              facility_id: true,
            },
          })
        : null;
      const metadataBilling =
        normalizedMetadata?.billing && typeof normalizedMetadata.billing === 'object'
          ? normalizedMetadata.billing
          : undefined;
      const resolvedBillingEligible =
        mergedValidation.data.billing_eligible ??
        (resolvedNoteType === 'service_manager' ||
          metadataBilling?.link_status === 'candidate' ||
          metadataBilling?.link_status === 'linked');
      const resolvedBillingCode =
        mergedValidation.data.billing_code?.trim() || metadataBilling?.code?.trim() || null;
      const mergedMetadata =
        normalizedMetadata || existingMetadataExtras
          ? {
              ...(existingMetadataExtras ?? {}),
              ...(normalizedMetadata ?? {}),
            }
          : null;
      const saved = await tx.conferenceNote.update({
        where: { id },
        data: {
          patient_id: resolvedPatientId,
          facility_id: mergedValidation.data.facility_id ?? primaryResidence?.facility_id ?? null,
          note_type: resolvedNoteType,
          title: mergedValidation.data.title,
          content: normalizedContent,
          structured_content: normalizeInputJsonValue(normalizedStructuredContent),
          metadata: normalizeInputJsonValue(mergedMetadata),
          billing_eligible: resolvedBillingEligible,
          billing_code: resolvedBillingCode,
          follow_up_date: mergedValidation.data.follow_up_date
            ? new Date(mergedValidation.data.follow_up_date)
            : null,
          follow_up_completed: mergedValidation.data.follow_up_completed ?? false,
          generated_report_id: existing.generated_report_id,
          participants: normalizeInputJsonArray(mergedValidation.data.participants),
          conference_date: new Date(mergedValidation.data.conference_date),
          action_items:
            mergedValidation.data.action_items !== undefined
              ? normalizeInputJsonArray(mergedValidation.data.action_items)
              : Prisma.JsonNull,
        },
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'conference_note.updated',
        targetType: 'conference_note',
        targetId: saved.id,
        changes: {
          conference_note: {
            note_type: resolvedNoteType,
            report_type: normalizedMetadata?.conference_operation?.report_type ?? null,
            follow_up_date: mergedValidation.data.follow_up_date ?? null,
            follow_up_completed: mergedValidation.data.follow_up_completed ?? false,
            action_item_count: mergedValidation.data.action_items?.length ?? 0,
            billing_eligible: resolvedBillingEligible,
            billing_code: resolvedBillingCode,
            changed_fields: Object.keys(parsed.data).filter(
              (field) => field !== 'content' && field !== 'participants',
            ),
          },
        },
      });

      return ConferenceDataSyncService.syncSavedNote(tx, ctx.orgId, ctx.userId, saved, {
        mode: 'update',
      });
    });
    if ('error' in result) return result.error;

    return success({
      data: {
        ...result.note,
        conference_type: result.note.note_type,
        generated_report_id: result.note.generated_report_id,
      },
      sync: result.sync,
    });
  },
  {
    permission: 'canAuthorReport',
    message: 'カンファレンス記録の更新権限がありません',
  },
);
