import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { formatUtcDateKey } from '@/lib/date-key';
import { runJob } from '../runner';
import {
  addJapanCalendarDays,
  parseConferenceSections,
  parseDateFromConferenceText,
  startOfDay,
} from '../daily-helpers';
import { dispatchNotificationEvent } from '@/server/services/notifications';
import { listOrganizationIds } from '../organization-iteration';

export async function checkConferenceMeetingReminders() {
  return runJob('conference_meeting_reminders', async () => {
    const today = startOfDay(new Date());
    const tomorrow = addJapanCalendarDays(today, 1);

    const orgIds = await listOrganizationIds(prisma);
    let processedCount = 0;

    for (const orgId of orgIds) {
      const notes = await withOrgContext(orgId, (tx) =>
        tx.conferenceNote.findMany({
          where: {
            org_id: orgId,
            note_type: 'service_manager',
          },
          select: {
            id: true,
            case_id: true,
            title: true,
            structured_content: true,
          },
        }),
      );

      const caseIds = Array.from(
        new Set(
          notes.map((note) => note.case_id).filter((value): value is string => Boolean(value)),
        ),
      );
      const careCases =
        caseIds.length > 0
          ? await withOrgContext(orgId, (tx) =>
              tx.careCase.findMany({
                where: {
                  org_id: orgId,
                  id: { in: caseIds },
                },
                select: {
                  id: true,
                  patient_id: true,
                  primary_pharmacist_id: true,
                  patient: {
                    select: {
                      name: true,
                    },
                  },
                },
              }),
            )
          : [];
      const careCaseById = new Map(careCases.map((careCase) => [careCase.id, careCase]));

      for (const note of notes) {
        if (!note.case_id) continue;

        const sections = parseConferenceSections(note.structured_content);
        const nextMeetingSection = sections.find((section) => section.key === 'next_meeting_date');
        const meetingDate = parseDateFromConferenceText(nextMeetingSection?.body);
        if (!meetingDate) continue;
        const meetingDateKey = formatUtcDateKey(meetingDate);

        const isReminderWindow =
          meetingDate.getTime() === today.getTime() || meetingDate.getTime() === tomorrow.getTime();
        if (!isReminderWindow) continue;

        const careCase = careCaseById.get(note.case_id);
        const primaryPharmacistId = careCase?.primary_pharmacist_id;
        if (!primaryPharmacistId) continue;

        await withOrgContext(orgId, async (tx) =>
          dispatchNotificationEvent(tx, {
            orgId,
            eventType: 'conference_next_meeting_due',
            type: 'reminder',
            title: '次回担当者会議の予定確認',
            message: `${careCase.patient.name ?? '患者'} の担当者会議が ${meetingDateKey} に予定されています。`,
            link: '/conferences',
            explicitUserIds: [primaryPharmacistId],
            dedupeKey: `conference-next-meeting:${note.id}:${meetingDateKey}`,
            metadata: {
              conference_note_id: note.id,
              case_id: note.case_id,
              patient_id: careCase.patient_id,
              next_meeting_date: meetingDateKey,
            } satisfies Prisma.InputJsonValue,
          }),
        );
        processedCount++;
      }
    }

    return { processedCount };
  });
}
