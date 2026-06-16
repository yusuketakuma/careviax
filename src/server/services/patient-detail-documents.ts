import type { MemberRole, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { getPatientPrivacyFlags, maskContactValue, maskPhoneNumber } from '@/lib/patient/privacy';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';

type DbClient = typeof prisma | Prisma.TransactionClient;

type DetailArgs = {
  orgId: string;
  patientId: string;
  role: MemberRole;
  userId: string;
};

type FirstVisitDocumentContact = {
  id?: string;
  name: string;
  relation: string | null;
  phone: string | null;
  email: string | null;
  fax: string | null;
  organization_name: string | null;
  department: string | null;
  is_primary: boolean;
  is_emergency_contact: boolean;
};

type FirstVisitDocumentHistoryItem = {
  id: string;
  action: string;
  document_type: string | null;
  template_name: string | null;
  template_version: string | null;
  print_batch_id: string | null;
  storage_location: string | null;
  contract_date: string | null;
  explanation_date: string | null;
  explanation_staff_name: string | null;
  signer_type: string | null;
  signer_name: string | null;
  signer_relationship: string | null;
  reason: string | null;
  note: string | null;
  actor_id: string;
  created_at: Date;
};

type DocumentStatus = {
  document_type: string;
  label: string;
  status:
    | 'not_created'
    | 'created'
    | 'printed'
    | 'recovered'
    | 'image_saved'
    | 'replaced'
    | 'invalidated';
  status_label: string;
  template_name: string | null;
  template_version: string | null;
  storage_location: string | null;
  latest_action_at: Date | null;
  latest_document_id: string | null;
  has_file: boolean;
  delivered_at: Date | null;
  alerts: string[];
};

type PrintReadinessCheck = {
  key: string;
  label: string;
  completed: boolean;
  severity: 'required' | 'warning';
  description: string;
  action_href: string;
  action_label: string;
};

type DbClientWithAuditLog = DbClient & {
  auditLog?: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        actor_id: string;
        action: string;
        target_id: string;
        changes: Prisma.JsonValue | null;
        created_at: Date;
      }>
    >;
  };
};

const FIRST_VISIT_TEMPLATE_TYPES = [
  { document_type: 'contract', template_type: 'contract_document', label: '契約書' },
  {
    document_type: 'important_matters',
    template_type: 'important_matters',
    label: '重要事項説明書',
  },
  { document_type: 'privacy_consent', template_type: 'privacy_consent', label: '個人情報同意書' },
  { document_type: 'consent', template_type: 'consent_form', label: '同意書' },
] as const;

const DOCUMENT_STATUS_TYPES = [
  { document_type: 'contract', label: '契約書' },
  { document_type: 'important_matters', label: '重要事項説明書' },
  { document_type: 'privacy_consent', label: '個人情報同意書' },
  { document_type: 'consent', label: '同意書' },
] as const;

const DOCUMENT_STATUS_LABELS: Record<DocumentStatus['status'], string> = {
  not_created: '未作成',
  created: '作成済み',
  printed: '印刷済み',
  recovered: '回収済み',
  image_saved: '画像保存済み',
  replaced: '差替え済み',
  invalidated: '失効',
};

function buildPatientDocumentsWhere(args: DetailArgs): Prisma.PatientWhereInput {
  return applyPatientAssignmentWhere(
    {
      id: args.patientId,
      org_id: args.orgId,
    },
    {
      userId: args.userId,
      role: args.role,
    },
  );
}

function normalizeFirstVisitDocumentContacts(
  value: Prisma.JsonValue | null | undefined,
): FirstVisitDocumentContact[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    const record = readJsonObject(item);
    if (!record) return [];
    const name = typeof record.name === 'string' ? record.name : null;
    if (!name) return [];

    return [
      {
        id: typeof record.id === 'string' ? record.id : undefined,
        name,
        relation:
          typeof record.relation === 'string'
            ? record.relation
            : typeof record.relationship === 'string'
              ? record.relationship
              : null,
        phone: typeof record.phone === 'string' ? record.phone : null,
        email: typeof record.email === 'string' ? record.email : null,
        fax: typeof record.fax === 'string' ? record.fax : null,
        organization_name:
          typeof record.organization_name === 'string' ? record.organization_name : null,
        department: typeof record.department === 'string' ? record.department : null,
        is_primary: record.is_primary === true,
        is_emergency_contact: record.is_emergency_contact === true,
      },
    ];
  });
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeFirstVisitDocumentHistory(log: {
  id: string;
  actor_id: string;
  action: string;
  changes: Prisma.JsonValue | null;
  created_at: Date;
}): FirstVisitDocumentHistoryItem {
  const changes = readJsonObject(log.changes);
  const documentAction = readJsonObject(changes?.document_action);

  return {
    id: log.id,
    action: readString(documentAction?.action) ?? log.action.replace('first_visit_document.', ''),
    document_type: readString(documentAction?.document_type),
    template_name: readString(documentAction?.template_name),
    template_version: readString(documentAction?.template_version),
    print_batch_id: readString(documentAction?.print_batch_id),
    storage_location: readString(documentAction?.storage_location),
    contract_date: readString(documentAction?.contract_date),
    explanation_date: readString(documentAction?.explanation_date),
    explanation_staff_name: readString(documentAction?.explanation_staff_name),
    signer_type: readString(documentAction?.signer_type),
    signer_name: readString(documentAction?.signer_name),
    signer_relationship: readString(documentAction?.signer_relationship),
    reason: readString(documentAction?.reason),
    note: readString(documentAction?.note),
    actor_id: log.actor_id,
    created_at: log.created_at,
  };
}

function deriveFirstVisitDocumentStatuses(args: {
  documents: Array<{
    id: string;
    document_url: string | null;
    delivered_at: Date | null;
    created_at: Date;
  }>;
  historyByDocumentId: Map<string, FirstVisitDocumentHistoryItem[]>;
}): DocumentStatus[] {
  const allHistory = args.documents.flatMap((document) =>
    (args.historyByDocumentId.get(document.id) ?? []).map((history) => ({
      ...history,
      document_id: document.id,
      document_url: document.document_url,
      delivered_at: document.delivered_at,
      document_created_at: document.created_at,
    })),
  );

  return DOCUMENT_STATUS_TYPES.map(({ document_type: documentType, label }) => {
    const matchingHistory = allHistory
      .filter((history) => history.document_type === documentType)
      .sort((left, right) => right.created_at.getTime() - left.created_at.getTime());
    const latest = matchingHistory[0] ?? null;
    const latestDocument = latest
      ? (args.documents.find((document) => document.id === latest.document_id) ?? null)
      : null;
    const hasFile = Boolean(latest?.document_url ?? latestDocument?.document_url);
    const deliveredAt = latest?.delivered_at ?? latestDocument?.delivered_at ?? null;
    const status = latest
      ? latest.action === 'invalidated'
        ? 'invalidated'
        : latest.action === 'replaced'
          ? 'replaced'
          : hasFile && (latest.action === 'image_saved' || deliveredAt)
            ? 'image_saved'
            : latest.action === 'recovered' || deliveredAt
              ? 'recovered'
              : latest.action === 'printed'
                ? 'printed'
                : 'created'
      : 'not_created';
    const alerts = [
      ...(!latest ? [`${label}が未作成です`] : []),
      ...(latest && ['created', 'printed'].includes(status) && !deliveredAt
        ? [`${label}の回収が未記録です`]
        : []),
      ...(latest && status !== 'invalidated' && !hasFile ? [`${label}の画像/PDFが未保存です`] : []),
      ...(status === 'invalidated' ? [`${label}は失効中です`] : []),
    ];

    return {
      document_type: documentType,
      label,
      status,
      status_label: DOCUMENT_STATUS_LABELS[status],
      template_name: latest?.template_name ?? null,
      template_version: latest?.template_version ?? null,
      storage_location: latest?.storage_location ?? null,
      latest_action_at: latest?.created_at ?? null,
      latest_document_id: latest?.document_id ?? null,
      has_file: hasFile,
      delivered_at: deliveredAt,
      alerts,
    };
  });
}

function latestActiveTemplateByType(
  templates: Array<{
    id: string;
    template_type: string;
    name: string;
    version: number;
    effective_from: Date | null;
    effective_to: Date | null;
  }>,
) {
  const byType = new Map<string, (typeof templates)[number]>();
  for (const template of templates) {
    if (!byType.has(template.template_type)) {
      byType.set(template.template_type, template);
    }
  }
  return byType;
}

function buildPrintReadiness(args: {
  patient: {
    id: string;
    name: string | null;
    name_kana: string | null;
    birth_date?: Date | null;
    phone?: string | null;
    medical_insurance_number?: string | null;
    care_insurance_number?: string | null;
    residences?: Array<{
      address: string | null;
      facility_id: string | null;
      building_id: string | null;
      unit_name: string | null;
      is_primary?: boolean;
    }>;
    contacts?: Array<{
      name: string;
      phone: string | null;
      is_primary: boolean;
      is_emergency_contact: boolean;
    }>;
    insurances?: Array<{
      insurance_type: string;
      insurer_number: string | null;
      number: string | null;
      valid_until: Date | null;
    }>;
    cases?: Array<{
      id: string;
      status: string;
      start_date: Date | null;
      primary_pharmacist_id: string | null;
    }>;
  };
  templates: Array<{
    id: string;
    template_type: string;
    name: string;
    version: number;
    effective_from: Date | null;
    effective_to: Date | null;
  }>;
}) {
  const residences = args.patient.residences ?? [];
  const contacts = args.patient.contacts ?? [];
  const insurances = args.patient.insurances ?? [];
  const cases = args.patient.cases ?? [];
  const activeCase =
    cases.find((careCase) => careCase.status === 'active') ??
    cases.find((careCase) =>
      ['referral_received', 'assessment', 'on_hold'].includes(careCase.status),
    ) ??
    cases[0] ??
    null;
  const primaryResidence =
    residences.find((residence) => residence.is_primary) ?? residences[0] ?? null;
  const hasResidence = Boolean(
    primaryResidence?.address || primaryResidence?.facility_id || primaryResidence?.building_id,
  );
  const hasCareInsurance =
    Boolean(args.patient.care_insurance_number) ||
    insurances.some(
      (insurance) =>
        insurance.insurance_type === 'care' &&
        Boolean(insurance.insurer_number || insurance.number) &&
        (!insurance.valid_until || insurance.valid_until >= new Date()),
    );
  const hasContact =
    Boolean(args.patient.phone) || contacts.some((contact) => Boolean(contact.phone));
  const hasKeyPerson = contacts.some(
    (contact) => contact.is_primary || contact.is_emergency_contact,
  );
  const templatesByType = latestActiveTemplateByType(args.templates);
  const missingTemplateLabels = FIRST_VISIT_TEMPLATE_TYPES.filter(
    (item) => !templatesByType.has(item.template_type),
  ).map((item) => item.label);
  const checks: PrintReadinessCheck[] = [
    {
      key: 'patient_profile',
      label: '患者基本情報',
      completed: Boolean(args.patient.name && args.patient.name_kana && args.patient.birth_date),
      severity: 'required',
      description:
        args.patient.name && args.patient.name_kana && args.patient.birth_date
          ? '氏名、フリガナ、生年月日を差し込みできます。'
          : '氏名、フリガナ、生年月日を登録してください。',
      action_href: `/patients/${args.patient.id}/edit`,
      action_label: '基本情報を編集',
    },
    {
      key: 'primary_residence',
      label: '住所・訪問先',
      completed: hasResidence,
      severity: 'required',
      description: hasResidence
        ? '住所または施設情報を差し込みできます。'
        : '契約書へ転記する住所または施設情報を登録してください。',
      action_href: `/patients/${args.patient.id}/edit`,
      action_label: '住所を編集',
    },
    {
      key: 'contact_channel',
      label: '連絡先',
      completed: hasContact,
      severity: 'required',
      description: hasContact
        ? '患者または連絡先の電話番号を差し込みできます。'
        : '患者電話番号、または主連絡先の電話番号を登録してください。',
      action_href: `/patients/${args.patient.id}/edit`,
      action_label: '連絡先を編集',
    },
    {
      key: 'care_insurance',
      label: '介護保険情報',
      completed: hasCareInsurance,
      severity: 'required',
      description: hasCareInsurance
        ? '介護保険番号または有効な介護保険レコードがあります。'
        : '契約書・重要事項説明書へ転記する介護保険情報を登録してください。',
      action_href: `/patients/${args.patient.id}#patient-profile-summary`,
      action_label: '保険を確認',
    },
    {
      key: 'key_person',
      label: '署名者・家族候補',
      completed: hasKeyPerson,
      severity: 'warning',
      description: hasKeyPerson
        ? '主連絡先または緊急連絡先があり、代理人・家族署名候補を確認できます。'
        : '家族・代理人署名に備えて主連絡先または緊急連絡先を登録してください。',
      action_href: `/patients/${args.patient.id}#patient-profile-summary`,
      action_label: '連絡先を確認',
    },
    {
      key: 'service_start',
      label: 'サービス開始日',
      completed: Boolean(activeCase?.start_date),
      severity: 'warning',
      description: activeCase?.start_date
        ? '契約開始日としてケース開始日を参照できます。'
        : '契約開始日に使うケース開始日を登録してください。',
      action_href: `/patients/${args.patient.id}#patient-profile-summary`,
      action_label: 'ケースを確認',
    },
    {
      key: 'explainer',
      label: '説明担当者',
      completed: Boolean(activeCase?.primary_pharmacist_id),
      severity: 'warning',
      description: activeCase?.primary_pharmacist_id
        ? '説明担当者候補として主担当薬剤師を参照できます。'
        : '説明担当者の初期値に使う主担当薬剤師を設定してください。',
      action_href: `/patients/${args.patient.id}#patient-profile-summary`,
      action_label: '担当者を確認',
    },
    {
      key: 'default_templates',
      label: '既定テンプレート',
      completed: missingTemplateLabels.length === 0,
      severity: 'required',
      description:
        missingTemplateLabels.length === 0
          ? '契約・重要事項・個人情報同意・同意書の既定テンプレートが揃っています。'
          : `既定テンプレート未設定: ${missingTemplateLabels.join(' / ')}`,
      action_href: '/admin/document-templates',
      action_label: 'テンプレートを確認',
    },
  ];
  const missingRequiredCount = checks.filter(
    (check) => check.severity === 'required' && !check.completed,
  ).length;
  const warningCount = checks.filter(
    (check) => check.severity === 'warning' && !check.completed,
  ).length;

  return {
    overall_status: missingRequiredCount > 0 ? 'blocked' : warningCount > 0 ? 'warning' : 'ready',
    missing_required_count: missingRequiredCount,
    warning_count: warningCount,
    template_versions: FIRST_VISIT_TEMPLATE_TYPES.map((item) => {
      const template = templatesByType.get(item.template_type) ?? null;
      return {
        document_type: item.document_type,
        label: item.label,
        template_id: template?.id ?? null,
        template_name: template?.name ?? null,
        template_version: template ? `v${template.version}` : null,
        effective_from: template?.effective_from ?? null,
        effective_to: template?.effective_to ?? null,
      };
    }),
    checks,
  };
}

export async function getPatientDocumentsData(db: DbClient, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDocumentsWhere(args),
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      phone: true,
      medical_insurance_number: true,
      care_insurance_number: true,
      residences: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          address: true,
          facility_id: true,
          building_id: true,
          unit_name: true,
          is_primary: true,
        },
      },
      contacts: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          name: true,
          phone: true,
          is_primary: true,
          is_emergency_contact: true,
        },
      },
      insurances: {
        where: { is_active: true },
        select: {
          insurance_type: true,
          insurer_number: true,
          number: true,
          valid_until: true,
        },
      },
      cases: {
        orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          status: true,
          start_date: true,
          primary_pharmacist_id: true,
        },
      },
    },
  });
  if (!patient) return null;

  const caseIds = patient.cases.map((item) => item.id);
  const today = new Date();
  const [firstVisitDocuments, latestTemplates] = await Promise.all([
    caseIds.length === 0
      ? Promise.resolve([])
      : db.firstVisitDocument.findMany({
          where: {
            org_id: args.orgId,
            patient_id: args.patientId,
            case_id: { in: caseIds },
          },
          orderBy: [{ created_at: 'desc' }],
          select: {
            id: true,
            case_id: true,
            emergency_contacts: true,
            document_url: true,
            delivered_at: true,
            delivered_to: true,
            created_at: true,
            updated_at: true,
          },
        }),
    db.template.findMany({
      where: {
        org_id: args.orgId,
        template_type: { in: FIRST_VISIT_TEMPLATE_TYPES.map((item) => item.template_type) },
        is_default: true,
        OR: [{ effective_from: null }, { effective_from: { lte: today } }],
        AND: [{ OR: [{ effective_to: null }, { effective_to: { gte: today } }] }],
      },
      orderBy: [{ template_type: 'asc' }, { version: 'desc' }, { updated_at: 'desc' }],
      select: {
        id: true,
        template_type: true,
        name: true,
        version: true,
        effective_from: true,
        effective_to: true,
      },
    }),
  ]);
  const documentIds = firstVisitDocuments.map((item) => item.id);
  const auditLogs =
    documentIds.length === 0 || !('auditLog' in db) || !db.auditLog?.findMany
      ? []
      : await (db as DbClientWithAuditLog).auditLog!.findMany({
          where: {
            org_id: args.orgId,
            target_type: 'first_visit_document',
            target_id: { in: documentIds },
            action: { startsWith: 'first_visit_document.' },
          },
          orderBy: [{ created_at: 'desc' }],
          take: 30,
          select: {
            id: true,
            actor_id: true,
            action: true,
            target_id: true,
            changes: true,
            created_at: true,
          },
        });
  const historyByDocumentId = new Map<string, FirstVisitDocumentHistoryItem[]>();
  for (const log of auditLogs) {
    const list = historyByDocumentId.get(log.target_id) ?? [];
    if (list.length < 5) {
      list.push(normalizeFirstVisitDocumentHistory(log));
      historyByDocumentId.set(log.target_id, list);
    }
  }

  const privacy = getPatientPrivacyFlags(args.role);

  return {
    patient: {
      id: patient.id,
      name: patient.name,
      name_kana: patient.name_kana,
    },
    print_readiness: buildPrintReadiness({
      patient,
      templates: latestTemplates,
    }),
    document_statuses: deriveFirstVisitDocumentStatuses({
      documents: firstVisitDocuments,
      historyByDocumentId,
    }),
    first_visit_documents: firstVisitDocuments.map((item) => ({
      ...item,
      history: historyByDocumentId.get(item.id) ?? [],
      emergency_contacts: normalizeFirstVisitDocumentContacts(item.emergency_contacts).map(
        (contact) => ({
          ...contact,
          phone: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.phone) : contact.phone,
          fax: privacy.sensitiveFieldsMasked ? maskPhoneNumber(contact.fax) : contact.fax,
          email: privacy.sensitiveFieldsMasked ? maskContactValue(contact.email) : contact.email,
        }),
      ),
    })),
  };
}
