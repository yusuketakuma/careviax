import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { createFacilityBatchPrescriptionIntakeSchema } from '@/lib/validations/prescription';
import { addDays } from 'date-fns';
import {
  collectDuplicatePrescriptionLines,
  collectStructuringBlockedLines,
} from '../shared';

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
      prescriber_institution,
      original_document_url,
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

    const result = await withOrgContext(req.orgId, async (tx) => {
      const cases = await tx.careCase.findMany({
        where: {
          org_id: req.orgId,
          id: {
            in: entries.map((entry) => entry.case_id),
          },
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
        const facilityLabel = residence?.building_id ?? residence?.address ?? null;
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
      for (const entry of entries) {
        const careCase = caseById.get(entry.case_id)!;
        const cycle = await tx.medicationCycle.create({
          data: {
            org_id: req.orgId,
            case_id: entry.case_id,
            patient_id: entry.patient_id,
            overall_status: 'intake_received',
            version: 1,
          },
        });

        const intake = await tx.prescriptionIntake.create({
          data: {
            org_id: req.orgId,
            cycle_id: cycle.id,
            source_type,
            prescribed_date: prescribedDate,
            prescription_expiry_date: expiryDate,
            ...(prescriber_name ? { prescriber_name } : {}),
            ...(prescriber_institution ? { prescriber_institution } : {}),
            ...(original_document_url ? { original_document_url } : {}),
            lines: {
              create: entry.lines.map((line) => ({
                org_id: req.orgId,
                ...line,
              })),
            },
          },
          include: {
            lines: {
              select: {
                id: true,
              },
            },
          },
        });

        createdEntries.push({
          cycle_id: cycle.id,
          intake_id: intake.id,
          case_id: careCase.id,
          patient_id: careCase.patient.id,
          patient_name: careCase.patient.name,
          line_count: intake.lines.length,
        });
      }

      return {
        facility_label: Array.from(facilityLabels)[0] ?? null,
        patient_count: createdEntries.length,
        entries: createdEntries,
      };
    });

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
    }

    return success(result, 201);
  },
  {
    permission: 'canVisit',
    message: '施設まとめ処方の作成権限がありません',
  }
);
