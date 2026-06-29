import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { conflict, internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { updatePatientCareTeamSchema } from '@/lib/validations/patient';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
} from '@/lib/auth/visit-schedule-access';
import type { AuthContext } from '@/lib/auth/context';
import { requireWritablePatient } from '@/server/services/patient-write-guard';
import {
  buildCareTeamReliabilitySummary,
  normalizeCareTeamPrimaryByRole,
} from '@/lib/patient/care-team-contact';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';

async function loadPatientCases(ctx: AuthContext, patientId: string) {
  const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
  return prisma.careCase.findMany({
    where: {
      org_id: ctx.orgId,
      patient_id: patientId,
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      status: true,
      created_at: true,
      care_team_links: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
      },
    },
  });
}

function pickDefaultCaseId(cases: Array<{ id: string; status: string; created_at: Date }>) {
  return cases.find((careCase) => careCase.status === 'active')?.id ?? cases[0]?.id ?? null;
}

type CareTeamLinkAuditSubject = {
  id?: string | null;
  external_professional_id?: string | null;
  role: string;
  is_primary?: boolean | null;
  organization_name?: string | null;
  department?: string | null;
  phone?: string | null;
  email?: string | null;
  fax?: string | null;
  address?: string | null;
  notes?: string | null;
};

const CARE_TEAM_LINK_AUDIT_SELECT = {
  id: true,
  external_professional_id: true,
  role: true,
  is_primary: true,
  organization_name: true,
  department: true,
  phone: true,
  email: true,
  fax: true,
  address: true,
  notes: true,
} as const;

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function summarizeCareTeamLinksForAudit(links: CareTeamLinkAuditSubject[]) {
  return links
    .map((link) => ({
      id: link.id ?? null,
      external_professional_id: link.external_professional_id ?? null,
      role: link.role,
      is_primary: Boolean(link.is_primary),
      has_organization: hasText(link.organization_name),
      has_department: hasText(link.department),
      has_phone: hasText(link.phone),
      has_email: hasText(link.email),
      has_fax: hasText(link.fax),
      has_address: hasText(link.address),
      has_notes: hasText(link.notes),
    }))
    .sort((a, b) => {
      const roleOrder = a.role.localeCompare(b.role);
      if (roleOrder !== 0) return roleOrder;
      return (a.id ?? '').localeCompare(b.id ?? '');
    });
}

function countCareTeamRoles(links: CareTeamLinkAuditSubject[]) {
  return links.reduce<Record<string, number>>((counts, link) => {
    counts[link.role] = (counts[link.role] ?? 0) + 1;
    return counts;
  }, {});
}

function collectExternalProfessionalIds(links: CareTeamLinkAuditSubject[]) {
  return Array.from(
    new Set(
      links
        .map((link) => link.external_professional_id)
        .filter((value): value is string => hasText(value)),
    ),
  ).sort();
}

function buildCareTeamReplacementAuditChanges(args: {
  caseId: string;
  beforeLinks: CareTeamLinkAuditSubject[];
  afterLinks: CareTeamLinkAuditSubject[];
}) {
  return {
    case_id: args.caseId,
    before_count: args.beforeLinks.length,
    after_count: args.afterLinks.length,
    role_counts_before: countCareTeamRoles(args.beforeLinks),
    role_counts_after: countCareTeamRoles(args.afterLinks),
    external_professional_ids_before: collectExternalProfessionalIds(args.beforeLinks),
    external_professional_ids_after: collectExternalProfessionalIds(args.afterLinks),
    before: summarizeCareTeamLinksForAudit(args.beforeLinks),
    after: summarizeCareTeamLinksForAudit(args.afterLinks),
  };
}

async function authenticatedGET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const { searchParams } = new URL(req.url);

  const patient = await prisma.patient.findFirst({
    where: applyPatientAssignmentWhere(
      { id, org_id: ctx.orgId },
      { userId: ctx.userId, role: ctx.role },
    ),
    select: { id: true },
  });
  if (!patient) return notFound('患者が見つかりません');

  const cases = await loadPatientCases(ctx, id);
  const requestedCaseId = searchParams.get('case_id');
  const caseId = cases.some((careCase) => careCase.id === requestedCaseId)
    ? requestedCaseId
    : pickDefaultCaseId(cases);

  return success({
    case_id: caseId,
    cases: cases.map((careCase) => ({
      id: careCase.id,
      status: careCase.status,
    })),
    data: cases.find((careCase) => careCase.id === caseId)?.care_team_links ?? [],
  });
}

export async function GET(req: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '患者情報の更新権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePatientCareTeamSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  const normalizedLinks = normalizeCareTeamPrimaryByRole(parsed.data.links);

  const writable = await requireWritablePatient(prisma, ctx, id);
  if ('response' in writable) return writable.response;

  const caseAssignmentWhere = buildCareCaseAssignmentWhere(ctx);
  const careCase = await prisma.careCase.findFirst({
    where: {
      id: parsed.data.case_id,
      org_id: ctx.orgId,
      patient_id: id,
      ...(caseAssignmentWhere ? { AND: [caseAssignmentWhere] } : {}),
    },
    select: { id: true },
  });
  if (!careCase) return notFound('対象ケースが見つかりません');

  try {
    const data = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const externalProfessionalIds = normalizedLinks
          .map((link) => link.external_professional_id)
          .filter((value): value is string => Boolean(value));

        if (externalProfessionalIds.length > 0) {
          const items = await tx.externalProfessional.findMany({
            where: {
              org_id: ctx.orgId,
              id: { in: externalProfessionalIds },
            },
            select: { id: true },
          });

          if (items.length !== new Set(externalProfessionalIds).size) {
            throw new Error('INVALID_EXTERNAL_PROFESSIONAL');
          }
        }

        const beforeLinks = await tx.careTeamLink.findMany({
          where: { org_id: ctx.orgId, case_id: careCase.id },
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
          select: CARE_TEAM_LINK_AUDIT_SELECT,
        });

        await tx.careTeamLink.deleteMany({
          where: { org_id: ctx.orgId, case_id: careCase.id },
        });

        if (normalizedLinks.length > 0) {
          await tx.careTeamLink.createMany({
            data: normalizedLinks.map((link) => ({
              org_id: ctx.orgId,
              case_id: careCase.id,
              external_professional_id: link.external_professional_id || null,
              role: link.role,
              name: link.name,
              organization_name: link.organization_name || null,
              department: link.department || null,
              phone: link.phone || null,
              email: link.email || null,
              fax: link.fax || null,
              address: link.address || null,
              is_primary: link.is_primary,
              notes: link.notes || null,
            })),
          });
        }

        const links = await tx.careTeamLink.findMany({
          where: { org_id: ctx.orgId, case_id: careCase.id },
          orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        });

        await createAuditLogEntry(tx, ctx, {
          action: 'patient_care_team_replaced',
          targetType: 'CareCase',
          targetId: careCase.id,
          patientId: id,
          changes: buildCareTeamReplacementAuditChanges({
            caseId: careCase.id,
            beforeLinks,
            afterLinks: links,
          }),
        });

        return links;
      },
      { requestContext: ctx },
    );
    const contacts = await prisma.contactParty.findMany({
      where: { org_id: ctx.orgId, patient_id: id },
      select: {
        is_primary: true,
        is_emergency_contact: true,
        phone: true,
        email: true,
        fax: true,
      },
    });
    const reliability = buildCareTeamReliabilitySummary({
      contacts,
      careTeamLinks: data,
    });

    return success({
      case_id: careCase.id,
      data,
      warnings: reliability.needs_confirmation
        ? [
            {
              code: 'CARE_TEAM_RELIABILITY_UNREADY',
              severity: 'warning',
              message: reliability.detail,
            },
          ]
        : [],
      metadata: {
        care_team_reliability: reliability,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_EXTERNAL_PROFESSIONAL') {
      return validationError('他組織の他職種はケアチームに登録できません');
    }
    if (isPrismaUniqueConstraintError(error)) {
      return conflict('ケアチームが同時に更新されました。再読み込みしてください');
    }
    throw error;
  }
}
