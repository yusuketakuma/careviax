import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';

const {
  renderToBufferMock,
  fontRegisterMock,
  organizationFindUniqueMock,
  pharmacySiteFindFirstMock,
  pharmacyInvoiceFindFirstMock,
} = vi.hoisted(() => ({
  renderToBufferMock: vi.fn(),
  fontRegisterMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  pharmacySiteFindFirstMock: vi.fn(),
  pharmacyInvoiceFindFirstMock: vi.fn(),
}));

vi.mock('@react-pdf/renderer', async () => {
  const React = await import('react');
  const Component = (props: { children?: React.ReactNode }) =>
    React.createElement('div', null, props.children);
  return {
    Document: Component,
    Font: { register: fontRegisterMock },
    Page: Component,
    StyleSheet: { create: (styles: unknown) => styles },
    Text: Component,
    View: Component,
    renderToBuffer: renderToBufferMock,
  };
});

vi.mock('@/lib/db/client', () => ({
  prisma: {
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    pharmacySite: {
      findFirst: pharmacySiteFindFirstMock,
    },
    pharmacyInvoice: {
      findFirst: pharmacyInvoiceFindFirstMock,
    },
  },
}));

import { buildPharmacyInvoiceDocumentPdf } from './pdf-pharmacy-invoice';
import { PdfNotFoundError } from './pdf-errors';

function collectPdfText(value: unknown): string[] {
  if (value == null || typeof value === 'boolean') return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectPdfText);
  if (typeof value === 'object' && !isValidElement(value)) {
    const record = value as { label?: unknown; value?: unknown };
    return [...collectPdfText(record.label), ...collectPdfText(record.value)];
  }
  if (!isValidElement(value)) return [];

  const props = value.props as {
    title?: unknown;
    rows?: unknown;
    headers?: unknown;
    children?: unknown;
  };
  return [
    ...collectPdfText(props.title),
    ...collectPdfText(props.headers),
    ...collectPdfText(props.rows),
    ...collectPdfText(props.children),
  ];
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice_1',
    org_id: 'org_1',
    contract_id: 'contract_1',
    document_kind: 'invoice',
    invoice_no: 'INV-202606-001',
    billing_month: new Date('2026-06-01T00:00:00.000Z'),
    issuer_snapshot: { name: '協力薬局' },
    recipient_snapshot: { name: '基幹薬局' },
    subtotal: 5500,
    tax_amount: 550,
    total: 6050,
    status: 'draft',
    pdf_file_id: null,
    issued_at: null,
    sent_at: null,
    received_at: null,
    paid_at: null,
    snapshot: {
      patient_display_mode: 'management_number',
      patient_name: '患者 太郎',
    },
    created_by: 'user_1',
    created_at: new Date('2026-06-19T00:00:00.000Z'),
    updated_at: new Date('2026-06-19T00:00:00.000Z'),
    items: [
      {
        id: 'item_1',
        visit_date: new Date('2026-06-19T00:00:00.000Z'),
        description: '薬局間協力訪問 2026-06-19',
        quantity: 1,
        unit_price: 5500,
        amount: 5500,
        tax_category: 'taxable',
      },
    ],
    ...overrides,
  };
}

describe('buildPharmacyInvoiceDocumentPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from('pdf'));
    organizationFindUniqueMock.mockResolvedValue({ name: 'ケアビア薬局' });
    pharmacySiteFindFirstMock.mockResolvedValue({ name: '本店' });
    pharmacyInvoiceFindFirstMock.mockResolvedValue(invoice());
  });

  it('renders a PHI-minimized pharmacy invoice PDF from frozen invoice item scalars', async () => {
    const result = await buildPharmacyInvoiceDocumentPdf('org_1', 'invoice_1');

    expect(result.fileName).toBe('pharmacy-invoice-2026-06-01-invoice_1.pdf');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
    expect(result.auditMetadata).toMatchObject({
      document_kind: 'invoice',
      billing_month: '2026-06-01',
      item_count: 1,
      subtotal: 5500,
      tax_amount: 550,
      total: 6050,
      patient_display_mode: 'management_number',
    });
    const text = collectPdfText(renderToBufferMock.mock.calls[0]?.[0]).join('\n');
    expect(text).toContain('薬局間請求書');
    expect(text).toContain('薬局間協力訪問 2026-06-19');
    expect(text).toContain('患者表示方式');
    expect(text).toContain('management_number');
    expect(text).not.toContain('患者 太郎');
  });

  it('renders a free cooperation report with zero totals', async () => {
    pharmacyInvoiceFindFirstMock.mockResolvedValue(
      invoice({
        document_kind: 'free_cooperation_report',
        invoice_no: null,
        subtotal: 0,
        tax_amount: 0,
        total: 0,
        items: [
          {
            id: 'item_1',
            visit_date: new Date('2026-06-19T00:00:00.000Z'),
            description: '無償協力訪問 2026-06-19',
            quantity: 1,
            unit_price: 0,
            amount: 0,
            tax_category: 'out_of_scope',
          },
        ],
      }),
    );

    const result = await buildPharmacyInvoiceDocumentPdf('org_1', 'invoice_1');

    expect(result.auditMetadata).toMatchObject({
      document_kind: 'free_cooperation_report',
      total: 0,
    });
    const text = collectPdfText(renderToBufferMock.mock.calls[0]?.[0]).join('\n');
    expect(text).toContain('無償協力訪問 実績報告書');
    expect(text).toContain('無償協力訪問 2026-06-19');
  });

  it('fails closed for missing or non-exportable invoices', async () => {
    pharmacyInvoiceFindFirstMock.mockResolvedValueOnce(null);
    await expect(buildPharmacyInvoiceDocumentPdf('org_1', 'missing')).rejects.toBeInstanceOf(
      PdfNotFoundError,
    );

    pharmacyInvoiceFindFirstMock.mockResolvedValueOnce(invoice({ status: 'cancelled' }));
    await expect(buildPharmacyInvoiceDocumentPdf('org_1', 'invoice_1')).rejects.toThrow(
      'PHARMACY_INVOICE_DOCUMENT_NOT_EXPORTABLE',
    );
  });
});
