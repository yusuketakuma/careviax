import { withAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { ConferenceSyncService } from '@/server/services/conference-sync';
import {
  generateConferenceReportSchema,
  type ConferenceParticipantInput,
} from '@/lib/validations/conference';

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, routeContext) => {
    const { id } = await routeContext.params;
    const body = await req.json().catch(() => ({}));

    const parsed = generateConferenceReportSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const note = await prisma.conferenceNote.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
      },
      select: {
        id: true,
        case_id: true,
        patient_id: true,
        note_type: true,
        title: true,
        content: true,
        conference_date: true,
        participants: true,
        structured_content: true,
        metadata: true,
        generated_report_id: true,
        action_items: true,
      },
    });

    if (!note) {
      return notFound('カンファレンス記録が見つかりません');
    }

    const defaultReportTypes =
      note.note_type === 'pre_discharge'
        ? ['physician_report']
        : note.note_type === 'service_manager'
          ? ['care_manager_report']
          : note.note_type === 'death_conference' || note.note_type === 'care_team'
            ? ['internal_record']
            : note.note_type === 'emergency'
              ? ['physician_report', 'internal_record']
              : ['internal_record'];

    if (parsed.data.report_type && !defaultReportTypes.includes(parsed.data.report_type)) {
      return validationError('この会議種別では指定された報告書種別を生成できません');
    }

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const careCase = note.case_id
        ? await tx.careCase.findFirst({
            where: {
              id: note.case_id,
              org_id: ctx.orgId,
            },
            select: {
              patient_id: true,
            },
          })
        : null;

      const reportDraftIds = await ConferenceSyncService.generateReportDraft(
        tx,
        ctx.orgId,
        ctx.userId,
        note,
        note.patient_id ?? careCase?.patient_id ?? null,
        {
          ...(parsed.data.report_type ? { reportTypes: [parsed.data.report_type] } : {}),
          includeStructuredContent: parsed.data.include_structured_content,
        },
      );

      const queuedRecipients: Array<{
        report_id: string;
        name: string;
        channel: 'email' | 'fax';
      }> = [];
      if (parsed.data.auto_send && reportDraftIds.length > 0) {
        const participants = Array.isArray(note.participants)
          ? (note.participants as ConferenceParticipantInput[])
          : [];
        const recipients = participants.filter(
          (participant) =>
            participant.is_report_recipient &&
            ((participant.email && participant.email.length > 0) ||
              (participant.fax && participant.fax.length > 0)),
        );

        if (recipients.length > 0) {
          const draftRows = reportDraftIds.flatMap((reportId) =>
            recipients.map((recipient) => ({
              org_id: ctx.orgId,
              report_id: reportId,
              channel: recipient.email && recipient.email.length > 0 ? 'email' : 'fax',
              recipient_name: recipient.name,
              recipient_contact:
                (recipient.email && recipient.email.length > 0 ? recipient.email : recipient.fax) ??
                '',
              status: 'draft' as const,
            })),
          );

          const deliveryRecordClient = tx.deliveryRecord as {
            findMany?: (args: unknown) => Promise<
              Array<{
                report_id: string;
                channel: string;
                recipient_contact: string;
              }>
            >;
            createMany?: (args: unknown) => Promise<unknown>;
          };
          const existingDrafts =
            typeof deliveryRecordClient.findMany === 'function'
              ? await deliveryRecordClient.findMany({
                  where: {
                    org_id: ctx.orgId,
                    report_id: { in: reportDraftIds },
                  },
                  select: {
                    report_id: true,
                    channel: true,
                    recipient_contact: true,
                  },
                })
              : [];
          const existingKeys = new Set(
            existingDrafts.map(
              (item) => `${item.report_id}:${item.channel}:${item.recipient_contact}`,
            ),
          );
          const newDraftRows = draftRows.filter(
            (item) =>
              !existingKeys.has(`${item.report_id}:${item.channel}:${item.recipient_contact}`),
          );
          if (newDraftRows.length > 0 && typeof deliveryRecordClient.createMany === 'function') {
            await deliveryRecordClient.createMany({
              data: newDraftRows,
            });
          }
          queuedRecipients.push(
            ...newDraftRows.map((item) => ({
              report_id: item.report_id,
              name: item.recipient_name,
              channel: item.channel as 'email' | 'fax',
            })),
          );
        }
      }

      if (reportDraftIds[0]) {
        await tx.conferenceNote.update({
          where: { id: note.id },
          data: {
            generated_report_id: reportDraftIds[0],
          },
        });
      }

      return {
        report_draft_ids: reportDraftIds,
        queued_recipients: queuedRecipients,
      };
    });

    return success({ data: result }, 201);
  },
  {
    permission: 'canReport',
    message: '報告書生成の権限がありません',
  },
);
