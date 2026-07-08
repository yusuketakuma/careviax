import { z } from 'zod';
import { unstable_rethrow } from 'next/navigation';
import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { runWithRequestAuthContext } from '@/lib/auth/request-context';
import { withOrgContext } from '@/lib/db/rls';
import { internalError, notFound, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { validateOrgReferences } from '@/lib/api/org-reference';
import { prisma } from '@/lib/db/client';
import { acquireAdvisoryTxLock } from '@/lib/db/advisory-lock';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';
import {
  buildAuditedConsentDocumentUrl,
  CONSENT_DOCUMENT_MIME_TYPES,
  normalizeAuditedConsentDocumentUrl,
  serializeConsentRecordDocumentUrl,
} from '@/server/services/consent-record-documents';
import {
  recordConsentRecordCreatedAudit,
  recordConsentRecordsViewedAudit,
} from '@/server/services/consent-record-audit';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';

const ROUTE = '/api/consent-records';

function optionalTrimmedString(value: unknown) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const createConsentSchema = z.object({
  patient_id: z.string().min(1, '患者IDは必須です'),
  case_id: z.string().optional(),
  template_id: z.string().optional(),
  consent_type: z.enum([
    'visit_medication_management',
    'personal_info_handling',
    'external_sharing',
    'photo_capture',
  ]),
  method: z.enum(['paper_scan', 'digital']),
  obtained_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  document_url: z.preprocess(optionalTrimmedString, z.string().max(500).optional().nullable()),
  document_file_id: z.preprocess(optionalTrimmedString, z.string().min(1).optional()),
});

async function validateConsentDocumentFileAsset(args: {
  orgId: string;
  patientId: string;
  fileId: string;
}) {
  return prisma.fileAsset.findFirst({
    where: {
      id: args.fileId,
      org_id: args.orgId,
      purpose: 'consent-document',
      status: 'uploaded',
      mime_type: { in: CONSENT_DOCUMENT_MIME_TYPES },
      patient_id: args.patientId,
    },
    select: { id: true },
  });
}

async function canAccessConsentRecordPatient(args: {
  orgId: string;
  patientId: string;
  caseId?: string | null;
  userId: string;
  role: Parameters<typeof canAccessCaseScopedPatientResource>[0]['accessContext']['role'];
}) {
  return canAccessCaseScopedPatientResource({
    db: prisma,
    orgId: args.orgId,
    patientId: args.patientId,
    caseId: args.caseId,
    accessContext: {
      userId: args.userId,
      role: args.role,
    },
  });
}

function resolveConsentDocumentUrlInput(args: {
  documentUrl?: string | null;
  documentFileId?: string;
}) {
  if (args.documentUrl !== undefined && args.documentFileId) {
    return {
      ok: false as const,
      response: validationError('入力値が不正です', {
        document_url: ['document_url と document_file_id は同時に指定できません'],
      }),
    };
  }

  if (args.documentFileId) {
    return { ok: true as const, documentUrl: buildAuditedConsentDocumentUrl(args.documentFileId) };
  }

  if (args.documentUrl === undefined) {
    return { ok: true as const, documentUrl: undefined };
  }

  if (args.documentUrl === null) {
    return { ok: true as const, documentUrl: null };
  }

  const normalizedUrl = normalizeAuditedConsentDocumentUrl(args.documentUrl);
  if (!normalizedUrl) {
    return {
      ok: false as const,
      response: validationError('入力値が不正です', {
        document_url: ['同意書文書は監査済みファイルURLまたは document_file_id で指定してください'],
      }),
    };
  }

  return { ok: true as const, documentUrl: normalizedUrl };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '同意記録の閲覧には訪問権限が必要です',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const searchParams = req.nextUrl.searchParams;
    const patientId = searchParams.get('patient_id');
    if (!patientId) {
      return validationError('patient_idは必須です');
    }

    const consentTypeParam = searchParams.get('consent_type');
    const consentTypeResult = consentTypeParam
      ? createConsentSchema.shape.consent_type.safeParse(consentTypeParam)
      : null;
    if (consentTypeParam && !consentTypeResult?.success) {
      return validationError('consent_typeが不正です', {
        consent_type: ['無効な同意種別です'],
      });
    }
    const consentType = consentTypeResult?.success ? consentTypeResult.data : undefined;
    const isActiveParam = searchParams.get('is_active');
    const isActive = isActiveParam === 'false' ? false : true;

    const canAccessPatient = await canAccessConsentRecordPatient({
      orgId: ctx.orgId,
      patientId,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!canAccessPatient) return notFound('同意記録が見つかりません');

    const { cursor, limit } = parsePaginationParams(searchParams);

    const where = {
      org_id: ctx.orgId,
      patient_id: patientId,
      is_active: isActive,
      ...(consentType ? { consent_type: consentType } : {}),
    };

    const [records, totalCount] = await Promise.all([
      prisma.consentRecord.findMany({
        where,
        orderBy: { obtained_date: 'desc' },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          template: {
            select: {
              id: true,
              name: true,
              version: true,
            },
          },
        },
      }),
      prisma.consentRecord.count({ where }),
    ]);

    const page = buildCursorPage(records, limit, (record) => record.id);
    const data = page.data.map(serializeConsentRecordDocumentUrl);

    await recordConsentRecordsViewedAudit(prisma, ctx, {
      patientId,
      caseId: null,
      consentType: consentType ?? null,
      isActive,
      limit,
      hasCursor: Boolean(cursor),
      hasMore: page.hasMore,
      totalCount,
      records: page.data.map((record) => ({
        id: record.id,
        document_url: record.document_url,
      })),
    });

    return success({
      data,
      meta: {
        limit,
        has_more: page.hasMore,
        next_cursor: page.nextCursor ?? null,
        total_count: totalCount,
      },
    });
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'consent_records_get_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}

async function authenticatedPOST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: '同意記録の作成には訪問権限が必要です',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  return runWithRequestAuthContext(ctx, async () => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createConsentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      patient_id,
      case_id,
      template_id,
      consent_type,
      method,
      obtained_date,
      expiry_date,
      document_url,
      document_file_id,
    } = parsed.data;

    const documentInput = resolveConsentDocumentUrlInput({
      documentUrl: document_url,
      documentFileId: document_file_id,
    });
    if (!documentInput.ok) return documentInput.response;

    // Validate patient and optional case belong to this org
    const refResult = await validateOrgReferences(ctx.orgId, {
      patient_id,
      ...(case_id ? { case_id } : {}),
    });
    if (!refResult.ok) return refResult.response;

    const canAccessPatient = await canAccessConsentRecordPatient({
      orgId: ctx.orgId,
      patientId: patient_id,
      caseId: case_id ?? null,
      userId: ctx.userId,
      role: ctx.role,
    });
    if (!canAccessPatient) return notFound('同意記録が見つかりません');

    if (document_file_id) {
      const fileAsset = await validateConsentDocumentFileAsset({
        orgId: ctx.orgId,
        patientId: patient_id,
        fileId: document_file_id,
      });
      if (!fileAsset) {
        return validationError('入力値が不正です', {
          document_file_id: ['患者に紐づくアップロード済み同意書ファイルではありません'],
        });
      }
    }

    const dedupKey = `${ctx.orgId}:${patient_id}:${consent_type}`;
    const record = await withOrgContext(ctx.orgId, async (tx) => {
      await acquireAdvisoryTxLock(tx, 'consent_record_active_dedup', dedupKey);

      const duplicate = await tx.consentRecord.findFirst({
        where: {
          org_id: ctx.orgId,
          patient_id,
          consent_type,
          is_active: true,
        },
        select: { id: true },
      });
      if (duplicate) {
        return { duplicate: true as const };
      }

      const today = new Date(`${obtained_date}T00:00:00.000Z`);
      const template = template_id
        ? await tx.template.findFirst({
            where: {
              id: template_id,
              org_id: ctx.orgId,
              template_type: 'consent_form',
            },
            select: {
              id: true,
              version: true,
            },
          })
        : await tx.template.findFirst({
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
              version: true,
            },
          });

      if (template_id && !template) {
        return { templateMissing: true as const };
      }

      const createdRecord = await tx.consentRecord.create({
        data: {
          org_id: ctx.orgId,
          patient_id,
          case_id: case_id ?? null,
          template_id: template?.id ?? null,
          template_version: template?.version ?? null,
          consent_type,
          method,
          obtained_date: new Date(obtained_date),
          expiry_date: expiry_date ? new Date(expiry_date) : null,
          document_url: documentInput.documentUrl ?? null,
          document_file_id: document_file_id ?? null,
          is_active: true,
          access_restricted: false,
        },
      });
      await recordConsentRecordCreatedAudit(tx, ctx, createdRecord);
      return createdRecord;
    });
    if ('duplicate' in record) {
      return validationError('この患者にはすでに有効な同意記録が存在します', {
        consent_type: ['同一種別の有効な同意がすでに存在します'],
      });
    }
    if ('templateMissing' in record) {
      return validationError('選択した同意書テンプレートが見つかりません', {
        template_id: ['有効な同意書テンプレートを選択してください'],
      });
    }

    return success({ data: serializeConsentRecordDocumentUrl(record) }, 201);
  });
}

export async function POST(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedPOST(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'consent_records_post_unhandled_error',
          route: ROUTE,
          method: req.method,
          status: 500,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
