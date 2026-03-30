import { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { parseSearchParams } from '@/lib/api/validation';
import { ConferenceDataSyncService } from '@/server/services/conference-data-sync';
import {
  buildConferenceContent,
  buildConferenceMetadata,
  conferenceNoteQuerySchema,
  createConferenceNoteSchema,
  normalizeConferenceStructuredContent,
  resolveConferenceNoteType,
} from '@/lib/validations/conference';

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);
  const caseId = searchParams.get('case_id') ?? undefined;
  const parsedFilters = parseSearchParams(conferenceNoteQuerySchema, searchParams);
  if (!parsedFilters.ok) {
    return validationError('クエリパラメータが不正です', parsedFilters.error.flatten().fieldErrors);
  }

  const requestedType = parsedFilters.data.conference_type ?? parsedFilters.data.note_type;

  const notes = await withOrgContext(req.orgId, async (tx) => {
    const [patientScopedCases, facilityScopedCases] = await Promise.all([
      parsedFilters.data.patient_id
        ? tx.careCase.findMany({
            where: {
              org_id: req.orgId,
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
              org_id: req.orgId,
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

    const records = await tx.conferenceNote.findMany({
      where: {
        org_id: req.orgId,
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
      },
      orderBy: { conference_date: 'desc' },
    });

    const caseIds = Array.from(
      new Set(records.map((note) => note.case_id).filter((value): value is string => Boolean(value)))
    );
    const cases = await tx.careCase.findMany({
      where: {
        org_id: req.orgId,
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

    return records.map((note) => {
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
          ].filter((value): value is string => Boolean(value))
        )
      );
      return {
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
    });
  });

  const filteredNotes =
    parsedFilters.data.billing_eligible === undefined
      ? notes
      : notes.filter((note) => note.billing_eligible === parsedFilters.data.billing_eligible);

  const cursorIndex = cursor ? filteredNotes.findIndex((note) => note.id === cursor) : -1;
  const paginated = cursorIndex >= 0 ? filteredNotes.slice(cursorIndex + 1) : filteredNotes;
  const hasMore = paginated.length > limit;
  const data = hasMore ? paginated.slice(0, limit) : paginated;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canReport',
  message: 'カンファレンス記録の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createConferenceNoteSchema.safeParse(body);
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
    structured_content
  );

  const { note, sync } = await withOrgContext(req.orgId, async (tx) => {
    const careCase = case_id
      ? await tx.careCase.findFirst({
          where: {
            id: case_id,
            org_id: req.orgId,
          },
          select: {
            patient_id: true,
          },
        })
      : null;
    const resolvedPatientId =
      parsed.data.patient_id ??
      careCase?.patient_id ??
      (metadata?.visit_brief?.patient_id?.trim() ? metadata.visit_brief.patient_id.trim() : null);
    const primaryResidence = resolvedPatientId
      ? await tx.residence.findFirst({
          where: {
            org_id: req.orgId,
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
        org_id: req.orgId,
        case_id: case_id ?? null,
        patient_id: resolvedPatientId,
        facility_id: parsed.data.facility_id ?? primaryResidence?.facility_id ?? null,
        note_type,
        title,
        content: normalizedContent,
        ...(normalizedStructuredContent ? { structured_content: normalizedStructuredContent } : {}),
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

    return ConferenceDataSyncService.syncSavedNote(tx, req.orgId, req.userId, created, {
      mode: 'create',
    });
  });

  return success({ data: note, sync }, 201);
}, {
  permission: 'canReport',
  message: 'カンファレンス記録の作成権限がありません',
});
