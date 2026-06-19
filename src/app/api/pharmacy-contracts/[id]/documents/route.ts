import { z } from 'zod';
import type { NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { error, notFound, success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { dateKeySchema } from '@/lib/validations/date-key';
import { utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import {
  buildPharmacyContractDocumentPreview,
  type PharmacyContractDocumentPreview,
} from '@/server/services/pharmacy-contract-documents';
import { renderPharmacyContractDocumentPdf } from '@/server/services/pdf-pharmacy-contract-document';
import {
  deleteGeneratedFile,
  FileStorageError,
  storeGeneratedFile,
  type StoredFileRecord,
} from '@/server/services/file-storage';

const dateOnlySchema = dateKeySchema('日付形式が不正です（YYYY-MM-DD）');
const documentModeSchema = z.enum(['preview', 'save']).default('save');

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional();

const createContractDocumentSchema = z
  .object({
    mode: documentModeSchema,
    version_id: optionalTrimmedString(128),
    template_id: optionalTrimmedString(128),
    document_type: optionalTrimmedString(64).default('basic_contract'),
    signed_file_id: optionalTrimmedString(128),
    signed_at: dateOnlySchema.optional().nullable(),
    generate_pdf: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.signed_at && !value.signed_file_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['signed_file_id'],
        message: '署名済み契約書の日付を記録する場合は signed_file_id が必要です',
      });
    }
    if (value.generate_pdf && value.signed_file_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['generate_pdf'],
        message: 'PDF自動生成と署名済みPDF添付は同時に指定できません',
      });
    }
  });

function optionalDate(value: string | null | undefined) {
  return value ? utcDateFromLocalKey(value) : null;
}

function contractTemplateSelect() {
  return {
    id: true,
    name: true,
    format: true,
    version: true,
    content: true,
  } as const;
}

function documentSelect() {
  return {
    id: true,
    contract_id: true,
    version_id: true,
    template_id: true,
    file_id: true,
    document_type: true,
    hash_value: true,
    signed_at: true,
    created_by: true,
    created_at: true,
    updated_at: true,
  } as const;
}

type PreparedContractDocument = {
  versionId: string;
  versionNo: number;
  templateId: string;
  templateVersion: number;
  preview: PharmacyContractDocumentPreview;
};

export const GET = withAuthContext<{ id: string }>(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const contractId = normalizeRequiredRouteParam(rawId);
    if (!contractId) return validationError('薬局間契約IDが不正です');

    const result = await withOrgContext(ctx.orgId, async (tx) => {
      const contract = await tx.pharmacyContract.findFirst({
        where: { id: contractId, org_id: ctx.orgId },
        select: { id: true },
      });
      if (!contract) return { response: notFound('薬局間契約が見つかりません') };

      const documents = await tx.contractDocument.findMany({
        where: { org_id: ctx.orgId, contract_id: contractId },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        select: documentSelect(),
      });
      return { documents };
    });

    if ('response' in result) return result.response ?? validationError('入力値が不正です');
    return success({ data: result.documents });
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間契約文書の閲覧権限がありません',
  },
);

export const POST = withAuthContext<{ id: string }>(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const contractId = normalizeRequiredRouteParam(rawId);
    if (!contractId) return validationError('薬局間契約IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createContractDocumentSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const signedAt = optionalDate(parsed.data.signed_at);
    if (parsed.data.signed_at && !signedAt)
      return validationError('日付形式が不正です（YYYY-MM-DD）');
    const now = new Date();

    const prepared: { response: NextResponse } | PreparedContractDocument = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const contract = await tx.pharmacyContract.findFirst({
          where: { id: contractId, org_id: ctx.orgId },
          select: {
            id: true,
            partnership_id: true,
            status: true,
            effective_from: true,
            effective_to: true,
            closing_day: true,
            payment_due_rule: true,
            partnership: {
              select: {
                id: true,
                status: true,
                base_site: { select: { id: true, name: true } },
                partner_pharmacy: { select: { id: true, name: true, status: true } },
              },
            },
            versions: {
              ...(parsed.data.version_id ? { where: { id: parsed.data.version_id } } : {}),
              orderBy: { version_no: 'desc' },
              take: 1,
              select: {
                id: true,
                version_no: true,
                status: true,
                effective_from: true,
                effective_to: true,
                fee_rules: {
                  where: { is_active: true },
                  orderBy: { created_at: 'asc' },
                  take: 1,
                  select: {
                    billing_model: true,
                    unit_price: true,
                    addon_rules: true,
                    expense_rules: true,
                    tax_category: true,
                    tax_rate_bp: true,
                    rounding_rule: true,
                  },
                },
              },
            },
          },
        });
        if (!contract) return { response: notFound('薬局間契約が見つかりません') };

        const version = contract.versions[0] ?? null;
        if (!version) return { response: notFound('薬局間契約版が見つかりません') };

        const template = parsed.data.template_id
          ? await tx.template.findFirst({
              where: {
                id: parsed.data.template_id,
                org_id: ctx.orgId,
                template_type: 'contract_document',
              },
              select: contractTemplateSelect(),
            })
          : await tx.template.findFirst({
              where: {
                org_id: ctx.orgId,
                template_type: 'contract_document',
                OR: [{ target_role: 'partner_pharmacy' }, { target_role: null }],
              },
              orderBy: [{ is_default: 'desc' }, { version: 'desc' }, { updated_at: 'desc' }],
              select: contractTemplateSelect(),
            });
        if (!template) {
          return {
            response: validationError('有効な薬局間契約書テンプレートを選択してください', {
              template_id: ['有効な薬局間契約書テンプレートを選択してください'],
            }),
          };
        }

        if (parsed.data.signed_file_id) {
          const signedFile = await tx.fileAsset.findFirst({
            where: {
              id: parsed.data.signed_file_id,
              org_id: ctx.orgId,
              status: 'uploaded',
              purpose: 'contract-document',
              mime_type: 'application/pdf',
              patient_id: null,
              visit_record_id: null,
              report_id: null,
              job_id: null,
            },
            select: { id: true },
          });
          if (!signedFile) {
            return {
              response: validationError('署名済み契約書ファイルが見つかりません', {
                signed_file_id: ['同一組織のアップロード済み契約書PDFファイルを指定してください'],
              }),
            };
          }

          const existingDocument = await tx.contractDocument.findFirst({
            where: {
              org_id: ctx.orgId,
              file_id: parsed.data.signed_file_id,
            },
            select: { id: true },
          });
          if (existingDocument) {
            return {
              response: validationError('署名済み契約書ファイルは既に使用されています', {
                signed_file_id: ['未使用の契約書PDFファイルを指定してください'],
              }),
            };
          }
        }

        const built = buildPharmacyContractDocumentPreview({
          documentType: parsed.data.document_type,
          generatedAt: now,
          template,
          contract,
          version,
        });
        if (!built.ok) {
          return {
            response: validationError('薬局間契約書テンプレートに必須条文が不足しています', {
              template_id: ['薬局間契約書テンプレートは第1条から第23条までを含めてください'],
              missing_article_numbers: built.missingArticleNumbers,
            }),
          };
        }

        return {
          versionId: version.id,
          versionNo: version.version_no,
          templateId: template.id,
          templateVersion: template.version,
          preview: built.preview,
        };
      },
    );

    if ('response' in prepared) return prepared.response ?? validationError('入力値が不正です');
    if (parsed.data.mode === 'preview') {
      return success({ mode: 'preview', ...prepared.preview });
    }

    let generatedFile: StoredFileRecord | null = null;
    try {
      if (parsed.data.generate_pdf) {
        const renderedPdf = await renderPharmacyContractDocumentPdf(prepared.preview);
        generatedFile = await storeGeneratedFile({
          orgId: ctx.orgId,
          purpose: 'contract-document',
          fileName: renderedPdf.fileName,
          mimeType: 'application/pdf',
          buffer: renderedPdf.buffer,
          uploadedBy: ctx.userId,
          jobId: `contract-document-${contractId}`,
          downloadDisposition: 'attachment',
        });
      }

      const saved = await withOrgContext(ctx.orgId, async (tx) => {
        const document = await tx.contractDocument.create({
          data: {
            org_id: ctx.orgId,
            contract_id: contractId,
            version_id: prepared.versionId,
            template_id: prepared.templateId,
            file_id: parsed.data.signed_file_id ?? generatedFile?.id ?? null,
            document_type: parsed.data.document_type,
            hash_value: prepared.preview.hash_value,
            signed_at: signedAt,
            created_by: ctx.userId,
          },
          select: documentSelect(),
        });

        await createAuditLogEntry(tx, ctx, {
          action: 'pharmacy_contract_document_created',
          targetType: 'ContractDocument',
          targetId: document.id,
          changes: {
            contract_id: contractId,
            version_id: prepared.versionId,
            version_no: prepared.versionNo,
            template_id: prepared.templateId,
            template_version: prepared.templateVersion,
            document_type: parsed.data.document_type,
            signed_file_attached: Boolean(parsed.data.signed_file_id),
            generated_pdf_stored: Boolean(generatedFile),
            has_signed_at: Boolean(parsed.data.signed_at),
            article_count: prepared.preview.snapshot.articles.length,
          },
        });

        return { document, preview: prepared.preview };
      });

      return success({ ...saved.document, preview: saved.preview }, 201);
    } catch (cause) {
      if (generatedFile) {
        await deleteGeneratedFile(generatedFile).catch((cleanupCause) => {
          logger.warn({
            event: 'pharmacy_contract_document.generated_pdf_cleanup_failed',
            orgId: ctx.orgId,
            entityType: 'file',
            entityId: generatedFile?.id,
            code: cleanupCause instanceof Error ? cleanupCause.name : 'UNKNOWN_ERROR',
          });
        });
      }
      if (cause instanceof FileStorageError) {
        return error(cause.code, cause.message, cause.status);
      }
      throw cause;
    }
  },
  {
    permission: 'canManagePatientSharing',
    message: '薬局間契約文書の作成権限がありません',
  },
);
