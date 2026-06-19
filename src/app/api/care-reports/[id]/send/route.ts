import { NextRequest } from 'next/server';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Prisma, type MemberRole } from '@prisma/client';
import { requireAuthContext, type AuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { parseOptionalIdempotencyKey } from '@/lib/api/idempotency-key';
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
import { upsertBillingEvidenceForVisit } from '@/server/services/billing-evidence';
import { resolveOperationalTasks } from '@/server/services/operational-tasks';
import { sendCareReportEmail } from '@/server/services/report-delivery';
import { learnContactProfileFromCommunication } from '@/lib/contact-profiles';
import { transitionCycleStatus } from '@/lib/db/cycle-transition';
import { inferCareReportTargetRole } from '@/lib/reports/care-report-target-role';
import { toPrismaJsonInput } from '@/lib/db/json';
import { getAuthSecret } from '@/lib/auth/secret';
import { logger } from '@/lib/utils/logger';
import {
  normalizeCareReportRecipientRole,
  normalizeCareReportSendPayload,
  type CareReportSendRecipient as SendRecipient,
} from '@/lib/reports/care-report-send-validation';

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
const STALE_DRAFT_DELIVERY_MS = 10 * 60 * 1000;
const STALE_SEND_REQUEST_MS = 10 * 60 * 1000;

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

function resolveCareReportIdempotencyHashSecret() {
  const configuredSecret = process.env.CARE_REPORT_IDEMPOTENCY_HASH_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  const authSecret = getAuthSecret();
  if (authSecret) return authSecret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('care report idempotency hash secret is not configured');
  }
  return 'ph-os-local-care-report-idempotency-secret';
}

function keyedHashJson(value: unknown) {
  const secret = resolveCareReportIdempotencyHashSecret();
  return createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
}

function buildCareReportSendIdempotencyKeyHash(args: { reportId: string; idempotencyKey: string }) {
  return `care-report-send:v2:${keyedHashJson({
    purpose: 'care_report_send_idempotency_key',
    report_id: args.reportId,
    idempotency_key: args.idempotencyKey,
  })}`;
}

function buildCareReportSendRequestFingerprint(args: {
  reportId: string;
  recipients: SendRecipient[];
  expectedUpdatedAt: Date;
}) {
  return `care-report-send-request:v2:${keyedHashJson({
    action: 'care_report.send',
    report_id: args.reportId,
    expected_updated_at: args.expectedUpdatedAt.toISOString(),
    recipients: args.recipients.map((recipient) => ({
      channel: recipient.channel,
      recipient_name: recipient.recipient_name,
      recipient_contact: recipient.recipient_contact,
      recipient_role: recipient.recipient_role,
    })),
    safety_ack: true,
  })}`;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isDeliveredReportStatus(status: string) {
  return status === 'sent' || status === 'confirmed' || status === 'response_waiting';
}

function isStaleDraftDelivery(updatedAt: Date | null | undefined, now = new Date()) {
  if (!(updatedAt instanceof Date)) return false;
  return now.getTime() - updatedAt.getTime() >= STALE_DRAFT_DELIVERY_MS;
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
        const linkRole = normalizeCareReportRecipientRole(
          link.role || professional?.profession_type || '',
        );
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
  updated_at: Date;
};

type DeliveryOutcome = {
  recipient: SendRecipient;
  deliveryRecordId: string;
  failureReason: string | null;
  reusedExistingDelivery?: boolean;
};

function buildDeliveryResponseItem(outcome: DeliveryOutcome) {
  return {
    delivery_record_id: outcome.deliveryRecordId,
    channel: outcome.recipient.channel,
    recipient_role: outcome.recipient.recipient_role,
    recipient_contact_masked: maskRecipientContact(
      outcome.recipient.channel,
      outcome.recipient.recipient_contact,
    ),
    status: outcome.failureReason ? 'failed' : 'sent',
    failure_reason: outcome.failureReason,
    retryable: outcome.failureReason !== null,
    reused_existing_delivery: outcome.reusedExistingDelivery === true,
    external_send_skipped:
      outcome.reusedExistingDelivery === true && outcome.failureReason === null,
  };
}

class DeliveryInProgressConflict extends Error {
  constructor() {
    super('同じ送付先への報告書送付が進行中です。送付履歴を確認してください');
  }
}

function isStaleSendRequest(updatedAt: Date | null | undefined, now = new Date()) {
  if (!(updatedAt instanceof Date)) return false;
  return now.getTime() - updatedAt.getTime() >= STALE_SEND_REQUEST_MS;
}

function toJsonSerializable(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function minimizeDeliveryForIdempotencyReplay(value: unknown) {
  const delivery = readRecord(value);
  if (!delivery) return value;
  return {
    delivery_record_id: delivery.delivery_record_id,
    channel: delivery.channel,
    recipient_role: delivery.recipient_role,
    recipient_contact_masked: delivery.recipient_contact_masked,
    status: delivery.status,
    failure_reason: delivery.failure_reason,
    retryable: delivery.retryable,
    reused_existing_delivery: delivery.reused_existing_delivery,
    external_send_skipped: delivery.external_send_skipped,
  };
}

function minimizeResponseBodyForIdempotencyReplay(responseBody: unknown) {
  const body = readRecord(responseBody);
  if (!body) return responseBody;
  const data = readRecord(body.data);
  const details = readRecord(body.details);
  if (data) {
    const report = readRecord(data.report);
    return {
      data: {
        report: report
          ? {
              id: report.id,
              status: report.status,
            }
          : data.report,
        deliveries: Array.isArray(data.deliveries)
          ? data.deliveries.map(minimizeDeliveryForIdempotencyReplay)
          : data.deliveries,
        sent_count: data.sent_count,
        failed_count: data.failed_count,
        reused_delivery_count: data.reused_delivery_count,
        retry_finalized_from_existing_delivery: data.retry_finalized_from_existing_delivery,
      },
    };
  }
  if (details) {
    return {
      code: body.code,
      message: body.message,
      details: {
        ...details,
        deliveries: Array.isArray(details.deliveries)
          ? details.deliveries.map(minimizeDeliveryForIdempotencyReplay)
          : details.deliveries,
      },
    };
  }
  return body;
}

type ReportSendIdempotencyClaim =
  | { kind: 'none' }
  | { kind: 'claimed'; id: string; claimToken: string }
  | { kind: 'claimable'; id: string }
  | { kind: 'replayed'; responseStatus: number; responseBody: Prisma.JsonValue }
  | { kind: 'idempotency_conflict' }
  | { kind: 'in_progress' };

type ReportSendRequestRecord = {
  id: string;
  request_fingerprint: string;
  status: string;
  response_status: number | null;
  response_body: Prisma.JsonValue | null;
  updated_at: Date | null;
};

async function peekCareReportSendIdempotency(args: {
  ctx: AuthContext;
  reportId: string;
  idempotencyKey: string | null;
  requestFingerprint: string | null;
}): Promise<ReportSendIdempotencyClaim> {
  const requestFingerprint = args.requestFingerprint;
  if (!args.idempotencyKey || !requestFingerprint) return { kind: 'none' };
  const idempotencyKeyHash = buildCareReportSendIdempotencyKeyHash({
    reportId: args.reportId,
    idempotencyKey: args.idempotencyKey,
  });

  const existing = await withOrgContext(
    args.ctx.orgId,
    (tx) =>
      tx.careReportSendRequest.findFirst({
        where: {
          org_id: args.ctx.orgId,
          report_id: args.reportId,
          idempotency_key_hash: idempotencyKeyHash,
        },
        select: {
          id: true,
          request_fingerprint: true,
          status: true,
          response_status: true,
          response_body: true,
          updated_at: true,
        },
      }),
    { requestContext: args.ctx },
  );

  return existing
    ? replayOrConflictFromSendRequest(existing, requestFingerprint)
    : { kind: 'none' };
}

function replayOrConflictFromSendRequest(
  existing: ReportSendRequestRecord,
  requestFingerprint: string,
): ReportSendIdempotencyClaim {
  if (existing.request_fingerprint !== requestFingerprint) {
    return { kind: 'idempotency_conflict' };
  }
  if (
    existing.status === 'completed' &&
    existing.response_status != null &&
    existing.response_body != null
  ) {
    return {
      kind: 'replayed',
      responseStatus: existing.response_status,
      responseBody: existing.response_body,
    };
  }
  if (!isStaleSendRequest(existing.updated_at)) {
    return { kind: 'in_progress' };
  }
  return { kind: 'claimable', id: existing.id };
}

async function claimCareReportSendIdempotency(args: {
  ctx: AuthContext;
  reportId: string;
  idempotencyKey: string | null;
  requestFingerprint: string | null;
}): Promise<ReportSendIdempotencyClaim> {
  const requestFingerprint = args.requestFingerprint;
  if (!args.idempotencyKey || !requestFingerprint) return { kind: 'none' };

  const idempotencyKeyHash = buildCareReportSendIdempotencyKeyHash({
    reportId: args.reportId,
    idempotencyKey: args.idempotencyKey,
  });

  return withOrgContext(
    args.ctx.orgId,
    async (tx) => {
      const findExisting = () =>
        tx.careReportSendRequest.findFirst({
          where: {
            org_id: args.ctx.orgId,
            report_id: args.reportId,
            idempotency_key_hash: idempotencyKeyHash,
          },
          select: {
            id: true,
            request_fingerprint: true,
            status: true,
            response_status: true,
            response_body: true,
            updated_at: true,
          },
        });

      const existing = await findExisting();
      if (existing) {
        const interpreted = replayOrConflictFromSendRequest(existing, requestFingerprint);
        if (interpreted.kind !== 'claimable') return interpreted;
        const claimToken = randomUUID();
        const claimed = await tx.careReportSendRequest.updateMany({
          where: {
            id: existing.id,
            org_id: args.ctx.orgId,
            report_id: args.reportId,
            status: existing.status,
            request_fingerprint: requestFingerprint,
            updated_at: existing.updated_at,
          },
          data: {
            status: 'in_progress',
            response_status: null,
            completed_at: null,
            claim_token: claimToken,
            created_by: args.ctx.userId,
          },
        });
        return claimed.count === 1
          ? { kind: 'claimed', id: existing.id, claimToken }
          : { kind: 'in_progress' };
      }

      try {
        const claimToken = randomUUID();
        const created = await tx.careReportSendRequest.create({
          data: {
            org_id: args.ctx.orgId,
            report_id: args.reportId,
            idempotency_key_hash: idempotencyKeyHash,
            request_fingerprint: requestFingerprint,
            claim_token: claimToken,
            created_by: args.ctx.userId,
          },
          select: { id: true },
        });
        return { kind: 'claimed', id: created.id, claimToken };
      } catch (createError) {
        if (!isUniqueConstraintError(createError)) throw createError;
        const raced = await findExisting();
        if (!raced) return { kind: 'in_progress' };
        const interpreted = replayOrConflictFromSendRequest(raced, requestFingerprint);
        return interpreted.kind === 'claimable' ? { kind: 'in_progress' } : interpreted;
      }
    },
    { requestContext: args.ctx },
  );
}

async function completeCareReportSendIdempotency(args: {
  ctx: AuthContext;
  claim: ReportSendIdempotencyClaim;
  reportId: string;
  responseStatus: number;
  responseBody: unknown;
}) {
  const claim = args.claim;
  if (claim.kind !== 'claimed') return true;
  const serializableBody = toJsonSerializable(args.responseBody);
  try {
    const updatedCount = await withOrgContext(
      args.ctx.orgId,
      async (tx) => {
        const updated = await tx.careReportSendRequest.updateMany({
          where: {
            id: claim.id,
            org_id: args.ctx.orgId,
            report_id: args.reportId,
            status: 'in_progress',
            claim_token: claim.claimToken,
          },
          data: {
            status: 'completed',
            response_status: args.responseStatus,
            response_body: toPrismaJsonInput(serializableBody),
            completed_at: new Date(),
          },
        });
        return updated.count;
      },
      { requestContext: args.ctx },
    );
    if (updatedCount === 1) return true;
    logger.error({
      event: 'care_report.send_idempotency_completion_failed',
      orgId: args.ctx.orgId,
      userId: args.ctx.userId,
      entityType: 'care_report',
      entityId: args.reportId,
      targetId: claim.id,
      code: 'CARE_REPORT_SEND_IDEMPOTENCY_COMPLETION_FAILED',
      status: args.responseStatus,
      count: updatedCount,
    });
    return false;
  } catch (cause) {
    logger.error(
      {
        event: 'care_report.send_idempotency_completion_failed',
        orgId: args.ctx.orgId,
        userId: args.ctx.userId,
        entityType: 'care_report',
        entityId: args.reportId,
        targetId: claim.id,
        code: 'CARE_REPORT_SEND_IDEMPOTENCY_COMPLETION_FAILED',
        status: args.responseStatus,
      },
      cause,
    );
    return false;
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
          updated_at: true,
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
        if (!isStaleDraftDelivery(existingDeliveryRecord.updated_at)) {
          throw new DeliveryInProgressConflict();
        }
        const staleClaim = await tx.deliveryRecord.updateMany({
          where: {
            id: existingDeliveryRecord.id,
            org_id: ctx.orgId,
            status: 'draft',
            updated_at: existingDeliveryRecord.updated_at,
          },
          data: {
            recipient_name: recipient.recipient_name,
            recipient_contact: recipient.recipient_contact,
            delivery_intent_key: deliveryIntentKey,
            failure_reason: null,
            retry_count: { increment: 1 },
          },
        });
        if (staleClaim.count !== 1) {
          throw new DeliveryInProgressConflict();
        }
        await createAuditLogEntry(tx, ctx, {
          action: 'care_report_delivery_attempted',
          targetType: 'care_report',
          targetId: reportId,
          changes: buildDeliveryAttemptAuditChanges({
            deliveryRecordId: existingDeliveryRecord.id,
            report: { ...report, id: reportId },
            request: { ...recipient, safety_ack: true },
          }),
        });
        return {
          id: existingDeliveryRecord.id,
          status: existingDeliveryRecord.status,
        };
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
                    updated_at: true,
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
        select: {
          id: true,
          status: true,
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
            siblingReports.every((siblingReport) => siblingReport.status === 'sent');

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

  const normalized = normalizeCareReportSendPayload(payload);
  if (!normalized.ok) {
    return validationError('入力値が不正です', normalized.details);
  }
  const parsedIdempotencyKey = parseOptionalIdempotencyKey(req.headers.get('idempotency-key'));
  if (!parsedIdempotencyKey.ok) {
    return validationError(parsedIdempotencyKey.message);
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
      updated_at: true,
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
  const requestFingerprint = parsedIdempotencyKey.key
    ? buildCareReportSendRequestFingerprint({
        reportId: id,
        recipients,
        expectedUpdatedAt: normalized.expectedUpdatedAt,
      })
    : null;
  const idempotencyPeek = await peekCareReportSendIdempotency({
    ctx,
    reportId: id,
    idempotencyKey: parsedIdempotencyKey.key,
    requestFingerprint,
  });
  if (idempotencyPeek.kind === 'replayed') {
    return success(idempotencyPeek.responseBody, idempotencyPeek.responseStatus);
  }
  if (idempotencyPeek.kind === 'idempotency_conflict') {
    return error(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency-Keyが別の報告書送付リクエストで使用されています',
      409,
      { reason: 'key_reused_with_different_request' },
    );
  }
  if (idempotencyPeek.kind === 'in_progress') {
    return conflict('同じIdempotency-Keyの報告書送付が進行中です', {
      reason: 'request_in_progress',
    });
  }

  if (existing.status === 'draft') {
    return conflict('薬剤師確認済みの報告書のみ送付できます', {
      status: existing.status,
    });
  }
  if (existing.updated_at.getTime() !== normalized.expectedUpdatedAt.getTime()) {
    return conflict('報告書が同時に更新されました。再読み込みしてください');
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

  const idempotencyClaim = await claimCareReportSendIdempotency({
    ctx,
    reportId: id,
    idempotencyKey: parsedIdempotencyKey.key,
    requestFingerprint,
  });
  if (idempotencyClaim.kind === 'replayed') {
    return success(idempotencyClaim.responseBody, idempotencyClaim.responseStatus);
  }
  if (idempotencyClaim.kind === 'idempotency_conflict') {
    return error(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency-Keyが別の報告書送付リクエストで使用されています',
      409,
      { reason: 'key_reused_with_different_request' },
    );
  }
  if (idempotencyClaim.kind === 'in_progress') {
    return conflict('同じIdempotency-Keyの報告書送付が進行中です', {
      reason: 'request_in_progress',
    });
  }
  if (idempotencyClaim.kind === 'claimable') {
    return conflict('同じIdempotency-Keyの報告書送付が進行中です', {
      reason: 'request_in_progress',
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
        const responseBody = {
          code: 'WORKFLOW_CONFLICT',
          message: cause.message,
          details: {
            report_id: id,
            recipient_contact_masked: maskRecipientContact(
              recipient.channel,
              recipient.recipient_contact,
            ),
            channel: recipient.channel,
          },
        };
        const replayBody = minimizeResponseBodyForIdempotencyReplay(responseBody);
        await completeCareReportSendIdempotency({
          ctx,
          claim: idempotencyClaim,
          reportId: id,
          responseStatus: 409,
          responseBody: replayBody,
        });
        return success(idempotencyClaim.kind === 'claimed' ? replayBody : responseBody, 409);
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

    const responseBody = {
      code: 'EXTERNAL_EMAIL_SEND_FAILED',
      message: 'メール送信に失敗しました',
      details: {
        provider: 'ses',
        failed_recipients: failures.length,
        deliveries: failures.map(buildDeliveryResponseItem),
      },
    };
    const replayBody = minimizeResponseBodyForIdempotencyReplay(responseBody);
    await completeCareReportSendIdempotency({
      ctx,
      claim: idempotencyClaim,
      reportId: id,
      responseStatus: 502,
      responseBody: replayBody,
    });
    return success(idempotencyClaim.kind === 'claimed' ? replayBody : responseBody, 502);
  }

  const report = await finalizeReportDelivery({ ctx, reportId: id, report: existing, outcomes });

  const deliveries = outcomes.map(buildDeliveryResponseItem);
  const reusedDeliveryCount = outcomes.filter(
    (outcome) => outcome.reusedExistingDelivery === true,
  ).length;
  const responseBody = {
    data: {
      report,
      deliveries,
      sent_count: successes.length,
      failed_count: failures.length,
      reused_delivery_count: reusedDeliveryCount,
      retry_finalized_from_existing_delivery: reusedDeliveryCount > 0,
    },
  };
  const replayBody = minimizeResponseBodyForIdempotencyReplay(responseBody);
  await completeCareReportSendIdempotency({
    ctx,
    claim: idempotencyClaim,
    reportId: id,
    responseStatus: 200,
    responseBody: replayBody,
  });

  return success(idempotencyClaim.kind === 'claimed' ? replayBody : responseBody);
}
