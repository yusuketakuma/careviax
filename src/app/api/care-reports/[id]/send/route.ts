import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { error, forbiddenResponse, success, validationError, notFound } from '@/lib/api/response';
import {
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { sendCareReportEmail } from '@/server/services/report-delivery';
import { learnContactProfileFromCommunication } from '@/lib/contact-profiles';
import { transitionCycleStatus } from '@/lib/db/cycle-transition';

function toPrimaryCommunicationEventType(reportType: string) {
  switch (reportType) {
    case 'physician_report':
      return 'physician_report';
    case 'care_manager_report':
      return 'care_manager_report';
    default:
      return null;
  }
}

const sendCareReportSchema = z
  .object({
    channel: z.enum(['email', 'fax', 'phone', 'in_person', 'postal', 'ses']),
    recipient_name: z.string().min(1, '送付先氏名は必須です'),
    recipient_contact: z.string().min(1, '送付先連絡先は必須です'),
  })
  .superRefine((value, ctx) => {
    if (
      (value.channel === 'email' || value.channel === 'ses') &&
      !z.string().email().safeParse(value.recipient_contact).success
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'メール送信時は送付先連絡先にメールアドレスを指定してください',
        path: ['recipient_contact'],
      });
    }
  });

async function canAccessCareReport(args: {
  orgId: string;
  userId: string;
  report: {
    patient_id: string;
    case_id: string | null;
    visit_record_id: string | null;
  };
}) {
  if (args.report.visit_record_id) {
    const visitRecord = await prisma.visitRecord.findFirst({
      where: {
        id: args.report.visit_record_id,
        org_id: args.orgId,
      },
      select: {
        schedule: {
          select: {
            pharmacist_id: true,
            case_: {
              select: {
                primary_pharmacist_id: true,
                backup_pharmacist_id: true,
              },
            },
          },
        },
      },
    });

    return canAccessVisitScheduleAssignment(
      { userId: args.userId, role: 'pharmacist' },
      visitRecord?.schedule,
    );
  }

  if (args.report.case_id) {
    const careCase = await prisma.careCase.findFirst({
      where: {
        id: args.report.case_id,
        org_id: args.orgId,
      },
      select: {
        primary_pharmacist_id: true,
        backup_pharmacist_id: true,
      },
    });

    return canAccessVisitScheduleAssignment(
      { userId: args.userId, role: 'pharmacist' },
      {
        pharmacist_id: null,
        case_: careCase,
      },
    );
  }

  const accessibleSchedule = await prisma.visitSchedule.findFirst({
    where: {
      org_id: args.orgId,
      case_: {
        patient_id: args.report.patient_id,
      },
      OR: [
        { pharmacist_id: args.userId },
        { case_: { primary_pharmacist_id: args.userId } },
        { case_: { backup_pharmacist_id: args.userId } },
      ],
    },
    select: { id: true },
  });
  if (accessibleSchedule) return true;

  const accessibleCase = await prisma.careCase.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.report.patient_id,
      OR: [{ primary_pharmacist_id: args.userId }, { backup_pharmacist_id: args.userId }],
    },
    select: { id: true },
  });

  return Boolean(accessibleCase);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canSendCareReport',
    message: '報告書送信の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = sendCareReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const existing = await prisma.careReport.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      status: true,
      visit_record_id: true,
      content: true,
      report_type: true,
      pdf_url: true,
    },
  });
  if (!existing) return notFound('報告書が見つかりません');
  if (
    !canBypassVisitScheduleAssignmentAccess(ctx) &&
    !(await canAccessCareReport({
      orgId: ctx.orgId,
      userId: ctx.userId,
      report: existing,
    }))
  ) {
    return forbiddenResponse('この報告書を送信する権限がありません');
  }

  if (parsed.data.channel === 'email' || parsed.data.channel === 'ses') {
    try {
      await sendCareReportEmail({
        to: parsed.data.recipient_contact,
        recipientName: parsed.data.recipient_name,
        reportType: existing.report_type,
        reportId: existing.id,
        pdfUrl: existing.pdf_url,
      });
    } catch (cause) {
      const failureReason =
        cause instanceof Error ? cause.message : 'SES によるメール送信に失敗しました';

      await withOrgContext(
        ctx.orgId,
        async (tx) => {
          await tx.deliveryRecord.create({
            data: {
              org_id: ctx.orgId,
              report_id: id,
              channel: parsed.data.channel,
              recipient_name: parsed.data.recipient_name,
              recipient_contact: parsed.data.recipient_contact,
              status: 'failed',
              failure_reason: failureReason,
            },
          });

          await tx.careReport.update({
            where: { id },
            data: { status: 'failed' },
          });

          await tx.communicationEvent.create({
            data: {
              org_id: ctx.orgId,
              patient_id: existing.patient_id,
              case_id: existing.case_id,
              event_type: 'delivery_failure',
              channel: parsed.data.channel,
              direction: 'outbound',
              counterpart_name: parsed.data.recipient_name,
              counterpart_contact: parsed.data.recipient_contact,
              subject: existing.report_type,
              content: failureReason,
            },
          });

          await learnContactProfileFromCommunication(tx, {
            orgId: ctx.orgId,
            counterpartName: parsed.data.recipient_name,
            counterpartContact: parsed.data.recipient_contact,
            channel: parsed.data.channel,
            occurredAt: new Date(),
            markSuccess: false,
          });
        },
        { requestContext: ctx },
      );

      return error('EXTERNAL_EMAIL_SEND_FAILED', 'メール送信に失敗しました', 502, {
        provider: 'ses',
      });
    }
  }

  const result = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const primaryEventType = toPrimaryCommunicationEventType(existing.report_type);

      // DeliveryRecord を作成し、MVPではステータスを sent に設定
      const deliveryRecord = await tx.deliveryRecord.create({
        data: {
          org_id: ctx.orgId,
          report_id: id,
          channel: parsed.data.channel,
          recipient_name: parsed.data.recipient_name,
          recipient_contact: parsed.data.recipient_contact,
          status: 'sent',
          sent_at: new Date(),
        },
      });

      // 報告書のステータスも sent に更新
      const report = await tx.careReport.update({
        where: { id },
        data: { status: 'sent' },
      });

      const eventType = existing.status === 'draft' ? primaryEventType : 'resend';
      if (eventType) {
        await tx.communicationEvent.create({
          data: {
            org_id: ctx.orgId,
            patient_id: existing.patient_id,
            case_id: existing.case_id,
            event_type: eventType,
            channel: parsed.data.channel,
            direction: 'outbound',
            counterpart_name: parsed.data.recipient_name,
            counterpart_contact: parsed.data.recipient_contact,
            subject: existing.report_type,
            content:
              existing.status === 'draft'
                ? `${parsed.data.recipient_name} へ送付`
                : `${parsed.data.recipient_name} へ再送`,
          },
        });
      }

      await learnContactProfileFromCommunication(tx, {
        orgId: ctx.orgId,
        counterpartName: parsed.data.recipient_name,
        counterpartContact: parsed.data.recipient_contact,
        channel: parsed.data.channel,
        occurredAt: new Date(),
        markSuccess: true,
      });

      if (existing.visit_record_id) {
        const schedule = await tx.visitRecord.findFirst({
          where: {
            id: existing.visit_record_id,
            org_id: ctx.orgId,
          },
          select: {
            schedule: {
              select: {
                cycle_id: true,
              },
            },
          },
        });

        if (schedule?.schedule.cycle_id) {
          const siblingReports = await tx.careReport.findMany({
            where: {
              org_id: ctx.orgId,
              visit_record_id: existing.visit_record_id,
            },
            select: { status: true },
          });

          const allReportsDelivered =
            siblingReports.length > 0 &&
            siblingReports.every(
              (siblingReport) =>
                siblingReport.status === 'sent' || siblingReport.status === 'confirmed',
            );

          if (allReportsDelivered) {
            const cycle = await tx.medicationCycle.findFirst({
              where: {
                id: schedule.schedule.cycle_id,
                org_id: ctx.orgId,
              },
              select: { id: true, overall_status: true },
            });

            if (cycle?.overall_status === 'visit_ready') {
              await transitionCycleStatus(tx, cycle.id, ctx.orgId, 'visit_completed', ctx.userId, {
                note: '報告書送付に伴う訪問完了',
              });
              await transitionCycleStatus(tx, cycle.id, ctx.orgId, 'reported', ctx.userId, {
                note: '報告書送付完了',
              });
            } else if (cycle?.overall_status === 'visit_completed') {
              await transitionCycleStatus(tx, cycle.id, ctx.orgId, 'reported', ctx.userId, {
                note: '報告書送付完了',
              });
            }

            await resolveOperationalTasks(tx, {
              orgId: ctx.orgId,
              dedupeKey: `care-report-followup:${existing.visit_record_id}`,
              status: 'completed',
            });

            await upsertBillingEvidenceForVisit(tx, {
              orgId: ctx.orgId,
              visitRecordId: existing.visit_record_id,
            });
          }
        }
      } else {
        const conferenceNoteId =
          existing.content &&
          typeof existing.content === 'object' &&
          !Array.isArray(existing.content) &&
          typeof existing.content.conference_note_id === 'string'
            ? existing.content.conference_note_id
            : null;

        if (conferenceNoteId) {
          const conferenceNote = await tx.conferenceNote.findFirst({
            where: {
              id: conferenceNoteId,
              org_id: ctx.orgId,
            },
            select: {
              case_id: true,
              conference_date: true,
            },
          });

          if (conferenceNote?.case_id) {
            const monthStart = new Date(
              conferenceNote.conference_date.getFullYear(),
              conferenceNote.conference_date.getMonth(),
              1,
            );
            const monthEnd = new Date(
              conferenceNote.conference_date.getFullYear(),
              conferenceNote.conference_date.getMonth() + 1,
              0,
              23,
              59,
              59,
              999,
            );
            const relatedVisitRecords = await tx.visitRecord.findMany({
              where: {
                org_id: ctx.orgId,
                patient_id: existing.patient_id,
                visit_date: {
                  gte: monthStart,
                  lte: monthEnd,
                },
                schedule: {
                  case_id: conferenceNote.case_id,
                },
              },
              select: {
                id: true,
              },
            });

            for (const visitRecord of relatedVisitRecords) {
              await upsertBillingEvidenceForVisit(tx, {
                orgId: ctx.orgId,
                visitRecordId: visitRecord.id,
              });
            }
          }
        }
      }

      return { report, deliveryRecord };
    },
    { requestContext: ctx },
  );

  return success({ data: result });
}
