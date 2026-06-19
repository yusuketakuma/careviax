import { Prisma, type PharmacyInvoiceDocumentKind } from '@prisma/client';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { buildCursorPage, parsePaginationParams } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import {
  createPharmacyInvoiceDraft,
  PharmacyInvoiceDraftError,
} from '@/server/services/pharmacy-invoices';
import {
  BILLING_MONTH_FORMAT_MESSAGE,
  parseStrictBillingMonth,
} from '../billing-candidates/billing-month';

const createDraftSchema = z.object({
  billing_month: z.string().trim().min(1, 'billing_month は必須です'),
  contract_id: z.string().trim().min(1, 'contract_id は必須です'),
  document_kind: z.enum(['invoice', 'free_cooperation_report']),
});

const invoiceStatusSchema = z.enum([
  'draft',
  'issued',
  'sent',
  'received',
  'payment_scheduled',
  'paid',
  'voided',
  'cancelled',
]);
const documentKindSchema = z.enum(['invoice', 'free_cooperation_report']);

function optionalSearchParam(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function toDateKey(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function draftErrorResponse(error: PharmacyInvoiceDraftError) {
  if (error.code === 'NO_ELIGIBLE_CANDIDATES') {
    return conflict(error.message, error.details);
  }
  if (error.code === 'INVALID_CANDIDATE_AMOUNT') {
    return validationError(error.message, error.details);
  }
  if (error.code === 'STALE_CANDIDATES') {
    return conflict(error.message, error.details);
  }
  return conflict(error.message, error.details);
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const rawStatus = optionalSearchParam(searchParams.get('status'));
    const status = rawStatus ? invoiceStatusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', {
          status: ['対応していないステータスです'],
        }),
      );
    }

    const rawDocumentKind = optionalSearchParam(searchParams.get('document_kind'));
    const documentKind = rawDocumentKind ? documentKindSchema.safeParse(rawDocumentKind) : null;
    if (documentKind && !documentKind.success) {
      return withSensitiveNoStore(
        validationError('検索条件が不正です', {
          document_kind: ['対応していない文書種別です'],
        }),
      );
    }

    const rawBillingMonth = optionalSearchParam(searchParams.get('billing_month'));
    const billingMonth = rawBillingMonth ? parseStrictBillingMonth(rawBillingMonth) : null;
    if (rawBillingMonth && !billingMonth) {
      return withSensitiveNoStore(validationError(BILLING_MONTH_FORMAT_MESSAGE));
    }

    const contractId = optionalSearchParam(searchParams.get('contract_id'));
    const rows = await withOrgContext(ctx.orgId, (tx) =>
      tx.pharmacyInvoice.findMany({
        where: {
          org_id: ctx.orgId,
          ...(status ? { status: status.data } : {}),
          ...(documentKind ? { document_kind: documentKind.data } : {}),
          ...(billingMonth ? { billing_month: billingMonth.start } : {}),
          ...(contractId ? { contract_id: contractId } : {}),
        },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [{ billing_month: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          contract_id: true,
          document_kind: true,
          invoice_no: true,
          billing_month: true,
          subtotal: true,
          tax_amount: true,
          total: true,
          status: true,
          issued_at: true,
          sent_at: true,
          received_at: true,
          paid_at: true,
          created_at: true,
          updated_at: true,
          _count: { select: { items: true } },
          contract: {
            select: {
              partnership: {
                select: {
                  base_site: { select: { id: true, name: true } },
                  partner_pharmacy: { select: { id: true, name: true, status: true } },
                },
              },
            },
          },
        },
      }),
    );

    const page = buildCursorPage(rows, limit, (row) => row.id);
    return withSensitiveNoStore(
      success({
        ...page,
        data: page.data.map((row) => ({
          id: row.id,
          contract_id: row.contract_id,
          document_kind: row.document_kind,
          invoice_no: row.invoice_no,
          billing_month: toDateKey(row.billing_month),
          subtotal: row.subtotal,
          tax_amount: row.tax_amount,
          total: row.total,
          status: row.status,
          issued_at: row.issued_at,
          sent_at: row.sent_at,
          received_at: row.received_at,
          paid_at: row.paid_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
          item_count: row._count.items,
          partnership: row.contract.partnership,
        })),
      }),
    );
  },
  {
    permission: 'canManageBilling',
    message: '薬局間請求書の閲覧権限がありません',
  },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return withSensitiveNoStore(validationError('リクエストボディが不正です'));

    const parsed = createDraftSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const billingMonth = parseStrictBillingMonth(parsed.data.billing_month);
    if (!billingMonth) {
      return withSensitiveNoStore(validationError(BILLING_MONTH_FORMAT_MESSAGE));
    }

    try {
      const result = await withOrgContext(
        ctx.orgId,
        (tx) =>
          createPharmacyInvoiceDraft(tx, ctx, {
            billingMonth,
            contractId: parsed.data.contract_id,
            documentKind: parsed.data.document_kind as PharmacyInvoiceDocumentKind,
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return withSensitiveNoStore(
        success(
          {
            message: result.reused
              ? '既存の薬局間請求書ドラフトを返しました'
              : '薬局間請求書ドラフトを作成しました',
            ...result.invoice,
          },
          result.reused ? 200 : 201,
        ),
      );
    } catch (error) {
      if (error instanceof PharmacyInvoiceDraftError) {
        return withSensitiveNoStore(draftErrorResponse(error));
      }
      throw error;
    }
  },
  {
    permission: 'canManageBilling',
    message: '薬局間請求書の作成権限がありません',
  },
);
