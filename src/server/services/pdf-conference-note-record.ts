import { prisma } from '@/lib/db/client';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  readPdfJsonArrayField,
  readPdfJsonObject,
  readPdfJsonObjects,
} from '@/server/services/pdf-document-json';
import { PdfNotFoundError } from './pdf-errors';

export type ConferenceNoteParticipant = {
  name?: string;
  role?: string;
  attended?: boolean;
  is_report_recipient?: boolean;
  email?: string;
  fax?: string;
};

export type ConferenceNoteActionItem = {
  title?: string;
  assignee?: string;
  converted_task_id?: string;
  converted_at?: string;
};

export type ConferenceNoteStructuredSection = {
  key: string;
  label: string;
  body?: string;
};

export type ConferenceNotePdfRecord = {
  id: string;
  note_type: string;
  title: string;
  content: string;
  conference_date: Date;
  participants: ConferenceNoteParticipant[];
  structured_sections: ConferenceNoteStructuredSection[];
  action_items: ConferenceNoteActionItem[];
  metadata: Record<string, unknown>;
  patient: {
    id: string;
    name: string;
    birth_date: Date;
    gender: string;
  } | null;
  facility_name: string | null;
  unit_name: string | null;
};

function parseConferenceParticipants(raw: unknown): ConferenceNoteParticipant[] {
  return readPdfJsonObjects(raw).map((item) => ({
    name: typeof item.name === 'string' ? item.name : undefined,
    role: typeof item.role === 'string' ? item.role : undefined,
    attended: typeof item.attended === 'boolean' ? item.attended : undefined,
    is_report_recipient:
      typeof item.is_report_recipient === 'boolean' ? item.is_report_recipient : undefined,
    email: typeof item.email === 'string' ? item.email : undefined,
    fax: typeof item.fax === 'string' ? item.fax : undefined,
  }));
}

function parseConferenceActionItems(raw: unknown): ConferenceNoteActionItem[] {
  return readPdfJsonObjects(raw).map((item) => ({
    title: typeof item.title === 'string' ? item.title : undefined,
    assignee: typeof item.assignee === 'string' ? item.assignee : undefined,
    converted_task_id:
      typeof item.converted_task_id === 'string' ? item.converted_task_id : undefined,
    converted_at: typeof item.converted_at === 'string' ? item.converted_at : undefined,
  }));
}

function parseConferenceStructuredSections(raw: unknown): ConferenceNoteStructuredSection[] {
  return readPdfJsonObjects(readPdfJsonArrayField(raw, 'sections')).flatMap((item) => {
    if (typeof item.key !== 'string' || typeof item.label !== 'string') return [];
    return [
      {
        key: item.key,
        label: item.label,
        body: typeof item.body === 'string' ? item.body : undefined,
      },
    ];
  });
}

export async function getConferenceNoteRecord(
  orgId: string,
  noteId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<ConferenceNotePdfRecord> {
  const note = await prisma.conferenceNote.findFirst({
    where: { id: noteId, org_id: orgId },
    select: {
      id: true,
      case_id: true,
      patient_id: true,
      note_type: true,
      title: true,
      content: true,
      structured_content: true,
      metadata: true,
      participants: true,
      conference_date: true,
      action_items: true,
    },
  });

  if (!note) {
    throw new PdfNotFoundError('conferenceNote');
  }

  if (
    accessContext &&
    !canBypassVisitScheduleAssignmentAccess(accessContext) &&
    !note.case_id &&
    !note.patient_id
  ) {
    throw new PdfNotFoundError('conferenceNote');
  }

  if (accessContext && note.patient_id) {
    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere({ id: note.patient_id, org_id: orgId }, accessContext),
      select: { id: true },
    });
    if (!patient) {
      throw new PdfNotFoundError('conferenceNote');
    }
  }

  const careCase = note.case_id
    ? await prisma.careCase.findFirst({
        where: {
          id: note.case_id,
          org_id: orgId,
          ...(accessContext && buildCareCaseAssignmentWhere(accessContext)
            ? { AND: [buildCareCaseAssignmentWhere(accessContext)!] }
            : {}),
        },
        select: {
          patient: {
            select: {
              id: true,
              name: true,
              birth_date: true,
              gender: true,
              residences: {
                where: { is_primary: true },
                take: 1,
                select: {
                  unit_name: true,
                  facility: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    : null;

  if (note.case_id && !careCase) {
    throw new PdfNotFoundError('conferenceNote');
  }

  return {
    id: note.id,
    note_type: note.note_type,
    title: note.title,
    content: note.content,
    conference_date: note.conference_date,
    participants: parseConferenceParticipants(note.participants),
    structured_sections: parseConferenceStructuredSections(note.structured_content),
    action_items: parseConferenceActionItems(note.action_items),
    metadata: readPdfJsonObject(note.metadata),
    patient: careCase?.patient ?? null,
    facility_name: careCase?.patient.residences[0]?.facility?.name ?? null,
    unit_name: careCase?.patient.residences[0]?.unit_name ?? null,
  };
}
