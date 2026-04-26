import {
  getConferenceTypeLabel,
  type VisitWorkflowConferenceContext,
} from '@/lib/visits/visit-workflow-projection';

export type ConferenceReportType =
  | 'physician_report'
  | 'care_manager_report'
  | 'facility_handoff'
  | 'nurse_share'
  | 'family_share'
  | 'internal_record';

export type ConferenceReportSection = {
  key: string;
  label: string;
  body?: string | null;
};

const EXTERNAL_SECTION_ALLOWLIST: Record<
  string,
  Partial<Record<ConferenceReportType, string[]>>
> = {
  pre_discharge: {
    physician_report: [
      'discharge_background',
      'target_discharge_date',
      'medication_changes_on_discharge',
      'medication_summary',
      'risk_assessment',
      'next_visit_plan',
      'consent_status',
    ],
  },
  service_manager: {
    care_manager_report: [
      'meeting_purpose',
      'care_plan_changes',
      'care_plan_update',
      'service_adjustments',
      'visit_schedule_adjustment',
      'coordination_items',
    ],
  },
  emergency: {
    physician_report: ['incident_summary', 'emergency_context', 'immediate_actions'],
  },
};

export function isExternalConferenceReportType(reportType: ConferenceReportType) {
  return reportType !== 'internal_record';
}

function allowedSectionKeys(noteType: string, reportType: ConferenceReportType) {
  return new Set(EXTERNAL_SECTION_ALLOWLIST[noteType]?.[reportType] ?? []);
}

function sectionBody(section: ConferenceReportSection) {
  return section.body?.trim() ?? '';
}

function sectionText(sections: ConferenceReportSection[]) {
  return sections
    .filter((section) => sectionBody(section).length > 0)
    .map((section) => `### ${section.label}\n${sectionBody(section)}`)
    .join('\n\n');
}

export function buildConferenceReportDisclosureContent(args: {
  conferenceNoteId: string;
  noteType: string;
  noteTitle: string;
  reportType: ConferenceReportType;
  label: string;
  sections: ConferenceReportSection[];
  noteContent: string;
  includeStructuredContent: boolean;
}) {
  const sectionsWithBody = args.sections.filter((section) => sectionBody(section).length > 0);

  if (!isExternalConferenceReportType(args.reportType)) {
    return {
      conference_note_id: args.conferenceNoteId,
      note_type: args.noteType,
      title: `${args.label} 報告書ドラフト — ${args.noteTitle}`,
      body: args.includeStructuredContent
        ? sectionText(sectionsWithBody) || args.noteContent
        : args.noteContent,
      sections: sectionsWithBody.map((section) => ({
        key: section.key,
        label: section.label,
        body: sectionBody(section),
      })),
      disclosure_scope: {
        source: 'conference_note',
        audience: 'internal',
        sanitized: false,
        included_section_keys: sectionsWithBody.map((section) => section.key),
        excluded_section_keys: [],
      },
    };
  }

  const allowlist = allowedSectionKeys(args.noteType, args.reportType);
  const allowedSections = args.includeStructuredContent
    ? sectionsWithBody.filter((section) => allowlist.has(section.key))
    : [];
  const excludedSections = sectionsWithBody.filter((section) => !allowlist.has(section.key));

  return {
    conference_note_id: args.conferenceNoteId,
    note_type: args.noteType,
    title: `${args.label} 報告書ドラフト — ${args.noteTitle}`,
    body: args.includeStructuredContent ? sectionText(allowedSections) : '',
    sections: [],
    disclosure_scope: {
      source: 'conference_note',
      audience: args.reportType,
      sanitized: true,
      included_section_keys: allowedSections.map((section) => section.key),
      excluded_section_keys: excludedSections.map((section) => section.key),
    },
  };
}

export function buildReportableConferenceHighlightsFromStructuredContent(args: {
  noteType: VisitWorkflowConferenceContext['note_type'];
  structuredContent: unknown;
}) {
  if (
    typeof args.structuredContent !== 'object' ||
    args.structuredContent === null ||
    Array.isArray(args.structuredContent)
  ) {
    return [];
  }

  const sections: ConferenceReportSection[] = Array.isArray(
    (args.structuredContent as Record<string, unknown>).sections,
  )
    ? ((args.structuredContent as Record<string, unknown>).sections as unknown[])
        .map((section): ConferenceReportSection | null => {
          if (typeof section !== 'object' || section === null || Array.isArray(section)) {
            return null;
          }
          const record = section as Record<string, unknown>;
          return {
            key: typeof record.key === 'string' ? record.key : '',
            label: typeof record.label === 'string' ? record.label : '',
            body: typeof record.body === 'string' ? record.body : '',
          };
        })
        .filter((section): section is ConferenceReportSection => section != null)
    : [];

  const reportType =
    args.noteType === 'pre_discharge'
      ? 'physician_report'
      : args.noteType === 'service_manager'
        ? 'care_manager_report'
        : null;
  if (!reportType) return [];

  const allowlist = allowedSectionKeys(args.noteType, reportType);
  return sections
    .filter((section) => allowlist.has(section.key) && sectionBody(section).length > 0)
    .slice(0, 3)
    .map((section) => `${section.label}: ${sectionBody(section).replace(/\s+/g, ' ')}`);
}

function isReportableConferenceNote(
  note: VisitWorkflowConferenceContext,
  reportType: ConferenceReportType,
) {
  if (reportType === 'physician_report') {
    return note.note_type === 'pre_discharge';
  }
  if (reportType === 'care_manager_report') {
    return note.note_type === 'service_manager';
  }
  return false;
}

export function buildExternalConferenceReportLines(
  notes: VisitWorkflowConferenceContext[],
  reportType: ConferenceReportType,
) {
  return notes.flatMap((note) => {
    if (!isReportableConferenceNote(note, reportType)) return [];
    const prefix = `${getConferenceTypeLabel(note.note_type)}: ${note.title}`;
    return (note.highlights ?? []).slice(0, 3).map((item) => `${prefix} / ${item}`);
  });
}
