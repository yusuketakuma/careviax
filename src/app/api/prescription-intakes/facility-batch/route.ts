import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { createFacilityBatchPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { addDays } from 'date-fns';
import { collectDuplicatePrescriptionLines, collectStructuringBlockedLines } from '../shared';
import { PrescriberInstitutionReferenceValidationError } from '@/lib/prescriptions/prescriber-institutions';
import {
  createPrescriptionIntakeInTx,
  runPrescriptionIntakePostCreateHooks,
} from '@/server/services/prescription-intake-service';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createFacilityBatchPrescriptionIntakeSchema.safeParse(body);
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

    const prescribedDate = new Date(prescribed_date);
    const expiryDate = addDays(prescribedDate, 4);
    if (expiryDate < new Date()) {
      return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
    }

    const duplicatedCaseIds = entries
      .map((entry) => entry.case_id)
      .filter((caseId, index, array) => array.indexOf(caseId) !== index);
    if (duplicatedCaseIds.length > 0) {
      return validationError('施設まとめ処方に同じケースが重複しています', {
        duplicated_case_ids: Array.from(new Set(duplicatedCaseIds)),
      });
    }

    let result;
    try {
      result = await withOrgContext(req.orgId, async (tx) => {
        const assignmentWhere = buildCareCaseAssignmentWhere(req);
        const cases = await tx.careCase.findMany({
          where: {
            org_id: req.orgId,
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
            req.orgId,
            req.userId,
            { accessContext: { userId: req.userId, role: req.role } },
          );

          if (intakeResult.kind === 'error') {
            if (intakeResult.error === 'cycle_not_found') {
              return {
                error: 'case_patient_mismatch' as const,
                caseId: entry.case_id,
              };
            }
            if (intakeResult.error === 'duplicate_prescription_lines') {
              return {
                error: 'duplicate_prescription_lines' as const,
                caseId: entry.case_id,
                patientName: careCase.patient.name,
                duplicates: intakeResult.duplicates,
              };
            }
            if (intakeResult.error === 'structuring_blocked_lines') {
              return {
                error: 'structuring_blocked_lines' as const,
                caseId: entry.case_id,
                patientName: careCase.patient.name,
                blockedLines: intakeResult.blockedLines,
              };
            }
            if (intakeResult.error === 'invalid_transition') {
              return { error: 'invalid_transition' as const };
            }
            if (intakeResult.error === 'version_conflict') {
              return { error: 'version_conflict' as const };
            }
            return { error: 'unexpected_create_failure' as const };
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
            orgId: req.orgId,
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
      if (error instanceof PrescriberInstitutionReferenceValidationError) {
        return validationError(error.message);
      }
      throw error;
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
