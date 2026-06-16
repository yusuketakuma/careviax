import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import { Prisma, type MemberRole } from '@prisma/client';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withOrgContext } from '@/lib/db/rls';
import {
  conflict,
  error,
  forbiddenResponse,
  success,
  validationError,
  notFound,
} from '@/lib/api/response';
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
import { inferCareReportTargetRole } from '@/lib/reports/document-delivery-rules';
import { toPrismaJsonInput } from '@/lib/db/json';

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

const EMAIL_DELIVERY_FAILURE_REASON = 'メール送信に失敗しました';

type SendRecipient = {
  channel: 'email' | 'fax' | 'phone' | 'in_person' | 'postal' | 'ses' | 'ph_os_share';
  recipient_name: string;
  recipient_contact: string;
  recipient_role: string;
};

const RECIPIENT_ROLE_ALIASES: Record<string, string> = {
  doctor: 'physician',
  prescriber: 'physician',
  visiting_nurse: 'nurse',
  facility: 'facility_staff',
};

const ALLOWED_RECIPIENT_ROLES = new Set([
  'physician',
  'care_manager',
  'nurse',
  'facility_staff',
  'family',
]);

function normalizeRecipientRole(value: string) {
  const normalized = value.trim();
  return RECIPIENT_ROLE_ALIASES[normalized] ?? normalized;
}

function comparableText(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function comparableContact(channel: SendRecipient['channel'], value: string | null | undefined) {
  const normalized = (value ?? '').trim();
  if (channel === 'email' || channel === 'ses') return normalized.toLowerCase();
  if (channel === 'phone' || channel === 'fax') return normalized.replace(/\D/g, '');
  return comparableText(normalized);
}

function buildDeliveryIntentKey(args: {
  reportId: string;
  channel: SendRecipient['channel'];
  recipientName: string;
  recipientRole: string;
  recipientContact: string;
}) {
  const material = [
    'care-report',
    args.reportId,
    args.channel,
    comparableText(args.recipientRole),
    comparableText(args.recipientName),
    comparableContact(args.channel, args.recipientContact),
  ].join(':');
  return `care-report:v1:${createHash('sha256').update(material).digest('hex')}`;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isDeliveredReportStatus(status: string) {
  return status === 'sent' || status === 'confirmed' || status === 'response_waiting';
}

function recipientContactMatches(
  channel: SendRecipient['channel'],
  recipientContact: string,
  source: {
    phone?: string | null;
    email?: string | null;
    fax?: string | null;
    address?: string | null;
  },
) {
  const expectedContact = comparableContact(channel, recipientContact);
  if (!expectedContact) return false;

  if (channel === 'email' || channel === 'ses') {
    return comparableContact(channel, source.email) === expectedContact;
  }
  if (channel === 'fax') return comparableContact(channel, source.fax) === expectedContact;
  if (channel === 'phone') return comparableContact(channel, source.phone) === expectedContact;
  if (channel === 'postal' || channel === 'in_person') {
    return comparableContact(channel, source.address) === expectedContact;
  }

  return (
    comparableContact('email', source.email) === expectedContact ||
    comparableContact('fax', source.fax) === expectedContact ||
    comparableContact('phone', source.phone) === expectedContact
  );
}

function recipientNameMatches(
  recipientName: string,
  sourceNames: Array<string | null | undefined>,
) {
  const expectedName = comparableText(recipientName);
  return sourceNames.some((name) => comparableText(name) === expectedName);
}

async function validateRecipientsAgainstKnownSources(args: {
  orgId: string;
  report: ReportRecord;
  recipients: SendRecipient[];
}) {
  const { orgId, report, recipients } = args;
  if (!report.case_id && !report.patient_id) {
    return {
      ok: false as const,
      recipientName: recipients[0]?.recipient_name ?? '',
    };
  }

  const [cases, latestPrescriptionIntake] = await Promise.all([
    prisma.careCase.findMany({
      where: {
        org_id: orgId,
        ...(report.case_id ? { id: report.case_id } : {}),
        ...(report.patient_id ? { patient_id: report.patient_id } : {}),
      },
      select: {
        care_team_links: {
          select: {
            role: true,
            name: true,
            organization_name: true,
            phone: true,
            email: true,
            fax: true,
            address: true,
            external_professional: {
              select: {
                profession_type: true,
                name: true,
                organization_name: true,
                phone: true,
                email: true,
                fax: true,
                address: true,
              },
            },
          },
        },
      },
    }),
    prisma.prescriptionIntake.findFirst({
      where: {
        org_id: orgId,
        prescriber_institution_id: { not: null },
        cycle: {
          ...(report.case_id ? { case_id: report.case_id } : {}),
          ...(report.patient_id ? { patient_id: report.patient_id } : {}),
        },
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
      select: {
        prescriber_name: true,
        prescriber_institution_ref: {
          select: {
            name: true,
            phone: true,
            fax: true,
            address: true,
          },
        },
      },
    }),
  ]);

  for (const recipient of recipients) {
    const matchesCareTeam = cases.some((careCase) =>
      careCase.care_team_links.some((link) => {
        const professional = link.external_professional;
        const linkRole = normalizeRecipientRole(link.role || professional?.profession_type || '');
        if (linkRole !== recipient.recipient_role) return false;
        if (
          !recipientNameMatches(recipient.recipient_name, [
            link.name,
            professional?.name,
            link.organization_name,
            professional?.organization_name,
          ])
        ) {
          return false;
        }
        return recipientContactMatches(recipient.channel, recipient.recipient_contact, {
          phone: link.phone ?? professional?.phone,
          email: link.email ?? professional?.email,
          fax: link.fax ?? professional?.fax,
          address: link.address ?? professional?.address,
        });
      }),
    );
    if (matchesCareTeam) continue;

    const institution = latestPrescriptionIntake?.prescriber_institution_ref ?? null;
    const matchesPrescriberInstitution =
      recipient.recipient_role === 'physician' &&
      institution != null &&
      recipientNameMatches(recipient.recipient_name, [
        latestPrescriptionIntake?.prescriber_name,
        institution.name,
      ]) &&
      recipientContactMatches(recipient.channel, recipient.recipient_contact, {
        phone: institution.phone,
        fax: institution.fax,
        address: institution.address,
      });
    if (matchesPrescriberInstitution) continue;

    return {
      ok: false as const,
      recipientName: recipient.recipient_name,
    };
  }

  return { ok: true as const };
}

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
      role: args.request.recipient_role,
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
    recipient_role: z
      .string()
      .trim()
      .min(1, '送付先区分は必須です')
      .transform(normalizeRecipientRole)
      .refine((value) => ALLOWED_RECIPIENT_ROLES.has(value), '送付先区分が不正です'),
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
    recipient_role: parsed.data.recipient_role,
  };
  return { ok: true, recipients: [recipient] };
}

function validateRecipientRoles(reportType: string, recipients: SendRecipient[]) {
  const expectedRole = inferCareReportTargetRole(reportType);
  if (expectedRole === 'other') {
    return {
      expectedRole,
      recipientName: recipients[0]?.recipient_name ?? '',
      recipientRole: recipients[0]?.recipient_role ?? '',
    };
  }

  const mismatchedRecipient = recipients.find(
    (recipient) => recipient.recipient_role !== expectedRole,
  );
  if (!mismatchedRecipient) return null;

  return {
    expectedRole,
    recipientName: mismatchedRecipient.recipient_name,
    recipientRole: mismatchedRecipient.recipient_role,
  };
}

function readJsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readReportSourceRevision(content: Prisma.JsonValue) {
  const sourceProvenance = readJsonObject(
    readJsonObject(content).source_provenance as Prisma.JsonValue,
  );
  const visitRecordVersion = sourceProvenance.visit_record_version;
  const visitRecordUpdatedAt = sourceProvenance.visit_record_updated_at;
  return {
    visitRecordVersion: typeof visitRecordVersion === 'number' ? visitRecordVersion : null,
    visitRecordUpdatedAt:
      typeof visitRecordUpdatedAt === 'string' && visitRecordUpdatedAt.trim().length > 0
        ? visitRecordUpdatedAt
        : null,
  };
}

async function validateReportVisitRecordFreshness(args: {
  orgId: string;
  visitRecordId: string | null;
  content: Prisma.JsonValue;
}) {
  if (!args.visitRecordId) return { ok: true as const };
  const sourceRevision = readReportSourceRevision(args.content);
  if (sourceRevision.visitRecordVersion == null && sourceRevision.visitRecordUpdatedAt == null) {
    return {
      ok: false as const,
      reason: 'missing_source_provenance' as const,
      currentVersion: null,
      currentUpdatedAt: null,
    };
  }

  const currentVisitRecord = await prisma.visitRecord.findFirst({
    where: { id: args.visitRecordId, org_id: args.orgId },
    select: { version: true, updated_at: true },
  });
  if (!currentVisitRecord) {
    return {
      ok: false as const,
      reason: 'source_visit_record_missing' as const,
      currentVersion: null,
      currentUpdatedAt: null,
    };
  }

  const versionMatches =
    sourceRevision.visitRecordVersion == null ||
    currentVisitRecord.version === sourceRevision.visitRecordVersion;
  const updatedAtMatches =
    sourceRevision.visitRecordUpdatedAt == null ||
    currentVisitRecord.updated_at.toISOString() === sourceRevision.visitRecordUpdatedAt;
  if (versionMatches && updatedAtMatches) return { ok: true as const };

  return {
    ok: false as const,
    reason: 'source_visit_record_stale' as const,
    currentVersion: currentVisitRecord.version,
    currentUpdatedAt: currentVisitRecord.updated_at.toISOString(),
  };
}

function mergeReportDeliveryTargets(args: {
  content: Prisma.JsonValue;
  outcomes: DeliveryOutcome[];
}): Record<string, unknown> {
  const content = readJsonObject(args.content);
  const existingTargets = Array.isArray(content.report_delivery_targets)
    ? content.report_delivery_targets
    : [];
  const deliveredAt = new Date().toISOString();
  return {
    ...content,
    report_delivery_targets: [
      ...existingTargets,
      ...args.outcomes.map((outcome) => ({
        delivery_record_id: outcome.deliveryRecordId,
        recipient_name: outcome.recipient.recipient_name,
        recipient_role: outcome.recipient.recipient_role,
        channel: outcome.recipient.channel,
        status: outcome.failureReason ? 'failed' : 'sent',
        delivered_at: outcome.failureReason ? null : deliveredAt,
        failure_reason: outcome.failureReason,
      })),
    ].filter((target, index, targets) => {
      if (!target || typeof target !== 'object' || Array.isArray(target)) return true;
      const deliveryRecordId = (target as { delivery_record_id?: unknown }).delivery_record_id;
      if (typeof deliveryRecordId !== 'string') return true;
      return (
        targets.findIndex(
          (candidate) =>
            candidate &&
            typeof candidate === 'object' &&
            !Array.isArray(candidate) &&
            (candidate as { delivery_record_id?: unknown }).delivery_record_id === deliveryRecordId,
        ) === index
      );
    }),
  };
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
  reusedExistingDelivery?: boolean;
};

class DeliveryInProgressConflict extends Error {
  constructor() {
    super('同じ送付先への報告書送付が進行中です。送付履歴を確認してください');
  }
}

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
  const deliveryIntentKey = buildDeliveryIntentKey({
    reportId,
    channel: recipient.channel,
    recipientName: recipient.recipient_name,
    recipientRole: recipient.recipient_role,
    recipientContact: recipient.recipient_contact,
  });

  const attemptedDeliveryRecord = await withOrgContext(
    ctx.orgId,
    async (tx) => {
      const existingDeliveryRecord = await tx.deliveryRecord.findFirst({
        where: {
          org_id: ctx.orgId,
          report_id: reportId,
          channel: recipient.channel,
          OR: [
            { delivery_intent_key: deliveryIntentKey },
            { delivery_intent_key: null, recipient_contact: recipient.recipient_contact },
          ],
        },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          status: true,
        },
      });
      if (existingDeliveryRecord && isDeliveredReportStatus(existingDeliveryRecord.status)) {
        return {
          id: existingDeliveryRecord.id,
          status: existingDeliveryRecord.status,
          reusedExistingDelivery: true,
        };
      }
      if (existingDeliveryRecord?.status === 'draft') {
        throw new DeliveryInProgressConflict();
      }

      const deliveryRecord =
        existingDeliveryRecord?.status === 'failed'
          ? await tx.deliveryRecord.update({
              where: { id: existingDeliveryRecord.id },
              data: {
                recipient_name: recipient.recipient_name,
                recipient_contact: recipient.recipient_contact,
                delivery_intent_key: deliveryIntentKey,
                status: 'draft',
                failure_reason: null,
                retry_count: { increment: 1 },
              },
            })
          : await tx.deliveryRecord
              .create({
                data: {
                  org_id: ctx.orgId,
                  report_id: reportId,
                  channel: recipient.channel,
                  recipient_name: recipient.recipient_name,
                  recipient_contact: recipient.recipient_contact,
                  delivery_intent_key: deliveryIntentKey,
                  status: 'draft',
                },
              })
              .catch(async (createError: unknown) => {
                if (!isUniqueConstraintError(createError)) throw createError;
                const racedDeliveryRecord = await tx.deliveryRecord.findFirst({
                  where: {
                    org_id: ctx.orgId,
                    delivery_intent_key: deliveryIntentKey,
                  },
                  select: {
                    id: true,
                    status: true,
                  },
                });
                if (racedDeliveryRecord && isDeliveredReportStatus(racedDeliveryRecord.status)) {
                  return {
                    id: racedDeliveryRecord.id,
                    status: racedDeliveryRecord.status,
                    reusedExistingDelivery: true,
                  };
                }
                throw new DeliveryInProgressConflict();
              });

      if ('reusedExistingDelivery' in deliveryRecord) {
        return deliveryRecord;
      }

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

  if ('reusedExistingDelivery' in attemptedDeliveryRecord) {
    return {
      recipient,
      deliveryRecordId: attemptedDeliveryRecord.id,
      failureReason: null,
      reusedExistingDelivery: true,
    };
  }

  if (recipient.channel === 'email' || recipient.channel === 'ses') {
    try {
      await sendCareReportEmail({
        to: recipient.recipient_contact,
        recipientName: recipient.recipient_name,
        reportType: report.report_type,
        reportId: report.id,
        pdfUrl: report.pdf_url,
      });
    } catch {
      const failureReason = EMAIL_DELIVERY_FAILURE_REASON;

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

      if (primaryEventType) {
        await tx.communicationEvent.create({
          data: {
            org_id: ctx.orgId,
            patient_id: report.patient_id,
            case_id: report.case_id,
            event_type: primaryEventType,
            channel: recipient.channel,
            direction: 'outbound',
            counterpart_name: recipient.recipient_name,
            counterpart_contact: recipient.recipient_contact,
            subject: report.report_type,
            content:
              report.status === 'sent'
                ? `${recipient.recipient_name} へ再送`
                : `${recipient.recipient_name} へ送付`,
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
  outcomes: DeliveryOutcome[];
}) {
  const { ctx, reportId, report, outcomes } = args;

  return withOrgContext(
    ctx.orgId,
    async (tx) => {
      const currentReportContent = await tx.careReport.findFirst({
        where: { id: reportId, org_id: ctx.orgId },
        select: { content: true },
      });
      const updatedReport = await tx.careReport.update({
        where: { id: reportId },
        data: {
          status: outcomes.some((outcome) => outcome.failureReason !== null)
            ? 'response_waiting'
            : 'sent',
          content: toPrismaJsonInput(
            mergeReportDeliveryTargets({
              content: currentReportContent?.content ?? report.content,
              outcomes,
            }),
          ),
        },
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
  if (existing.status === 'draft') {
    return conflict('薬剤師確認済みの報告書のみ送付できます', {
      status: existing.status,
    });
  }
  const freshness = await validateReportVisitRecordFreshness({
    orgId: ctx.orgId,
    visitRecordId: existing.visit_record_id,
    content: existing.content,
  });
  if (!freshness.ok) {
    return conflict('訪問記録が更新されています。報告書を再生成してから送付してください', {
      reason: freshness.reason,
      visit_record_id: existing.visit_record_id,
      current_visit_record_version: freshness.currentVersion,
      current_visit_record_updated_at: freshness.currentUpdatedAt,
    });
  }

  const recipients = normalized.recipients;
  const roleMismatch = validateRecipientRoles(existing.report_type, recipients);
  if (roleMismatch) {
    return validationError('報告書タイプと送付先区分が一致していません', {
      recipient_role: [
        `${roleMismatch.recipientName} は ${roleMismatch.recipientRole} ですが、この報告書の送付先区分は ${roleMismatch.expectedRole} です`,
      ],
    });
  }

  const recipientSourceValidation = await validateRecipientsAgainstKnownSources({
    orgId: ctx.orgId,
    report: existing,
    recipients,
  });
  if (!recipientSourceValidation.ok) {
    return validationError('送付先が現在の患者関係者または処方元候補と一致していません', {
      recipient: [
        `${recipientSourceValidation.recipientName} は現在の患者関係者・処方元候補として確認できません`,
      ],
    });
  }

  // 各送付先を順次処理(監査・送達は送付先単位)。
  const outcomes: DeliveryOutcome[] = [];
  for (const recipient of recipients) {
    try {
      const outcome = await processRecipient({
        ctx,
        reportId: id,
        report: existing,
        recipient,
      });
      outcomes.push(outcome);
    } catch (cause) {
      if (cause instanceof DeliveryInProgressConflict) {
        return conflict(cause.message, {
          report_id: id,
          recipient_contact: recipient.recipient_contact,
          channel: recipient.channel,
        });
      }
      throw cause;
    }
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

  const report = await finalizeReportDelivery({ ctx, reportId: id, report: existing, outcomes });

  const deliveries = outcomes.map((outcome) => ({
    delivery_record_id: outcome.deliveryRecordId,
    channel: outcome.recipient.channel,
    recipient_name: outcome.recipient.recipient_name,
    recipient_role: outcome.recipient.recipient_role,
    status: outcome.failureReason ? 'failed' : 'sent',
    failure_reason: outcome.failureReason,
    reused_existing_delivery: outcome.reusedExistingDelivery === true,
    external_send_skipped:
      outcome.reusedExistingDelivery === true && outcome.failureReason === null,
  }));
  const reusedDeliveryCount = outcomes.filter(
    (outcome) => outcome.reusedExistingDelivery === true,
  ).length;

  return success({
    data: {
      report,
      deliveries,
      sent_count: successes.length,
      failed_count: failures.length,
      reused_delivery_count: reusedDeliveryCount,
      retry_finalized_from_existing_delivery: reusedDeliveryCount > 0,
    },
  });
}
