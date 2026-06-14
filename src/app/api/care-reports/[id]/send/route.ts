import { NextRequest } from 'next/server';
import type { MemberRole, Prisma } from '@prisma/client';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import { error, forbiddenResponse, success, validationError, notFound } from '@/lib/api/response';
import {
  canAccessVisitScheduleAssignment,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
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

function maskRecipientContact(channel: string, contact: string) {
  if (channel === 'email' || channel === 'ses') {
    const [localPart, domain] = contact.split('@');
    if (!localPart || !domain) return '***';
    return `${localPart.slice(0, 1)}***@${domain.toLowerCase()}`;
  }

  const digits = contact.replace(/\D/g, '');
  if (digits.length >= 4) return `***${digits.slice(-4)}`;
  return contact ? '***' : '';
}

type SendRecipient = {
  channel: 'email' | 'fax' | 'phone' | 'in_person' | 'postal' | 'ses' | 'ph_os_share';
  recipient_name: string;
  recipient_contact: string;
};

function buildDeliveryAttemptAuditChanges(args: {
  deliveryRecordId: string;
  report: {
    id: string;
    case_id: string | null;
    visit_record_id: string | null;
    report_type: string;
    status: string;
  };
  request: SendRecipient & { safety_ack: true };
}) {
  return {
    delivery_record_id: args.deliveryRecordId,
    report_type: args.report.report_type,
    previous_report_status: args.report.status,
    channel: args.request.channel,
    safety_ack: args.request.safety_ack,
    recipient: {
      name: args.request.recipient_name,
      contact_masked: maskRecipientContact(args.request.channel, args.request.recipient_contact),
    },
    source_scope: {
      has_case: Boolean(args.report.case_id),
      has_visit_record: Boolean(args.report.visit_record_id),
    },
  } satisfies Prisma.InputJsonValue;
}

const recipientSchema = z
  .object({
    channel: z.enum(['email', 'fax', 'phone', 'in_person', 'postal', 'ses', 'ph_os_share']),
    recipient_name: z.string().trim().min(1, '送付先氏名は必須です'),
    recipient_contact: z.string().trim().min(1, '送付先連絡先は必須です'),
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

// 単一送付(従来)。一括送付は recipients を持つ別スキーマで受ける。
// 単一送付は recipients が 1 件のサブセットとして扱う。
const singleSendSchema = recipientSchema.and(z.object({ safety_ack: z.literal(true) }));

const bulkSendSchema = z.object({
  recipients: z.array(recipientSchema).min(1, '送付先を1件以上選択してください'),
  safety_ack: z.literal(true),
});

function normalizeSendPayload(
  payload: Record<string, unknown>,
):
  | { ok: true; recipients: SendRecipient[] }
  | { ok: false; details: Record<string, string[] | undefined> } {
  // recipients フィールドがあれば一括送付として扱う。
  if ('recipients' in payload) {
    const parsed = bulkSendSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, details: parsed.error.flatten().fieldErrors };
    }
    return { ok: true, recipients: parsed.data.recipients };
  }

  const parsed = singleSendSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, details: parsed.error.flatten().fieldErrors };
  }
  const recipient: SendRecipient = {
    channel: parsed.data.channel,
    recipient_name: parsed.data.recipient_name,
    recipient_contact: parsed.data.recipient_contact,
  };
  return { ok: true, recipients: [recipient] };
}

async function canAccessCareReport(args: {
  orgId: string;
  userId: string;
  role: MemberRole;
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
      { userId: args.userId, role: args.role },
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
      { userId: args.userId, role: args.role },
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

type ReportRecord = {
  id: string;
  patient_id: string;
  case_id: string | null;
  status: string;
  visit_record_id: string | null;
  content: Prisma.JsonValue;
  report_type: string;
  pdf_url: string | null;
};

type DeliveryOutcome = {
  recipient: SendRecipient;
  deliveryRecordId: string;
  failureReason: string | null;
};

/**
 * 1 件の送付先について、送達レコード作成・監査ログ・(必要なら)メール送信・
 * 状態更新・連携イベント・連絡先プロファイル学習までを実行する。
 * メール送信は外部 I/O のためトランザクション外で行い、結果に応じて記録する。
 */
async function processRecipient(args: {
  ctx: AuthContext;
  reportId: string;
  report: ReportRecord;
  recipient: SendRecipient;
}): Promise<DeliveryOutcome> {
  const { ctx, reportId, report, recipient } = args;

  const attemptedDeliveryRecord = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const deliveryRecord = await tx.deliveryRecord.create({
        data: {
          org_id: ctx.orgId,
          report_id: reportId,
          channel: recipient.channel,
          recipient_name: recipient.recipient_name,
          recipient_contact: recipient.recipient_contact,
          status: 'draft',
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'care_report_delivery_attempted',
        targetType: 'care_report',
        targetId: reportId,
        changes: buildDeliveryAttemptAuditChanges({
          deliveryRecordId: deliveryRecord.id,
          report: { ...report, id: reportId },
          request: { ...recipient, safety_ack: true },
        }),
      });

      return deliveryRecord;
    },
    { requestContext: ctx },
  );

  if (recipient.channel === 'email' || recipient.channel === 'ses') {
    try {
      await sendCareReportEmail({
        to: recipient.recipient_contact,
        recipientName: recipient.recipient_name,
        reportType: report.report_type,
        reportId: report.id,
        pdfUrl: report.pdf_url,
      });
    } catch (cause) {
      const failureReason =
        cause instanceof Error ? cause.message : 'SES によるメール送信に失敗しました';

      await withOrgContext(
        ctx.orgId,
        async (tx) => {
          await tx.deliveryRecord.update({
            where: { id: attemptedDeliveryRecord.id },
            data: {
              status: 'failed',
              failure_reason: failureReason,
            },
          });

          await tx.communicationEvent.create({
            data: {
              org_id: ctx.orgId,
              patient_id: report.patient_id,
              case_id: report.case_id,
              event_type: 'delivery_failure',
              channel: recipient.channel,
              direction: 'outbound',
              counterpart_name: recipient.recipient_name,
              counterpart_contact: recipient.recipient_contact,
              subject: report.report_type,
              content: failureReason,
            },
          });

          await learnContactProfileFromCommunication(tx, {
            orgId: ctx.orgId,
            counterpartName: recipient.recipient_name,
            counterpartContact: recipient.recipient_contact,
            channel: recipient.channel,
            occurredAt: new Date(),
            markSuccess: false,
          });
        },
        { requestContext: ctx },
      );

      return {
        recipient,
        deliveryRecordId: attemptedDeliveryRecord.id,
        failureReason,
      };
    }
  }

  await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const primaryEventType = toPrimaryCommunicationEventType(report.report_type);

      await tx.deliveryRecord.update({
        where: { id: attemptedDeliveryRecord.id },
        data: {
          status: 'sent',
          sent_at: new Date(),
          failure_reason: null,
        },
      });

      const eventType = report.status === 'draft' ? primaryEventType : 'resend';
      if (eventType) {
        await tx.communicationEvent.create({
          data: {
            org_id: ctx.orgId,
            patient_id: report.patient_id,
            case_id: report.case_id,
            event_type: eventType,
            channel: recipient.channel,
            direction: 'outbound',
            counterpart_name: recipient.recipient_name,
            counterpart_contact: recipient.recipient_contact,
            subject: report.report_type,
            content:
              report.status === 'draft'
                ? `${recipient.recipient_name} へ送付`
                : `${recipient.recipient_name} へ再送`,
          },
        });
      }

      await learnContactProfileFromCommunication(tx, {
        orgId: ctx.orgId,
        counterpartName: recipient.recipient_name,
        counterpartContact: recipient.recipient_contact,
        channel: recipient.channel,
        occurredAt: new Date(),
        markSuccess: true,
      });
    },
    { requestContext: ctx },
  );

  return { recipient, deliveryRecordId: attemptedDeliveryRecord.id, failureReason: null };
}

/**
 * すべての送付先処理後、報告書状態・服薬サイクル遷移・算定エビデンスを 1 回だけ更新する。
 * 単一送付はこの処理の n=1 サブセットとして同じ挙動になる。
 */
async function finalizeReportDelivery(args: {
  ctx: AuthContext;
  reportId: string;
  report: ReportRecord;
}) {
  const { ctx, reportId, report } = args;

  return withOrgContext(
    ctx.orgId,
    async (tx) => {
      const updatedReport = await tx.careReport.update({
        where: { id: reportId },
        data: { status: 'sent' },
      });

      if (report.visit_record_id) {
        const schedule = await tx.visitRecord.findFirst({
          where: {
            id: report.visit_record_id,
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
              visit_record_id: report.visit_record_id,
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
              dedupeKey: `care-report-followup:${report.visit_record_id}`,
              status: 'completed',
            });

            await upsertBillingEvidenceForVisit(tx, {
              orgId: ctx.orgId,
              visitRecordId: report.visit_record_id,
            });
          }
        }
      } else {
        const conferenceNoteId =
          report.content &&
          typeof report.content === 'object' &&
          !Array.isArray(report.content) &&
          typeof report.content.conference_note_id === 'string'
            ? report.content.conference_note_id
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
                patient_id: report.patient_id,
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

      return updatedReport;
    },
    { requestContext: ctx },
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canSendCareReport',
    message: '報告書送信の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('報告書IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const normalized = normalizeSendPayload(payload);
  if (!normalized.ok) {
    return validationError('入力値が不正です', normalized.details);
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
      role: ctx.role,
      report: existing,
    }))
  ) {
    return forbiddenResponse('この報告書を送信する権限がありません');
  }

  const recipients = normalized.recipients;

  // 各送付先を順次処理(監査・送達は送付先単位)。
  const outcomes: DeliveryOutcome[] = [];
  for (const recipient of recipients) {
    const outcome = await processRecipient({
      ctx,
      reportId: id,
      report: existing,
      recipient,
    });
    outcomes.push(outcome);
  }

  const failures = outcomes.filter((outcome) => outcome.failureReason !== null);
  const successes = outcomes.filter((outcome) => outcome.failureReason === null);

  // 単一送付でメール送信が失敗した場合は、従来どおり報告書を failed にして 502 を返す。
  if (successes.length === 0) {
    await withOrgContext(
      ctx.orgId,
      async (tx) => {
        await tx.careReport.update({
          where: { id },
          data: { status: 'failed' },
        });
      },
      { requestContext: ctx },
    );

    return error('EXTERNAL_EMAIL_SEND_FAILED', 'メール送信に失敗しました', 502, {
      provider: 'ses',
      failed_recipients: failures.length,
    });
  }

  const report = await finalizeReportDelivery({ ctx, reportId: id, report: existing });

  const deliveries = outcomes.map((outcome) => ({
    delivery_record_id: outcome.deliveryRecordId,
    channel: outcome.recipient.channel,
    recipient_name: outcome.recipient.recipient_name,
    status: outcome.failureReason ? 'failed' : 'sent',
    failure_reason: outcome.failureReason,
  }));

  return success({
    data: {
      report,
      deliveries,
      sent_count: successes.length,
      failed_count: failures.length,
    },
  });
}
