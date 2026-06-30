import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type {
  AudienceReportContent,
  BaselineContext,
  CareManagerReportContent,
  PhysicianReportContent,
} from '@/types/care-report-content';
import {
  careLevelLabels,
  adlLabels,
  dementiaLabels,
  specialProcedureLabels,
} from '@/lib/patient/home-visit-intake';
import type { PatientArchiveSummary } from '@/lib/patient/archive-summary';
import type { VisitScheduleAccessContext } from '@/lib/auth/visit-schedule-access';
import { flattenPdfJson, readPdfJsonObject } from '@/server/services/pdf-document-json';
import { formatYen } from '@/lib/format/currency';
import {
  MEDICATION_CALENDAR_SLOT_KEYS,
  MEDICATION_CALENDAR_SLOT_LABELS,
  buildMedicationCalendarSlots,
  enumerateMedicationCalendarMonthDays,
} from '@/server/services/pdf-medication-calendar';
import {
  getMedicationHistoryRecord,
  type MedicationHistoryRecord,
} from '@/server/services/pdf-medication-record';
import {
  getManagementPlanRecord,
  type ManagementPlanRecord,
} from '@/server/services/pdf-management-plan-record';
import {
  getTracingReportRecord,
  type TracingReportRecord,
} from '@/server/services/pdf-tracing-report-record';
import {
  getCareReportRecord,
  type CareReportRecord,
} from '@/server/services/pdf-care-report-record';
import {
  getPatientVisitRecordRecord,
  getVisitRecordEntry,
  type PatientVisitRecordPdfRecord,
  type VisitRecordPdfEntry,
} from '@/server/services/pdf-visit-record';
import {
  getConferenceNoteRecord,
  type ConferenceNotePdfRecord,
} from '@/server/services/pdf-conference-note-record';
import {
  getBillingDocumentRecord,
  type BillingDocumentKind,
  type BillingDocumentRecord,
} from '@/server/services/pdf-billing-document-record';
import {
  formatPdfDate,
  getPdfBranding,
  renderPdf,
  sanitizePdfFileName,
  type PdfRenderResult,
} from '@/server/services/pdf-rendering';
import { defaultAudienceForReportType } from '@/lib/communications/share-audience';

type PdfShellProps = {
  title: string;
  subtitle?: string;
  pharmacyName: string;
  generatedAt: Date;
  orientation?: 'portrait' | 'landscape';
  children: React.ReactNode;
};

type KeyValueRow = {
  label: string;
  value: string;
};

type PatientArchiveRowsSource =
  | Pick<PatientArchiveSummary, 'archived' | 'archived_at'>
  | null
  | undefined;

type MedicationCalendarRecord = MedicationHistoryRecord & {
  month: Date;
};

type AudienceReportPdfContent = AudienceReportContent;

type PhysicianReportPdfContent = Omit<
  PhysicianReportContent,
  'adverse_events' | 'functional_assessment' | 'physician_communication'
> & {
  adverse_events?: PhysicianReportContent['adverse_events'];
  functional_assessment?: Partial<PhysicianReportContent['functional_assessment']>;
  physician_communication?: string;
};

const CONFERENCE_NOTE_TYPE_LABELS: Record<string, string> = {
  regular: '定例会議',
  pre_discharge: '退院前カンファレンス',
  service_manager: 'サービス担当者会議',
  care_team: '多職種カンファレンス',
  emergency: '緊急カンファレンス',
  death_conference: 'デスカンファレンス',
};

const VISIT_OUTCOME_LABELS: Record<string, string> = {
  completed: '完了',
  revisit_needed: '再訪必要',
  postponed: '延期',
  cancelled: 'キャンセル',
  delivery_only: '投薬のみ',
  completed_with_issue: '完了（課題あり）',
};

const VISIT_TYPE_LABELS: Record<string, string> = {
  initial: '初回',
  regular: '定期',
  temporary: '臨時',
  revisit: '再訪',
  delivery_only: '配薬のみ',
  emergency: '緊急',
  physician_co_visit: '医師同行',
};

const BILLING_DOCUMENT_KIND_LABELS: Record<BillingDocumentKind, string> = {
  receipt: '領収証',
  invoice: '請求書',
};

const BILLING_COLLECTION_STATUS_LABELS: Record<string, string> = {
  unbilled: '未請求',
  billed: '請求済',
  scheduled: '集金予定',
  collected: '集金済',
  partial: '一部入金',
  unpaid: '未収',
  dunning: '督促中',
  waived: '免除・公費',
  refunded: '返金',
  offset: '相殺',
};

const BILLING_PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: '現金',
  bank_transfer: '銀行振込',
  bank_debit: '口座振替',
  credit_card: 'クレジットカード',
  facility_billing: '施設請求',
  corporate_billing: '法人請求',
  other: 'その他',
};

const RELATION_LABELS: Record<string, string> = {
  self: '本人',
  spouse: '配偶者',
  child: '子',
  parent: '親',
  sibling: '兄弟姉妹',
  other_family: 'その他家族',
  caregiver: '介護者',
  facility_staff: '施設職員',
  other: 'その他',
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 78,
    paddingBottom: 52,
    paddingHorizontal: 28,
    fontFamily: 'NotoSansJP',
    fontSize: 9.5,
    color: '#111827',
    lineHeight: 1.45,
  },
  header: {
    position: 'absolute',
    top: 18,
    left: 28,
    right: 28,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  headerTitleWrap: {
    maxWidth: '70%',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 700,
  },
  headerSubtitle: {
    fontSize: 8.5,
    color: '#4B5563',
    marginTop: 2,
  },
  headerMeta: {
    fontSize: 8,
    textAlign: 'right',
    color: '#4B5563',
  },
  footerLeft: {
    position: 'absolute',
    bottom: 18,
    left: 28,
    fontSize: 8,
    color: '#4B5563',
  },
  footerRight: {
    position: 'absolute',
    bottom: 18,
    right: 28,
    fontSize: 8,
    color: '#4B5563',
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 10.5,
    fontWeight: 700,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  keyValueGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  keyValueCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  keyValueLabel: {
    fontSize: 8,
    color: '#6B7280',
    marginBottom: 2,
  },
  keyValueValue: {
    fontSize: 9.5,
  },
  paragraph: {
    fontSize: 9.5,
    whiteSpace: 'pre-wrap',
  },
  bulletList: {
    marginTop: 2,
    gap: 3,
  },
  bulletItem: {
    flexDirection: 'row',
    gap: 4,
  },
  bulletMarker: {
    width: 8,
    fontSize: 9.5,
  },
  bulletText: {
    flex: 1,
    fontSize: 9.5,
  },
  table: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableHeaderCell: {
    backgroundColor: '#F3F4F6',
    fontWeight: 700,
  },
  tableCell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontSize: 8.5,
  },
  tableCellTight: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    fontSize: 7.5,
  },
  muted: {
    color: '#6B7280',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    fontSize: 8,
  },
  calendarHeaderRow: {
    flexDirection: 'row',
  },
  calendarDayCell: {
    width: `${100 / 7}%`,
    minHeight: 88,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  calendarDayNumber: {
    fontSize: 8.5,
    fontWeight: 700,
    marginBottom: 3,
  },
  calendarSlotBox: {
    marginBottom: 3,
    borderRadius: 3,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  calendarSlotLabel: {
    fontSize: 6.5,
    color: '#374151',
    marginBottom: 1,
  },
  calendarDrugLine: {
    fontSize: 6.2,
    lineHeight: 1.25,
  },
});

function PdfShell({
  title,
  subtitle,
  pharmacyName,
  generatedAt,
  orientation = 'portrait',
  children,
}: PdfShellProps) {
  return (
    <Document title={title} author="PH-OS" subject={subtitle}>
      <Page size="A4" orientation={orientation} style={styles.page}>
        <View fixed style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>{title}</Text>
            {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
          </View>
          <Text style={styles.headerMeta}>
            {pharmacyName}
            {'\n'}
            出力日時: {formatPdfDate(generatedAt, true)}
          </Text>
        </View>

        <Text fixed style={styles.footerLeft}>
          PH-OS PDF
        </Text>
        <Text
          fixed
          style={styles.footerRight}
          render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`}
        />

        {children}
      </Page>
    </Document>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function KeyValueCards({ rows }: { rows: KeyValueRow[] }) {
  return (
    <View style={styles.keyValueGrid}>
      {rows.map((row) => (
        <View key={`${row.label}:${row.value}`} style={styles.keyValueCard}>
          <Text style={styles.keyValueLabel}>{row.label}</Text>
          <Text style={styles.keyValueValue}>{row.value || '—'}</Text>
        </View>
      ))}
    </View>
  );
}

function BulletList({ items }: { items: string[] }) {
  const resolvedItems = items.length > 0 ? items : ['—'];
  return (
    <View style={styles.bulletList}>
      {resolvedItems.map((item, index) => (
        <View key={`${index}:${item}`} style={styles.bulletItem}>
          <Text style={styles.bulletMarker}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Table({
  headers,
  rows,
  widths,
  compact = false,
}: {
  headers: string[];
  rows: string[][];
  widths: number[];
  compact?: boolean;
}) {
  const cellStyle = compact ? [styles.tableCell, styles.tableCellTight] : [styles.tableCell];

  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        {headers.map((header, index) => (
          <Text
            key={header}
            style={[...cellStyle, styles.tableHeaderCell, { width: `${widths[index]}%` }]}
          >
            {header}
          </Text>
        ))}
      </View>
      {rows.map((row, rowIndex) => (
        <View key={`${rowIndex}:${row.join('|')}`} style={styles.tableRow}>
          {row.map((cell, cellIndex) => (
            <Text
              key={`${rowIndex}:${cellIndex}`}
              style={[...cellStyle, { width: `${widths[cellIndex]}%` }]}
            >
              {cell || '—'}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function renderBaselineContextSection(baseline: BaselineContext) {
  const procedureLabels = (baseline.special_medical_procedures ?? []).map(
    (p) => specialProcedureLabels[p] ?? p,
  );
  const rows: KeyValueRow[] = [
    {
      label: '介護度',
      value: careLevelLabels[baseline.care_level ?? ''] ?? baseline.care_level ?? '—',
    },
    { label: 'ADL', value: adlLabels[baseline.adl_level ?? ''] ?? baseline.adl_level ?? '—' },
    {
      label: '認知症',
      value: dementiaLabels[baseline.dementia_level ?? ''] ?? baseline.dementia_level ?? '—',
    },
    { label: '主傷病', value: baseline.primary_disease ?? '—' },
  ];
  if (baseline.requester) {
    rows.push(
      { label: '依頼元', value: baseline.requester.organization_name ?? '—' },
      { label: '担当者', value: baseline.requester.contact_name ?? '—' },
    );
  }
  return (
    <Section title="患者状態（受付時ベースライン）">
      <KeyValueCards rows={rows} />
      {procedureLabels.length > 0 ? <BulletList items={procedureLabels} /> : null}
    </Section>
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function patientArchiveRows(archive: PatientArchiveRowsSource): KeyValueRow[] {
  if (!archive?.archived) return [];
  return [
    { label: '患者状態', value: 'アーカイブ中（閲覧専用）' },
    { label: 'アーカイブ日時', value: formatPdfDate(archive.archived_at, true) },
  ];
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isBaselineContext(value: unknown): value is BaselineContext {
  if (value === undefined) return true;
  const object = readPdfJsonObject(value);
  if (
    !isOptionalString(object.care_level) ||
    !isOptionalString(object.adl_level) ||
    !isOptionalString(object.dementia_level) ||
    !isOptionalString(object.primary_disease)
  ) {
    return false;
  }
  if (
    object.special_medical_procedures !== undefined &&
    !isStringArray(object.special_medical_procedures)
  ) {
    return false;
  }
  if (object.requester !== undefined) {
    const requester = readPdfJsonObject(object.requester);
    return (
      isOptionalString(requester.contact_name) &&
      isOptionalString(requester.organization_name) &&
      isOptionalString(requester.profession) &&
      isOptionalString(requester.phone) &&
      isOptionalString(requester.fax)
    );
  }
  return true;
}

function isPhysicianPrescription(
  value: unknown,
): value is PhysicianReportContent['prescriptions'][number] {
  const object = readPdfJsonObject(value);
  return (
    typeof object.drug_name === 'string' &&
    typeof object.dose === 'string' &&
    typeof object.frequency === 'string' &&
    typeof object.days === 'number'
  );
}

function isResidualMedication(
  value: unknown,
): value is PhysicianReportContent['residual_medications'][number] {
  const object = readPdfJsonObject(value);
  return (
    typeof object.drug_name === 'string' &&
    typeof object.remaining_qty === 'number' &&
    typeof object.excess_days === 'number'
  );
}

function isPhysicianReportContent(value: unknown): value is PhysicianReportPdfContent {
  const object = readPdfJsonObject(value);
  const patient = readPdfJsonObject(object.patient);
  const prescriber = readPdfJsonObject(object.prescriber);
  const medicationManagement = readPdfJsonObject(object.medication_management);
  const adverseEvents = readPdfJsonObject(object.adverse_events);
  const functionalAssessment = readPdfJsonObject(object.functional_assessment);
  const hasAdverseEvents =
    object.adverse_events === undefined ||
    (typeof adverseEvents.has_events === 'boolean' &&
      isStringArray(adverseEvents.events) &&
      isOptionalString(adverseEvents.details));
  const hasFunctionalAssessment =
    object.functional_assessment === undefined ||
    (isOptionalString(functionalAssessment.lab_values) &&
      isOptionalString(functionalAssessment.sleep) &&
      isOptionalString(functionalAssessment.cognition) &&
      isOptionalString(functionalAssessment.diet_oral) &&
      isOptionalString(functionalAssessment.mobility) &&
      isOptionalString(functionalAssessment.excretion));

  return (
    typeof patient.name === 'string' &&
    typeof patient.birth_date === 'string' &&
    typeof patient.gender === 'string' &&
    typeof object.report_date === 'string' &&
    typeof object.visit_date === 'string' &&
    typeof object.pharmacist_name === 'string' &&
    typeof prescriber.name === 'string' &&
    typeof prescriber.institution === 'string' &&
    Array.isArray(object.prescriptions) &&
    object.prescriptions.every(isPhysicianPrescription) &&
    typeof medicationManagement.compliance_summary === 'string' &&
    typeof medicationManagement.adherence_score === 'number' &&
    typeof medicationManagement.self_management === 'string' &&
    typeof medicationManagement.calendar_used === 'boolean' &&
    hasAdverseEvents &&
    hasFunctionalAssessment &&
    typeof object.assessment === 'string' &&
    typeof object.plan === 'string' &&
    isOptionalString(object.prescription_proposals) &&
    isOptionalString(object.physician_communication) &&
    Array.isArray(object.residual_medications) &&
    object.residual_medications.every(isResidualMedication) &&
    isStringArray(object.warnings) &&
    isBaselineContext(object.baseline_context)
  );
}

function isCareManagerReportContent(value: unknown): value is CareManagerReportContent {
  const object = readPdfJsonObject(value);
  const patient = readPdfJsonObject(object.patient);
  const careManager = readPdfJsonObject(object.care_manager);
  const medicationSummary = readPdfJsonObject(object.medication_management_summary);
  const functionalImpact = readPdfJsonObject(object.functional_impact);
  const residualStatus = readPdfJsonObject(object.residual_status);
  const careServiceCoordination = readPdfJsonObject(object.care_service_coordination);
  const nextVisitPlan = readPdfJsonObject(object.next_visit_plan);

  return (
    typeof patient.name === 'string' &&
    typeof patient.birth_date === 'string' &&
    typeof careManager.name === 'string' &&
    typeof careManager.organization === 'string' &&
    typeof object.report_date === 'string' &&
    typeof object.visit_date === 'string' &&
    typeof object.pharmacist_name === 'string' &&
    typeof medicationSummary.total_drugs === 'number' &&
    typeof medicationSummary.compliance_summary === 'string' &&
    typeof medicationSummary.self_management === 'string' &&
    typeof medicationSummary.calendar_used === 'boolean' &&
    typeof functionalImpact.sleep_impact === 'string' &&
    typeof functionalImpact.cognition_impact === 'string' &&
    typeof functionalImpact.diet_impact === 'string' &&
    typeof functionalImpact.mobility_impact === 'string' &&
    typeof functionalImpact.excretion_impact === 'string' &&
    typeof residualStatus.summary === 'string' &&
    isStringArray(residualStatus.reduction_proposals) &&
    typeof careServiceCoordination.medication_assistance === 'string' &&
    typeof careServiceCoordination.unit_dose_packaging === 'boolean' &&
    typeof careServiceCoordination.calendar_recommendation === 'boolean' &&
    typeof careServiceCoordination.other_items === 'string' &&
    isOptionalString(nextVisitPlan.date) &&
    isStringArray(nextVisitPlan.followup_items) &&
    isStringArray(object.warnings) &&
    isBaselineContext(object.baseline_context)
  );
}

function isAudienceReportPdfContent(value: unknown): value is AudienceReportPdfContent {
  const object = readPdfJsonObject(value);
  const patient = readPdfJsonObject(object.patient);
  return (
    (object.report_audience === 'visiting_nurse' ||
      object.report_audience === 'facility' ||
      object.report_audience === 'family') &&
    typeof patient.name === 'string' &&
    typeof patient.birth_date === 'string' &&
    typeof object.report_date === 'string' &&
    typeof object.visit_date === 'string' &&
    typeof object.pharmacist_name === 'string' &&
    typeof object.summary === 'string' &&
    typeof object.medication === 'string' &&
    typeof object.residual === 'string' &&
    typeof object.evaluation === 'string' &&
    typeof object.requests === 'string' &&
    isStringArray(object.warnings) &&
    isBaselineContext(object.baseline_context)
  );
}

function renderCareReportContent(report: CareReportRecord) {
  if (report.report_type === 'physician_report') {
    const content = readPdfJsonObject(report.content);
    if (isPhysicianReportContent(content)) {
      const adverseEvents = content.adverse_events ?? { has_events: false, events: [] };
      const functionalAssessment = {
        lab_values: content.functional_assessment?.lab_values,
        sleep: content.functional_assessment?.sleep ?? '記載なし',
        cognition: content.functional_assessment?.cognition ?? '記載なし',
        diet_oral: content.functional_assessment?.diet_oral ?? '記載なし',
        mobility: content.functional_assessment?.mobility ?? '記載なし',
        excretion: content.functional_assessment?.excretion ?? '記載なし',
      };
      return (
        <>
          <Section title="基本情報">
            <KeyValueCards
              rows={[
                { label: '患者名', value: content.patient.name },
                { label: '生年月日', value: content.patient.birth_date },
                { label: '性別', value: content.patient.gender },
                ...patientArchiveRows(report.patient.archive),
                { label: '訪問日', value: content.visit_date },
                { label: '報告日', value: content.report_date },
                { label: '報告書種別', value: '訪問薬剤管理指導報告書' },
                {
                  label: '確認状態',
                  value: report.status === 'confirmed' ? '薬剤師確認済み' : report.status,
                },
                { label: '担当薬剤師', value: content.pharmacist_name },
                { label: '主治医', value: content.prescriber.name },
                { label: '所属', value: content.prescriber.institution },
              ]}
            />
          </Section>
          {content.baseline_context ? renderBaselineContextSection(content.baseline_context) : null}

          <Section title="処方内容">
            <Table
              headers={['薬剤名', '用量', '用法', '日数']}
              widths={[42, 18, 25, 15]}
              rows={content.prescriptions.map((item) => [
                item.drug_name,
                item.dose,
                item.frequency,
                `${item.days}日`,
              ])}
            />
          </Section>

          <Section title="服薬管理">
            <KeyValueCards
              rows={[
                { label: '服薬サマリー', value: content.medication_management.compliance_summary },
                {
                  label: 'アドヒアランス',
                  value: `${content.medication_management.adherence_score}/5`,
                },
                { label: '自己管理', value: content.medication_management.self_management },
                {
                  label: 'カレンダー使用',
                  value: content.medication_management.calendar_used ? '使用あり' : '使用なし',
                },
              ]}
            />
          </Section>

          <Section title="薬物有害事象">
            <KeyValueCards
              rows={[
                { label: '有害事象', value: adverseEvents.has_events ? 'あり' : 'なし' },
                {
                  label: '内容',
                  value: adverseEvents.events.length > 0 ? adverseEvents.events.join('、') : '—',
                },
                { label: '詳細', value: adverseEvents.details ?? '—' },
              ]}
            />
          </Section>

          <Section title="検査値・機能評価">
            <BulletList
              items={[
                `検査値: ${functionalAssessment.lab_values ?? '記載なし'}`,
                `睡眠: ${functionalAssessment.sleep}`,
                `認知・感覚: ${functionalAssessment.cognition}`,
                `食事・口腔: ${functionalAssessment.diet_oral}`,
                `歩行・運動: ${functionalAssessment.mobility}`,
                `排泄: ${functionalAssessment.excretion}`,
              ]}
            />
          </Section>

          <Section title="薬学的評価と対応">
            <Text style={styles.paragraph}>{content.assessment}</Text>
            <Text style={[styles.paragraph, { marginTop: 6 }]}>{content.plan}</Text>
            {content.prescription_proposals ? (
              <Text style={[styles.paragraph, { marginTop: 6 }]}>
                処方提案: {content.prescription_proposals}
              </Text>
            ) : null}
          </Section>

          <Section title="処方医への連絡事項">
            <Text style={styles.paragraph}>{content.physician_communication ?? '特になし'}</Text>
          </Section>

          <Section title="残薬・注意事項">
            <BulletList
              items={[
                ...content.residual_medications.map(
                  (item) =>
                    `${item.drug_name}: 残 ${item.remaining_qty} / 余剰 ${item.excess_days}日`,
                ),
                ...content.warnings,
              ]}
            />
          </Section>
        </>
      );
    }
  }

  if (report.report_type === 'care_manager_report') {
    const content = readPdfJsonObject(report.content);
    if (isCareManagerReportContent(content)) {
      return (
        <>
          <Section title="基本情報">
            <KeyValueCards
              rows={[
                { label: '患者名', value: content.patient.name },
                { label: '生年月日', value: content.patient.birth_date },
                ...patientArchiveRows(report.patient.archive),
                { label: '報告日', value: content.report_date },
                { label: '訪問日', value: content.visit_date },
                { label: '報告書種別', value: '居宅療養管理指導情報提供書' },
                {
                  label: '確認状態',
                  value: report.status === 'confirmed' ? '薬剤師確認済み' : report.status,
                },
                { label: '担当薬剤師', value: content.pharmacist_name },
                { label: 'ケアマネ', value: content.care_manager.name },
                { label: '所属', value: content.care_manager.organization },
              ]}
            />
          </Section>
          {content.baseline_context ? renderBaselineContextSection(content.baseline_context) : null}

          <Section title="服薬管理サマリー">
            <KeyValueCards
              rows={[
                {
                  label: '服薬薬剤数',
                  value: `${content.medication_management_summary.total_drugs}剤`,
                },
                {
                  label: '服薬状況',
                  value: content.medication_management_summary.compliance_summary,
                },
                {
                  label: '自己管理',
                  value: content.medication_management_summary.self_management,
                },
                {
                  label: 'カレンダー使用',
                  value: content.medication_management_summary.calendar_used
                    ? '使用あり'
                    : '使用なし',
                },
              ]}
            />
          </Section>

          <Section title="生活機能への影響">
            <BulletList
              items={[
                `睡眠: ${content.functional_impact.sleep_impact}`,
                `認知: ${content.functional_impact.cognition_impact}`,
                `食事・口腔: ${content.functional_impact.diet_impact}`,
                `移動: ${content.functional_impact.mobility_impact}`,
                `排泄: ${content.functional_impact.excretion_impact}`,
              ]}
            />
          </Section>

          <Section title="連携・次回計画">
            <BulletList
              items={[
                `残薬状況: ${content.residual_status.summary}`,
                ...content.residual_status.reduction_proposals.map((item) => `減数提案: ${item}`),
                `服薬支援: ${content.care_service_coordination.medication_assistance}`,
                `一包化: ${content.care_service_coordination.unit_dose_packaging ? 'あり' : 'なし'}`,
                `服薬カレンダー提案: ${content.care_service_coordination.calendar_recommendation ? 'あり' : 'なし'}`,
                `次回訪問予定: ${content.next_visit_plan.date ?? '未定'}`,
                ...content.next_visit_plan.followup_items,
                ...content.warnings,
              ]}
            />
          </Section>
        </>
      );
    }
  }

  if (
    report.report_type === 'nurse_share' ||
    report.report_type === 'facility_handoff' ||
    report.report_type === 'family_share'
  ) {
    const content = readPdfJsonObject(report.content);
    const expectedAudience = defaultAudienceForReportType(report.report_type);
    if (isAudienceReportPdfContent(content) && content.report_audience === expectedAudience) {
      return (
        <>
          <Section title="基本情報">
            <KeyValueCards
              rows={[
                { label: '患者名', value: content.patient.name },
                { label: '生年月日', value: content.patient.birth_date },
                ...patientArchiveRows(report.patient.archive),
                { label: '訪問日', value: content.visit_date },
                { label: '報告日', value: content.report_date },
                {
                  label: '報告書種別',
                  value:
                    content.report_audience === 'visiting_nurse'
                      ? '訪問看護向け服薬情報共有'
                      : content.report_audience === 'family'
                        ? 'ご家族向け服薬情報共有'
                        : '施設向け服薬介助申し送り',
                },
                {
                  label: '確認状態',
                  value: report.status === 'confirmed' ? '薬剤師確認済み' : report.status,
                },
                { label: '担当薬剤師', value: content.pharmacist_name },
              ]}
            />
          </Section>
          {content.baseline_context ? renderBaselineContextSection(content.baseline_context) : null}
          <Section title="今日の要点">
            <Text style={styles.paragraph}>{content.summary}</Text>
          </Section>
          <Section title="服薬状況">
            <Text style={styles.paragraph}>{content.medication}</Text>
          </Section>
          <Section title="残薬">
            <Text style={styles.paragraph}>{content.residual}</Text>
          </Section>
          <Section title="薬剤師の評価">
            <Text style={styles.paragraph}>{content.evaluation}</Text>
          </Section>
          <Section title="お願いしたいこと">
            <Text style={styles.paragraph}>{content.requests}</Text>
          </Section>
          {content.warnings.length > 0 ? (
            <Section title="提出前確認">
              <BulletList items={content.warnings} />
            </Section>
          ) : null}
        </>
      );
    }
  }

  return (
    <Section title="内容">
      <Text style={styles.paragraph}>
        この報告書形式は外部提出用PDFとして表示できません。薬剤師が内容を確認し、専用形式で再出力してください。
      </Text>
    </Section>
  );
}

function renderManagementPlanContent(plan: ManagementPlanRecord) {
  return (
    <>
      <Section title="基本情報">
        <KeyValueCards
          rows={[
            { label: '患者名', value: plan.patient.name },
            { label: '生年月日', value: formatPdfDate(plan.patient.birth_date) },
            { label: '性別', value: plan.patient.gender },
            ...patientArchiveRows(plan.patient.archive),
            { label: '版数', value: `v${plan.version}` },
            { label: '状態', value: plan.status },
            { label: '適用開始日', value: formatPdfDate(plan.effective_from) },
            { label: '次回見直し日', value: formatPdfDate(plan.next_review_date) },
            { label: '承認日', value: formatPdfDate(plan.approved_at) },
          ]}
        />
      </Section>

      <Section title="要約">
        <Text style={styles.paragraph}>{plan.summary ?? '—'}</Text>
      </Section>

      <Section title="計画内容">
        <BulletList
          items={flattenPdfJson(plan.content).map((row) => `${row.label}: ${row.value}`)}
        />
      </Section>
    </>
  );
}

function renderMedicationHistoryContent(record: MedicationHistoryRecord) {
  return (
    <>
      <Section title="患者情報">
        <KeyValueCards
          rows={[
            { label: '患者名', value: record.patient.name },
            { label: '生年月日', value: formatPdfDate(record.patient.birth_date) },
            { label: '性別', value: record.patient.gender },
            { label: '患者ID', value: record.patient.id },
            ...patientArchiveRows(record.patient.archive),
          ]}
        />
      </Section>

      <Section title="服薬中薬剤一覧">
        <Table
          headers={['薬剤名', '用量', '用法', '開始', '終了', '処方医']}
          widths={[31, 14, 17, 12, 12, 14]}
          rows={record.medications.map((item) => [
            item.drug_name,
            item.dose ?? '',
            item.frequency ?? '',
            formatPdfDate(item.start_date),
            formatPdfDate(item.end_date),
            item.prescriber ?? '',
          ])}
        />
      </Section>
    </>
  );
}

function renderMedicationCalendarContent(record: MedicationCalendarRecord) {
  const calendarCells = enumerateMedicationCalendarMonthDays(record.month);
  const weekRows = Array.from({ length: calendarCells.length / 7 }, (_, index) =>
    calendarCells.slice(index * 7, index * 7 + 7),
  );

  return (
    <>
      <Section title="対象情報">
        <KeyValueCards
          rows={[
            { label: '患者名', value: record.patient.name },
            {
              label: '対象月',
              value: `${record.month.getFullYear()}年${record.month.getMonth() + 1}月`,
            },
            { label: '患者ID', value: record.patient.id },
            ...patientArchiveRows(record.patient.archive),
            { label: '薬剤数', value: `${record.medications.length}件` },
          ]}
        />
      </Section>

      <View style={styles.table}>
        <View style={styles.calendarHeaderRow}>
          {['日', '月', '火', '水', '木', '金', '土'].map((label) => (
            <Text
              key={label}
              style={[
                styles.tableCell,
                styles.tableHeaderCell,
                styles.tableCellTight,
                { width: `${100 / 7}%` },
              ]}
            >
              {label}
            </Text>
          ))}
        </View>

        {weekRows.map((week, weekIndex) => (
          <View key={`week-${weekIndex}`} style={styles.calendarHeaderRow}>
            {week.map((date, dayIndex) => {
              const slots = buildMedicationCalendarSlots(record.medications, date);
              return (
                <View key={`day-${weekIndex}-${dayIndex}`} style={styles.calendarDayCell}>
                  <Text style={styles.calendarDayNumber}>{date ? date.getDate() : ''}</Text>
                  {date
                    ? MEDICATION_CALENDAR_SLOT_KEYS.map((slot) => (
                        <View key={`${date.toISOString()}-${slot}`} style={styles.calendarSlotBox}>
                          <Text style={styles.calendarSlotLabel}>
                            {MEDICATION_CALENDAR_SLOT_LABELS[slot]}
                          </Text>
                          {(slots[slot] ?? []).slice(0, 3).map((line, lineIndex) => (
                            <Text key={`${slot}-${lineIndex}`} style={styles.calendarDrugLine}>
                              {line}
                            </Text>
                          ))}
                          {(slots[slot]?.length ?? 0) > 3 ? (
                            <Text style={styles.calendarDrugLine}>
                              他 {(slots[slot]?.length ?? 0) - 3} 件
                            </Text>
                          ) : null}
                        </View>
                      ))
                    : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </>
  );
}

function renderVisitRecordEntryContent(record: VisitRecordPdfEntry) {
  const issueNotes = [
    record.cancellation_reason ? `キャンセル理由: ${record.cancellation_reason}` : null,
    record.postpone_reason ? `延期理由: ${record.postpone_reason}` : null,
    record.revisit_reason ? `再訪理由: ${record.revisit_reason}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <>
      <Section title="患者情報">
        <KeyValueCards
          rows={[
            { label: '患者名', value: record.patient.name },
            { label: '患者ID', value: record.patient.id },
            { label: '生年月日', value: formatPdfDate(record.patient.birth_date) },
            { label: '性別', value: record.patient.gender },
            ...patientArchiveRows(record.patient.archive),
          ]}
        />
      </Section>

      <Section title="訪問情報">
        <KeyValueCards
          rows={[
            { label: '訪問日', value: formatPdfDate(record.visit_date) },
            {
              label: '訪問タイプ',
              value: record.schedule
                ? (VISIT_TYPE_LABELS[record.schedule.visit_type] ?? record.schedule.visit_type)
                : '—',
            },
            {
              label: '結果',
              value: VISIT_OUTCOME_LABELS[record.outcome_status] ?? record.outcome_status,
            },
            { label: '記録者', value: record.pharmacist_name ?? record.pharmacist_id },
            {
              label: '最終更新者',
              value: record.last_modified_by_name ?? record.last_modified_by_id ?? '—',
            },
            {
              label: '最終更新日時',
              value: formatPdfDate(record.updated_at, true),
            },
            { label: '作成日時', value: formatPdfDate(record.created_at, true) },
            { label: '版数', value: `v${record.version}` },
          ]}
        />
      </Section>

      <Section title="SOAP">
        <BulletList
          items={[
            `S: ${record.soap_subjective ?? '記録なし'}`,
            `O: ${record.soap_objective ?? '記録なし'}`,
            `A: ${record.soap_assessment ?? '記録なし'}`,
            `P: ${record.soap_plan ?? '記録なし'}`,
          ]}
        />
      </Section>

      <Section title="受領・次回対応">
        <BulletList
          items={[
            `受領者: ${record.receipt_person_name ?? '記録なし'}`,
            `続柄: ${
              record.receipt_person_relation
                ? (RELATION_LABELS[record.receipt_person_relation] ??
                  record.receipt_person_relation)
                : '—'
            }`,
            `受領日時: ${formatPdfDate(record.receipt_at, true)}`,
            `次回訪問提案日: ${formatPdfDate(record.next_visit_suggestion_date)}`,
            ...issueNotes,
          ]}
        />
      </Section>

      <Section title="残薬記録">
        <Table
          headers={['薬剤名', '処方量', '残数', '余剰日数', '区分']}
          widths={[40, 14, 14, 14, 18]}
          rows={
            record.residuals.length > 0
              ? record.residuals.map((item) => [
                  item.drug_name,
                  item.prescribed_quantity != null ? String(item.prescribed_quantity) : '—',
                  String(item.remaining_quantity),
                  item.excess_days != null ? `${item.excess_days}日` : '—',
                  item.is_prohibited_reduction
                    ? '減数禁止'
                    : item.is_reduction_target
                      ? '減数対象'
                      : '通常',
                ])
              : [['記録なし', '', '', '', '']]
          }
        />
      </Section>
    </>
  );
}

function renderPatientVisitRecordsContent(record: PatientVisitRecordPdfRecord) {
  return (
    <>
      <Section title="患者情報">
        <KeyValueCards
          rows={[
            { label: '患者名', value: record.patient.name },
            { label: '患者ID', value: record.patient.id },
            { label: '生年月日', value: formatPdfDate(record.patient.birth_date) },
            { label: '性別', value: record.patient.gender },
            ...patientArchiveRows(record.patient.archive),
            {
              label: '期間',
              value:
                record.dateFrom || record.dateTo
                  ? `${formatPdfDate(record.dateFrom)} - ${formatPdfDate(record.dateTo)}`
                  : '全期間',
            },
            { label: '記録件数', value: `${record.records.length}件` },
          ]}
        />
      </Section>

      <Section title="訪問記録一覧">
        <Table
          headers={['訪問日', '訪問タイプ', '結果', '次回提案', '更新日時', '記録者']}
          widths={[16, 17, 16, 16, 18, 17]}
          compact
          rows={record.records.map((item) => [
            formatPdfDate(item.visit_date),
            item.schedule
              ? (VISIT_TYPE_LABELS[item.schedule.visit_type] ?? item.schedule.visit_type)
              : '—',
            VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status,
            formatPdfDate(item.next_visit_suggestion_date),
            formatPdfDate(item.updated_at, true),
            item.last_modified_by_name ?? item.pharmacist_name ?? item.pharmacist_id,
          ])}
        />
      </Section>

      {record.records.map((item, index) => (
        <Section
          key={item.id}
          title={`${index + 1}. ${formatPdfDate(item.visit_date)} / ${
            VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status
          }`}
        >
          <BulletList
            items={[
              `訪問タイプ: ${
                item.schedule
                  ? (VISIT_TYPE_LABELS[item.schedule.visit_type] ?? item.schedule.visit_type)
                  : '—'
              }`,
              `記録者: ${item.pharmacist_name ?? item.pharmacist_id}`,
              `最終更新者: ${item.last_modified_by_name ?? item.last_modified_by_id ?? '—'}`,
              `S: ${item.soap_subjective ?? '記録なし'}`,
              `O: ${item.soap_objective ?? '記録なし'}`,
              `A: ${item.soap_assessment ?? '記録なし'}`,
              `P: ${item.soap_plan ?? '記録なし'}`,
              ...(item.cancellation_reason ? [`キャンセル理由: ${item.cancellation_reason}`] : []),
              ...(item.postpone_reason ? [`延期理由: ${item.postpone_reason}`] : []),
              ...(item.revisit_reason ? [`再訪理由: ${item.revisit_reason}`] : []),
            ]}
          />
        </Section>
      ))}
    </>
  );
}

function renderTracingReportContent(report: TracingReportRecord) {
  return (
    <>
      <Section title="基本情報">
        <KeyValueCards
          rows={[
            { label: '患者名', value: report.patient.name },
            { label: '生年月日', value: formatPdfDate(report.patient.birth_date) },
            { label: '性別', value: report.patient.gender },
            ...patientArchiveRows(report.patient.archive),
            { label: '送付先医師', value: report.sent_to_physician ?? '—' },
            { label: '状態', value: report.status },
            { label: '送付日時', value: formatPdfDate(report.sent_at, true) },
            { label: '受領確認', value: formatPdfDate(report.acknowledged_at, true) },
          ]}
        />
      </Section>

      {report.issue ? (
        <Section title="関連課題">
          <BulletList
            items={[
              `タイトル: ${report.issue.title}`,
              `優先度: ${report.issue.priority}`,
              `状態: ${report.issue.status}`,
              `内容: ${report.issue.description}`,
            ]}
          />
        </Section>
      ) : null}

      <Section title="報告内容">
        <BulletList
          items={flattenPdfJson(report.content).map((row) => `${row.label}: ${row.value}`)}
        />
      </Section>
    </>
  );
}

function renderConferenceNoteContent(record: ConferenceNotePdfRecord) {
  const participantItems = record.participants.map((participant) => {
    const deliveryChannels = [
      participant.email ? `Mail: ${participant.email}` : null,
      participant.fax ? `FAX: ${participant.fax}` : null,
    ].filter(Boolean);

    return [
      participant.name ?? '名称未設定',
      participant.role ? `(${participant.role})` : null,
      participant.attended === false ? '欠席' : '出席',
      participant.is_report_recipient ? '報告書送付対象' : null,
      deliveryChannels.length > 0 ? `連絡先 ${deliveryChannels.join(' / ')}` : null,
    ]
      .filter(Boolean)
      .join(' / ');
  });
  const structuredSections = record.structured_sections.filter((section) => section.body?.trim());
  const actionRows =
    record.action_items.length > 0
      ? record.action_items.map((item) => [
          item.title ?? '—',
          item.assignee ?? '—',
          item.converted_task_id ? 'タスク化済み' : '未処理',
        ])
      : [['記録なし', '', '']];
  const metadataRows = flattenPdfJson(record.metadata);

  return (
    <>
      <Section title="基本情報">
        <KeyValueCards
          rows={[
            {
              label: '会議種別',
              value: CONFERENCE_NOTE_TYPE_LABELS[record.note_type] ?? record.note_type,
            },
            { label: '開催日時', value: formatPdfDate(record.conference_date, true) },
            { label: 'タイトル', value: record.title },
            { label: '患者名', value: record.patient?.name ?? '未紐付け' },
            ...patientArchiveRows(record.patient?.archive),
            { label: '施設', value: record.facility_name ?? '—' },
            { label: 'ユニット', value: record.unit_name ?? '—' },
          ]}
        />
      </Section>

      <Section title="参加者">
        <BulletList items={participantItems} />
      </Section>

      {structuredSections.length > 0 ? (
        <Section title="構造化項目">
          <BulletList
            items={structuredSections.map(
              (section) => `${section.label}: ${section.body?.trim() ?? '—'}`,
            )}
          />
        </Section>
      ) : null}

      <Section title="議事内容">
        <Text style={styles.paragraph}>{record.content || '記録なし'}</Text>
      </Section>

      <Section title="アクションアイテム">
        <Table headers={['内容', '担当', '状態']} widths={[56, 22, 22]} rows={actionRows} />
      </Section>

      {metadataRows.length > 0 ? (
        <Section title="連携メタデータ">
          <Table
            headers={['項目', '値']}
            widths={[36, 64]}
            compact
            rows={metadataRows.map((row) => [row.label, row.value])}
          />
        </Section>
      ) : null}
    </>
  );
}

function formatPdfCurrency(value: number | null | undefined) {
  return formatYen(value);
}

function formatPdfBillingMonth(value: Date) {
  return `${value.getFullYear()}年${String(value.getMonth() + 1).padStart(2, '0')}月`;
}

function renderBillingDocumentContent(record: BillingDocumentRecord) {
  const documentLabel = BILLING_DOCUMENT_KIND_LABELS[record.kind];
  const collection = record.collection;
  const patientOrTarget = record.patient?.name ?? record.billing_target_name ?? '未紐付け';
  const documentNumber =
    record.kind === 'receipt'
      ? (collection.receipt_number ?? '—')
      : `INV-${record.billing_month.getFullYear()}${String(
          record.billing_month.getMonth() + 1,
        ).padStart(2, '0')}-${record.id.slice(-6)}`;
  const paidAmount =
    record.kind === 'receipt' ? collection.collected_amount : collection.billed_amount;

  return (
    <>
      <Section title={`${documentLabel}情報`}>
        <KeyValueCards
          rows={[
            { label: `${documentLabel}番号`, value: documentNumber },
            { label: '対象月', value: formatPdfBillingMonth(record.billing_month) },
            { label: '患者/請求先', value: patientOrTarget },
            { label: '支払者', value: collection.payer_name ?? patientOrTarget },
            {
              label: '発行日',
              value: formatPdfDate(collection.collected_at ?? collection.updated_at, true),
            },
            {
              label: '支払方法',
              value: collection.payment_method
                ? (BILLING_PAYMENT_METHOD_LABELS[collection.payment_method] ??
                  collection.payment_method)
                : '—',
            },
          ]}
        />
      </Section>

      <Section title="金額">
        <Table
          headers={['項目', '請求額', '入金額', '未収額']}
          widths={[40, 20, 20, 20]}
          rows={[
            [
              record.billing_name,
              formatPdfCurrency(collection.billed_amount),
              formatPdfCurrency(collection.collected_amount),
              formatPdfCurrency(collection.unpaid_amount),
            ],
            [
              `${documentLabel}対象額`,
              record.kind === 'invoice' ? formatPdfCurrency(paidAmount) : '—',
              record.kind === 'receipt' ? formatPdfCurrency(paidAmount) : '—',
              '—',
            ],
          ]}
        />
      </Section>

      <Section title="請求根拠">
        <KeyValueCards
          rows={[
            { label: '請求コード', value: record.billing_code },
            { label: '請求領域', value: record.billing_domain },
            {
              label: '集金状態',
              value: collection.status
                ? (BILLING_COLLECTION_STATUS_LABELS[collection.status] ?? collection.status)
                : '—',
            },
            { label: '請求候補ID', value: record.id },
          ]}
        />
      </Section>

      <Section title="控え">
        <Text style={styles.paragraph}>
          この{documentLabel}
          はPH-OSの請求候補と集金記録から出力されています。紙控えまたはPDF控えとして保存する場合は、患者詳細の請求・集金履歴から同じ請求候補IDを確認してください。
        </Text>
      </Section>
    </>
  );
}

export async function buildCareReportPdf(
  orgId: string,
  reportId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult & { reportUpdatedAt: Date }> {
  const [branding, report] = await Promise.all([
    getPdfBranding(orgId),
    getCareReportRecord(orgId, reportId, accessContext),
  ]);
  if (report.status !== 'confirmed') {
    throw new Error('CARE_REPORT_NOT_CONFIRMED');
  }
  const fileName = sanitizePdfFileName(`care-report-${report.id}.pdf`);

  const rendered = await renderPdf(
    <PdfShell
      title="訪問薬剤管理指導報告書"
      subtitle={`${report.patient.name} / ${report.report_type}`}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderCareReportContent(report)}
    </PdfShell>,
    fileName,
  );
  return { ...rendered, reportUpdatedAt: report.updated_at };
}

export async function buildBillingDocumentPdf(
  orgId: string,
  candidateId: string,
  kind: BillingDocumentKind,
): Promise<PdfRenderResult> {
  const [branding, record] = await Promise.all([
    getPdfBranding(orgId),
    getBillingDocumentRecord(orgId, candidateId, kind),
  ]);
  const documentLabel = BILLING_DOCUMENT_KIND_LABELS[kind];
  const fileName = sanitizePdfFileName(
    `billing-${kind}-${record.patient?.name ?? record.billing_target_name ?? 'target'}-${record.id}.pdf`,
  );

  return renderPdf(
    <PdfShell
      title={documentLabel}
      subtitle={`${record.patient?.name ?? record.billing_target_name ?? '請求先未設定'} / ${formatPdfBillingMonth(
        record.billing_month,
      )}`}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderBillingDocumentContent(record)}
    </PdfShell>,
    fileName,
  );
}

export async function buildConferenceNotePdf(
  orgId: string,
  noteId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const [branding, note] = await Promise.all([
    getPdfBranding(orgId),
    getConferenceNoteRecord(orgId, noteId, accessContext),
  ]);
  const subject = note.patient?.name ?? note.title;
  const fileName = sanitizePdfFileName(`conference-note-${subject}-${note.id}.pdf`);

  return renderPdf(
    <PdfShell
      title={CONFERENCE_NOTE_TYPE_LABELS[note.note_type] ?? 'カンファレンス記録'}
      subtitle={note.patient ? `${note.patient.name} / ${note.title}` : note.title}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderConferenceNoteContent(note)}
    </PdfShell>,
    fileName,
  );
}

export async function buildManagementPlanPdf(
  orgId: string,
  planId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const [branding, plan] = await Promise.all([
    getPdfBranding(orgId),
    getManagementPlanRecord(orgId, planId, accessContext),
  ]);
  const fileName = sanitizePdfFileName(`management-plan-${plan.patient.name}-${plan.id}.pdf`);

  return renderPdf(
    <PdfShell
      title="訪問薬剤管理指導計画書"
      subtitle={plan.patient.name}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderManagementPlanContent(plan)}
    </PdfShell>,
    fileName,
  );
}

export async function buildMedicationHistoryPdf(
  orgId: string,
  patientId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const [branding, record] = await Promise.all([
    getPdfBranding(orgId),
    getMedicationHistoryRecord(orgId, patientId, accessContext),
  ]);
  const fileName = sanitizePdfFileName(
    `medications-${record.patient.name}-${record.patient.id}.pdf`,
  );

  return renderPdf(
    <PdfShell
      title="薬歴・服薬一覧"
      subtitle={record.patient.name}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderMedicationHistoryContent(record)}
    </PdfShell>,
    fileName,
  );
}

export async function buildVisitRecordPdf(
  orgId: string,
  recordId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const [branding, record] = await Promise.all([
    getPdfBranding(orgId),
    getVisitRecordEntry(orgId, recordId, accessContext),
  ]);
  const fileName = sanitizePdfFileName(
    `visit-record-${record.patient.name}-${formatPdfDate(record.visit_date).replaceAll('/', '')}-${record.id}.pdf`,
  );

  return renderPdf(
    <PdfShell
      title="訪問記録（薬歴）"
      subtitle={`${record.patient.name} / ${formatPdfDate(record.visit_date)}`}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderVisitRecordEntryContent(record)}
    </PdfShell>,
    fileName,
  );
}

export async function buildPatientVisitRecordsPdf(
  orgId: string,
  patientId: string,
  dateFrom?: string | null,
  dateTo?: string | null,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const normalizedDateFrom =
    dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom) ? new Date(`${dateFrom}T00:00:00.000Z`) : null;
  const normalizedDateTo =
    dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo) ? new Date(`${dateTo}T23:59:59.999Z`) : null;

  const [branding, record] = await Promise.all([
    getPdfBranding(orgId),
    getPatientVisitRecordRecord(
      orgId,
      patientId,
      normalizedDateFrom,
      normalizedDateTo,
      accessContext,
    ),
  ]);
  const fileName = sanitizePdfFileName(
    `visit-records-${record.patient.name}-${record.patient.id}${
      dateFrom || dateTo ? `-${dateFrom ?? 'start'}-${dateTo ?? 'end'}` : ''
    }.pdf`,
  );

  return renderPdf(
    <PdfShell
      title="訪問記録一覧（薬歴）"
      subtitle={record.patient.name}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderPatientVisitRecordsContent(record)}
    </PdfShell>,
    fileName,
  );
}

export async function buildMedicationCalendarPdf(
  orgId: string,
  patientId: string,
  month?: string | null,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const parsedMonth =
    month && /^\d{4}-\d{2}$/.test(month) ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const currentMonth = new Date(parsedMonth.getFullYear(), parsedMonth.getMonth(), 1);

  const [branding, record] = await Promise.all([
    getPdfBranding(orgId),
    getMedicationHistoryRecord(orgId, patientId, accessContext),
  ]);
  const fileName = sanitizePdfFileName(
    `medication-calendar-${record.patient.name}-${currentMonth.getFullYear()}-${String(
      currentMonth.getMonth() + 1,
    ).padStart(2, '0')}.pdf`,
  );

  return renderPdf(
    <PdfShell
      title="服薬カレンダー"
      subtitle={`${record.patient.name} / ${currentMonth.getFullYear()}年${currentMonth.getMonth() + 1}月`}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
      orientation="landscape"
    >
      {renderMedicationCalendarContent({
        ...record,
        month: currentMonth,
      })}
    </PdfShell>,
    fileName,
  );
}

export async function buildTracingReportPdf(
  orgId: string,
  reportId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const [branding, report] = await Promise.all([
    getPdfBranding(orgId),
    getTracingReportRecord(orgId, reportId, accessContext),
  ]);
  const fileName = sanitizePdfFileName(`tracing-report-${report.patient.name}-${report.id}.pdf`);

  return renderPdf(
    <PdfShell
      title="トレーシングレポート"
      subtitle={report.patient.name}
      pharmacyName={branding.pharmacyName}
      generatedAt={new Date()}
    >
      {renderTracingReportContent(report)}
    </PdfShell>,
    fileName,
  );
}
