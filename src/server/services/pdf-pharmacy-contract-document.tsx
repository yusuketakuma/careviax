import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { formatYen } from '@/lib/ui/currency-format';
import {
  formatPdfDate,
  renderPdf,
  sanitizePdfFileName,
  type PdfRenderResult,
} from '@/server/services/pdf-rendering';
import type { PharmacyContractDocumentPreview } from './pharmacy-contract-documents';

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 44,
    paddingHorizontal: 34,
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    color: '#111827',
    lineHeight: 1.5,
  },
  header: {
    position: 'absolute',
    top: 20,
    left: 34,
    right: 34,
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
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    marginBottom: 5,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  label: {
    width: '30%',
    paddingVertical: 4,
    color: '#4B5563',
  },
  value: {
    width: '70%',
    paddingVertical: 4,
  },
  article: {
    marginBottom: 7,
  },
  articleTitle: {
    fontWeight: 700,
    marginBottom: 2,
  },
  paragraph: {
    whiteSpace: 'pre-wrap',
  },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 34,
    right: 34,
    fontSize: 7.5,
    color: '#6B7280',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function taxRateLabel(value: number | null) {
  return value == null ? '未設定' : `${(value / 100).toLocaleString('ja-JP')}%`;
}

function ContractDocumentPdf({ preview }: { preview: PharmacyContractDocumentPreview }) {
  const snapshot = preview.snapshot;
  const generatedAt = new Date(snapshot.generated_at);
  const baseName = snapshot.parties.base_pharmacy.name ?? '基幹薬局';
  const partnerName = snapshot.parties.partner_pharmacy.name ?? '協力薬局';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.title}>薬局間連携契約書</Text>
            <Text style={styles.subtitle}>
              {snapshot.template.name} v{snapshot.template.version}
            </Text>
          </View>
          <Text style={styles.headerMeta}>生成 {formatPdfDate(generatedAt, true)}</Text>
        </View>

        <Section title="契約情報">
          <DetailRow label="基幹薬局" value={baseName} />
          <DetailRow label="協力薬局" value={partnerName} />
          <DetailRow label="契約ID" value={snapshot.contract.id} />
          <DetailRow label="契約版" value={`v${snapshot.version.version_no}`} />
          <DetailRow
            label="有効期間"
            value={`${snapshot.contract.effective_from} - ${snapshot.contract.effective_to ?? '未定'}`}
          />
          <DetailRow label="締日" value={snapshot.contract.closing_day?.toString() ?? '未設定'} />
        </Section>

        <Section title="別紙 費用条件表">
          <DetailRow label="費用区分" value={snapshot.fee_schedule.billing_model} />
          <DetailRow label="1訪問単価" value={formatYen(snapshot.fee_schedule.unit_price)} />
          <DetailRow label="税区分" value={snapshot.fee_schedule.tax_category} />
          <DetailRow label="税率" value={taxRateLabel(snapshot.fee_schedule.tax_rate_bp)} />
          <DetailRow label="端数処理" value={snapshot.fee_schedule.rounding_rule ?? '未設定'} />
        </Section>

        <Section title="契約本文">
          {snapshot.articles.map((article) => (
            <View key={article.article_no} style={styles.article}>
              <Text style={styles.articleTitle}>
                第{article.article_no}条 {article.title}
              </Text>
              <Text style={styles.paragraph}>{article.body}</Text>
            </View>
          ))}
        </Section>

        <View style={styles.footer} fixed>
          <Text>PH-OS 契約書PDF</Text>
          <Text>{preview.hash_value}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderPharmacyContractDocumentPdf(
  preview: PharmacyContractDocumentPreview,
): Promise<PdfRenderResult> {
  const snapshot = preview.snapshot;
  const fileName = `${sanitizePdfFileName(
    `${snapshot.contract.id}_contract_v${snapshot.version.version_no}`,
  )}.pdf`;
  return renderPdf(<ContractDocumentPdf preview={preview} />, fileName);
}
