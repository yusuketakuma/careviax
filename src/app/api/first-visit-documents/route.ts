import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { createFirstVisitDocumentSchema } from '@/lib/validations/first-visit-document';
import { prisma } from '@/lib/db/client';
import {
  canBypassVisitScheduleAssignmentAccess,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import {
  canAccessCareCase,
  listAccessibleCareCaseIds,
  listAccessiblePatientCaseIds,
} from '@/server/services/patient-access';
import type { Prisma } from '@prisma/client';

const FIRST_VISIT_TEMPLATE_TYPES = [
  'contract_document',
  'important_matters',
  'privacy_consent',
  'consent_form',
] as const;

const FIRST_VISIT_TEMPLATE_DOCUMENT_TYPES: Record<
  (typeof FIRST_VISIT_TEMPLATE_TYPES)[number],
  'contract' | 'important_matters' | 'privacy_consent' | 'consent'
> = {
  contract_document: 'contract',
  important_matters: 'important_matters',
  privacy_consent: 'privacy_consent',
  consent_form: 'consent',
};

function relationLabelForDocument(relation: string) {
  const labels: Record<string, string> = {
    spouse: '配偶者',
    child: '子',
    parent: '親',
    sibling: 'きょうだい',
    family: '家族',
    care_manager: 'ケアマネ',
    physician: '医師',
    nurse: '訪問看護',
    facility_staff: '施設職員',
    other: 'その他',
  };
  return labels[relation] ?? relation;
}

async function buildFirstVisitDocumentAssignmentWhere(args: {
  orgId: string;
  patientId?: string;
  caseId?: string;
  accessContext: VisitScheduleAccessContext;
}): Promise<Prisma.FirstVisitDocumentWhereInput> {
  if (args.caseId) {
    const canAccess = await canAccessCareCase({
      db: prisma,
      orgId: args.orgId,
      caseId: args.caseId,
      patientId: args.patientId,
      accessContext: args.accessContext,
    });

    return canAccess ? { case_id: args.caseId } : { id: { in: [] } };
  }

  if (canBypassVisitScheduleAssignmentAccess(args.accessContext)) return {};

  const caseIds = args.patientId
    ? await listAccessiblePatientCaseIds({
        db: prisma,
        orgId: args.orgId,
        patientId: args.patientId,
        accessContext: args.accessContext,
      })
    : await listAccessibleCareCaseIds({
        db: prisma,
        orgId: args.orgId,
        accessContext: args.accessContext,
      });

  return { case_id: { in: caseIds } };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const caseId = searchParams.get('case_id') ?? undefined;

    const assignmentWhere = await buildFirstVisitDocumentAssignmentWhere({
      orgId: ctx.orgId,
      patientId,
      caseId,
      accessContext: ctx,
    });

    const where = {
      org_id: ctx.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(caseId ? { case_id: caseId } : {}),
      ...assignmentWhere,
    };

    const docs = await prisma.firstVisitDocument.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        emergency_contacts: true,
        document_url: true,
        delivered_at: true,
        delivered_to: true,
        created_at: true,
        updated_at: true,
      },
    });

    const hasMore = docs.length > limit;
    const data = hasMore ? docs.slice(0, limit) : docs;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canVisit',
    message: '初回文書の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createFirstVisitDocumentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const canAccessScope = await canAccessCareCase({
      db: prisma,
      orgId: ctx.orgId,
      caseId: parsed.data.case_id,
      patientId: parsed.data.patient_id,
      accessContext: ctx,
    });
    if (!canAccessScope) return notFound('患者またはケースが見つかりません');

    const emergencyContacts =
      parsed.data.emergency_contacts && parsed.data.emergency_contacts.length > 0
        ? parsed.data.emergency_contacts
        : (
            await prisma.contactParty.findMany({
              where: {
                org_id: ctx.orgId,
                patient_id: parsed.data.patient_id,
                OR: [{ is_primary: true }, { is_emergency_contact: true }],
              },
              orderBy: [
                { is_primary: 'desc' },
                { is_emergency_contact: 'desc' },
                { created_at: 'asc' },
              ],
              take: 5,
              select: {
                name: true,
                relation: true,
                phone: true,
                email: true,
                fax: true,
                organization_name: true,
                department: true,
                is_primary: true,
                is_emergency_contact: true,
              },
            })
          ).flatMap((contact) => {
            if (!contact.phone && !contact.email && !contact.fax) return [];
            return [
              {
                name: contact.name,
                relationship: relationLabelForDocument(contact.relation),
                relation: relationLabelForDocument(contact.relation),
                phone: contact.phone,
                email: contact.email,
                fax: contact.fax,
                organization_name: contact.organization_name,
                department: contact.department,
                is_primary: contact.is_primary,
                is_emergency_contact: contact.is_emergency_contact,
              },
            ];
          });

    if (emergencyContacts.length === 0) {
      return validationError('緊急連絡先を1件以上入力してください', {
        emergency_contacts: ['緊急連絡先を1件以上入力してください'],
      });
    }

    const today = new Date();
    const template = parsed.data.template_id
      ? await prisma.template.findFirst({
          where: {
            id: parsed.data.template_id,
            org_id: ctx.orgId,
            template_type: { in: [...FIRST_VISIT_TEMPLATE_TYPES] },
          },
          select: {
            id: true,
            name: true,
            template_type: true,
            version: true,
          },
        })
      : await prisma.template.findFirst({
          where: {
            org_id: ctx.orgId,
            template_type: 'consent_form',
            is_default: true,
            OR: [{ effective_from: null }, { effective_from: { lte: today } }],
            AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: today } }] }],
          },
          orderBy: [{ version: 'desc' }, { updated_at: 'desc' }],
          select: {
            id: true,
            name: true,
            template_type: true,
            version: true,
          },
        });

    if (parsed.data.template_id && !template) {
      return validationError('選択した初回文書テンプレートが見つかりません', {
        template_id: ['有効な初回文書テンプレートを選択してください'],
      });
    }

    const doc = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await tx.firstVisitDocument.create({
        data: {
          org_id: ctx.orgId,
          patient_id: parsed.data.patient_id,
          case_id: parsed.data.case_id,
          emergency_contacts: emergencyContacts,
          ...(parsed.data.delivered_at ? { delivered_at: new Date(parsed.data.delivered_at) } : {}),
          delivered_to: parsed.data.delivered_to,
          document_url: parsed.data.document_url ?? null,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'first_visit_document.generated',
        targetType: 'first_visit_document',
        targetId: created.id,
        changes: {
          document_action: {
            action: 'generated',
            document_type: template
              ? FIRST_VISIT_TEMPLATE_DOCUMENT_TYPES[
                  template.template_type as (typeof FIRST_VISIT_TEMPLATE_TYPES)[number]
                ]
              : 'first_visit_document',
            template_id: template?.id ?? null,
            template_name: template?.name ?? null,
            template_version: template ? String(template.version) : null,
          },
          patient_id: parsed.data.patient_id,
          case_id: parsed.data.case_id,
          delivered_at: created.delivered_at?.toISOString() ?? null,
          delivered_to: created.delivered_to,
          document_url: created.document_url,
        },
      });

      return created;
    });

    return success({ data: doc }, 201);
  },
  {
    permission: 'canVisit',
    message: '初回文書の作成権限がありません',
  },
);
