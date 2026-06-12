import { format } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import { compactPreviewValues } from '@/server/services/patient-detail-helpers';
import { listPatientLabSummary } from '@/server/services/patient-detail-labs';
import {
  buildAssignedCareCaseWhere,
  buildPatientDetailWhere,
  type PatientDetailScopeArgs,
} from '@/server/services/patient-detail-scope';
import {
  buildVisitScheduleCommunicationTargets,
  resolveVisitScheduleCommunicationChannel,
  type VisitScheduleSchedulingPreferenceContext,
} from '@/server/services/visit-schedule-communication';

type PatientWorkflowPreviewDb = typeof prisma | Prisma.TransactionClient;

function pickPrimaryCareTeamLink<
  T extends {
    role: string;
    name: string;
    phone: string | null;
    email?: string | null;
    fax?: string | null;
    is_primary?: boolean;
    organization_name?: string | null;
  },
>(links: T[], role: string) {
  return (
    [...links]
      .filter((link) => link.role === role)
      .sort(
        (left, right) => Number(Boolean(right.is_primary)) - Number(Boolean(left.is_primary)),
      )[0] ?? null
  );
}

export async function getPatientWorkflowPreviewData(
  db: PatientWorkflowPreviewDb,
  args: PatientDetailScopeArgs,
) {
  const patient = await db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: {
      id: true,
      contacts: {
        orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
        select: {
          id: true,
          name: true,
          relation: true,
          phone: true,
          email: true,
          fax: true,
          is_primary: true,
          is_emergency_contact: true,
        },
      },
      scheduling_preference: {
        select: {
          preferred_weekdays: true,
          preferred_time_from: true,
          preferred_time_to: true,
          phone_contact_from: true,
          phone_contact_to: true,
          facility_time_from: true,
          facility_time_to: true,
          family_presence_required: true,
          visit_buffer_minutes: true,
          preferred_contact_name: true,
          preferred_contact_phone: true,
          visit_before_contact_required: true,
          first_visit_preferred_date: true,
          first_visit_time_slot: true,
          first_visit_time_note: true,
          parking_available: true,
          primary_contact_preference: true,
          mcs_linked: true,
          adl_level: true,
          dementia_level: true,
          swallowing_route: true,
          care_level: true,
          infection_isolation: true,
          notes: true,
        },
      },
      consents: {
        where: {
          consent_type: 'visit_medication_management',
          is_active: true,
          revoked_date: null,
        },
        select: { id: true, expiry_date: true },
      },
      mcs_link: {
        select: {
          id: true,
          source_url: true,
          project_title: true,
          member_count: true,
          last_sync_status: true,
          last_sync_error: true,
        },
      },
      cases: {
        ...(buildAssignedCareCaseWhere(args) ? { where: buildAssignedCareCaseWhere(args) } : {}),
        orderBy: [{ updated_at: 'desc' }],
        select: {
          id: true,
          status: true,
          required_visit_support: true,
          care_team_links: {
            orderBy: [{ is_primary: 'desc' }, { created_at: 'asc' }],
            select: {
              id: true,
              role: true,
              name: true,
              organization_name: true,
              phone: true,
              email: true,
              fax: true,
              is_primary: true,
            },
          },
          management_plans: {
            where: { status: 'approved' },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  if (!patient) return null;

  const currentCase =
    patient.cases.find((item) =>
      ['referral_received', 'assessment', 'active', 'on_hold'].includes(item.status),
    ) ??
    patient.cases[0] ??
    null;
  const intake = currentCase ? getHomeVisitIntake(currentCase.required_visit_support) : null;
  const schedulingPreference = patient.scheduling_preference;
  const careTeamLinks = currentCase?.care_team_links ?? [];

  const physicianCareTeamTarget = pickPrimaryCareTeamLink(careTeamLinks, 'physician');
  const physicianRequesterTarget =
    intake?.requester?.profession === 'physician' && intake.requester.contact_name
      ? {
          role: 'physician',
          name: intake.requester.contact_name,
          organization_name: intake.requester.organization_name ?? null,
          phone: intake.requester.phone ?? null,
          email: null,
          fax: intake.requester.fax ?? null,
          is_primary: false,
        }
      : null;
  const physicianTarget = physicianCareTeamTarget ?? physicianRequesterTarget;
  const careManagerCareTeamTarget = pickPrimaryCareTeamLink(careTeamLinks, 'care_manager');
  const careManagerIntakeTarget = intake?.care_manager?.name
    ? {
        role: 'care_manager',
        name: intake.care_manager.name,
        organization_name: intake.care_manager.organization_name ?? null,
        phone: intake.care_manager.phone ?? null,
        email: null,
        fax: intake.care_manager.fax ?? null,
        is_primary: false,
      }
    : null;
  const careManagerTarget = careManagerCareTeamTarget ?? careManagerIntakeTarget;
  const nurseCareTeamTarget = pickPrimaryCareTeamLink(careTeamLinks, 'nurse');
  const nurseIntakeTarget = intake?.visiting_nurse?.name
    ? {
        role: 'nurse',
        name: intake.visiting_nurse.name,
        organization_name: intake.visiting_nurse.organization_name ?? null,
        phone: intake.visiting_nurse.phone ?? null,
        email: null,
        fax: intake.visiting_nurse.fax ?? null,
        is_primary: false,
      }
    : null;
  const nurseTarget = nurseCareTeamTarget ?? nurseIntakeTarget;

  const communicationPreference: VisitScheduleSchedulingPreferenceContext = {
    preferredContactMethod:
      intake?.requester?.preferred_contact_method ??
      schedulingPreference?.primary_contact_preference ??
      null,
    visitBeforeContactRequired:
      schedulingPreference?.visit_before_contact_required ??
      intake?.visit_before_contact_required ??
      false,
    mcsLinked: schedulingPreference?.mcs_linked ?? intake?.mcs_linked ?? false,
    pharmacyDecisionDueDate: intake?.requester?.pharmacy_decision_due_date
      ? new Date(intake.requester.pharmacy_decision_due_date)
      : null,
  };

  const communicationTargets = buildVisitScheduleCommunicationTargets({
    contacts: patient.contacts.map((contact) => ({
      name: contact.name,
      relation: contact.relation,
      phone: contact.phone,
      email: contact.email,
      fax: contact.fax,
      is_primary: contact.is_primary,
    })),
    careTeamLinks: careTeamLinks.map((link) => ({
      role: link.role,
      name: link.name,
      phone: link.phone,
      email: link.email,
      fax: link.fax,
      is_primary: link.is_primary,
    })),
    channel: 'phone',
    schedulingPreference: communicationPreference,
  });

  const emergencyContacts = patient.contacts.filter((contact) => contact.is_emergency_contact);
  const keyAnalytes = await listPatientLabSummary(db, args);

  return {
    visit_preparation: {
      onboarding_readiness: {
        consent_obtained: patient.consents.length > 0,
        emergency_contact_set: emergencyContacts.length > 0,
        primary_physician_set: Boolean(physicianTarget),
        management_plan_approved: Boolean(currentCase?.management_plans[0]),
      },
      scheduling_preview: {
        preferred_weekdays:
          (schedulingPreference?.preferred_weekdays as number[] | null | undefined) ?? [],
        preferred_time_from: schedulingPreference?.preferred_time_from?.toISOString() ?? null,
        preferred_time_to: schedulingPreference?.preferred_time_to?.toISOString() ?? null,
        phone_contact_from: schedulingPreference?.phone_contact_from?.toISOString() ?? null,
        phone_contact_to: schedulingPreference?.phone_contact_to?.toISOString() ?? null,
        facility_time_from: schedulingPreference?.facility_time_from?.toISOString() ?? null,
        facility_time_to: schedulingPreference?.facility_time_to?.toISOString() ?? null,
        family_presence_required: schedulingPreference?.family_presence_required ?? false,
        visit_buffer_minutes: schedulingPreference?.visit_buffer_minutes ?? null,
        preferred_contact_name: schedulingPreference?.preferred_contact_name ?? null,
        preferred_contact_phone: schedulingPreference?.preferred_contact_phone ?? null,
        visit_before_contact_required: communicationPreference.visitBeforeContactRequired,
        first_visit_preferred_date:
          schedulingPreference?.first_visit_preferred_date?.toISOString() ?? null,
        first_visit_time_slot: schedulingPreference?.first_visit_time_slot ?? null,
        first_visit_time_note: schedulingPreference?.first_visit_time_note ?? null,
        parking_available: schedulingPreference?.parking_available ?? null,
        primary_contact_preference: schedulingPreference?.primary_contact_preference ?? null,
        mcs_linked: communicationPreference.mcsLinked,
      },
      baseline_context: {
        primary_disease: intake?.primary_disease ?? null,
        care_level: schedulingPreference?.care_level ?? intake?.care_level ?? null,
        adl_level: schedulingPreference?.adl_level ?? intake?.adl_level ?? null,
        dementia_level: schedulingPreference?.dementia_level ?? intake?.dementia_level ?? null,
        money_management: intake?.money_management ?? null,
        family_key_person: intake?.family_key_person ?? null,
        medication_support_methods: intake?.medication_support_methods ?? [],
        special_medical_procedures: intake?.special_medical_procedures ?? [],
        infection_isolation:
          intake?.infection_isolation ??
          (schedulingPreference?.infection_isolation ? '要隔離' : null),
        narcotics_base: intake?.narcotics_base ?? null,
        narcotics_rescue: intake?.narcotics_rescue ?? null,
        residual_medication_status: intake?.residual_medication_status ?? null,
      },
      latest_labs: keyAnalytes.map((lab) => ({
        analyte_code: lab.analyte_code,
        measured_at: lab.measured_at.toISOString(),
        value_numeric: lab.value_numeric,
        unit: lab.unit,
        abnormal_flag: lab.abnormal_flag,
      })),
      blockers: compactPreviewValues([
        patient.consents.length === 0 ? '訪問薬剤管理同意が未取得です。' : null,
        emergencyContacts.length === 0 ? '緊急連絡先が未登録です。' : null,
        !physicianTarget ? '主治医または依頼元医師情報が未設定です。' : null,
        !currentCase?.management_plans[0] ? '承認済み管理計画書がありません。' : null,
        communicationPreference.visitBeforeContactRequired &&
        !schedulingPreference?.preferred_contact_phone &&
        !patient.contacts.some((contact) => contact.phone)
          ? '訪問前連絡が必要ですが連絡先電話が不足しています。'
          : null,
      ]),
    },
    report_targets: [
      {
        key: 'physician_report' as const,
        label: '医師向け報告',
        available: Boolean(physicianTarget),
        source: physicianCareTeamTarget
          ? 'care_team'
          : physicianRequesterTarget
            ? 'requester'
            : 'missing',
        recipient_name: physicianTarget?.name ?? null,
        recipient_organization: physicianTarget?.organization_name ?? null,
        contact:
          compactPreviewValues([
            physicianTarget?.phone ? `TEL ${physicianTarget.phone}` : null,
            physicianTarget?.fax ? `FAX ${physicianTarget.fax}` : null,
            physicianTarget?.email ? physicianTarget.email : null,
          ]).join(' / ') || null,
      },
      {
        key: 'care_manager_report' as const,
        label: 'ケアマネ向け報告',
        available: Boolean(careManagerTarget),
        source: careManagerCareTeamTarget
          ? 'care_team'
          : careManagerIntakeTarget
            ? 'intake'
            : 'missing',
        recipient_name: careManagerTarget?.name ?? null,
        recipient_organization: careManagerTarget?.organization_name ?? null,
        contact:
          compactPreviewValues([
            careManagerTarget?.phone ? `TEL ${careManagerTarget.phone}` : null,
            careManagerTarget?.fax ? `FAX ${careManagerTarget.fax}` : null,
            careManagerTarget?.email ? careManagerTarget.email : null,
          ]).join(' / ') || null,
      },
      {
        key: 'nurse_share' as const,
        label: '訪問看護共有',
        available: Boolean(nurseTarget),
        source: nurseCareTeamTarget ? 'care_team' : nurseIntakeTarget ? 'intake' : 'missing',
        recipient_name: nurseTarget?.name ?? null,
        recipient_organization: nurseTarget?.organization_name ?? null,
        contact:
          compactPreviewValues([
            nurseTarget?.phone ? `TEL ${nurseTarget.phone}` : null,
            nurseTarget?.fax ? `FAX ${nurseTarget.fax}` : null,
            nurseTarget?.email ? nurseTarget.email : null,
          ]).join(' / ') || null,
      },
      {
        key: 'mcs' as const,
        label: 'MCS共有',
        available: communicationPreference.mcsLinked,
        source: communicationPreference.mcsLinked ? 'patient_setting' : 'missing',
        recipient_name: patient.mcs_link?.project_title ?? 'MCS連携',
        recipient_organization: null,
        contact: patient.mcs_link?.source_url ?? null,
        status: patient.mcs_link?.last_sync_status ?? null,
      },
    ],
    communication_priority: {
      preferred_contact_method: communicationPreference.preferredContactMethod,
      effective_channel: resolveVisitScheduleCommunicationChannel(
        'phone',
        communicationPreference.preferredContactMethod,
      ),
      visit_before_contact_required: communicationPreference.visitBeforeContactRequired,
      pharmacy_decision_due_date:
        communicationPreference.pharmacyDecisionDueDate?.toISOString() ?? null,
      targets: communicationTargets.map((target, index) => ({
        ...target,
        priority_order: index + 1,
      })),
      warnings: compactPreviewValues([
        communicationPreference.visitBeforeContactRequired
          ? '患者・家族への事前連絡を優先します。'
          : null,
        communicationPreference.pharmacyDecisionDueDate
          ? `薬局決定希望期限 ${format(communicationPreference.pharmacyDecisionDueDate, 'yyyy/MM/dd')}`
          : null,
        communicationTargets.length === 0 ? '有効な連携先が見つかっていません。' : null,
        communicationPreference.mcsLinked && !patient.mcs_link
          ? 'MCS連携フラグはありますが連携先 URL が未登録です。'
          : null,
      ]),
    },
  };
}
