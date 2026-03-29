import { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { z } from 'zod';
import { ConferenceSyncService } from '@/server/services/conference-sync';

const conferenceNoteTypeSchema = z.enum([
  'regular',
  'pre_discharge',
  'service_manager',
  'care_team',
  'emergency',
  'death_conference',
]);

const participantSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional().default(''),
});

const actionItemSchema = z.object({
  title: z.string().min(1),
  assignee: z.string().optional(),
  converted_task_id: z.string().optional(),
  converted_at: z.string().optional(),
});

const structuredContentSchema = z.object({
  template: conferenceNoteTypeSchema.optional(),
  sections: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        body: z.string().trim().optional(),
      })
    )
    .min(1),
});

const conferenceMetadataSchema = z.object({
  billing: z
    .object({
      link_status: z.enum(['none', 'candidate', 'linked']).optional(),
      code: z.string().trim().optional(),
      label: z.string().trim().optional(),
      points: z.number().int().nonnegative().optional(),
    })
    .optional(),
  visit_brief: z
    .object({
      patient_id: z.string().trim().optional(),
      schedule_id: z.string().trim().optional(),
      highlighted_risks: z.array(z.string().trim().min(1)).optional(),
      summary: z.string().trim().optional(),
    })
    .optional(),
}).optional();

const createNoteSchema = z
  .object({
    case_id: z.string().optional(),
    note_type: conferenceNoteTypeSchema.default('regular'),
    title: z.string().min(1).max(200),
    content: z.string().trim().optional(),
    structured_content: structuredContentSchema.optional(),
    metadata: conferenceMetadataSchema,
    participants: z.array(participantSchema),
    conference_date: z.string().datetime(),
    action_items: z.array(actionItemSchema).optional(),
  })
  .superRefine((value, ctx) => {
    const synthesizedContent = buildConferenceContent(value.content, value.structured_content);
    if (!synthesizedContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: '内容または構造化セクションのいずれかを入力してください',
      });
    }
  });

function buildConferenceContent(
  content: string | undefined,
  structuredContent:
    | {
        sections: Array<{ label: string; body?: string }>;
      }
    | undefined,
) {
  const normalizedContent = content?.trim();
  if (normalizedContent) return normalizedContent;

  if (!structuredContent?.sections?.length) return '';

  return structuredContent.sections
    .map((section) => ({
      label: section.label.trim(),
      body: section.body?.trim() ?? '',
    }))
    .filter((section) => section.body)
    .map((section) => `${section.label}: ${section.body}`)
    .join('\n');
}

function buildConferenceMetadata(
  noteType: z.infer<typeof conferenceNoteTypeSchema>,
  metadata: z.infer<typeof conferenceMetadataSchema>,
) {
  const billingDefaults =
    noteType === 'pre_discharge'
      ? {
          link_status: 'candidate' as const,
          label: '退院時共同指導',
          points: 600,
        }
      : noteType === 'death_conference'
        ? {
            link_status: 'candidate' as const,
            label: 'ターミナルケア会議',
            points: 2500,
          }
        : undefined;

  const normalizedBilling = {
    ...(billingDefaults ?? {}),
    ...(metadata?.billing ?? {}),
  };
  const normalizedVisitBrief = {
    ...(metadata?.visit_brief?.patient_id ? { patient_id: metadata.visit_brief.patient_id } : {}),
    ...(metadata?.visit_brief?.schedule_id ? { schedule_id: metadata.visit_brief.schedule_id } : {}),
    ...(metadata?.visit_brief?.summary ? { summary: metadata.visit_brief.summary } : {}),
    ...(metadata?.visit_brief?.highlighted_risks?.length
      ? {
          highlighted_risks: metadata.visit_brief.highlighted_risks,
        }
      : {}),
  };

  const hasBilling = Object.keys(normalizedBilling).length > 0;
  const hasVisitBrief = Object.keys(normalizedVisitBrief).length > 0;

  if (!hasBilling && !hasVisitBrief) return undefined;
  return {
    ...(hasBilling ? { billing: normalizedBilling } : {}),
    ...(hasVisitBrief ? { visit_brief: normalizedVisitBrief } : {}),
  } satisfies Prisma.InputJsonValue;
}

function normalizeStructuredContent(
  noteType: z.infer<typeof conferenceNoteTypeSchema>,
  structuredContent: z.infer<typeof structuredContentSchema> | undefined,
) {
  if (!structuredContent) return undefined;

  const sections = structuredContent.sections
    .map((section) => ({
      key: section.key,
      label: section.label,
      ...(section.body?.trim() ? { body: section.body.trim() } : {}),
    }))
    .filter((section) => 'body' in section);

  if (sections.length === 0) return undefined;

  return {
    template: structuredContent.template ?? noteType,
    sections,
  } satisfies Prisma.InputJsonValue;
}

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);
  const caseId = searchParams.get('case_id') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(caseId ? { case_id: caseId } : {}),
  };

  const notes = await withOrgContext(req.orgId, async (tx) => {
    const records = await tx.conferenceNote.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { conference_date: 'desc' },
    });

    const caseIds = Array.from(
      new Set(records.map((note) => note.case_id).filter((value): value is string => Boolean(value)))
    );
    if (caseIds.length === 0) {
      return records;
    }

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
          },
        },
      },
    });
    const caseById = new Map(cases.map((item) => [item.id, item]));

    return records.map((note) => {
      const relatedCase = note.case_id ? caseById.get(note.case_id) : null;
      return {
        ...note,
        patient_id: relatedCase?.patient_id ?? null,
        patient_name: relatedCase?.patient.name ?? null,
      };
    });
  });

  const hasMore = notes.length > limit;
  const data = hasMore ? notes.slice(0, limit) : notes;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canReport',
  message: 'カンファレンス記録の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.issues);
  }

  const {
    case_id,
    note_type,
    title,
    content,
    structured_content,
    metadata,
    participants,
    conference_date,
    action_items,
  } = parsed.data;
  const normalizedContent = buildConferenceContent(content, structured_content);
  const normalizedMetadata = buildConferenceMetadata(note_type, metadata);
  const normalizedStructuredContent = normalizeStructuredContent(note_type, structured_content);

  const { note, sync } = await withOrgContext(req.orgId, async (tx) => {
    const created = await tx.conferenceNote.create({
      data: {
        org_id: req.orgId,
        case_id: case_id ?? null,
        note_type,
        title,
        content: normalizedContent,
        ...(normalizedStructuredContent ? { structured_content: normalizedStructuredContent } : {}),
        ...(normalizedMetadata ? { metadata: normalizedMetadata } : {}),
        participants,
        conference_date: new Date(conference_date),
        action_items: action_items !== undefined ? action_items : Prisma.JsonNull,
      },
    });

    const syncResult = await ConferenceSyncService.syncOnCreate(tx, req.orgId, req.userId, {
      id: created.id,
      case_id: created.case_id,
      note_type: created.note_type,
      title: created.title,
      conference_date: created.conference_date,
      participants: created.participants,
      structured_content: created.structured_content,
      metadata: created.metadata,
      action_items: created.action_items,
    });

    return { note: created, sync: syncResult };
  });

  return success({ data: note, sync }, 201);
}, {
  permission: 'canReport',
  message: 'カンファレンス記録の作成権限がありません',
});
