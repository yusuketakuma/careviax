import { NextRequest } from 'next/server';
import { createHash, randomInt, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { withAuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { error, forbidden, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { SmsNotificationAdapter } from '@/server/adapters/sms';
import {
  attachExternalAccessCaseBoundary,
  externalAccessScopeRequiresCaseBoundary,
  buildExternalAccessGrantVisibilityWhere,
  issueExternalAccessToken,
  MissingExternalAccessSecretError,
  toPublicExternalAccessScope,
  validateExternalAccessScopeForRole,
} from '@/server/services/external-access';
import {
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
} from '@/lib/auth/visit-schedule-access';
import { hasPermission } from '@/lib/auth/permissions';
import { canAccessPatient, listAccessiblePatientCaseIds } from '@/server/services/patient-access';
import { z } from 'zod';

const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

const createGrantSchema = z.object({
  patient_id: requiredTrimmedStringSchema('患者IDは必須です'),
  granted_to_name: requiredTrimmedStringSchema('共有先氏名は必須です'),
  granted_to_contact: z.string().trim().optional().nullable(),
  scope: z.unknown(),
  expires_hours: z.number().int().min(1).max(720).default(72),
});

const EXTERNAL_ACCESS_LIST_PAGE_SIZE = 200;
function optionalTrimmedSearchParam(value: string | null) {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function looksLikePhoneNumber(value: string | null | undefined) {
  if (!value) return false;
  const normalized = value.replace(/[^\d+]/g, '');
  return /^(\+?\d{10,15})$/.test(normalized);
}

function maskPhoneNumber(value: string) {
  const digitsOnly = value.replace(/[^\d]/g, '');
  if (digitsOnly.length <= 4) return value;
  return `${digitsOnly.slice(0, 3)}****${digitsOnly.slice(-4)}`;
}

async function listExternalGrantsForContext(args: {
  orgId: string;
  patientId?: string;
  accessContext: Parameters<typeof canAccessPatient>[0]['accessContext'];
}) {
  if (
    !hasPermission(args.accessContext.role, 'canVisit') &&
    !hasPermission(args.accessContext.role, 'canSendCareReport')
  ) {
    return [];
  }

  const canBypassAssignment = canBypassVisitScheduleAssignmentAccess(args.accessContext);

  if (args.patientId) {
    const canAccessTargetPatient = await canAccessPatient({
      db: prisma,
      orgId: args.orgId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });
    if (!canAccessTargetPatient) return [];

    const visibleCaseIds = canBypassAssignment
      ? undefined
      : await listAccessiblePatientCaseIds({
          db: prisma,
          orgId: args.orgId,
          patientId: args.patientId,
          accessContext: args.accessContext,
        });

    if (visibleCaseIds === undefined) {
      return prisma.externalAccessGrant.findMany({
        where: {
          org_id: args.orgId,
          revoked_at: null,
          patient_id: args.patientId,
        },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          org_id: true,
          patient_id: true,
          granted_to_name: true,
          granted_to_contact: true,
          scope: true,
          expires_at: true,
          accessed_at: true,
          created_at: true,
        },
        take: EXTERNAL_ACCESS_LIST_PAGE_SIZE,
      });
    }

    return prisma.externalAccessGrant.findMany({
      where: {
        org_id: args.orgId,
        revoked_at: null,
        patient_id: args.patientId,
        ...buildExternalAccessGrantVisibilityWhere(visibleCaseIds),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        granted_to_name: true,
        granted_to_contact: true,
        scope: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
      take: EXTERNAL_ACCESS_LIST_PAGE_SIZE,
    });
  }

  const assignmentWhere = buildCareCaseAssignmentWhere(args.accessContext);
  const accessibleCases = assignmentWhere
    ? await prisma.careCase.findMany({
        where: {
          org_id: args.orgId,
          AND: [assignmentWhere],
        },
        select: { id: true, patient_id: true },
      })
    : [];
  const accessiblePatientIds = canBypassAssignment
    ? undefined
    : Array.from(new Set(accessibleCases.map((careCase) => careCase.patient_id)));
  if (!canBypassAssignment && accessiblePatientIds?.length === 0) return [];

  if (canBypassAssignment) {
    return prisma.externalAccessGrant.findMany({
      where: {
        org_id: args.orgId,
        revoked_at: null,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        granted_to_name: true,
        granted_to_contact: true,
        scope: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
      take: 200,
    });
  }

  const caseIdsByPatient = new Map<string, string[]>();
  for (const careCase of accessibleCases) {
    caseIdsByPatient.set(careCase.patient_id, [
      ...(caseIdsByPatient.get(careCase.patient_id) ?? []),
      careCase.id,
    ]);
  }
  const visibilityBranches = Array.from(caseIdsByPatient.entries()).map(([patientId, caseIds]) => ({
    AND: [{ patient_id: patientId }, buildExternalAccessGrantVisibilityWhere(caseIds)],
  }));
  if (visibilityBranches.length === 0) return [];

  return prisma.externalAccessGrant.findMany({
    where: {
      org_id: args.orgId,
      revoked_at: null,
      OR: visibilityBranches,
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      granted_to_name: true,
      granted_to_contact: true,
      scope: true,
      expires_at: true,
      accessed_at: true,
      created_at: true,
    },
    take: EXTERNAL_ACCESS_LIST_PAGE_SIZE,
  });
}

export const GET = withAuthContext(
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    const patientId = optionalTrimmedSearchParam(searchParams.get('patient_id'));
    const grants = await listExternalGrantsForContext({
      orgId: ctx.orgId,
      patientId,
      accessContext: ctx,
    });

    const patientMap =
      grants.length === 0
        ? new Map<string, { name: string; name_kana: string }>()
        : new Map(
            (
              await prisma.patient.findMany({
                where: {
                  org_id: ctx.orgId,
                  id: { in: [...new Set(grants.map((grant) => grant.patient_id))] },
                },
                select: {
                  id: true,
                  name: true,
                  name_kana: true,
                },
              })
            ).map((patient) => [patient.id, { name: patient.name, name_kana: patient.name_kana }]),
          );

    const reportSummary = new Map<
      string,
      { total: number; open: number; latest_at: Date | null }
    >();
    if (grants.length > 0) {
      const reports = await prisma.patientSelfReport.findMany({
        where: {
          org_id: ctx.orgId,
          external_access_grant_id: { in: grants.map((grant) => grant.id) },
        },
        select: {
          external_access_grant_id: true,
          status: true,
          created_at: true,
        },
      });
      for (const report of reports) {
        const key = report.external_access_grant_id;
        if (!key) continue;
        const current = reportSummary.get(key) ?? {
          total: 0,
          open: 0,
          latest_at: null,
        };
        current.total += 1;
        if (report.status !== 'resolved' && report.status !== 'dismissed') {
          current.open += 1;
        }
        if (!current.latest_at || report.created_at > current.latest_at) {
          current.latest_at = report.created_at;
        }
        reportSummary.set(key, current);
      }
    }

    return success({
      data: grants.map((grant) => {
        const patient = patientMap.get(grant.patient_id);
        return {
          ...grant,
          scope: toPublicExternalAccessScope(grant.scope),
          patient: {
            name: patient?.name ?? '不明な患者',
            name_kana: patient?.name_kana ?? null,
          },
          self_report_summary: reportSummary.get(grant.id) ?? {
            total: 0,
            open: 0,
            latest_at: null,
          },
        };
      }),
    });
  },
  {
    permission: 'canReport',
    message: '外部共有の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req: NextRequest, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createGrantSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, granted_to_name, granted_to_contact, expires_hours } = parsed.data;
    const scopeResult = validateExternalAccessScopeForRole(parsed.data.scope, ctx.role);
    if (!scopeResult.ok) {
      if (scopeResult.kind === 'permission') {
        return forbidden(scopeResult.message);
      }

      return validationError(scopeResult.message, scopeResult.details);
    }

    const scope = scopeResult.scope;
    const normalizedGrantedToContact =
      granted_to_contact && granted_to_contact.trim().length > 0 ? granted_to_contact.trim() : null;

    const refResult = await validateOrgReferences(ctx.orgId, { patient_id });
    if (!refResult.ok) return refResult.response;
    const canAccessTargetPatient = await canAccessPatient({
      db: prisma,
      orgId: ctx.orgId,
      patientId: patient_id,
      accessContext: ctx,
    });
    if (!canAccessTargetPatient) {
      return forbidden('患者への外部共有権限がありません');
    }
    const requiresCaseBoundary = externalAccessScopeRequiresCaseBoundary(scope);
    const allowedCaseIds = requiresCaseBoundary
      ? await listAccessiblePatientCaseIds({
          db: prisma,
          orgId: ctx.orgId,
          patientId: patient_id,
          accessContext: ctx,
        })
      : [];
    if (requiresCaseBoundary && allowedCaseIds.length === 0) {
      return forbidden('患者ケースへの外部共有権限がありません');
    }
    const storedScope = requiresCaseBoundary
      ? attachExternalAccessCaseBoundary(scope, allowedCaseIds)
      : scope;

    const rawOtp = randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(rawOtp, 12);
    const expiresAt = new Date(Date.now() + expires_hours * 60 * 60 * 1000);
    const provisionalToken = `provisional:${randomUUID()}`;
    const provisionalTokenHash = createHash('sha256').update(provisionalToken).digest('hex');

    let grant;
    try {
      grant = await withOrgContext(ctx.orgId, async (tx) => {
        const created = await tx.externalAccessGrant.create({
          data: {
            org_id: ctx.orgId,
            patient_id,
            token_hash: provisionalTokenHash,
            otp_hash: otpHash,
            granted_to_name,
            granted_to_contact: normalizedGrantedToContact,
            scope: toPrismaJsonInput(storedScope),
            expires_at: expiresAt,
          },
          select: {
            id: true,
            patient_id: true,
            granted_to_name: true,
            granted_to_contact: true,
            scope: true,
            expires_at: true,
            created_at: true,
          },
        });

        const jwtToken = await issueExternalAccessToken({
          grantId: created.id,
          orgId: ctx.orgId,
          patientId: patient_id,
          expiresHours: expires_hours,
        });

        const finalTokenHash = createHash('sha256').update(jwtToken).digest('hex');
        await tx.externalAccessGrant.update({
          where: { id: created.id },
          data: { token_hash: finalTokenHash },
        });

        return {
          ...created,
          token: jwtToken,
        };
      });
    } catch (errorValue) {
      if (errorValue instanceof MissingExternalAccessSecretError) {
        return error(
          'EXTERNAL_ACCESS_SECRET_MISSING',
          '外部共有リンクの署名設定が不足しています',
          500,
        );
      }
      throw errorValue;
    }

    let otpDelivery: 'sms' | 'manual' = 'manual';
    let otpDeliveryDestination: string | null = null;

    if (looksLikePhoneNumber(normalizedGrantedToContact) && normalizedGrantedToContact) {
      try {
        const smsAdapter = new SmsNotificationAdapter();
        await smsAdapter.sendSms(
          normalizedGrantedToContact,
          `PH-OS共有OTP: ${rawOtp} 有効期限 ${expiresAt.toLocaleString('ja-JP')}`,
        );
        otpDelivery = 'sms';
        otpDeliveryDestination = maskPhoneNumber(normalizedGrantedToContact);
      } catch {
        otpDelivery = 'manual';
        otpDeliveryDestination = null;
      }
    }

    return success(
      {
        data: {
          ...grant,
          scope: toPublicExternalAccessScope(grant.scope),
          ...(otpDelivery === 'manual' ? { otp: rawOtp } : {}),
          otp_delivery: otpDelivery,
          otp_delivery_destination: otpDeliveryDestination,
        },
      },
      201,
    );
  },
  {
    permission: 'canReport',
    message: '外部共有の作成権限がありません',
  },
);
