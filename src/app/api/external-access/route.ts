import { NextRequest, type NextResponse } from 'next/server';
import { createHash, randomInt, randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { withAuthContext } from '@/lib/auth/context';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { withOrgContext } from '@/lib/db/rls';
import { toPrismaJsonInput } from '@/lib/db/json';
import { conflict, error, forbidden, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import { SmsNotificationAdapter } from '@/server/adapters/sms';
import {
  attachExternalAccessCaseBoundary,
  externalAccessScopeRequiresCaseBoundary,
  buildExternalAccessGrantVisibilityWhere,
  buildVisibleExternalAccessGrantWhere,
  issueExternalAccessToken,
  type ExternalAccessScope,
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
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  looksLikePhoneNumber,
  maskContactValueForAudit,
  maskPhoneContact,
} from '@/lib/privacy/contact-mask';
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
const EXTERNAL_ACCESS_LIST_QUERY_LIMIT = EXTERNAL_ACCESS_LIST_PAGE_SIZE + 1;
const externalAccessGrantListSelect = {
  id: true,
  org_id: true,
  patient_id: true,
  granted_to_name: true,
  granted_to_contact: true,
  scope: true,
  expires_at: true,
  accessed_at: true,
  created_at: true,
} as const;

type ExternalAccessGrantListItem = {
  id: string;
  org_id: string;
  patient_id: string;
  granted_to_name: string;
  granted_to_contact: string | null;
  scope: unknown;
  expires_at: Date;
  accessed_at: Date | null;
  created_at: Date;
};

type ExternalAccessGrantListPage = {
  grants: ExternalAccessGrantListItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

type ExternalAccessGrantListResult =
  | ({ ok: true } & ExternalAccessGrantListPage)
  | { ok: false; reason: 'invalid_cursor' };

function emptyExternalAccessGrantListPage(): ExternalAccessGrantListResult {
  return { ok: true, grants: [], hasMore: false, nextCursor: null };
}

function toExternalAccessGrantListPage(
  rows: ExternalAccessGrantListItem[],
): ExternalAccessGrantListResult {
  const grants = rows.slice(0, EXTERNAL_ACCESS_LIST_PAGE_SIZE);
  return {
    ok: true,
    grants,
    hasMore: rows.length > EXTERNAL_ACCESS_LIST_PAGE_SIZE,
    nextCursor:
      rows.length > EXTERNAL_ACCESS_LIST_PAGE_SIZE ? (grants[grants.length - 1]?.id ?? null) : null,
  };
}

async function findVisibleExternalAccessGrantPage(args: {
  where: Prisma.ExternalAccessGrantWhereInput;
  cursor?: string;
}): Promise<ExternalAccessGrantListResult> {
  if (args.cursor) {
    const visibleCursor = await prisma.externalAccessGrant.findFirst({
      where: { ...args.where, id: args.cursor },
      select: { id: true },
    });
    if (!visibleCursor) return { ok: false, reason: 'invalid_cursor' };
  }

  const rows = await prisma.externalAccessGrant.findMany({
    where: args.where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: externalAccessGrantListSelect,
    take: EXTERNAL_ACCESS_LIST_QUERY_LIMIT,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
  });
  return toExternalAccessGrantListPage(rows);
}

function optionalTrimmedSearchParam(value: string | null) {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPresentOptionalSearchParam(
  searchParams: URLSearchParams,
  name: string,
  message: string,
) {
  const value = optionalTrimmedSearchParam(searchParams.get(name));
  if (searchParams.has(name) && !value) {
    return {
      ok: false as const,
      response: withSensitiveNoStore(validationError('検索条件が不正です', { [name]: [message] })),
    };
  }
  return { ok: true as const, value };
}

function maskExternalAccessContact(value: string | null) {
  return maskContactValueForAudit(value, { phoneLeadingDigits: 3 });
}

function readScopeKeys(scope: unknown) {
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) return [];
  return Object.entries(scope)
    .filter(([key, enabled]) => key !== 'allowed_case_ids' && enabled === true)
    .map(([key]) => key)
    .sort();
}

function externalAccessScopeHasPatientLevelShare(scope: ExternalAccessScope) {
  return scope.allergy_info === true || scope.medication_list === true;
}

async function findActiveExternalSharingConsent(args: {
  orgId: string;
  patientId: string;
  scope: ExternalAccessScope;
  allowedCaseIds: string[];
}) {
  const caseScope: Prisma.ConsentRecordWhereInput[] = [{ case_id: null }];
  if (!externalAccessScopeHasPatientLevelShare(args.scope) && args.allowedCaseIds.length > 0) {
    caseScope.push({ case_id: { in: args.allowedCaseIds } });
  }

  return prisma.consentRecord.findFirst({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      consent_type: 'external_sharing',
      is_active: true,
      revoked_date: null,
      OR: [{ expiry_date: null }, { expiry_date: { gte: new Date() } }],
      AND: [{ OR: caseScope }],
    },
    orderBy: [{ obtained_date: 'desc' }],
    select: { id: true, case_id: true },
  });
}

async function listExternalGrantsForContext(args: {
  orgId: string;
  patientId?: string;
  cursor?: string;
  accessContext: Parameters<typeof canAccessPatient>[0]['accessContext'];
}): Promise<ExternalAccessGrantListResult> {
  if (
    !hasPermission(args.accessContext.role, 'canVisit') &&
    !hasPermission(args.accessContext.role, 'canSendCareReport')
  ) {
    return emptyExternalAccessGrantListPage();
  }

  const canBypassAssignment = canBypassVisitScheduleAssignmentAccess(args.accessContext);

  if (args.patientId) {
    const canAccessTargetPatient = await canAccessPatient({
      db: prisma,
      orgId: args.orgId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });
    if (!canAccessTargetPatient) return emptyExternalAccessGrantListPage();

    const visibleCaseIds = canBypassAssignment
      ? undefined
      : await listAccessiblePatientCaseIds({
          db: prisma,
          orgId: args.orgId,
          patientId: args.patientId,
          accessContext: args.accessContext,
        });

    if (visibleCaseIds === undefined) {
      return findVisibleExternalAccessGrantPage({
        where: buildVisibleExternalAccessGrantWhere({
          orgId: args.orgId,
          patientId: args.patientId,
          caseIds: visibleCaseIds,
        }),
        cursor: args.cursor,
      });
    }

    return findVisibleExternalAccessGrantPage({
      where: buildVisibleExternalAccessGrantWhere({
        orgId: args.orgId,
        patientId: args.patientId,
        caseIds: visibleCaseIds,
      }),
      cursor: args.cursor,
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
  if (!canBypassAssignment && accessiblePatientIds?.length === 0) {
    return emptyExternalAccessGrantListPage();
  }

  if (canBypassAssignment) {
    return findVisibleExternalAccessGrantPage({
      where: {
        org_id: args.orgId,
        revoked_at: null,
      },
      cursor: args.cursor,
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
  if (visibilityBranches.length === 0) return emptyExternalAccessGrantListPage();

  return findVisibleExternalAccessGrantPage({
    where: {
      org_id: args.orgId,
      revoked_at: null,
      OR: visibilityBranches,
    },
    cursor: args.cursor,
  });
}

export const GET = withAuthContext(
  async (req: NextRequest, ctx) => {
    const { searchParams } = new URL(req.url);
    const patientIdResult = readPresentOptionalSearchParam(
      searchParams,
      'patient_id',
      '患者IDを指定してください',
    );
    if (!patientIdResult.ok) return patientIdResult.response;
    const patientId = patientIdResult.value;
    const cursor = optionalTrimmedSearchParam(searchParams.get('cursor'));
    const grantPage = await listExternalGrantsForContext({
      orgId: ctx.orgId,
      patientId,
      cursor,
      accessContext: ctx,
    });
    if (!grantPage.ok) {
      return withSensitiveNoStore(
        validationError('ページカーソルが不正です', {
          cursor: ['カーソルが見つかりません'],
        }),
      );
    }
    const { grants } = grantPage;

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
      const grantIds = grants.map((grant) => grant.id);
      const [totalRows, openRows] = await Promise.all([
        prisma.patientSelfReport.groupBy({
          by: ['external_access_grant_id'],
          where: {
            org_id: ctx.orgId,
            external_access_grant_id: { in: grantIds },
          },
          _count: { _all: true },
          _max: { created_at: true },
        }),
        prisma.patientSelfReport.groupBy({
          by: ['external_access_grant_id'],
          where: {
            org_id: ctx.orgId,
            external_access_grant_id: { in: grantIds },
            status: { notIn: ['resolved', 'dismissed'] },
          },
          _count: { _all: true },
        }),
      ]);

      for (const row of totalRows) {
        if (!row.external_access_grant_id) continue;
        reportSummary.set(row.external_access_grant_id, {
          total: row._count._all,
          open: 0,
          latest_at: row._max.created_at ?? null,
        });
      }
      for (const row of openRows) {
        if (!row.external_access_grant_id) continue;
        const current = reportSummary.get(row.external_access_grant_id) ?? {
          total: 0,
          open: 0,
          latest_at: null,
        };
        reportSummary.set(row.external_access_grant_id, {
          ...current,
          open: row._count._all,
        });
      }
    }

    return withSensitiveNoStore(
      success({
        data: grants.map((grant) => {
          const patient = patientMap.get(grant.patient_id);
          const { granted_to_contact: rawContact, ...grantData } = grant;
          return {
            ...grantData,
            granted_to_contact_masked: maskExternalAccessContact(rawContact),
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
        hasMore: grantPage.hasMore,
        nextCursor: grantPage.nextCursor,
      }),
    );
  },
  {
    permission: 'canReport',
    message: '外部共有の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req: NextRequest, ctx): Promise<NextResponse> => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = createGrantSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const { patient_id, granted_to_name, granted_to_contact, expires_hours } = parsed.data;
    const scopeResult = validateExternalAccessScopeForRole(parsed.data.scope, ctx.role);
    if (!scopeResult.ok) {
      if (scopeResult.kind === 'permission') {
        return withSensitiveNoStore(forbidden(scopeResult.message));
      }

      return withSensitiveNoStore(validationError(scopeResult.message, scopeResult.details));
    }

    const scope = scopeResult.scope;
    const normalizedGrantedToContact =
      granted_to_contact && granted_to_contact.trim().length > 0 ? granted_to_contact.trim() : null;

    const refResult = await validateOrgReferences(ctx.orgId, { patient_id });
    if (!refResult.ok) return withSensitiveNoStore(refResult.response);
    const canAccessTargetPatient = await canAccessPatient({
      db: prisma,
      orgId: ctx.orgId,
      patientId: patient_id,
      accessContext: ctx,
    });
    if (!canAccessTargetPatient) {
      return withSensitiveNoStore(forbidden('患者への外部共有権限がありません'));
    }
    const writable = await requireWritablePatient(prisma, ctx, patient_id);
    if ('response' in writable) return withSensitiveNoStore(writable.response);
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
      return withSensitiveNoStore(forbidden('患者ケースへの外部共有権限がありません'));
    }
    const storedScope = requiresCaseBoundary
      ? attachExternalAccessCaseBoundary(scope, allowedCaseIds)
      : scope;
    const activeExternalSharingConsent = await findActiveExternalSharingConsent({
      orgId: ctx.orgId,
      patientId: patient_id,
      scope,
      allowedCaseIds,
    });
    if (!activeExternalSharingConsent) {
      return withSensitiveNoStore(
        conflict('外部共有の有効な同意が未登録または期限切れです', {
          consent_type: 'external_sharing',
          scope_keys: readScopeKeys(scope),
        }),
      );
    }

    const rawOtp = randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(rawOtp, 12);
    const expiresAt = new Date(Date.now() + expires_hours * 60 * 60 * 1000);
    const provisionalToken = `provisional:${randomUUID()}`;
    const provisionalTokenHash = createHash('sha256').update(provisionalToken).digest('hex');
    const otpDeliveryIntent =
      looksLikePhoneNumber(normalizedGrantedToContact) && normalizedGrantedToContact
        ? 'sms'
        : 'manual';

    const grantResult = await withOrgContext(ctx.orgId, async (tx) => {
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

      await createAuditLogEntry(tx, ctx, {
        action: 'external_access_grant_created',
        targetType: 'external_access_grant',
        targetId: created.id,
        changes: {
          patient_id,
          granted_to_name,
          granted_to_contact_masked: maskExternalAccessContact(normalizedGrantedToContact),
          scope: toPublicExternalAccessScope(storedScope),
          scope_keys: readScopeKeys(toPublicExternalAccessScope(storedScope)),
          expires_at: expiresAt.toISOString(),
          expires_hours,
          otp_delivery_intent: otpDeliveryIntent,
          actor_id: ctx.userId,
        },
      });

      return {
        ...created,
        token: jwtToken,
      };
    })
      .then((grant) => ({ ok: true as const, grant }))
      .catch((errorValue) => {
        if (errorValue instanceof MissingExternalAccessSecretError) {
          return {
            ok: false as const,
            response: error(
              'EXTERNAL_ACCESS_SECRET_MISSING',
              '外部共有リンクの署名設定が不足しています',
              500,
            ),
          };
        }
        throw errorValue;
      });
    if (!grantResult.ok) return withSensitiveNoStore(grantResult.response);
    const grant = grantResult.grant;

    let otpDelivery: 'sms' | 'manual' = 'manual';
    let otpDeliveryDestination: string | null = null;

    if (otpDeliveryIntent === 'sms' && normalizedGrantedToContact) {
      try {
        const smsAdapter = new SmsNotificationAdapter();
        await smsAdapter.sendSms(
          normalizedGrantedToContact,
          `PH-OS共有OTP: ${rawOtp} 有効期限 ${expiresAt.toLocaleString('ja-JP')}`,
        );
        otpDelivery = 'sms';
        otpDeliveryDestination = maskPhoneContact(normalizedGrantedToContact, {
          leadingDigits: 3,
        });
      } catch {
        otpDelivery = 'manual';
        otpDeliveryDestination = null;
      }
    }

    if (otpDeliveryIntent === 'sms' && otpDelivery === 'manual') {
      try {
        await withOrgContext(ctx.orgId, (tx) =>
          createAuditLogEntry(tx, ctx, {
            action: 'external_access_otp_delivery_fallback',
            targetType: 'external_access_grant',
            targetId: grant.id,
            changes: {
              patient_id,
              granted_to_contact_masked: maskExternalAccessContact(normalizedGrantedToContact),
              otp_delivery_intent: otpDeliveryIntent,
              otp_delivery_result: otpDelivery,
              actor_id: ctx.userId,
            },
          }),
        );
      } catch {
        await withOrgContext(ctx.orgId, (tx) =>
          tx.externalAccessGrant.update({
            where: { id: grant.id },
            data: { revoked_at: new Date() },
          }),
        ).catch(() => undefined);
        return withSensitiveNoStore(
          error(
            'EXTERNAL_ACCESS_OTP_DELIVERY_AUDIT_FAILED',
            '外部共有OTPの配送結果監査を記録できませんでした',
            500,
          ),
        );
      }
    }

    const { granted_to_contact: rawContact, ...grantData } = grant;
    return withSensitiveNoStore(
      success(
        {
          data: {
            ...grantData,
            granted_to_contact_masked: maskExternalAccessContact(rawContact),
            scope: toPublicExternalAccessScope(grant.scope),
            ...(otpDelivery === 'manual' ? { otp: rawOtp } : {}),
            otp_delivery: otpDelivery,
            otp_delivery_destination: otpDeliveryDestination,
          },
        },
        201,
      ),
    );
  },
  {
    permission: 'canReport',
    message: '外部共有の作成権限がありません',
  },
);
