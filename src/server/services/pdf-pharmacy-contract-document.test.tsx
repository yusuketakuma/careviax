import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PharmacyContractDocumentPreview } from './pharmacy-contract-documents';

const { renderToBufferMock, fontRegisterMock } = vi.hoisted(() => ({
  renderToBufferMock: vi.fn(),
  fontRegisterMock: vi.fn(),
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

vi.mock('node:fs', () => ({
  default: {
    existsSync: () => true,
  },
}));

import { renderPharmacyContractDocumentPdf } from './pdf-pharmacy-contract-document';

function collectPdfText(value: unknown): string[] {
  if (value == null || typeof value === 'boolean') return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectPdfText);
  if (!isValidElement(value)) return [];

  if (typeof value.type === 'function') {
    const Component = value.type as (props: unknown) => unknown;
    return collectPdfText(Component(value.props));
  }

  const props = value.props as {
    label?: unknown;
    value?: unknown;
    children?: unknown;
  };
  return [
    ...collectPdfText(props.label),
    ...collectPdfText(props.value),
    ...collectPdfText(props.children),
  ];
}

function buildPreview(): PharmacyContractDocumentPreview {
  return {
    document_type: 'basic_contract',
    hash_value: 'hash_123',
    rendered_text: '第1条 目的',
    snapshot: {
      document_type: 'basic_contract',
      generated_at: '2026-06-19T00:00:00.000Z',
      template: {
        id: 'template_1',
        name: '薬局間契約書',
        version: 2,
        format: 'html',
      },
      contract: {
        id: 'contract_1',
        status: 'active',
        partnership_id: 'partnership_1',
        effective_from: '2026-06-01',
        effective_to: null,
        closing_day: 20,
        payment_due_rule: { month_offset: 1, day: 10 },
      },
      version: {
        id: 'version_1',
        version_no: 3,
        status: 'active',
        effective_from: '2026-06-01',
        effective_to: null,
      },
      parties: {
        base_pharmacy: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局' },
      },
      fee_schedule: {
        billing_model: 'fixed_per_visit',
        unit_price: 5500,
        tax_category: 'taxable',
        tax_rate_bp: 1000,
        rounding_rule: 'round',
        has_addon_rules: false,
        has_expense_rules: false,
      },
      articles: Array.from({ length: 23 }, (_value, index) => ({
        article_no: index + 1,
        title: `基本条項 ${index + 1}`,
        body: `契約本文 ${index + 1}`,
      })),
    },
  };
}

describe('renderPharmacyContractDocumentPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderToBufferMock.mockResolvedValue(Buffer.from('pdf'));
  });

  it('renders a contract document PDF from the frozen preview snapshot', async () => {
    const result = await renderPharmacyContractDocumentPdf(buildPreview());

    expect(result.fileName).toBe('contract_1_contract_v3.pdf');
    expect(result.buffer).toEqual(Buffer.from('pdf'));
    const text = collectPdfText(renderToBufferMock.mock.calls[0]?.[0]).join('\n');
    expect(text).toContain('薬局間連携契約書');
    expect(text).toContain('基幹薬局');
    expect(text).toContain('協力薬局');
    expect(text).toContain('5,500円');
    expect(text).toContain('契約本文 23');
    expect(text).toContain('hash_123');
  });
});
