import type { Prisma } from '@prisma/client';
import {
  findActiveVisitConsent,
  findCurrentManagementPlan,
} from '@/server/services/management-plans';
import {
  buildAssignedCareCaseWhere,
  buildPatientDetailWhere,
  type PatientDetailScopeArgs,
} from '@/server/services/patient-detail-scope';

type PatientReadinessDb = {
  consentRecord: Pick<Prisma.TransactionClient['consentRecord'], 'findFirst'>;
  firstVisitDocument: Pick<Prisma.TransactionClient['firstVisitDocument'], 'findFirst'>;
  managementPlan: Pick<Prisma.TransactionClient['managementPlan'], 'findFirst'>;
  patient: Pick<Prisma.TransactionClient['patient'], 'findFirst'>;
  prescriptionIntake: Pick<Prisma.TransactionClient['prescriptionIntake'], 'findFirst'>;
};

type DetailArgs = PatientDetailScopeArgs;

function normalizeCareTeamRole(role: string) {
  if (['physician', 'doctor', 'clinic', 'prescriber'].includes(role)) return 'physician';
  if (['nurse', 'visiting_nurse', 'home_nurse'].includes(role)) return 'nurse';
  if (['care_manager', 'caremanager', 'cm'].includes(role)) return 'care_manager';
  return role;
}

function hasJsonArrayItems(value: Prisma.JsonValue | null | undefined) {
  return Array.isArray(value) && value.length > 0;
}

export async function getPatientReadinessData(db: PatientReadinessDb, args: DetailArgs) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      name: true,
      name_kana: true,
      birth_date: true,
      gender: true,
      phone: true,
      medical_insurance_number: true,
      care_insurance_number: true,
      residences: {
        where: { is_primary: true },
        take: 1,
        select: {
          address: true,
          facility_id: true,
          facility_unit_id: true,
          building_id: true,
          unit_name: true,
        },
      },
      scheduling_preference: {
        select: {
          preferred_weekdays: true,
          preferred_time_from: true,
          preferred_time_to: true,
          facility_time_from: true,
          facility_time_to: true,
          visit_buffer_minutes: true,
          preferred_contact_name: true,
          preferred_contact_phone: true,
          visit_before_contact_required: true,
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
      contacts: {
        select: {
          is_emergency_contact: true,
        },
      },
      cases: {
        where: buildAssignedCareCaseWhere(args, {
          status: { in: ['referral_received', 'assessment', 'active', 'on_hold'] },
        }),
        orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          status: true,
          care_team_links: {
            select: {
              role: true,
            },
          },
        },
      },
    },
  });
  if (!patient) return null;

  const currentCase = patient.cases[0] ?? null;
  if (!currentCase) {
    return {
      applicable: false,
      overall_status: 'not_started' as const,
      completed_count: 0,
      total_count: 0,
      current_case: null,
      items: [],
    };
  }

  const [visitConsent, managementPlan, prescriptionIntake, deliveredDocument] = await Promise.all([
    findActiveVisitConsent(db, {
      orgId: args.orgId,
      patientId: args.patientId,
    }),
    findCurrentManagementPlan(db, {
      orgId: args.orgId,
      caseId: currentCase.id,
    }),
    db.prescriptionIntake.findFirst({
      where: {
        org_id: args.orgId,
        cycle: {
          case_id: currentCase.id,
        },
      },
      select: { id: true },
    }),
    db.firstVisitDocument.findFirst({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        case_id: currentCase.id,
        delivered_at: { not: null },
      },
      select: { id: true },
    }),
  ]);

  const hasEmergencyContact = patient.contacts.some((contact) => contact.is_emergency_contact);
  const careTeamRoles = new Set(
    currentCase.care_team_links.map((link) => normalizeCareTeamRole(link.role)),
  );
  const hasPrimaryPhysician = careTeamRoles.has('physician');
  const hasNurse = careTeamRoles.has('nurse');
  const hasCareManager = careTeamRoles.has('care_manager');
  const primaryResidence = patient.residences[0] ?? null;
  const hasPrimaryResidence = Boolean(
    primaryResidence?.address || primaryResidence?.facility_id || primaryResidence?.building_id,
  );
  const hasInsurance =
    Boolean(patient.medical_insurance_number || patient.care_insurance_number) ||
    patient.insurances.some(
      (insurance) =>
        Boolean(insurance.insurer_number || insurance.number) &&
        (!insurance.valid_until || insurance.valid_until >= new Date()),
    );
  const hasVisitPreferences = Boolean(
    hasJsonArrayItems(patient.scheduling_preference?.preferred_weekdays) ||
    patient.scheduling_preference?.preferred_time_from ||
    patient.scheduling_preference?.preferred_time_to ||
    patient.scheduling_preference?.facility_time_from ||
    patient.scheduling_preference?.facility_time_to ||
    patient.scheduling_preference?.visit_buffer_minutes != null ||
    patient.scheduling_preference?.preferred_contact_name ||
    patient.scheduling_preference?.preferred_contact_phone ||
    patient.scheduling_preference?.visit_before_contact_required != null,
  );

  const items = [
    {
      key: 'patient_profile' as const,
      label: '患者基本情報',
      completed: Boolean(patient.name && patient.name_kana && patient.birth_date && patient.gender),
      description:
        patient.name && patient.name_kana && patient.birth_date && patient.gender
          ? '氏名、カナ、生年月日、性別が登録されています。'
          : '氏名、カナ、生年月日、性別を登録してください。',
      action_href: `/patients/${args.patientId}/edit`,
      action_label: '患者基本を編集',
      severity: 'high' as const,
    },
    {
      key: 'primary_residence' as const,
      label: '訪問先住所・施設',
      completed: hasPrimaryResidence,
      description: hasPrimaryResidence
        ? '訪問先住所、施設、または個人宅グループが登録されています。'
        : '訪問先住所、施設、または個人宅グループを登録してください。',
      action_href: `/patients/${args.patientId}/edit`,
      action_label: '訪問先を編集',
      severity: 'high' as const,
    },
    {
      key: 'insurance' as const,
      label: '保険情報',
      completed: hasInsurance,
      description: hasInsurance
        ? '医療保険または介護保険情報が登録されています。'
        : '医療保険または介護保険情報を登録してください。',
      action_href: `/patients/${args.patientId}#patient-profile-summary`,
      action_label: '保険を確認',
      severity: 'high' as const,
    },
    {
      key: 'visit_preferences' as const,
      label: '訪問条件',
      completed: hasVisitPreferences,
      description: hasVisitPreferences
        ? '訪問希望曜日・時間帯・連絡条件のいずれかが登録されています。'
        : '訪問希望曜日、時間帯、連絡条件を登録してください。',
      action_href: `/patients/${args.patientId}/edit`,
      action_label: '訪問条件を編集',
      severity: 'normal' as const,
    },
    {
      key: 'care_team_recipients' as const,
      label: '報告書送付先',
      completed: hasPrimaryPhysician && hasNurse && hasCareManager,
      description:
        hasPrimaryPhysician && hasNurse && hasCareManager
          ? 'クリニック・訪問看護・ケアマネジャーが患者情報に登録されています。'
          : 'クリニック・訪問看護・ケアマネジャーを患者情報のケアチームに登録してください。',
      action_href: `/patients/${args.patientId}/collaboration`,
      action_label: '連携先を編集',
      severity: 'normal' as const,
    },
    {
      key: 'visit_consent' as const,
      label: '訪問同意',
      completed: Boolean(visitConsent),
      description: visitConsent
        ? '有効な訪問薬剤管理同意があります。'
        : '訪問薬剤管理の有効同意を取得してください。',
      action_href: `/patients/${args.patientId}/consent`,
      action_label: '同意を確認',
      severity: 'high' as const,
    },
    {
      key: 'emergency_contact' as const,
      label: '緊急連絡先',
      completed: hasEmergencyContact,
      description: hasEmergencyContact
        ? '緊急連絡先が登録されています。'
        : '少なくとも1件の緊急連絡先が必要です。',
      action_href: `/patients/${args.patientId}`,
      action_label: '連絡先を編集',
      severity: 'high' as const,
    },
    {
      key: 'primary_physician' as const,
      label: '主治医ケアチーム',
      completed: hasPrimaryPhysician,
      description: hasPrimaryPhysician
        ? '主治医がケアチームに紐付いています。'
        : '現在のケースに主治医を紐付けてください。',
      action_href: `/patients/${args.patientId}`,
      action_label: 'ケアチームを編集',
      severity: 'high' as const,
    },
    {
      key: 'management_plan' as const,
      label: '管理計画書',
      completed: Boolean(managementPlan.current) && !managementPlan.reviewOverdue,
      description: managementPlan.current
        ? managementPlan.reviewOverdue
          ? '承認済みですが見直し期限を超過しています。'
          : '承認済みの管理計画書があります。'
        : '承認済みの管理計画書が必要です。',
      action_href: `/patients/${args.patientId}/management-plan`,
      action_label: '計画書を確認',
      severity: 'high' as const,
    },
    {
      key: 'prescription_intake' as const,
      label: '処方受付',
      completed: Boolean(prescriptionIntake),
      description: prescriptionIntake
        ? 'このケースに紐づく処方受付があります。'
        : '初回訪問までに処方インテークを登録してください。',
      action_href: `/patients/${args.patientId}/prescriptions`,
      action_label: '処方履歴を確認',
      severity: 'normal' as const,
    },
    {
      key: 'first_visit_document' as const,
      label: '初回訪問文書交付',
      completed: Boolean(deliveredDocument),
      description: deliveredDocument
        ? '初回訪問文書の交付記録があります。'
        : '初回訪問文書の交付記録がまだありません。',
      action_href: `/patients/${args.patientId}`,
      action_label: '交付記録を確認',
      severity: 'normal' as const,
    },
  ];

  const completedCount = items.filter((item) => item.completed).length;

  return {
    applicable: true,
    overall_status:
      completedCount === items.length ? ('ready' as const) : ('action_required' as const),
    completed_count: completedCount,
    total_count: items.length,
    current_case: {
      id: currentCase.id,
      status: currentCase.status,
    },
    items,
  };
}
