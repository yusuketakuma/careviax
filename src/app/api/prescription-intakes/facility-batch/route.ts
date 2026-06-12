import { withAuthContext } from '@/lib/auth/context';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { createFacilityBatchPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { collectDuplicatePrescriptionLines, collectStructuringBlockedLines } from '../shared';
import { PrescriberInstitutionReferenceValidationError } from '@/lib/prescriptions/prescriber-institutions';
import {
  createPrescriptionIntakeInTx,
  PrescriptionIntakeTransactionRollback,
  runPrescriptionIntakePostCreateHooks,
} from '@/server/services/prescription-intake-service';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { validatePrescriptionDateWindow } from '@/lib/prescription/prescription-date-window';

type FacilityBatchErrorResult =
  | { error: 'missing_case' }
  | { error: 'case_patient_mismatch'; caseId: string }
  | {
      error: 'duplicate_prescription_lines';
      caseId: string;
      patientName: string;
      duplicates: Array<{ key: string; lines: Array<{ line_number: number; drug_name: string }> }>;
    }
  | {
      error: 'structuring_blocked_lines';
      caseId: string;
      patientName: string;
      blockedLines: Array<{ line_number: number; drug_name: string }>;
    }
  | {
      error: 'outpatient_injection_not_eligible';
      caseId: string;
      patientId: string;
      patientName: string;
      blockedLines: Array<{ line_number: number; drug_name: string; reason: string }>;
    }
  | { error: 'missing_facility_label'; caseId: string; patientName: string }
  | { error: 'mixed_facilities'; facilities: string[] }
  | { error: 'invalid_transition' }
  | { error: 'version_conflict' }
  | { error: 'unexpected_create_failure' };

type FacilityBatchSuccessResult = {
  facility_label: string | null;
  patient_count: number;
  entries: Array<{
    cycle_id: string;
    intake_id: string;
    case_id: string;
    patient_id: string;
    patient_name: string;
    line_count: number;
  }>;
  hookArgs: Array<Parameters<typeof runPrescriptionIntakePostCreateHooks>[0]>;
};

class FacilityBatchIntakeRollback extends Error {
  constructor(readonly result: FacilityBatchErrorResult) {
    super('Facility batch prescription intake rolled back');
  }
}

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createFacilityBatchPrescriptionIntakeSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      source_type,
      prescribed_date,
      prescriber_name,
      prescriber_institution_id,
      prescriber_institution,
      original_document_url,
      prescription_category,
      emergency_category,
      entries,
    } = parsed.data;

    const dateWindow = validatePrescriptionDateWindow(prescribed_date);
    if (!dateWindow.ok && dateWindow.reason === 'expiry_exceeded') {
      return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
    }
    if (!dateWindow.ok && dateWindow.reason === 'future_prescribed_date') {
      return validationError('未来日の処方箋は登録できません');
    }

    const duplicatedCaseIds = entries
      .map((entry) => entry.case_id)
      .filter((caseId, index, array) => array.indexOf(caseId) !== index);
    if (duplicatedCaseIds.length > 0) {
      return validationError('施設まとめ処方に同じケースが重複しています', {
        duplicated_case_ids: Array.from(new Set(duplicatedCaseIds)),
      });
    }

    let result: FacilityBatchSuccessResult | FacilityBatchErrorResult;
    try {
      result = await withOrgContext(ctx.orgId, async (tx) => {
        const assignmentWhere = buildCareCaseAssignmentWhere(ctx);
        const cases = await tx.careCase.findMany({
          where: {
            org_id: ctx.orgId,
            id: {
              in: entries.map((entry) => entry.case_id),
            },
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          },
          select: {
            id: true,
            patient_id: true,
            patient: {
              select: {
                id: true,
                name: true,
                residences: {
                  where: { is_primary: true },
                  take: 1,
                  select: {
                    address: true,
                    building_id: true,
                  },
                },
              },
            },
          },
        });

        if (cases.length !== entries.length) {
          return { error: 'missing_case' as const };
        }

        const caseById = new Map(cases.map((careCase) => [careCase.id, careCase]));
        const facilityLabels = new Set<string>();

        for (const entry of entries) {
          const careCase = caseById.get(entry.case_id);
          if (!careCase || careCase.patient_id !== entry.patient_id) {
            return { error: 'case_patient_mismatch' as const, caseId: entry.case_id };
          }

          const duplicateCandidates = collectDuplicatePrescriptionLines(entry.lines);
          if (duplicateCandidates.length > 0) {
            return {
              error: 'duplicate_prescription_lines' as const,
              caseId: entry.case_id,
              patientName: careCase.patient.name,
              duplicates: duplicateCandidates,
            };
          }

          const blockedLines = collectStructuringBlockedLines(entry.lines);
          if (blockedLines.length > 0) {
            return {
              error: 'structuring_blocked_lines' as const,
              caseId: entry.case_id,
              patientName: careCase.patient.name,
              blockedLines: blockedLines.map((line) => ({
                line_number: line.line_number,
                drug_name: line.drug_name,
              })),
            };
          }

          const residence = careCase.patient.residences[0];
          const facilityLabel = deriveFacilityLabel(residence ?? null);
          if (!facilityLabel) {
            return {
              error: 'missing_facility_label' as const,
              caseId: entry.case_id,
              patientName: careCase.patient.name,
            };
          }
          facilityLabels.add(facilityLabel);
        }

        if (facilityLabels.size > 1) {
          return {
            error: 'mixed_facilities' as const,
            facilities: Array.from(facilityLabels),
          };
        }

        const createdEntries = [];
        const hookArgs: Array<Parameters<typeof runPrescriptionIntakePostCreateHooks>[0]> = [];
        for (const entry of entries) {
          const careCase = caseById.get(entry.case_id)!;
          const intakeResult = await createPrescriptionIntakeInTx(
            tx,
            {
              case_id: entry.case_id,
              patient_id: entry.patient_id,
              source_type,
              prescribed_date,
              prescriber_name,
              prescriber_institution_id,
              prescriber_institution,
              original_document_url,
              prescription_category,
              emergency_category,
              lines: entry.lines,
            },
            ctx.orgId,
            ctx.userId,
            { accessContext: { userId: ctx.userId, role: ctx.role } },
          );

          if (intakeResult.kind === 'error') {
            if (intakeResult.error === 'cycle_not_found') {
              throw new FacilityBatchIntakeRollback({
                error: 'case_patient_mismatch' as const,
                caseId: entry.case_id,
              });
            }
            if (intakeResult.error === 'duplicate_prescription_lines') {
              throw new FacilityBatchIntakeRollback({
                error: 'duplicate_prescription_lines' as const,
                caseId: entry.case_id,
                patientName: careCase.patient.name,
                duplicates: intakeResult.duplicates,
              });
            }
            if (intakeResult.error === 'structuring_blocked_lines') {
              throw new FacilityBatchIntakeRollback({
                error: 'structuring_blocked_lines' as const,
                caseId: entry.case_id,
                patientName: careCase.patient.name,
                blockedLines: intakeResult.blockedLines,
              });
            }
            if (intakeResult.error === 'outpatient_injection_not_eligible') {
              throw new FacilityBatchIntakeRollback({
                error: 'outpatient_injection_not_eligible' as const,
                caseId: entry.case_id,
                patientId: entry.patient_id,
                patientName: careCase.patient.name,
                blockedLines: intakeResult.blockedLines,
              });
            }
            if (intakeResult.error === 'invalid_transition') {
              throw new FacilityBatchIntakeRollback({ error: 'invalid_transition' as const });
            }
            if (intakeResult.error === 'version_conflict') {
              throw new FacilityBatchIntakeRollback({ error: 'version_conflict' as const });
            }
            throw new FacilityBatchIntakeRollback({
              error: 'unexpected_create_failure' as const,
            });
          }

          createdEntries.push({
            cycle_id: intakeResult.cycle.id,
            intake_id: intakeResult.intake.id,
            case_id: careCase.id,
            patient_id: careCase.patient.id,
            patient_name: careCase.patient.name,
            line_count: intakeResult.intake.lines.length,
          });
          hookArgs.push({
            cycleId: intakeResult.cycle.id,
            intakeId: intakeResult.intake.id,
            patientId: careCase.patient.id,
            orgId: ctx.orgId,
            lines: entry.lines,
            prescriberName: prescriber_name ?? null,
            sourceType: source_type,
          });
        }

        return {
          facility_label: Array.from(facilityLabels)[0] ?? null,
          patient_count: createdEntries.length,
          entries: createdEntries,
          hookArgs,
        };
      });
    } catch (error) {
      if (error instanceof FacilityBatchIntakeRollback) {
        result = error.result;
      } else if (error instanceof PrescriptionIntakeTransactionRollback) {
        result = { error: error.result.error };
      } else if (error instanceof PrescriberInstitutionReferenceValidationError) {
        return validationError(error.message);
      } else {
        throw error;
      }
    }

    if ('error' in result) {
      if (result.error === 'missing_case') {
        return validationError('施設まとめ処方に含まれるケースが見つかりません');
      }
      if (result.error === 'case_patient_mismatch') {
        return validationError('ケースと患者の組み合わせが不正です', {
          case_id: result.caseId,
        });
      }
      if (result.error === 'duplicate_prescription_lines') {
        return validationError('施設まとめ処方に重複候補の処方明細があります', {
          case_id: result.caseId,
          patient_name: result.patientName,
          duplicates: result.duplicates,
        });
      }
      if (result.error === 'structuring_blocked_lines') {
        return validationError('施設まとめ処方に未構造化または不明な明細があります', {
          case_id: result.caseId,
          patient_name: result.patientName,
          blocked_lines: result.blockedLines,
        });
      }
      if (result.error === 'outpatient_injection_not_eligible') {
        return validationError(
          '施設まとめ処方に外来/在宅自己注射として調剤可否が未確認の注射剤があります',
          {
            case_id: result.caseId,
            patient_id: result.patientId,
            patient_name: result.patientName,
            blocked_lines: result.blockedLines,
          },
        );
      }
      if (result.error === 'missing_facility_label') {
        return validationError('施設まとめ処方の対象患者に施設住所または建物IDがありません', {
          case_id: result.caseId,
          patient_name: result.patientName,
        });
      }
      if (result.error === 'mixed_facilities') {
        return validationError('施設まとめ処方は同一施設の患者のみ一括登録できます', {
          facilities: result.facilities,
        });
      }
      if (result.error === 'invalid_transition') {
        return validationError('施設まとめ処方の状態遷移が無効です');
      }
      if (result.error === 'version_conflict') {
        return validationError(
          '施設まとめ処方の登録中に他ユーザーの更新が入りました。再度実行してください',
        );
      }
      if (result.error === 'unexpected_create_failure') {
        return validationError('施設まとめ処方の登録に失敗しました');
      }
    }

    await Promise.allSettled(
      result.hookArgs.map((args) => runPrescriptionIntakePostCreateHooks(args)),
    );

    return success(
      {
        facility_label: result.facility_label,
        patient_count: result.patient_count,
        entries: result.entries,
      },
      201,
    );
  },
  {
    permission: 'canVisit',
    message: '施設まとめ処方の作成権限がありません',
  },
);
