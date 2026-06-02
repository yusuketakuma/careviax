'use client';

import { differenceInYears, format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  adlLabels,
  careLevelLabels,
  contactMethodLabels,
  dementiaLabels,
  firstVisitSlotLabels,
  formatBoolean,
  formatOptionalDate,
  getHomeVisitIntake,
  housingTypeLabels,
  joinLabeledValues,
  labelOf,
  medicationSupportLabels,
  moneyManagementLabels,
  requesterProfessionLabels,
  specialProcedureLabels,
} from '@/lib/patient/home-visit-intake';

type PatientIntakeSummaryCardProps = {
  patient: {
    name: string;
    name_kana: string;
    birth_date: string;
    gender: string;
    residences: Array<{
      address: string;
      unit_name: string | null;
      is_primary: boolean;
    }>;
    cases: Array<{
      id: string;
      created_at: string;
      required_visit_support: Record<string, unknown> | null;
    }>;
    scheduling_preference?: {
      adl_level?: string | null;
      dementia_level?: string | null;
      swallowing_route?: string | null;
      care_level?: string | null;
      infection_isolation?: boolean;
    } | null;
  };
};

const genderLabels: Record<string, string> = {
  male: '男',
  female: '女',
  other: 'その他',
};

function formatResidenceAddress(
  address: string | null | undefined,
  unitName: string | null | undefined,
) {
  if (!address) return '—';
  if (!unitName) return address;

  const normalizedAddress = address.trim();
  const normalizedUnit = unitName.trim();
  const compactUnit = normalizedUnit.replace(/\s+/g, '');
  const unitStem = compactUnit.replace(/号室$/u, '');
  if (
    normalizedAddress.includes(` ${normalizedUnit}`) ||
    normalizedAddress.endsWith(normalizedUnit) ||
    (unitStem && normalizedAddress.endsWith(unitStem))
  ) {
    return normalizedAddress.includes(` ${unitName}`) ? normalizedAddress : normalizedAddress;
  }

  return `${normalizedAddress} ${normalizedUnit}`;
}

function DetailBlock({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground">{title}</p>
      <dl className="space-y-2 text-sm">
        {rows.map((row) => (
          <div
            key={`${title}-${row.label}`}
            className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)]"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words text-foreground">{row.value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function PatientIntakeSummaryCard({ patient }: PatientIntakeSummaryCardProps) {
  const intakeCase = patient.cases.find((careCase) =>
    getHomeVisitIntake(careCase.required_visit_support),
  );
  const intake = intakeCase ? getHomeVisitIntake(intakeCase.required_visit_support) : null;
  const primaryResidence = patient.residences.find((residence) => residence.is_primary) ?? null;
  const pref = patient.scheduling_preference;

  // P-09: prefer dedicated columns over JSON intake fields
  const adlLevel = pref?.adl_level ?? intake?.adl_level;
  const dementiaLevel = pref?.dementia_level ?? intake?.dementia_level;
  const careLevel = pref?.care_level ?? intake?.care_level;
  const swallowingRoute = pref?.swallowing_route ?? intake?.swallowing_route;
  const infectionIsolation =
    pref?.infection_isolation != null
      ? pref.infection_isolation
        ? '要隔離'
        : null
      : (intake?.infection_isolation ?? null);

  if (!intake || !intakeCase) {
    return null;
  }

  const age = differenceInYears(new Date(), new Date(patient.birth_date));
  const medicationSupport = joinLabeledValues(
    intake.medication_support_methods,
    medicationSupportLabels,
  );
  const specialProcedures = joinLabeledValues(
    intake.special_medical_procedures,
    specialProcedureLabels,
  );

  return (
    <Card className="lg:col-span-2" data-testid="patient-intake-summary-card">
      <CardHeader className="space-y-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-heading text-base leading-snug font-medium">
              訪問薬剤管理 新規依頼受付票
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              受付時に得た情報を、依頼元・患者特定・訪問条件・薬学的管理・多職種連携の観点で再構成しています。
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            作成日 {format(new Date(intakeCase.created_at), 'yyyy/MM/dd', { locale: ja })}
          </p>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-2">
        <DetailBlock
          title="A. 依頼元情報"
          rows={[
            { label: '事業所名', value: intake.requester?.organization_name ?? '—' },
            {
              label: '職種',
              value: labelOf(intake.requester?.profession, requesterProfessionLabels),
            },
            {
              label: '担当者',
              value: [intake.requester?.contact_name, intake.requester?.contact_name_kana]
                .filter(Boolean)
                .join(' / '),
            },
            {
              label: '電話 / FAX',
              value: [
                intake.requester?.phone,
                intake.requester?.fax ? `FAX ${intake.requester.fax}` : null,
              ]
                .filter(Boolean)
                .join(' / '),
            },
            {
              label: '薬局決定希望期限',
              value: formatOptionalDate(intake.requester?.pharmacy_decision_due_date),
            },
            {
              label: '連絡手段優先',
              value: [
                labelOf(intake.requester?.preferred_contact_method, contactMethodLabels),
                intake.requester?.preferred_contact_method_other,
              ]
                .filter(Boolean)
                .join(' / '),
            },
          ]}
        />

        <DetailBlock
          title="B. 患者特定情報"
          rows={[
            {
              label: '患者氏名',
              value: [patient.name, patient.name_kana].filter(Boolean).join(' / '),
            },
            { label: '主病名', value: intake.primary_disease ?? '—' },
            {
              label: '年齢 / 性別',
              value: `${intake.reported_age ?? age}歳 / ${genderLabels[patient.gender] ?? patient.gender}`,
            },
            {
              label: '住所',
              value: formatResidenceAddress(primaryResidence?.address, primaryResidence?.unit_name),
            },
            {
              label: '郵便番号 / 住居形態',
              value: [
                intake.postal_code ? `〒${intake.postal_code}` : null,
                labelOf(intake.housing_type, housingTypeLabels),
              ]
                .filter(Boolean)
                .join(' / '),
            },
            {
              label: '施設名 / MCS',
              value: [intake.facility_name, `MCS ${formatBoolean(intake.mcs_linked)}`]
                .filter(Boolean)
                .join(' / '),
            },
          ]}
        />

        <DetailBlock
          title="C. 連絡・訪問条件"
          rows={[
            {
              label: '主連絡先',
              value: [
                labelOf(intake.primary_contact_preference, {
                  phone: '電話優先',
                  mobile: '携帯優先',
                }),
                intake.contact_phone ? `電話 ${intake.contact_phone}` : null,
                intake.contact_mobile ? `携帯 ${intake.contact_mobile}` : null,
              ]
                .filter(Boolean)
                .join(' / '),
            },
            {
              label: '緊急連絡先',
              value: [
                intake.emergency_contact?.name,
                intake.emergency_contact?.relation,
                intake.emergency_contact?.phone,
              ]
                .filter(Boolean)
                .join(' / '),
            },
            {
              label: '訪問前連絡',
              value: formatBoolean(intake.visit_before_contact_required, '要', '不要'),
            },
            {
              label: '初回訪問希望',
              value:
                [
                  formatOptionalDate(intake.first_visit_date),
                  labelOf(intake.first_visit_time_slot, firstVisitSlotLabels),
                  intake.first_visit_time_note,
                ]
                  .filter((value) => value && value !== '—')
                  .join(' / ') || '—',
            },
            {
              label: '駐車スペース',
              value: formatBoolean(intake.parking_available, '有', '無'),
            },
          ]}
        />

        <DetailBlock
          title="D. 介護・生活背景"
          rows={[
            {
              label: '金銭管理',
              value: labelOf(intake.money_management, moneyManagementLabels),
            },
            { label: '家族構成・キーパーソン', value: intake.family_key_person ?? '—' },
            { label: '介護認定', value: labelOf(careLevel, careLevelLabels) },
            { label: '日常生活自立度', value: labelOf(adlLevel, adlLabels) },
            { label: '認知症自立度', value: labelOf(dementiaLevel, dementiaLabels) },
          ]}
        />

        <DetailBlock
          title="E. 薬学的管理情報"
          rows={[
            {
              label: '服薬支援・実施状況',
              value:
                [...medicationSupport, intake.medication_support_other]
                  .filter(Boolean)
                  .join(' / ') || '—',
            },
            {
              label: 'ENT処方',
              value: [
                formatBoolean(intake.ent_prescription, '有', '無'),
                intake.ent_period_from || intake.ent_period_to
                  ? `${formatOptionalDate(intake.ent_period_from)} - ${formatOptionalDate(
                      intake.ent_period_to,
                    )}`
                  : null,
              ]
                .filter(Boolean)
                .join(' / '),
            },
            {
              label: '初期移行管理料',
              value: formatBoolean(
                intake.initial_transition_management_expected,
                '該当見込みあり',
                '該当見込みなし',
              ),
            },
            {
              label: '麻薬',
              value: [
                `ベース ${formatBoolean(intake.narcotics_base)}`,
                `レスキュー ${formatBoolean(intake.narcotics_rescue)}`,
              ].join(' / '),
            },
            { label: 'アレルギー / 副作用歴', value: intake.allergy_history ?? '—' },
            { label: '感染症 / 隔離', value: infectionIsolation ?? '—' },
            { label: '嚥下 / 投与経路', value: swallowingRoute ?? '—' },
            { label: '残薬状況', value: intake.residual_medication_status ?? '—' },
            { label: '備考', value: intake.intake_note ?? '—' },
            { label: 'その他', value: intake.other_clinical_notes ?? '—' },
          ]}
        />

        <DetailBlock
          title="F. 多職種連携・医療処置"
          rows={[
            {
              label: '担当CM',
              value: intake.care_manager?.name
                ? [
                    intake.care_manager.name,
                    intake.care_manager.name_kana,
                    intake.care_manager.organization_name,
                    intake.care_manager.phone ? `TEL ${intake.care_manager.phone}` : null,
                    intake.care_manager.fax ? `FAX ${intake.care_manager.fax}` : null,
                  ]
                    .filter(Boolean)
                    .join(' / ')
                : '—',
            },
            {
              label: '訪問看護',
              value: intake.visiting_nurse?.name
                ? [
                    intake.visiting_nurse.name,
                    intake.visiting_nurse.name_kana,
                    intake.visiting_nurse.organization_name,
                    intake.visiting_nurse.phone ? `TEL ${intake.visiting_nurse.phone}` : null,
                    intake.visiting_nurse.fax ? `FAX ${intake.visiting_nurse.fax}` : null,
                  ]
                    .filter(Boolean)
                    .join(' / ')
                : '—',
            },
            {
              label: '特別な医療・処置',
              value: specialProcedures.join(' / ') || '—',
            },
            { label: '配慮事項', value: intake.special_medical_notes ?? '—' },
          ]}
        />
      </CardContent>
    </Card>
  );
}
