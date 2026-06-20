import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { PharmacyInvoiceDocumentKind, PharmacyInvoiceStatus } from '@prisma/client';
import type { ReactNode } from 'react';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { formatYen } from '@/lib/format/currency';
import {
  formatPdfDate,
  getPdfBranding,
  renderPdf,
  sanitizePdfFileName,
  type PdfRenderResult,
} from '@/server/services/pdf-rendering';
import { PdfNotFoundError } from './pdf-errors';

const DOCUMENT_KIND_LABELS: Record<PharmacyInvoiceDocumentKind, string> = {
  invoice: '薬局間請求書',
  free_cooperation_report: '無償協力訪問 実績報告書',
};

const STATUS_LABELS: Record<PharmacyInvoiceStatus, string> = {
  draft: '下書き',
  issued: '発行済み',
  sent: '送付済み',
  received: '受領済み',
  payment_scheduled: '支払予定',
  paid: '支払済み',
  voided: '無効',
  cancelled: '取消',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 64,
    paddingBottom: 44,
    paddingHorizontal: 30,
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    color: '#111827',
    lineHeight: 1.45,
  },
  header: {
    position: 'absolute',
    top: 20,
    left: 30,
    right: 30,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
  },
  subtitle: {
    marginTop: 2,
    color: '#4B5563',
    fontSize: 8,
  },
  headerMeta: {
    color: '#4B5563',
    fontSize: 8,
    textAlign: 'right',
  },
  section: {
    marginBottom: 11,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 5,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  card: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  cardLabel: {
    fontSize: 7.5,
    color: '#6B7280',
    marginBottom: 2,
  },
  cardValue: {
    fontSize: 9,
  },
  table: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  tableHeader: {
    backgroundColor: '#F3F4F6',
    fontWeight: 700,
  },
  tableCell: {
    paddingHorizontal: 5,
    paddingVertical: 4,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
  },
  note: {
    fontSize: 8,
    color: '#4B5563',
  },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 30,
    right: 30,
    fontSize: 7.5,
    color: '#6B7280',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

type KeyValueRow = {
  label: string;
  value: string;
};

type TableProps = {
  headers: string[];
  rows: string[][];
  widths: number[];
};

export type PharmacyInvoicePdfAuditMetadata = {
  document_kind: PharmacyInvoiceDocumentKind;
  billing_month: string;
  status: PharmacyInvoiceStatus;
  item_count: number;
  subtotal: number;
  tax_amount: number;
  total: number;
  patient_display_mode: string;
};

export type PharmacyInvoicePdfRenderResult = PdfRenderResult & {
  auditMetadata: PharmacyInvoicePdfAuditMetadata;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function KeyValueCards({ rows }: { rows: KeyValueRow[] }) {
  return (
    <View style={styles.cardGrid}>
      {rows.map((row) => (
        <View key={row.label} style={styles.card}>
          <Text style={styles.cardLabel}>{row.label}</Text>
          <Text style={styles.cardValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Table({ headers, rows, widths }: TableProps) {
  return (
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeader]}>
        {headers.map((header, index) => (
          <Text key={header} style={[styles.tableCell, { width: `${widths[index]}%` }]}>
            {header}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.tableRow}>
          {row.map((cell, cellIndex) => (
            <Text
              key={`${rowIndex}-${cellIndex}`}
              style={[styles.tableCell, { width: `${widths[cellIndex]}%` }]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function readStringFromJson(value: unknown, key: string) {
  const object = readJsonObject(value);
  const raw = object?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function readPatientDisplayMode(value: unknown) {
  return readStringFromJson(value, 'patient_display_mode') ?? 'management_number';
}

function formatBillingMonth(value: Date) {
  return `${value.getUTCFullYear()}年${String(value.getUTCMonth() + 1).padStart(2, '0')}月`;
}

function formatBillingMonthKey(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function assertExportableStatus(status: PharmacyInvoiceStatus) {
  if (status === 'voided' || status === 'cancelled') {
    throw new Error('PHARMACY_INVOICE_DOCUMENT_NOT_EXPORTABLE');
  }
}

export async function buildPharmacyInvoiceDocumentPdf(
  orgId: string,
  invoiceId: string,
): Promise<PharmacyInvoicePdfRenderResult> {
  const [branding, invoice] = await Promise.all([
    getPdfBranding(orgId),
    prisma.pharmacyInvoice.findFirst({
      where: { id: invoiceId, org_id: orgId },
      include: {
        items: {
          orderBy: [{ visit_date: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            visit_date: true,
            description: true,
            quantity: true,
            unit_price: true,
            amount: true,
            tax_category: true,
          },
        },
      },
    }),
  ]);
  if (!invoice) {
    throw new PdfNotFoundError('pharmacyInvoice');
  }
  assertExportableStatus(invoice.status);

  const documentLabel = DOCUMENT_KIND_LABELS[invoice.document_kind];
  const issuerName = readStringFromJson(invoice.issuer_snapshot, 'name') ?? '発行元未設定';
  const recipientName = readStringFromJson(invoice.recipient_snapshot, 'name') ?? '宛先未設定';
  const patientDisplayMode = readPatientDisplayMode(invoice.snapshot);
  const billingMonthKey = formatBillingMonthKey(invoice.billing_month);
  const fileName = sanitizePdfFileName(
    `pharmacy-${invoice.document_kind}-${billingMonthKey}-${invoice.id}.pdf`,
  );

  const rendered = await renderPdf(
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>{documentLabel}</Text>
            <Text style={styles.subtitle}>
              {issuerName} から {recipientName} への薬局間協力訪問実績
            </Text>
          </View>
          <Text style={styles.headerMeta}>
            対象月: {formatBillingMonth(invoice.billing_month)}
            {'\n'}
            出力日時: {formatPdfDate(new Date(), true)}
          </Text>
        </View>

        <Section title="文書情報">
          <KeyValueCards
            rows={[
              { label: '文書種別', value: documentLabel },
              { label: '状態', value: STATUS_LABELS[invoice.status] },
              { label: '対象月', value: formatBillingMonth(invoice.billing_month) },
              { label: '請求書番号', value: invoice.invoice_no ?? '未採番' },
              { label: '発行元', value: issuerName },
              { label: '宛先', value: recipientName },
              { label: '患者表示方式', value: patientDisplayMode },
              { label: '明細件数', value: `${invoice.items.length}件` },
            ]}
          />
        </Section>

        <Section title="金額">
          <Table
            headers={['小計', '税額', '合計']}
            widths={[34, 33, 33]}
            rows={[
              [
                formatYen(invoice.subtotal),
                formatYen(invoice.tax_amount),
                formatYen(invoice.total),
              ],
            ]}
          />
        </Section>

        <Section title="明細">
          <Table
            headers={['訪問日', '内容', '数量', '単価', '金額', '税区分']}
            widths={[14, 34, 9, 14, 14, 15]}
            rows={invoice.items.map((item) => [
              formatPdfDate(item.visit_date),
              item.description,
              String(item.quantity),
              formatYen(item.unit_price),
              formatYen(item.amount),
              item.tax_category,
            ])}
          />
        </Section>

        <Section title="出力注記">
          <Text style={styles.note}>
            この文書はPH-OSの薬局間協力訪問請求候補から固定済みの請求書明細をもとに出力されています。患者氏名や訪問記録本文は本PDFには含めません。
          </Text>
        </Section>

        <View style={styles.footer}>
          <Text>{branding.pharmacyName}</Text>
          <Text>Document ID: {invoice.id}</Text>
        </View>
      </Page>
    </Document>,
    fileName,
  );

  return {
    ...rendered,
    auditMetadata: {
      document_kind: invoice.document_kind,
      billing_month: billingMonthKey,
      status: invoice.status,
      item_count: invoice.items.length,
      subtotal: invoice.subtotal,
      tax_amount: invoice.tax_amount,
      total: invoice.total,
      patient_display_mode: patientDisplayMode,
    },
  };
}
