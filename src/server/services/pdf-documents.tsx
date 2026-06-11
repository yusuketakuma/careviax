import fs from 'node:fs';
import path from 'node:path';
import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  type DocumentProps,
  renderToBuffer,
} from '@react-pdf/renderer';
import { prisma } from '@/lib/db/client';
import { PdfNotFoundError } from './pdf-errors';
import type {
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
import {
  applyPatientAssignmentWhere,
  buildCareCaseAssignmentWhere,
  canBypassVisitScheduleAssignmentAccess,
  buildVisitRecordScheduleAssignmentWhere,
  type VisitScheduleAccessContext,
} from '@/lib/auth/visit-schedule-access';
import { canAccessCaseScopedPatientResource } from '@/server/services/patient-access';
import {
  flattenPdfJson,
  readPdfJsonArrayField,
  readPdfJsonObject,
  readPdfJsonObjectField,
  readPdfJsonObjects,
} from '@/server/services/pdf-document-json';
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

type PdfRenderResult = {
  buffer: Buffer;
  fileName: string;
};

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

type CareReportRecord = {
  id: string;
  report_type: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  content: Record<string, unknown>;
  patient: {
    id: string;
    name: string;
    birth_date: Date;
    gender: string;
  };
};

type ConferenceNoteParticipant = {
  name?: string;
  role?: string;
  attended?: boolean;
  is_report_recipient?: boolean;
  email?: string;
  fax?: string;
};

type ConferenceNoteActionItem = {
  title?: string;
  assignee?: string;
  converted_task_id?: string;
  converted_at?: string;
};

type ConferenceNoteStructuredSection = {
  key: string;
  label: string;
  body?: string;
};

type ConferenceNotePdfRecord = {
  id: string;
  note_type: string;
  title: string;
  content: string;
  conference_date: Date;
  participants: ConferenceNoteParticipant[];
  structured_sections: ConferenceNoteStructuredSection[];
  action_items: ConferenceNoteActionItem[];
  metadata: Record<string, unknown>;
  patient: {
    id: string;
    name: string;
    birth_date: Date;
    gender: string;
  } | null;
  facility_name: string | null;
  unit_name: string | null;
};

type MedicationCalendarRecord = MedicationHistoryRecord & {
  month: Date;
};

type VisitRecordResidualRow = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  prescribed_quantity: number | null;
  remaining_quantity: number;
  excess_days: number | null;
  is_prohibited_reduction: boolean;
  is_reduction_target: boolean;
};

type VisitRecordPdfEntry = {
  id: string;
  visit_date: Date;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  receipt_person_name: string | null;
  receipt_person_relation: string | null;
  receipt_at: Date | null;
  next_visit_suggestion_date: Date | null;
  cancellation_reason: string | null;
  postpone_reason: string | null;
  revisit_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  pharmacist_id: string;
  pharmacist_name: string | null;
  last_modified_by_id: string | null;
  last_modified_by_name: string | null;
  schedule: {
    visit_type: string;
    scheduled_date: Date;
  } | null;
  patient: {
    id: string;
    name: string;
    birth_date: Date;
    gender: string;
  };
  residuals: VisitRecordResidualRow[];
};

type PatientVisitRecordPdfRecord = {
  patient: VisitRecordPdfEntry['patient'];
  dateFrom: Date | null;
  dateTo: Date | null;
  records: VisitRecordPdfEntry[];
};

let fontRegistered = false;

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

function ensurePdfFontRegistered() {
  if (fontRegistered) return;

  const fontPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.otf');
  if (!fs.existsSync(fontPath)) {
    throw new Error('PDF 用フォントを初期化できませんでした');
  }

  Font.register({
    family: 'NotoSansJP',
    src: fontPath,
  });
  fontRegistered = true;
}

function formatDate(value?: Date | string | null, includeTime = false) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const datePart = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(
    date.getDate(),
  ).padStart(2, '0')}`;
  if (!includeTime) return datePart;

  return `${datePart} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}

function sanitizeFileName(value: string) {
  return (
    value
      .trim()
      .replaceAll(/[^A-Za-z0-9._-]/g, '_')
      .replaceAll(/_+/g, '_')
      .replaceAll(/^_+|_+$/g, '') || 'document'
  );
}

function inferPharmacyName(orgName?: string | null, siteName?: string | null) {
  return siteName?.trim() || orgName?.trim() || 'PH-OS薬局';
}

function parseConferenceParticipants(raw: unknown): ConferenceNoteParticipant[] {
  return readPdfJsonObjects(raw).map((item) => ({
    name: typeof item.name === 'string' ? item.name : undefined,
    role: typeof item.role === 'string' ? item.role : undefined,
    attended: typeof item.attended === 'boolean' ? item.attended : undefined,
    is_report_recipient:
      typeof item.is_report_recipient === 'boolean' ? item.is_report_recipient : undefined,
    email: typeof item.email === 'string' ? item.email : undefined,
    fax: typeof item.fax === 'string' ? item.fax : undefined,
  }));
}

function parseConferenceActionItems(raw: unknown): ConferenceNoteActionItem[] {
  return readPdfJsonObjects(raw).map((item) => ({
    title: typeof item.title === 'string' ? item.title : undefined,
    assignee: typeof item.assignee === 'string' ? item.assignee : undefined,
    converted_task_id:
      typeof item.converted_task_id === 'string' ? item.converted_task_id : undefined,
    converted_at: typeof item.converted_at === 'string' ? item.converted_at : undefined,
  }));
}

function parseConferenceStructuredSections(raw: unknown): ConferenceNoteStructuredSection[] {
  return readPdfJsonObjects(readPdfJsonArrayField(raw, 'sections')).flatMap((item) => {
    if (typeof item.key !== 'string' || typeof item.label !== 'string') return [];
    return [
      {
        key: item.key,
        label: item.label,
        body: typeof item.body === 'string' ? item.body : undefined,
      },
    ];
  });
}

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
            出力日時: {formatDate(generatedAt, true)}
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

function isPhysicianReportContent(value: unknown): value is PhysicianReportContent {
  const object = readPdfJsonObject(value);
  const patient = readPdfJsonObject(object.patient);
  const prescriber = readPdfJsonObject(object.prescriber);
  const medicationManagement = readPdfJsonObject(object.medication_management);

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
    typeof object.assessment === 'string' &&
    typeof object.plan === 'string' &&
    isOptionalString(object.prescription_proposals) &&
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

function renderCareReportContent(report: CareReportRecord) {
  const billingContext = readPdfJsonObjectField(report.content, 'billing_context');
  if (report.report_type === 'physician_report') {
    const content = readPdfJsonObject(report.content);
    if (isPhysicianReportContent(content)) {
      return (
        <>
          <Section title="基本情報">
            <KeyValueCards
              rows={[
                { label: '患者名', value: content.patient.name },
                { label: '生年月日', value: content.patient.birth_date },
                { label: '性別', value: content.patient.gender },
                { label: '訪問日', value: content.visit_date },
                { label: '報告日', value: content.report_date },
                { label: '担当薬剤師', value: content.pharmacist_name },
                { label: '主治医', value: content.prescriber.name },
                { label: '所属', value: content.prescriber.institution },
              ]}
            />
          </Section>
          {billingContext ? (
            <Section title="請求コンテキスト">
              <KeyValueCards
                rows={[
                  {
                    label: '保険種別',
                    value:
                      typeof billingContext.payer_basis === 'string'
                        ? billingContext.payer_basis
                        : '—',
                  },
                  {
                    label: '適用改定',
                    value:
                      typeof billingContext.effective_revision_code === 'string'
                        ? billingContext.effective_revision_code
                        : '—',
                  },
                  {
                    label: '薬局設定',
                    value:
                      typeof billingContext.site_config_status === 'string'
                        ? billingContext.site_config_status
                        : '—',
                  },
                  {
                    label: 'JAHIS補足',
                    value:
                      typeof billingContext.jahis_supplemental_record_count === 'number'
                        ? `${billingContext.jahis_supplemental_record_count}件`
                        : '—',
                  },
                  {
                    label: 'JAHIS残薬確認',
                    value:
                      typeof billingContext.jahis_residual_confirmation_count === 'number'
                        ? `${billingContext.jahis_residual_confirmation_count}件`
                        : '—',
                  },
                ]}
              />
            </Section>
          ) : null}
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

          <Section title="薬学的評価と対応">
            <Text style={styles.paragraph}>{content.assessment}</Text>
            <Text style={[styles.paragraph, { marginTop: 6 }]}>{content.plan}</Text>
            {content.prescription_proposals ? (
              <Text style={[styles.paragraph, { marginTop: 6 }]}>
                処方提案: {content.prescription_proposals}
              </Text>
            ) : null}
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
                { label: '報告日', value: content.report_date },
                { label: '訪問日', value: content.visit_date },
                { label: '担当薬剤師', value: content.pharmacist_name },
                { label: 'ケアマネ', value: content.care_manager.name },
                { label: '所属', value: content.care_manager.organization },
              ]}
            />
          </Section>
          {billingContext ? (
            <Section title="請求コンテキスト">
              <KeyValueCards
                rows={[
                  {
                    label: '保険種別',
                    value:
                      typeof billingContext.payer_basis === 'string'
                        ? billingContext.payer_basis
                        : '—',
                  },
                  {
                    label: '適用改定',
                    value:
                      typeof billingContext.effective_revision_code === 'string'
                        ? billingContext.effective_revision_code
                        : '—',
                  },
                  {
                    label: '薬局設定',
                    value:
                      typeof billingContext.site_config_status === 'string'
                        ? billingContext.site_config_status
                        : '—',
                  },
                  {
                    label: 'JAHIS補足',
                    value:
                      typeof billingContext.jahis_supplemental_record_count === 'number'
                        ? `${billingContext.jahis_supplemental_record_count}件`
                        : '—',
                  },
                  {
                    label: 'JAHIS残薬確認',
                    value:
                      typeof billingContext.jahis_residual_confirmation_count === 'number'
                        ? `${billingContext.jahis_residual_confirmation_count}件`
                        : '—',
                  },
                ]}
              />
            </Section>
          ) : null}
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

  return (
    <Section title="内容">
      <BulletList
        items={flattenPdfJson(report.content).map((row) => `${row.label}: ${row.value}`)}
      />
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
            { label: '生年月日', value: formatDate(plan.patient.birth_date) },
            { label: '性別', value: plan.patient.gender },
            { label: '版数', value: `v${plan.version}` },
            { label: '状態', value: plan.status },
            { label: '適用開始日', value: formatDate(plan.effective_from) },
            { label: '次回見直し日', value: formatDate(plan.next_review_date) },
            { label: '承認日', value: formatDate(plan.approved_at) },
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
            { label: '生年月日', value: formatDate(record.patient.birth_date) },
            { label: '性別', value: record.patient.gender },
            { label: '患者ID', value: record.patient.id },
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
            formatDate(item.start_date),
            formatDate(item.end_date),
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
            { label: '生年月日', value: formatDate(record.patient.birth_date) },
            { label: '性別', value: record.patient.gender },
          ]}
        />
      </Section>

      <Section title="訪問情報">
        <KeyValueCards
          rows={[
            { label: '訪問日', value: formatDate(record.visit_date) },
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
              value: formatDate(record.updated_at, true),
            },
            { label: '作成日時', value: formatDate(record.created_at, true) },
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
            `受領日時: ${formatDate(record.receipt_at, true)}`,
            `次回訪問提案日: ${formatDate(record.next_visit_suggestion_date)}`,
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
            { label: '生年月日', value: formatDate(record.patient.birth_date) },
            { label: '性別', value: record.patient.gender },
            {
              label: '期間',
              value:
                record.dateFrom || record.dateTo
                  ? `${formatDate(record.dateFrom)} - ${formatDate(record.dateTo)}`
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
            formatDate(item.visit_date),
            item.schedule
              ? (VISIT_TYPE_LABELS[item.schedule.visit_type] ?? item.schedule.visit_type)
              : '—',
            VISIT_OUTCOME_LABELS[item.outcome_status] ?? item.outcome_status,
            formatDate(item.next_visit_suggestion_date),
            formatDate(item.updated_at, true),
            item.last_modified_by_name ?? item.pharmacist_name ?? item.pharmacist_id,
          ])}
        />
      </Section>

      {record.records.map((item, index) => (
        <Section
          key={item.id}
          title={`${index + 1}. ${formatDate(item.visit_date)} / ${
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
            { label: '生年月日', value: formatDate(report.patient.birth_date) },
            { label: '性別', value: report.patient.gender },
            { label: '送付先医師', value: report.sent_to_physician ?? '—' },
            { label: '状態', value: report.status },
            { label: '送付日時', value: formatDate(report.sent_at, true) },
            { label: '受領確認', value: formatDate(report.acknowledged_at, true) },
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
            { label: '開催日時', value: formatDate(record.conference_date, true) },
            { label: 'タイトル', value: record.title },
            { label: '患者名', value: record.patient?.name ?? '未紐付け' },
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

async function renderPdf(document: React.ReactElement, fileName: string) {
  ensurePdfFontRegistered();
  const buffer = await renderToBuffer(document as React.ReactElement<DocumentProps>);
  return { buffer, fileName };
}

async function getPdfBranding(orgId: string) {
  const [org, site] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    }),
    prisma.pharmacySite.findFirst({
      where: { org_id: orgId },
      orderBy: { created_at: 'asc' },
      select: { name: true },
    }),
  ]);

  return {
    pharmacyName: inferPharmacyName(org?.name, site?.name),
  };
}

async function getCareReportRecord(
  orgId: string,
  reportId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<CareReportRecord> {
  const report = await prisma.careReport.findFirst({
    where: { id: reportId, org_id: orgId },
    select: {
      id: true,
      patient_id: true,
      case_id: true,
      visit_record_id: true,
      report_type: true,
      status: true,
      content: true,
      created_at: true,
      updated_at: true,
    },
  });

  if (!report) {
    throw new PdfNotFoundError('careReport');
  }

  if (accessContext) {
    const visitRecordWhere = report.visit_record_id
      ? buildVisitRecordScheduleAssignmentWhere(accessContext)
      : null;
    const allowedByVisitRecord = report.visit_record_id
      ? await prisma.visitRecord.findFirst({
          where: {
            id: report.visit_record_id,
            org_id: orgId,
            patient_id: report.patient_id,
            ...(visitRecordWhere ? { AND: [visitRecordWhere] } : {}),
            schedule: {
              ...(report.case_id ? { case_id: report.case_id } : {}),
              case_: {
                patient_id: report.patient_id,
              },
            },
          },
          select: { id: true },
        })
      : null;

    if (report.visit_record_id && !allowedByVisitRecord) {
      throw new PdfNotFoundError('careReport');
    }

    if (
      !report.visit_record_id &&
      !(await canAccessCaseScopedPatientResource({
        db: prisma,
        orgId,
        patientId: report.patient_id,
        caseId: report.case_id,
        accessContext,
      }))
    ) {
      throw new PdfNotFoundError('careReport');
    }
  }

  const patient = await prisma.patient.findFirst({
    where: { id: report.patient_id, org_id: orgId },
    select: {
      id: true,
      name: true,
      birth_date: true,
      gender: true,
    },
  });

  if (!patient) {
    throw new PdfNotFoundError('patient');
  }

  return {
    ...report,
    content: readPdfJsonObject(report.content),
    patient,
  };
}

async function getVisitRecordEntries(
  orgId: string,
  where: { id?: string; patientId?: string; dateFrom?: Date | null; dateTo?: Date | null },
  accessContext?: VisitScheduleAccessContext,
): Promise<VisitRecordPdfEntry[]> {
  const assignmentWhere = accessContext
    ? buildVisitRecordScheduleAssignmentWhere(accessContext)
    : null;

  const records = await prisma.visitRecord.findMany({
    where: {
      org_id: orgId,
      ...(where.id ? { id: where.id } : {}),
      ...(where.patientId ? { patient_id: where.patientId } : {}),
      ...(where.dateFrom || where.dateTo
        ? {
            visit_date: {
              ...(where.dateFrom ? { gte: where.dateFrom } : {}),
              ...(where.dateTo ? { lte: where.dateTo } : {}),
            },
          }
        : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    },
    orderBy: [{ visit_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      patient_id: true,
      pharmacist_id: true,
      visit_date: true,
      outcome_status: true,
      soap_subjective: true,
      soap_objective: true,
      soap_assessment: true,
      soap_plan: true,
      receipt_person_name: true,
      receipt_person_relation: true,
      receipt_at: true,
      next_visit_suggestion_date: true,
      cancellation_reason: true,
      postpone_reason: true,
      revisit_reason: true,
      version: true,
      created_at: true,
      updated_at: true,
      schedule: {
        select: {
          case_id: true,
          visit_type: true,
          scheduled_date: true,
          case_: {
            select: {
              patient_id: true,
            },
          },
        },
      },
    },
  });

  const scopedRecords = records.filter(
    (record) => record.schedule.case_.patient_id === record.patient_id,
  );

  if (scopedRecords.length === 0) {
    throw new PdfNotFoundError('visitRecord');
  }

  const patientIds = Array.from(new Set(scopedRecords.map((record) => record.patient_id)));
  const recordIds = scopedRecords.map((record) => record.id);

  const [patients, residuals, auditLogs] = await Promise.all([
    prisma.patient.findMany({
      where: {
        org_id: orgId,
        id: { in: patientIds },
      },
      select: {
        id: true,
        name: true,
        birth_date: true,
        gender: true,
      },
    }),
    prisma.residualMedication.findMany({
      where: {
        org_id: orgId,
        visit_record_id: { in: recordIds },
      },
      orderBy: [{ created_at: 'asc' }],
      select: {
        id: true,
        visit_record_id: true,
        drug_name: true,
        drug_code: true,
        prescribed_quantity: true,
        remaining_quantity: true,
        excess_days: true,
        is_prohibited_reduction: true,
        is_reduction_target: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        org_id: orgId,
        target_type: 'visit_record',
        target_id: { in: recordIds },
      },
      orderBy: [{ created_at: 'desc' }],
      select: {
        target_id: true,
        actor_id: true,
        created_at: true,
      },
    }),
  ]);

  const patientById = new Map(patients.map((patient) => [patient.id, patient]));
  const latestAuditByRecordId = new Map<string, { actor_id: string; created_at: Date }>();
  const userIds = new Set(records.map((record) => record.pharmacist_id));

  for (const audit of auditLogs) {
    if (!latestAuditByRecordId.has(audit.target_id)) {
      latestAuditByRecordId.set(audit.target_id, {
        actor_id: audit.actor_id,
        created_at: audit.created_at,
      });
      userIds.add(audit.actor_id);
    }
  }

  const users = await prisma.user.findMany({
    where: {
      org_id: orgId,
      id: { in: Array.from(userIds) },
    },
    select: {
      id: true,
      name: true,
    },
  });

  const userById = new Map(users.map((user) => [user.id, user.name]));
  const residualsByRecordId = new Map<string, VisitRecordResidualRow[]>();
  for (const residual of residuals) {
    const bucket = residualsByRecordId.get(residual.visit_record_id) ?? [];
    bucket.push({
      id: residual.id,
      drug_name: residual.drug_name,
      drug_code: residual.drug_code,
      prescribed_quantity: residual.prescribed_quantity,
      remaining_quantity: residual.remaining_quantity,
      excess_days: residual.excess_days,
      is_prohibited_reduction: residual.is_prohibited_reduction,
      is_reduction_target: residual.is_reduction_target,
    });
    residualsByRecordId.set(residual.visit_record_id, bucket);
  }

  return scopedRecords.map((record) => {
    const patient = patientById.get(record.patient_id);
    if (!patient) {
      throw new PdfNotFoundError('patient');
    }

    const latestAudit = latestAuditByRecordId.get(record.id);
    return {
      id: record.id,
      visit_date: record.visit_date,
      outcome_status: record.outcome_status,
      soap_subjective: record.soap_subjective,
      soap_objective: record.soap_objective,
      soap_assessment: record.soap_assessment,
      soap_plan: record.soap_plan,
      receipt_person_name: record.receipt_person_name,
      receipt_person_relation: record.receipt_person_relation,
      receipt_at: record.receipt_at,
      next_visit_suggestion_date: record.next_visit_suggestion_date,
      cancellation_reason: record.cancellation_reason,
      postpone_reason: record.postpone_reason,
      revisit_reason: record.revisit_reason,
      version: record.version,
      created_at: record.created_at,
      updated_at: record.updated_at,
      pharmacist_id: record.pharmacist_id,
      pharmacist_name: userById.get(record.pharmacist_id) ?? null,
      last_modified_by_id: latestAudit?.actor_id ?? record.pharmacist_id,
      last_modified_by_name:
        (latestAudit ? userById.get(latestAudit.actor_id) : null) ??
        userById.get(record.pharmacist_id) ??
        null,
      schedule: record.schedule,
      patient,
      residuals: residualsByRecordId.get(record.id) ?? [],
    };
  });
}

async function getVisitRecordEntry(
  orgId: string,
  recordId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<VisitRecordPdfEntry> {
  const entries = await getVisitRecordEntries(orgId, { id: recordId }, accessContext);
  const entry = entries[0];
  if (!entry) {
    throw new PdfNotFoundError('visitRecord');
  }
  return entry;
}

async function getPatientVisitRecordRecord(
  orgId: string,
  patientId: string,
  dateFrom?: Date | null,
  dateTo?: Date | null,
  accessContext?: VisitScheduleAccessContext,
): Promise<PatientVisitRecordPdfRecord> {
  const [patient, records] = await Promise.all([
    prisma.patient.findFirst({
      where: accessContext
        ? applyPatientAssignmentWhere({ id: patientId, org_id: orgId }, accessContext)
        : { id: patientId, org_id: orgId },
      select: {
        id: true,
        name: true,
        birth_date: true,
        gender: true,
      },
    }),
    getVisitRecordEntries(orgId, { patientId, dateFrom, dateTo }, accessContext),
  ]);

  if (!patient) {
    throw new PdfNotFoundError('patient');
  }

  return {
    patient,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    records,
  };
}

async function getConferenceNoteRecord(
  orgId: string,
  noteId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<ConferenceNotePdfRecord> {
  const note = await prisma.conferenceNote.findFirst({
    where: { id: noteId, org_id: orgId },
    select: {
      id: true,
      case_id: true,
      patient_id: true,
      note_type: true,
      title: true,
      content: true,
      structured_content: true,
      metadata: true,
      participants: true,
      conference_date: true,
      action_items: true,
    },
  });

  if (!note) {
    throw new PdfNotFoundError('conferenceNote');
  }

  if (
    accessContext &&
    !canBypassVisitScheduleAssignmentAccess(accessContext) &&
    !note.case_id &&
    !note.patient_id
  ) {
    throw new PdfNotFoundError('conferenceNote');
  }

  if (accessContext && note.patient_id) {
    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere({ id: note.patient_id, org_id: orgId }, accessContext),
      select: { id: true },
    });
    if (!patient) {
      throw new PdfNotFoundError('conferenceNote');
    }
  }

  const careCase = note.case_id
    ? await prisma.careCase.findFirst({
        where: {
          id: note.case_id,
          org_id: orgId,
          ...(accessContext && buildCareCaseAssignmentWhere(accessContext)
            ? { AND: [buildCareCaseAssignmentWhere(accessContext)!] }
            : {}),
        },
        select: {
          patient: {
            select: {
              id: true,
              name: true,
              birth_date: true,
              gender: true,
              residences: {
                where: { is_primary: true },
                take: 1,
                select: {
                  unit_name: true,
                  facility: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
    : null;

  if (note.case_id && !careCase) {
    throw new PdfNotFoundError('conferenceNote');
  }

  return {
    id: note.id,
    note_type: note.note_type,
    title: note.title,
    content: note.content,
    conference_date: note.conference_date,
    participants: parseConferenceParticipants(note.participants),
    structured_sections: parseConferenceStructuredSections(note.structured_content),
    action_items: parseConferenceActionItems(note.action_items),
    metadata: readPdfJsonObject(note.metadata),
    patient: careCase?.patient ?? null,
    facility_name: careCase?.patient.residences[0]?.facility?.name ?? null,
    unit_name: careCase?.patient.residences[0]?.unit_name ?? null,
  };
}

export async function buildCareReportPdf(
  orgId: string,
  reportId: string,
  accessContext?: VisitScheduleAccessContext,
): Promise<PdfRenderResult> {
  const [branding, report] = await Promise.all([
    getPdfBranding(orgId),
    getCareReportRecord(orgId, reportId, accessContext),
  ]);
  const fileName = sanitizeFileName(`care-report-${report.patient.name}-${report.id}.pdf`);

  return renderPdf(
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
  const fileName = sanitizeFileName(`conference-note-${subject}-${note.id}.pdf`);

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
  const fileName = sanitizeFileName(`management-plan-${plan.patient.name}-${plan.id}.pdf`);

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
  const fileName = sanitizeFileName(`medications-${record.patient.name}-${record.patient.id}.pdf`);

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
  const fileName = sanitizeFileName(
    `visit-record-${record.patient.name}-${formatDate(record.visit_date).replaceAll('/', '')}-${record.id}.pdf`,
  );

  return renderPdf(
    <PdfShell
      title="訪問記録（薬歴）"
      subtitle={`${record.patient.name} / ${formatDate(record.visit_date)}`}
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
  const fileName = sanitizeFileName(
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
  const fileName = sanitizeFileName(
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
  const fileName = sanitizeFileName(`tracing-report-${report.patient.name}-${report.id}.pdf`);

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
