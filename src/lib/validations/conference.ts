import { z } from 'zod';
import { optionalFaxNumberSchema } from '@/lib/validations/phone';

export const conferenceNoteTypeSchema = z.enum([
  'regular',
  'pre_discharge',
  'service_manager',
  'care_team',
  'emergency',
  'death_conference',
]);

export const conferenceParticipantSchema = z.object({
  name: z.string().trim().min(1),
  role: z.string().trim().optional().default(''),
  external_professional_id: z.string().trim().optional(),
  attended: z.boolean().optional().default(true),
  is_report_recipient: z.boolean().optional().default(false),
  organization_name: z.string().trim().optional(),
  email: z.string().email('メールアドレス形式が不正です').optional().or(z.literal('')),
  fax: optionalFaxNumberSchema,
});

export const conferenceActionItemSchema = z.object({
  title: z.string().trim().min(1),
  assignee: z.string().trim().optional(),
  converted_task_id: z.string().trim().optional(),
  converted_at: z.string().trim().optional(),
});

export const conferenceStructuredSectionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  body: z.string().trim().optional(),
});

export const conferenceStructuredContentSchema = z.object({
  template: conferenceNoteTypeSchema.optional(),
  sections: z.array(conferenceStructuredSectionSchema).min(1),
});

export const conferenceMetadataSchema = z
  .object({
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
  })
  .optional();

type ConferencePayloadWithType = {
  note_type?: z.infer<typeof conferenceNoteTypeSchema>;
  conference_type?: z.infer<typeof conferenceNoteTypeSchema>;
  content?: string;
  structured_content?: z.infer<typeof conferenceStructuredContentSchema>;
};

const conferenceStructuredSectionRules: Partial<
  Record<
    z.infer<typeof conferenceNoteTypeSchema>,
    {
      requiredKeys: string[];
      allowedKeys?: string[];
    }
  >
> = {
  pre_discharge: {
    requiredKeys: ['discharge_background'],
    allowedKeys: [
      'discharge_background',
      'target_discharge_date',
      'medication_changes_on_discharge',
      'medication_summary',
      'next_visit_plan',
      'team_roles',
      'consent_status',
      'risk_assessment',
    ],
  },
  service_manager: {
    requiredKeys: ['meeting_purpose'],
    allowedKeys: [
      'meeting_purpose',
      'care_plan_changes',
      'care_plan_update',
      'service_adjustments',
      'visit_schedule_adjustment',
      'medication_related_items',
      'medication_review',
      'agreed_actions',
      'coordination_items',
      'next_meeting_date',
    ],
  },
  care_team: {
    requiredKeys: [],
    allowedKeys: [
      'discussion_summary',
      'case_review',
      'medication_issues',
      'intervention_outcomes',
    ],
  },
  death_conference: {
    requiredKeys: ['billing_confirmation'],
    allowedKeys: [
      'billing_confirmation',
      'timeline_summary',
      'terminal_process',
      'improvement_actions',
      'quality_indicators',
      'medication_at_end',
    ],
  },
  emergency: {
    requiredKeys: [],
    allowedKeys: [
      'emergency_context',
      'incident_summary',
      'root_cause',
      'urgent_actions',
      'immediate_actions',
      'risk_mitigation',
    ],
  },
};

function validateConferenceStructuredContent(
  noteType: z.infer<typeof conferenceNoteTypeSchema>,
  structuredContent: z.infer<typeof conferenceStructuredContentSchema> | undefined,
  ctx: z.RefinementCtx,
) {
  if (!structuredContent) return;

  if (structuredContent.template && structuredContent.template !== noteType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['structured_content', 'template'],
      message: 'structured_content.template が conference_type と一致していません',
    });
  }

  const duplicateKeys = structuredContent.sections.reduce<string[]>(
    (keys, section, index, source) => {
      if (!section.key.trim()) return keys;
      if (source.findIndex((candidate) => candidate.key === section.key) !== index) {
        keys.push(section.key);
      }
      return keys;
    },
    [],
  );
  if (duplicateKeys.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['structured_content', 'sections'],
      message: `structured_content.sections に重複した key があります: ${Array.from(new Set(duplicateKeys)).join(', ')}`,
    });
  }

  const populatedSections = structuredContent.sections.filter((section) => section.body?.trim());
  if (populatedSections.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['structured_content', 'sections'],
      message: '本文を含むセクションを1件以上入力してください',
    });
    return;
  }

  const rules = conferenceStructuredSectionRules[noteType];
  if (!rules) return;

  if (rules.allowedKeys?.length) {
    const unexpectedKeys = structuredContent.sections
      .map((section) => section.key)
      .filter((key) => !rules.allowedKeys?.includes(key));
    if (unexpectedKeys.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['structured_content', 'sections'],
        message: `${noteType} では許可されていない section key が含まれています: ${Array.from(new Set(unexpectedKeys)).join(', ')}`,
      });
    }
  }

  const keys = new Set(populatedSections.map((section) => section.key));
  const missingKeys = rules.requiredKeys.filter((key) => !keys.has(key));
  if (missingKeys.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['structured_content', 'sections'],
      message: `${noteType} では次のセクションを入力してください: ${missingKeys.join(', ')}`,
    });
  }
}

export function resolveConferenceNoteType(input: ConferencePayloadWithType) {
  if (input.note_type && input.conference_type && input.note_type !== input.conference_type) {
    return null;
  }

  return input.note_type ?? input.conference_type ?? 'regular';
}

export function buildConferenceContent(
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

export function buildConferenceMetadata(
  noteType: z.infer<typeof conferenceNoteTypeSchema>,
  metadata: z.infer<typeof conferenceMetadataSchema>,
) {
  const supportsBillingMetadata =
    noteType === 'pre_discharge' ||
    noteType === 'service_manager' ||
    noteType === 'death_conference';
  const billingDefaults =
    noteType === 'pre_discharge'
      ? {
          link_status: 'candidate' as const,
          code: 'B011-6',
          label: '退院時共同指導',
          points: 600,
        }
      : noteType === 'death_conference'
        ? {
            link_status: 'candidate' as const,
            code: 'C013',
            label: 'ターミナルケア会議',
            points: 2500,
          }
        : noteType === 'service_manager'
          ? {
              link_status: 'candidate' as const,
              code: 'MED_INFO_PROVISION_2_HA',
              label: '服薬情報等提供料2 ハ',
              points: 20,
            }
          : undefined;

  const normalizedBilling = supportsBillingMetadata
    ? {
        ...(billingDefaults ?? {}),
        ...(metadata?.billing ?? {}),
      }
    : {};
  const normalizedVisitBrief = {
    ...(metadata?.visit_brief?.patient_id ? { patient_id: metadata.visit_brief.patient_id } : {}),
    ...(metadata?.visit_brief?.schedule_id
      ? { schedule_id: metadata.visit_brief.schedule_id }
      : {}),
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
  };
}

export function normalizeConferenceStructuredContent(
  noteType: z.infer<typeof conferenceNoteTypeSchema>,
  structuredContent: z.infer<typeof conferenceStructuredContentSchema> | undefined,
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
  };
}

export const createConferenceNoteSchema = z
  .object({
    case_id: z.string().trim().optional(),
    patient_id: z.string().trim().optional(),
    facility_id: z.string().trim().optional(),
    note_type: conferenceNoteTypeSchema.optional(),
    conference_type: conferenceNoteTypeSchema.optional(),
    title: z.string().min(1).max(200),
    content: z.string().trim().optional(),
    structured_content: conferenceStructuredContentSchema.optional(),
    metadata: conferenceMetadataSchema,
    billing_eligible: z.boolean().optional(),
    billing_code: z.string().trim().optional(),
    follow_up_date: z.string().datetime().optional(),
    follow_up_completed: z.boolean().optional(),
    participants: z.array(conferenceParticipantSchema),
    conference_date: z.string().datetime(),
    action_items: z.array(conferenceActionItemSchema).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.note_type && !value.conference_type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conference_type'],
        message: 'conference_type または note_type を指定してください',
      });
      return;
    }

    const noteType = resolveConferenceNoteType(value);
    if (!noteType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['conference_type'],
        message: 'conference_type と note_type が一致していません',
      });
      return;
    }

    const synthesizedContent = buildConferenceContent(value.content, value.structured_content);
    if (!synthesizedContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: '内容または構造化セクションのいずれかを入力してください',
      });
    }

    validateConferenceStructuredContent(noteType, value.structured_content, ctx);
  });

export const updateConferenceNoteSchema = z
  .object({
    patient_id: z.string().trim().optional(),
    facility_id: z.string().trim().optional(),
    note_type: conferenceNoteTypeSchema.optional(),
    conference_type: conferenceNoteTypeSchema.optional(),
    title: z.string().min(1).max(200).optional(),
    content: z.string().trim().optional(),
    structured_content: conferenceStructuredContentSchema.optional(),
    metadata: conferenceMetadataSchema,
    billing_eligible: z.boolean().optional(),
    billing_code: z.string().trim().optional(),
    follow_up_date: z.string().datetime().optional(),
    follow_up_completed: z.boolean().optional(),
    participants: z.array(conferenceParticipantSchema).optional(),
    conference_date: z.string().datetime().optional(),
    action_items: z.array(conferenceActionItemSchema).optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    '更新対象を1件以上指定してください',
  );

export const conferenceNoteQuerySchema = z.object({
  note_type: conferenceNoteTypeSchema.optional(),
  conference_type: conferenceNoteTypeSchema.optional(),
  detail_level: z.enum(['detail', 'summary']).optional().default('detail'),
  patient_id: z.string().trim().optional(),
  facility_id: z.string().trim().optional(),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
  billing_eligible: z.preprocess((value) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }, z.boolean().optional()),
});

export const generateConferenceReportSchema = z.object({
  report_type: z
    .enum([
      'physician_report',
      'care_manager_report',
      'facility_handoff',
      'nurse_share',
      'family_share',
      'internal_record',
    ])
    .optional(),
  include_structured_content: z.boolean().optional().default(true),
  auto_send: z.boolean().optional().default(false),
});

export type ConferenceParticipantInput = z.infer<typeof conferenceParticipantSchema>;
