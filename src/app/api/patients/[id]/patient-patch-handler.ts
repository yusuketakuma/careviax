import { format } from 'date-fns';
import type { NextRequest } from 'next/server';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { readJsonObject } from '@/lib/db/json';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { updatePatientSchema } from '@/lib/validations/patient';
import { Prisma } from '@prisma/client';
import {
  assertFacilityReference,
  assertFacilityUnitReference,
  FacilityReferenceValidationError,
  FacilityUnitReferenceValidationError,
  getFacilityVisitDefaults,
} from '@/lib/patient/facility-reference';
import {
  writePatientFieldRevisions,
  sortJsonArrayStable,
  isJsonEqual,
  type PatientFieldRevisionEntry,
} from '@/server/services/patient-field-revision';
import { upsertOperationalTask } from '@/server/services/operational-tasks';
import { syncStructuredHomeCare } from '@/server/services/patient-structured-care';
import { localDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { getHomeVisitIntake, type HomeVisitIntake } from '@/lib/patient/home-visit-intake';
import {
  hasOwnKey,
  mergeHomeVisitIntake,
  normalizeNullableText,
  validateMergedHomeVisitIntake,
} from '@/lib/patient/home-visit-intake-merge';
import { classifyHomeVisitIntakePatch } from '@/lib/patient/home-visit-intake-patch';
import { buildExactHomeVisitIntakeCaseWhere } from '@/lib/patient/home-visit-intake-target';
import { normalizePatientPrimaryContacts } from '@/lib/patient/care-team-contact';
import { buildPatientDetailWhere } from '@/server/services/patient-detail-scope';
import { normalizeInputJsonObject } from './patient-get-handler';
import {
  normalizeExpectedUpdatedAt,
  lockPatientPatchCareCaseAuthority,
  PatientPatchConflictError,
  PatientPatchResponseError,
  preparePatientPatchTransaction,
  presentPatientPatch,
} from './patient-patch-preflight';

export async function executeAuthenticatedPatientPatch(
  req: NextRequest,
  ctx: AuthContext,
  { params }: { params: Promise<{ id: string }> },
  dependencies: {
    now?: () => Date;
    testOnlyBeforeCareCaseClaim?: (tx: Prisma.TransactionClient) => Promise<void>;
  } = {},
): Promise<Response> {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('患者IDが不正です');
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updatePatientSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }
  const duplicateAcknowledged = payload.duplicate_acknowledged === true;
  const {
    address,
    birth_date,
    building_id,
    facility_id,
    facility_unit_id,
    unit_name,
    contacts,
    conditions,
    requester,
    intake,
    medical_insurance_number,
    care_insurance_number,
    source_visit_record_id,
    expected_updated_at,
    care_case_id,
    expected_care_case_version,
    primary_pharmacist_id,
    backup_pharmacist_id,
    primary_staff_id,
    backup_staff_id,
    ...rest
  } = parsed.data;

  const intakePatch = classifyHomeVisitIntakePatch({ requester, intake });
  const hasDirectWrites = Object.entries(parsed.data).some(
    ([key, value]) =>
      value !== undefined &&
      ![
        'expected_updated_at',
        'care_case_id',
        'expected_care_case_version',
        'source_visit_record_id',
        'requester',
        'intake',
      ].includes(key),
  );
  if (!hasDirectWrites && !intakePatch.hasAnyWrites) {
    return validationError('更新対象の項目が指定されていません');
  }
  const hasCaseClaim = care_case_id != null && expected_care_case_version != null;
  if (
    !intakePatch.hasAnyWrites &&
    (care_case_id !== undefined || expected_care_case_version !== undefined)
  ) {
    return validationError('ケースの版情報は受付情報を更新する場合だけ指定してください');
  }
  if (intakePatch.hasCareCaseWrites && !hasCaseClaim) {
    return validationError('ケースに属する受付情報を更新するにはケースの版情報が必要です');
  }
  if (intakePatch.hasAnyWrites && care_case_id === null && intakePatch.hasCareCaseWrites) {
    return validationError('ケースがない患者ではケースに属する受付情報を更新できません');
  }
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(expected_updated_at);
  if (!expectedUpdatedAt) return validationError('患者情報の版情報が不正です');
  // 担当チーム（患者単位）: 未指定=skip / 空文字=null へ正規化し、ID は org-reference で検証する。
  const normalizeAssignmentId = (value: string | undefined) =>
    value === undefined ? undefined : value === '' ? null : value;
  const normalizedPrimaryPharmacistId = normalizeAssignmentId(primary_pharmacist_id);
  const normalizedBackupPharmacistId = normalizeAssignmentId(backup_pharmacist_id);
  const normalizedPrimaryStaffId = normalizeAssignmentId(primary_staff_id);
  const normalizedBackupStaffId = normalizeAssignmentId(backup_staff_id);
  const careTeamPharmacistIds = [
    normalizedPrimaryPharmacistId,
    normalizedBackupPharmacistId,
  ].filter((value): value is string => Boolean(value));
  const careTeamStaffIds = [normalizedPrimaryStaffId, normalizedBackupStaffId].filter(
    (value): value is string => Boolean(value),
  );
  try {
    const transactionResult = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const { existing, duplicateCandidates, assignedCareCaseWhere } =
          await preparePatientPatchTransaction({
            tx,
            ctx,
            patientId: id,
            nextIdentity: { name: rest.name, gender: rest.gender, birthDate: birth_date },
            pharmacistIds: careTeamPharmacistIds,
            staffIds: careTeamStaffIds,
            duplicateAcknowledged,
            hasIntakeWrites: intakePatch.hasAnyWrites,
            hasCareCasePair:
              Object.prototype.hasOwnProperty.call(parsed.data, 'care_case_id') &&
              Object.prototype.hasOwnProperty.call(parsed.data, 'expected_care_case_version'),
          });
        const canonicalIntakeCase = intakePatch.hasAnyWrites
          ? await lockPatientPatchCareCaseAuthority({
              tx,
              ctx,
              patientId: id,
              assignedCareCaseWhere,
              careCaseId: care_case_id,
              expectedCareCaseVersion: expected_care_case_version,
            })
          : null;

        let preparedCaseMutation: {
          canonicalCase: NonNullable<typeof canonicalIntakeCase>;
          nextHomeVisitIntake: HomeVisitIntake | null;
        } | null = null;
        if (intakePatch.hasAnyWrites && hasCaseClaim) {
          if (
            !canonicalIntakeCase ||
            canonicalIntakeCase.id !== care_case_id ||
            canonicalIntakeCase.version !== expected_care_case_version
          ) {
            throw new PatientPatchConflictError('stale_care_case');
          }
          const nextHomeVisitIntake = mergeHomeVisitIntake({
            current: getHomeVisitIntake(canonicalIntakeCase.required_visit_support),
            requester,
            intake,
          });
          const intakeErrors = validateMergedHomeVisitIntake(nextHomeVisitIntake);
          if (intakeErrors.length > 0) {
            throw new PatientPatchResponseError(
              validationError('入力値が不正です', { intake: intakeErrors }),
            );
          }
          preparedCaseMutation = { canonicalCase: canonicalIntakeCase, nextHomeVisitIntake };
        }

        // Collect old→new business revisions once and persist them at the transaction tail.
        const revisionEntries: PatientFieldRevisionEntry[] = [];
        const revisionDate = utcDateFromLocalKey(localDateKey());
        let claimedCaseMutation: {
          id: string;
          nextHomeVisitIntake: HomeVisitIntake | null;
        } | null = null;

        // Accept visit provenance only when it belongs to this org and patient.
        let effectiveSourceVisitRecordId: string | null = null;
        if (source_visit_record_id) {
          const sourceVisit = await tx.visitRecord.findFirst({
            where: { id: source_visit_record_id, org_id: ctx.orgId, patient_id: id },
            select: { id: true },
          });
          effectiveSourceVisitRecordId = sourceVisit?.id ?? null;
        }

        const primaryResidence = await tx.residence.findFirst({
          where: { patient_id: id, is_primary: true },
          select: {
            id: true,
            address: true,
            building_id: true,
            facility_id: true,
            facility_unit_id: true,
            unit_name: true,
          },
        });

        const currentFacilityId = primaryResidence?.facility_id ?? null;
        const nextFacilityId = facility_id !== undefined ? facility_id || null : currentFacilityId;
        const nextFacilityUnitId =
          facility_unit_id !== undefined
            ? facility_unit_id || null
            : facility_id !== undefined && nextFacilityId !== currentFacilityId
              ? null
              : (primaryResidence?.facility_unit_id ?? null);

        const facilityVisitDefaults =
          facility_id !== undefined
            ? await getFacilityVisitDefaults(tx, ctx.orgId, nextFacilityId)
            : null;

        if (facility_id !== undefined) {
          await assertFacilityReference(tx, ctx.orgId, nextFacilityId);
        }
        if (facility_id !== undefined || facility_unit_id !== undefined) {
          await assertFacilityUnitReference(tx, ctx.orgId, nextFacilityId, nextFacilityUnitId);
        }

        const normalizedMedicalInsuranceNumber =
          medical_insurance_number !== undefined
            ? (normalizeNullableText(medical_insurance_number) ?? null)
            : undefined;
        const normalizedCareInsuranceNumber =
          care_insurance_number !== undefined
            ? (normalizeNullableText(care_insurance_number) ?? null)
            : undefined;

        const patientClaimBasis = expectedUpdatedAt;
        const now = dependencies.now?.() ?? new Date();
        const nextPatientUpdatedAt = new Date(
          Math.max(now.getTime(), patientClaimBasis.getTime() + 1),
        );
        const patientUpdateData: Prisma.PatientUpdateManyMutationInput = {
          ...(birth_date ? { birth_date: new Date(birth_date) } : {}),
          ...(normalizedMedicalInsuranceNumber !== undefined
            ? { medical_insurance_number: normalizedMedicalInsuranceNumber }
            : {}),
          ...(normalizedCareInsuranceNumber !== undefined
            ? { care_insurance_number: normalizedCareInsuranceNumber }
            : {}),
          ...(normalizedPrimaryPharmacistId !== undefined
            ? { primary_pharmacist_id: normalizedPrimaryPharmacistId }
            : {}),
          ...(normalizedBackupPharmacistId !== undefined
            ? { backup_pharmacist_id: normalizedBackupPharmacistId }
            : {}),
          ...(normalizedPrimaryStaffId !== undefined
            ? { primary_staff_id: normalizedPrimaryStaffId }
            : {}),
          ...(normalizedBackupStaffId !== undefined
            ? { backup_staff_id: normalizedBackupStaffId }
            : {}),
          ...rest,
          updated_at: nextPatientUpdatedAt,
        };
        const patientClaim = await tx.patient.updateMany({
          where: {
            ...buildPatientDetailWhere({
              orgId: ctx.orgId,
              patientId: id,
              role: ctx.role,
              userId: ctx.userId,
            }),
            updated_at: patientClaimBasis,
            archived_at: null,
          },
          data: patientUpdateData,
        });
        if (patientClaim.count !== 1) {
          throw new PatientPatchConflictError('stale_patient');
        }
        const updated = await tx.patient.findFirst({
          where: buildPatientDetailWhere({
            orgId: ctx.orgId,
            patientId: id,
            role: ctx.role,
            userId: ctx.userId,
          }),
          select: { id: true, phone: true, updated_at: true },
        });
        if (!updated) throw new PatientPatchConflictError('stale_patient');

        if (intakePatch.hasAnyWrites && hasCaseClaim) {
          if (!preparedCaseMutation) throw new PatientPatchConflictError('stale_care_case');
          await dependencies.testOnlyBeforeCareCaseClaim?.(tx);
          const { canonicalCase, nextHomeVisitIntake } = preparedCaseMutation;
          const currentRequiredVisitSupport = readJsonObject(canonicalCase.required_visit_support);
          const nextRequiredVisitSupport = currentRequiredVisitSupport
            ? { ...currentRequiredVisitSupport }
            : {};
          if (nextHomeVisitIntake) {
            nextRequiredVisitSupport.home_visit_intake = nextHomeVisitIntake;
          } else {
            delete nextRequiredVisitSupport.home_visit_intake;
          }

          const caseClaim = await tx.careCase.updateMany({
            where: buildExactHomeVisitIntakeCaseWhere({
              orgId: ctx.orgId,
              patientId: id,
              assignedCareCaseWhere,
              careCaseId: care_case_id,
              expectedVersion: expected_care_case_version,
            }),
            data: {
              ...(requester && hasOwnKey(requester, 'organization_name')
                ? {
                    referral_source: normalizeNullableText(requester.organization_name) ?? null,
                  }
                : {}),
              required_visit_support: normalizeInputJsonObject(nextRequiredVisitSupport),
              version: { increment: 1 },
            },
          });
          if (caseClaim.count !== 1) {
            throw new PatientPatchConflictError('stale_care_case');
          }
          claimedCaseMutation = { id: care_case_id, nextHomeVisitIntake };
        }

        const basicFieldLabels: Record<string, string> = {
          name: '氏名',
          name_kana: 'フリガナ',
          gender: '性別',
          phone: '電話番号',
          billing_support_flag: '請求支援フラグ',
          allergy_info: 'アレルギー情報',
          notes: 'メモ',
        };
        const restRecord = rest as Record<string, unknown>;
        for (const [fieldKey, fieldLabel] of Object.entries(basicFieldLabels)) {
          if (restRecord[fieldKey] === undefined) continue;
          revisionEntries.push({
            category: 'basic',
            field_key: fieldKey,
            field_label: fieldLabel,
            old_value: (existing as Record<string, unknown>)[fieldKey] ?? null,
            new_value: restRecord[fieldKey] ?? null,
          });
        }
        if (birth_date !== undefined) {
          revisionEntries.push({
            category: 'basic',
            field_key: 'birth_date',
            field_label: '生年月日',
            old_value:
              existing.birth_date instanceof Date
                ? format(existing.birth_date, 'yyyy-MM-dd')
                : (existing.birth_date ?? null),
            new_value: birth_date,
          });
        }

        const careTeamRevisionFields: Array<{
          key:
            | 'primary_pharmacist_id'
            | 'backup_pharmacist_id'
            | 'primary_staff_id'
            | 'backup_staff_id';
          label: string;
          value: string | null | undefined;
        }> = [
          {
            key: 'primary_pharmacist_id',
            label: '主担当薬剤師',
            value: normalizedPrimaryPharmacistId,
          },
          {
            key: 'backup_pharmacist_id',
            label: '副担当薬剤師',
            value: normalizedBackupPharmacistId,
          },
          { key: 'primary_staff_id', label: '主担当スタッフ', value: normalizedPrimaryStaffId },
          { key: 'backup_staff_id', label: '副担当スタッフ', value: normalizedBackupStaffId },
        ];
        for (const { key, label, value } of careTeamRevisionFields) {
          if (value === undefined) continue;
          revisionEntries.push({
            category: 'basic',
            field_key: key,
            field_label: label,
            old_value: (existing as Record<string, unknown>)[key] ?? null,
            new_value: value ?? null,
          });
        }

        if (
          address !== undefined ||
          building_id !== undefined ||
          facility_id !== undefined ||
          facility_unit_id !== undefined ||
          unit_name !== undefined
        ) {
          if (primaryResidence) {
            await tx.residence.update({
              where: { id: primaryResidence.id },
              data: {
                ...(address !== undefined ? { address } : {}),
                ...(building_id !== undefined ? { building_id: building_id || null } : {}),
                ...(facility_id !== undefined ? { facility_id: nextFacilityId } : {}),
                ...(facility_unit_id !== undefined ||
                (facility_id !== undefined && nextFacilityId !== currentFacilityId)
                  ? { facility_unit_id: nextFacilityUnitId }
                  : {}),
                ...(unit_name !== undefined ? { unit_name: unit_name || null } : {}),
              },
            });
          } else {
            await tx.residence.create({
              data: {
                org_id: ctx.orgId,
                patient_id: id,
                address: address ?? '',
                building_id: building_id || null,
                facility_id: nextFacilityId,
                facility_unit_id: nextFacilityUnitId,
                unit_name: unit_name || null,
                is_primary: true,
              },
            });
          }

          if (address !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'address',
              field_label: '住所',
              old_value: primaryResidence?.address ?? null,
              new_value: address ?? null,
            });
          }
          if (building_id !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'building_id',
              field_label: '建物',
              old_value: primaryResidence?.building_id ?? null,
              new_value: building_id || null,
            });
          }
          if (facility_id !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'facility_id',
              field_label: '施設',
              old_value: currentFacilityId,
              new_value: nextFacilityId,
            });
          }
          if (
            facility_unit_id !== undefined ||
            (facility_id !== undefined && nextFacilityId !== currentFacilityId)
          ) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'facility_unit_id',
              field_label: '施設ユニット',
              old_value: primaryResidence?.facility_unit_id ?? null,
              new_value: nextFacilityUnitId,
            });
          }
          if (unit_name !== undefined) {
            revisionEntries.push({
              category: 'residence',
              field_key: 'unit_name',
              field_label: '部屋番号',
              old_value: primaryResidence?.unit_name ?? null,
              new_value: unit_name || null,
            });
          }
        }

        if (contacts) {
          const previousContacts = await tx.contactParty.findMany({
            where: { org_id: ctx.orgId, patient_id: id },
            select: {
              name: true,
              relation: true,
              phone: true,
              email: true,
              fax: true,
              organization_name: true,
              department: true,
              address: true,
              is_primary: true,
              is_emergency_contact: true,
              notes: true,
            },
            orderBy: { created_at: 'asc' },
          });
          const nextContacts = normalizePatientPrimaryContacts(
            contacts.map((contact) => ({
              name: contact.name,
              relation: contact.relation,
              phone: contact.phone || null,
              email: contact.email || null,
              fax: contact.fax || null,
              organization_name: contact.organization_name || null,
              department: contact.department || null,
              address: contact.address || null,
              is_primary: contact.is_primary,
              is_emergency_contact: contact.is_emergency_contact,
              notes: contact.notes || null,
            })),
          );

          await tx.contactParty.deleteMany({
            where: { org_id: ctx.orgId, patient_id: id },
          });
          if (nextContacts.length > 0) {
            await tx.contactParty.createMany({
              data: nextContacts.map((contact) => ({
                org_id: ctx.orgId,
                patient_id: id,
                ...contact,
              })),
            });
          }

          revisionEntries.push({
            category: 'contacts',
            field_key: 'contacts',
            field_label: '連絡先',
            // 順序のみの差(UI 並び替え/GET と保存経路の orderBy 差)で偽の履歴を出さないため安定ソートして比較・保存する
            old_value: previousContacts.length > 0 ? sortJsonArrayStable(previousContacts) : null,
            new_value: nextContacts.length > 0 ? sortJsonArrayStable(nextContacts) : null,
          });
        }

        if (conditions) {
          // 連絡先と同様、破壊的置換の前に旧値スナップショットを取得して履歴化する(PatientCondition も audit 対象外)
          const previousConditions = await tx.patientCondition.findMany({
            where: { org_id: ctx.orgId, patient_id: id },
            select: {
              condition_type: true,
              name: true,
              is_primary: true,
              is_active: true,
              noted_at: true,
              notes: true,
            },
            orderBy: { created_at: 'asc' },
          });

          await tx.patientCondition.deleteMany({
            where: { org_id: ctx.orgId, patient_id: id },
          });
          if (conditions.length > 0) {
            await tx.patientCondition.createMany({
              data: conditions.map((condition) => ({
                org_id: ctx.orgId,
                patient_id: id,
                condition_type: condition.condition_type,
                name: condition.name,
                is_primary: condition.is_primary,
                is_active: condition.is_active,
                noted_at: condition.noted_at ? new Date(condition.noted_at) : null,
                notes: condition.notes || null,
              })),
            });
          }

          // 比較の安定化のため noted_at は日付文字列へ正規化したスナップショットで保持する
          const normalizeConditionSnapshot = (condition: {
            condition_type: unknown;
            name: unknown;
            is_primary: unknown;
            is_active: unknown;
            noted_at?: Date | string | null;
            notes?: unknown;
          }) => ({
            condition_type: condition.condition_type,
            name: condition.name,
            is_primary: condition.is_primary,
            is_active: condition.is_active,
            noted_at: condition.noted_at
              ? format(new Date(condition.noted_at), 'yyyy-MM-dd')
              : null,
            notes: condition.notes ?? null,
          });
          const previousSnapshot = sortJsonArrayStable(
            previousConditions.map(normalizeConditionSnapshot),
          );
          const nextSnapshot = sortJsonArrayStable(conditions.map(normalizeConditionSnapshot));
          revisionEntries.push({
            category: 'conditions',
            field_key: 'conditions',
            field_label: '病名・問題',
            old_value: previousSnapshot.length > 0 ? previousSnapshot : null,
            new_value: nextSnapshot.length > 0 ? nextSnapshot : null,
          });
        }

        const schedulePreferenceCreateData: Prisma.PatientSchedulePreferenceUncheckedCreateInput = {
          org_id: ctx.orgId,
          patient_id: id,
        };
        const schedulePreferencePatchData: Prisma.PatientSchedulePreferenceUncheckedUpdateInput =
          {};

        if (facility_id !== undefined) {
          const facilityTimeFrom = facilityVisitDefaults?.acceptance_time_from ?? null;
          const facilityTimeTo = facilityVisitDefaults?.acceptance_time_to ?? null;
          schedulePreferenceCreateData.facility_time_from = facilityTimeFrom;
          schedulePreferenceCreateData.facility_time_to = facilityTimeTo;
          schedulePreferencePatchData.facility_time_from = facilityTimeFrom;
          schedulePreferencePatchData.facility_time_to = facilityTimeTo;
        }

        const preferredContactPhoneCandidate =
          intake && hasOwnKey(intake, 'contact_phone')
            ? intake.contact_phone
            : (updated.phone ??
              (intake && hasOwnKey(intake, 'contact_mobile') ? intake.contact_mobile : undefined) ??
              existing.phone);
        const nextPreferredContactPhone =
          normalizeNullableText(preferredContactPhoneCandidate) ?? null;

        if (intakePatch.hasAnyWrites) {
          if (requester && hasOwnKey(requester, 'contact_name')) {
            const preferredContactName = normalizeNullableText(requester.contact_name) ?? null;
            schedulePreferenceCreateData.preferred_contact_name = preferredContactName;
            schedulePreferencePatchData.preferred_contact_name = preferredContactName;
          } else if (intake && hasOwnKey(intake, 'emergency_contact')) {
            const preferredContactName =
              normalizeNullableText(intake.emergency_contact?.name) ?? null;
            schedulePreferenceCreateData.preferred_contact_name = preferredContactName;
            schedulePreferencePatchData.preferred_contact_name = preferredContactName;
          }

          schedulePreferenceCreateData.preferred_contact_phone = nextPreferredContactPhone;
          schedulePreferencePatchData.preferred_contact_phone = nextPreferredContactPhone;

          if (intake) {
            if (hasOwnKey(intake, 'primary_contact_preference')) {
              const value = normalizeNullableText(intake.primary_contact_preference) ?? null;
              schedulePreferenceCreateData.primary_contact_preference = value;
              schedulePreferencePatchData.primary_contact_preference = value;
            }
            if (hasOwnKey(intake, 'visit_before_contact_required')) {
              const value = intake.visit_before_contact_required ?? null;
              schedulePreferenceCreateData.visit_before_contact_required = value;
              schedulePreferencePatchData.visit_before_contact_required = value;
            }
            if (hasOwnKey(intake, 'first_visit_preferred_date')) {
              const value = intake.first_visit_preferred_date
                ? new Date(intake.first_visit_preferred_date)
                : null;
              schedulePreferenceCreateData.first_visit_preferred_date = value;
              schedulePreferencePatchData.first_visit_preferred_date = value;
            }
            if (hasOwnKey(intake, 'first_visit_time_slot')) {
              const value = normalizeNullableText(intake.first_visit_time_slot) ?? null;
              schedulePreferenceCreateData.first_visit_time_slot = value;
              schedulePreferencePatchData.first_visit_time_slot = value;
            }
            if (hasOwnKey(intake, 'first_visit_time_note')) {
              const value = normalizeNullableText(intake.first_visit_time_note) ?? null;
              schedulePreferenceCreateData.first_visit_time_note = value;
              schedulePreferencePatchData.first_visit_time_note = value;
            }
            if (hasOwnKey(intake, 'parking_available')) {
              const value = intake.parking_available ?? null;
              schedulePreferenceCreateData.parking_available = value;
              schedulePreferencePatchData.parking_available = value;
            }
            if (hasOwnKey(intake, 'mcs_linked')) {
              const value = intake.mcs_linked ?? null;
              schedulePreferenceCreateData.mcs_linked = value;
              schedulePreferencePatchData.mcs_linked = value;
            }
            if (hasOwnKey(intake, 'adl_level')) {
              const value = normalizeNullableText(intake.adl_level) ?? null;
              schedulePreferenceCreateData.adl_level = value;
              schedulePreferencePatchData.adl_level = value;
            }
            if (hasOwnKey(intake, 'dementia_level')) {
              const value = normalizeNullableText(intake.dementia_level) ?? null;
              schedulePreferenceCreateData.dementia_level = value;
              schedulePreferencePatchData.dementia_level = value;
            }
            if (hasOwnKey(intake, 'swallowing_route')) {
              const value = normalizeNullableText(intake.swallowing_route) ?? null;
              schedulePreferenceCreateData.swallowing_route = value;
              schedulePreferencePatchData.swallowing_route = value;
            }
            if (hasOwnKey(intake, 'care_level')) {
              const value = normalizeNullableText(intake.care_level) ?? null;
              schedulePreferenceCreateData.care_level = value;
              schedulePreferencePatchData.care_level = value;
            }
            if (hasOwnKey(intake, 'infection_isolation')) {
              const rawIsolation = normalizeNullableText(intake.infection_isolation);
              if (rawIsolation === undefined) {
                schedulePreferenceCreateData.infection_isolation = false;
                schedulePreferencePatchData.infection_isolation = false;
              } else {
                const trueValues = [
                  '要',
                  'あり',
                  'true',
                  '1',
                  'yes',
                  'droplet',
                  'contact',
                  'airborne',
                ];
                const falseValues = ['不要', 'なし', 'false', '0', 'no', 'none'];
                const lower = rawIsolation.toLowerCase();
                const isolationValue = trueValues.some((v) => v === rawIsolation || v === lower)
                  ? true
                  : falseValues.some((v) => v === rawIsolation || v === lower)
                    ? false
                    : rawIsolation.length > 0; // non-empty unknown strings default to true
                schedulePreferenceCreateData.infection_isolation = isolationValue;
                schedulePreferencePatchData.infection_isolation = isolationValue;
              }
            }
          }
        }

        if (Object.keys(schedulePreferencePatchData).length > 0) {
          // (臨床項目) 介護度/ADL/認知症度/嚥下/感染隔離 の差分を履歴化する。
          // PatientSchedulePreference は audit トリガ対象外のため本履歴が唯一の変更痕跡。
          // 値は期間で変わるため writePatientFieldRevisions の valid_from/valid_to で時点管理される。
          const clinicalFieldLabels: Record<string, string> = {
            care_level: '介護度',
            adl_level: 'ADL',
            dementia_level: '認知症度',
            swallowing_route: '嚥下',
            infection_isolation: '感染隔離',
          };
          const patchRecord = schedulePreferencePatchData as Record<string, unknown>;
          const hasClinicalChange = Object.keys(clinicalFieldLabels).some(
            (key) => key in schedulePreferencePatchData,
          );
          const existingPreference = hasClinicalChange
            ? await tx.patientSchedulePreference.findUnique({
                where: { patient_id: id },
                select: {
                  care_level: true,
                  adl_level: true,
                  dementia_level: true,
                  swallowing_route: true,
                  infection_isolation: true,
                },
              })
            : null;
          const existingRecord = existingPreference as Record<string, unknown> | null;
          for (const [fieldKey, fieldLabel] of Object.entries(clinicalFieldLabels)) {
            if (!(fieldKey in schedulePreferencePatchData)) continue;
            revisionEntries.push({
              category: 'clinical',
              field_key: fieldKey,
              field_label: fieldLabel,
              old_value: existingRecord?.[fieldKey] ?? null,
              new_value: patchRecord[fieldKey] ?? null,
            });
          }

          await tx.patientSchedulePreference.upsert({
            where: {
              patient_id: id,
            },
            create: schedulePreferenceCreateData,
            update: schedulePreferencePatchData,
          });
        }

        if (claimedCaseMutation) {
          // 在宅医療処置/麻薬を構造化テーブルへ反映(JSON継続SoT・追加レイヤ)。追加(=開始)は確認タスク化する。
          const structuredCare = await syncStructuredHomeCare(tx, {
            orgId: ctx.orgId,
            patientId: id,
            caseId: claimedCaseMutation.id,
            intake: claimedCaseMutation.nextHomeVisitIntake,
            source: effectiveSourceVisitRecordId ? 'visit_record' : 'patient_detail_edit',
            confirmedBy: ctx.userId,
            startDate: revisionDate,
          });
          if (structuredCare.proceduresAdded.includes('tpn')) {
            await upsertOperationalTask(tx, {
              orgId: ctx.orgId,
              taskType: 'patient_change_review',
              title: 'TPN開始: 無菌調製体制・物品を確認',
              priority: 'high',
              dedupeKey: `patient-tpn-start-review:${id}`,
              relatedEntityType: 'patient',
              relatedEntityId: id,
            });
          }
          if (structuredCare.narcoticsAdded.length > 0) {
            await upsertOperationalTask(tx, {
              orgId: ctx.orgId,
              taskType: 'patient_change_review',
              title: '麻薬開始: 残数確認・管理者・保管方法を確認',
              priority: 'high',
              dedupeKey: `patient-narcotic-start-review:${id}`,
              relatedEntityType: 'patient',
              relatedEntityId: id,
            });
          }
        }

        const closeActiveInsuranceRows = (
          insuranceType: 'medical' | 'care',
          extraWhere: Prisma.PatientInsuranceWhereInput = {},
        ) =>
          tx.patientInsurance.updateMany({
            where: {
              org_id: ctx.orgId,
              patient_id: id,
              insurance_type: insuranceType,
              is_active: true,
              ...extraWhere,
            },
            data: {
              is_active: false,
              valid_until: revisionDate,
            },
          });

        for (const [insuranceType, nextNumber] of [
          ['medical', normalizedMedicalInsuranceNumber],
          ['care', normalizedCareInsuranceNumber],
        ] as const) {
          if (nextNumber === undefined) continue;

          if (nextNumber) {
            const currentInsurance = await tx.patientInsurance.findFirst({
              where: {
                org_id: ctx.orgId,
                patient_id: id,
                insurance_type: insuranceType,
                is_active: true,
              },
              orderBy: [{ valid_from: 'desc' }, { created_at: 'desc' }],
              select: { id: true, number: true },
            });

            const numberChanged = currentInsurance ? currentInsurance.number !== nextNumber : true;

            if (numberChanged) {
              await closeActiveInsuranceRows(insuranceType);

              await tx.patientInsurance.create({
                data: {
                  org_id: ctx.orgId,
                  patient_id: id,
                  insurance_type: insuranceType,
                  number: nextNumber,
                  valid_from: revisionDate,
                  is_active: true,
                },
              });
            } else if (currentInsurance) {
              await closeActiveInsuranceRows(insuranceType, { id: { not: currentInsurance.id } });
            }
          } else {
            await closeActiveInsuranceRows(insuranceType);
          }
        }

        if (revisionEntries.length > 0) {
          await writePatientFieldRevisions(tx, {
            orgId: ctx.orgId,
            patientId: id,
            actorId: ctx.userId,
            validFrom: revisionDate,
            // 反映導線(訪問記録→患者詳細)経由の更新は出所を visit_record として記録する
            source: effectiveSourceVisitRecordId ? 'visit_record' : undefined,
            sourceVisitRecordId: effectiveSourceVisitRecordId ?? undefined,
            entries: revisionEntries,
          });

          const changedFieldKeys = new Set(
            revisionEntries
              .filter((entry) => !isJsonEqual(entry.old_value, entry.new_value))
              .map((entry) => entry.field_key),
          );
          if (changedFieldKeys.has('care_level')) {
            await upsertOperationalTask(tx, {
              orgId: ctx.orgId,
              taskType: 'patient_change_review',
              title: '介護度の変更: 保険・算定区分を確認',
              priority: 'normal',
              dedupeKey: `patient-care-level-review:${id}`,
              relatedEntityType: 'patient',
              relatedEntityId: id,
            });
          }
          if (changedFieldKeys.has('facility_id')) {
            await upsertOperationalTask(tx, {
              orgId: ctx.orgId,
              taskType: 'patient_change_review',
              title: '居住・施設の変更: 単一建物人数を確認',
              priority: 'normal',
              dedupeKey: `patient-residence-review:${id}`,
              relatedEntityType: 'patient',
              relatedEntityId: id,
            });
          }
        }

        return {
          patient: presentPatientPatch(updated),
          duplicateCandidates,
          versionBasis: {
            patient_updated_at: updated.updated_at.toISOString(),
            care_case_id: claimedCaseMutation?.id ?? null,
            care_case_version:
              claimedCaseMutation && expected_care_case_version != null
                ? expected_care_case_version + 1
                : null,
          },
        };
      },
      { requestContext: ctx },
    );

    return withSensitiveNoStore(
      success({
        data: transactionResult.patient,
        meta: {
          warnings:
            transactionResult.duplicateCandidates.length > 0
              ? [
                  {
                    code: 'PATIENT_DUPLICATE_ACKNOWLEDGED',
                    severity: 'warning',
                    message: '重複候補を確認済みとして患者情報を更新しました。',
                  },
                ]
              : [],
          duplicate_candidates: transactionResult.duplicateCandidates,
          version_basis: transactionResult.versionBasis,
        },
      }),
    );
  } catch (error) {
    if (error instanceof PatientPatchResponseError) {
      return withSensitiveNoStore(error.response);
    }
    if (error instanceof PatientPatchConflictError) {
      return withSensitiveNoStore(
        conflict('患者情報が同時に更新されました。画面を再読み込みしてください', {
          conflict_type: error.conflictType,
        }),
      );
    }
    if (
      error instanceof FacilityReferenceValidationError ||
      error instanceof FacilityUnitReferenceValidationError
    ) {
      return validationError(error.message);
    }
    throw error;
  }
}

export const PATCH = withAuthContext(executeAuthenticatedPatientPatch, {
  permission: 'canVisit',
  message: '患者情報の更新権限がありません',
});
