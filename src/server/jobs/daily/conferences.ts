import { addDays } from 'date-fns';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { runJob } from '../runner';
import {
  formatDateKey,
  parseConferenceSections,
  parseDateFromConferenceText,
  startOfDay,
} from '../daily-helpers';
import { dispatchNotificationEvent } from '@/server/services/notifications';

export async function checkConferenceMeetingReminders() {
  return runJob('conference_meeting_reminders', async () => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);

    // cross-org: by-design。システム全体 cron のためリマインダ対象を全org横断で走査する。
    // 通知は下段の withOrgContext(note.org_id) 内で dispatch され、対象者(primaryPharmacistId)も
    // note.org_id と同一 org の careCase から解決するため org 境界を跨いだ漏洩は無い。
    const notes = await prisma.conferenceNote.findMany({
      where: {
        note_type: 'service_manager',
      },
      select: {
        id: true,
        org_id: true,
        case_id: true,
        title: true,
        structured_content: true,
      },
    });

    const caseIds = Array.from(
      new Set(notes.map((note) => note.case_id).filter((value): value is string => Boolean(value))),
    );
    const careCases =
      caseIds.length > 0
        ? await prisma.careCase.findMany({
            where: {
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
          })
        : [];
    const careCaseById = new Map(careCases.map((careCase) => [careCase.id, careCase]));

    let processedCount = 0;

    for (const note of notes) {
      if (!note.case_id) continue;

      const sections = parseConferenceSections(note.structured_content);
      const nextMeetingSection = sections.find((section) => section.key === 'next_meeting_date');
      const meetingDate = parseDateFromConferenceText(nextMeetingSection?.body);
      if (!meetingDate) continue;

      const isReminderWindow =
        meetingDate.getTime() === today.getTime() || meetingDate.getTime() === tomorrow.getTime();
      if (!isReminderWindow) continue;

      const careCase = careCaseById.get(note.case_id);
      const primaryPharmacistId = careCase?.primary_pharmacist_id;
      if (!primaryPharmacistId) continue;

      await withOrgContext(note.org_id, async (tx) =>
        dispatchNotificationEvent(tx, {
          orgId: note.org_id,
          eventType: 'conference_next_meeting_due',
          type: 'reminder',
          title: '次回担当者会議の予定確認',
          message: `${careCase.patient.name ?? '患者'} の担当者会議が ${formatDateKey(meetingDate)} に予定されています。`,
          link: '/conferences',
          explicitUserIds: [primaryPharmacistId],
          dedupeKey: `conference-next-meeting:${note.id}:${formatDateKey(meetingDate)}`,
          metadata: {
            conference_note_id: note.id,
            case_id: note.case_id,
            patient_id: careCase.patient_id,
            next_meeting_date: formatDateKey(meetingDate),
          } satisfies Prisma.InputJsonValue,
        }),
      );
      processedCount++;
    }

    return { processedCount };
  });
}
