import { Prisma } from '@prisma/client';
import { unstable_rethrow } from 'next/navigation';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { parsePaginationParams } from '@/lib/api/pagination';
import { parseSearchParams } from '@/lib/api/validation';
import { ConferenceDataSyncService } from '@/server/services/conference-data-sync';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  buildConferenceContent,
  buildConferenceMetadata,
  conferenceNoteQuerySchema,
  createConferenceNoteSchema,
  normalizeConferenceStructuredContent,
  resolveConferenceNoteType,
} from '@/lib/validations/conference';

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const caseId = searchParams.get('case_id') ?? undefined;
    const parsedFilters = parseSearchParams(conferenceNoteQuerySchema, searchParams);
    if (!parsedFilters.ok) {
      return validationError(
        'クエリパラメータが不正です',
        parsedFilters.error.flatten().fieldErrors,
      );
    }

    const requestedType = parsedFilters.data.conference_type ?? parsedFilters.data.note_type;
    const billingEligibilityFilter = parsedFilters.data.billing_eligible;
    const summaryList = parsedFilters.data.detail_level === 'summary';
    const orderBy = [{ conference_date: 'desc' as const }, { id: 'desc' as const }];
    const scanLimit =
      billingEligibilityFilter === undefined ? limit + 1 : Math.min(limit * 5 + 1, 501);

    const notes = await withOrgContext(ctx.orgId, async (tx) => {
      const [patientScopedCases, facilityScopedCases] = await Promise.all([
        parsedFilters.data.patient_id
          ? tx.careCase.findMany({
              where: {
                org_id: ctx.orgId,
                patient_id: parsedFilters.data.patient_id,
              },
              select: {
                id: true,
              },
            })
          : Promise.resolve([]),
        parsedFilters.data.facility_id
          ? tx.careCase.findMany({
              where: {
                org_id: ctx.orgId,
                patient: {
                  residences: {
                    some: {
                      facility_id: parsedFilters.data.facility_id,
                    },
                  },
                },
              },
              select: {
                id: true,
              },
            })
          : Promise.resolve([]),
      ]);
      const patientScopedCaseIds = patientScopedCases.map((item) => item.id);
      const facilityScopedCaseIds = facilityScopedCases.map((item) => item.id);

      const baseWhere: Prisma.ConferenceNoteWhereInput = {
        org_id: ctx.orgId,
        ...(caseId ? { case_id: caseId } : {}),
        ...(requestedType ? { note_type: requestedType } : {}),
        ...(parsedFilters.data.patient_id
          ? {
              OR: [
                { patient_id: parsedFilters.data.patient_id },
                ...(patientScopedCaseIds.length > 0
                  ? [
                      {
                        case_id: {
                          in: patientScopedCaseIds,
                        },
                      },
                    ]
                  : []),
              ],
            }
          : {}),
        ...(parsedFilters.data.facility_id
          ? {
              AND: [
                {
                  OR: [
                    { facility_id: parsedFilters.data.facility_id },
                    ...(facilityScopedCaseIds.length > 0
                      ? [
                          {
                            case_id: {
                              in: facilityScopedCaseIds,
                            },
                          },
                        ]
                      : []),
                  ],
                },
              ],
            }
          : {}),
        ...(parsedFilters.data.date_from || parsedFilters.data.date_to
          ? {
              conference_date: {
                ...(parsedFilters.data.date_from
                  ? { gte: new Date(`${parsedFilters.data.date_from}T00:00:00.000Z`) }
                  : {}),
                ...(parsedFilters.data.date_to
                  ? { lte: new Date(`${parsedFilters.data.date_to}T23:59:59.999Z`) }
                  : {}),
              },
            }
          : {}),
      };
      const cursorNote = cursor
        ? await tx.conferenceNote.findFirst({
            where: { AND: [baseWhere, { id: cursor }] },
            select: { id: true, conference_date: true },
          })
        : null;
      const cursorWhere: Prisma.ConferenceNoteWhereInput | null = cursorNote
        ? {
            OR: [
              { conference_date: { lt: cursorNote.conference_date } },
              {
                conference_date: cursorNote.conference_date,
                id: { lt: cursorNote.id },
              },
            ],
          }
        : null;
      const where: Prisma.ConferenceNoteWhereInput = cursorWhere
        ? { AND: [baseWhere, cursorWhere] }
        : baseWhere;

      const records = await tx.conferenceNote.findMany({
        where,
        orderBy,
        take: scanLimit,
        ...(summaryList
          ? {
              select: {
                id: true,
                org_id: true,
                case_id: true,
                patient_id: true,
                facility_id: true,
                note_type: true,
                title: true,
                metadata: true,
                participants: true,
                billing_eligible: true,
                billing_code: true,
                follow_up_date: true,
                follow_up_completed: true,
                generated_report_id: true,
                conference_date: true,
                created_at: true,
                updated_at: true,
              },
            }
          : {}),
      });

      const caseIds = Array.from(
        new Set(
          records.map((note) => note.case_id).filter((value): value is string => Boolean(value)),
        ),
      );
      const cases =
        caseIds.length === 0
          ? []
          : await tx.careCase.findMany({
              where: {
                org_id: ctx.orgId,
                id: {
                  in: caseIds,
                },
              },
              select: {
                id: true,
                patient_id: true,
                patient: {
                  select: {
                    name: true,
                    residences: {
                      select: {
                        facility_id: true,
                      },
                    },
                  },
                },
              },
            });
      const caseById = new Map(cases.map((item) => [item.id, item]));

      const mappedRecords = records.map((note) => {
        const relatedCase = note.case_id ? caseById.get(note.case_id) : null;
        const billing =
          note.metadata && typeof note.metadata === 'object' && !Array.isArray(note.metadata)
            ? (note.metadata as {
                billing?: { link_status?: string; code?: string };
                sync_summary?: {
                  report_draft_ids?: string[];
                  billing_candidate_id?: string | null;
                  visit_proposal_id?: string | null;
                  tasks_created?: number;
                  medication_issues_created?: number;
                };
                generated_report_id?: string;
              })
            : null;
        const billingEligible =
          note.billing_eligible ||
          note.note_type === 'service_manager' ||
          billing?.billing?.link_status === 'candidate' ||
          billing?.billing?.link_status === 'linked';
        const facilityIds = Array.from(
          new Set(
            [
              note.facility_id,
              ...(relatedCase?.patient.residences ?? []).map((residence) => residence.facility_id),
            ].filter((value): value is string => Boolean(value)),
          ),
        );
        const baseNote = {
          ...note,
          conference_type: note.note_type,
          patient_id: note.patient_id ?? relatedCase?.patient_id ?? null,
          patient_name: relatedCase?.patient.name ?? null,
          facility_id: note.facility_id ?? facilityIds[0] ?? null,
          facility_ids: facilityIds,
          billing_eligible: billingEligible,
          billing_code: note.billing_code ?? billing?.billing?.code ?? null,
          follow_up_date: note.follow_up_date,
          follow_up_completed: note.follow_up_completed,
          sync_summary: billing?.sync_summary ?? null,
          generated_report_id: note.generated_report_id ?? billing?.generated_report_id ?? null,
        };

        if (summaryList) {
          return {
            id: baseNote.id,
            org_id: baseNote.org_id,
            case_id: baseNote.case_id,
            patient_id: baseNote.patient_id,
            patient_name: baseNote.patient_name,
            facility_id: baseNote.facility_id,
            facility_ids: baseNote.facility_ids,
            note_type: baseNote.note_type,
            conference_type: baseNote.conference_type,
            title: baseNote.title,
            content: '',
            participants: baseNote.participants,
            billing_eligible: baseNote.billing_eligible,
            billing_code: baseNote.billing_code,
            follow_up_date: baseNote.follow_up_date,
            follow_up_completed: baseNote.follow_up_completed,
            generated_report_id: baseNote.generated_report_id,
            conference_date: baseNote.conference_date,
            action_items: null,
            created_at: baseNote.created_at,
            updated_at: baseNote.updated_at,
            sync_summary: baseNote.sync_summary,
          };
        }

        return baseNote;
      });

      const filteredRecords =
        billingEligibilityFilter === undefined
          ? mappedRecords
          : mappedRecords.filter((note) => note.billing_eligible === billingEligibilityFilter);
      const hasFilteredOverflow = filteredRecords.length > limit;
      const hasScanOverflow = records.length >= scanLimit;
      const data = hasFilteredOverflow ? filteredRecords.slice(0, limit) : filteredRecords;
      const nextCursor = hasFilteredOverflow
        ? data[data.length - 1]?.id
        : hasScanOverflow
          ? records[records.length - 1]?.id
          : undefined;

      return {
        data,
        hasMore: Boolean(nextCursor) && (hasFilteredOverflow || hasScanOverflow),
        nextCursor,
      };
    });

    return success(notes);
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

const authenticatedPOST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createConferenceNoteSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.issues);
    }

    const {
      case_id,
      title,
      content,
      structured_content,
      metadata,
      participants,
      conference_date,
      action_items,
    } = parsed.data;
    const note_type = resolveConferenceNoteType(parsed.data);
    if (!note_type) {
      return validationError('conference_type と note_type が一致していません');
    }
    const normalizedContent = buildConferenceContent(content, structured_content);
    const normalizedMetadata = buildConferenceMetadata(note_type, metadata);
    const normalizedStructuredContent = normalizeConferenceStructuredContent(
      note_type,
      structured_content,
    );

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const careCase = case_id
        ? await tx.careCase.findFirst({
            where: {
              id: case_id,
              org_id: ctx.orgId,
            },
            select: {
              patient_id: true,
            },
          })
        : null;
      if (case_id && !careCase) {
        return { error: validationError('ケースが見つかりません') };
      }
      const requestedPatientId =
        parsed.data.patient_id ??
        (metadata?.visit_brief?.patient_id?.trim() ? metadata.visit_brief.patient_id.trim() : null);
      const metadataPatientId = metadata?.visit_brief?.patient_id?.trim()
        ? metadata.visit_brief.patient_id.trim()
        : null;
      if (
        parsed.data.patient_id &&
        metadataPatientId &&
        parsed.data.patient_id !== metadataPatientId
      ) {
        return { error: validationError('患者ID指定が一致していません') };
      }
      if (
        careCase?.patient_id &&
        requestedPatientId &&
        requestedPatientId !== careCase.patient_id
      ) {
        return { error: validationError('ケースと患者が一致していません') };
      }
      const resolvedPatientId = careCase?.patient_id ?? parsed.data.patient_id ?? metadataPatientId;
      const resolvedPatient = resolvedPatientId
        ? await tx.patient.findFirst({
            where: {
              id: resolvedPatientId,
              org_id: ctx.orgId,
            },
            select: {
              id: true,
            },
          })
        : null;
      if (resolvedPatientId && !resolvedPatient) {
        return { error: validationError('患者が見つかりません') };
      }
      if (resolvedPatientId) {
        const writable = await requireWritablePatient(tx, ctx, resolvedPatientId);
        if ('response' in writable) {
          return {
            error: writable.response ?? conflict('アーカイブ中の患者は復元するまで更新できません'),
          };
        }
      }
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
        parsed.data.billing_eligible ??
        (note_type === 'service_manager' ||
          metadataBilling?.link_status === 'candidate' ||
          metadataBilling?.link_status === 'linked');
      const resolvedBillingCode =
        parsed.data.billing_code?.trim() || metadataBilling?.code?.trim() || null;
      const created = await tx.conferenceNote.create({
        data: {
          org_id: ctx.orgId,
          case_id: case_id ?? null,
          patient_id: resolvedPatientId,
          facility_id: parsed.data.facility_id ?? primaryResidence?.facility_id ?? null,
          note_type,
          title,
          content: normalizedContent,
          ...(normalizedStructuredContent
            ? { structured_content: normalizedStructuredContent }
            : {}),
          ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
          billing_eligible: resolvedBillingEligible,
          billing_code: resolvedBillingCode,
          follow_up_date: parsed.data.follow_up_date ? new Date(parsed.data.follow_up_date) : null,
          follow_up_completed: parsed.data.follow_up_completed ?? false,
          participants,
          conference_date: new Date(conference_date),
          action_items: action_items !== undefined ? action_items : Prisma.JsonNull,
        },
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'conference_note.created',
        targetType: 'conference_note',
        targetId: created.id,
        changes: {
          conference_note: {
            note_type,
            report_type: normalizedMetadata?.conference_operation?.report_type ?? null,
            follow_up_date: parsed.data.follow_up_date ?? null,
            follow_up_completed: parsed.data.follow_up_completed ?? false,
            action_item_count: action_items?.length ?? 0,
            billing_eligible: resolvedBillingEligible,
            billing_code: resolvedBillingCode,
          },
        },
      });

      return ConferenceDataSyncService.syncSavedNote(tx, ctx.orgId, ctx.userId, created, {
        mode: 'create',
      });
    });

    if ('error' in result) return result.error;

    return success({ data: result.note, sync: result.sync }, 201);
  },
  {
    permission: 'canAuthorReport',
    message: 'カンファレンス記録の作成権限がありません',
  },
);

export const POST: typeof authenticatedPOST = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedPOST(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
