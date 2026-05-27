import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { createPrescriptionIntake } from '@/server/services/prescription-intake-service';
import {
  attachJahisSupplementalRecordsToIntake,
  readJahisSupplementalRecords,
} from '@/server/services/jahis-supplemental-records';
import { broadcastOrgRealtimeEvent } from '@/server/services/org-realtime';
import { z } from 'zod';
import {
  buildQrDraftAssignmentWhere,
  getAssignedPatientIds,
} from '@/server/services/prescription-access';
import { prisma } from '@/lib/db/client';

const confirmQrDraftSchema = z.object({
  patient_id: z.string().min(1),
  case_id: z.string().min(1),
  lines: z
    .array(
      z.object({
        drug_name: z.string().min(1),
        drug_code: z.string().optional(),
        dosage_form: z.string().optional(),
        dose: z.string().min(1),
        frequency: z.string().min(1),
        days: z.number().int().min(1),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        is_generic: z.boolean().optional(),
        packaging_method: z.string().optional(),
        packaging_instructions: z.string().optional(),
        packaging_instruction_tags: z.array(z.string()).optional(),
        route: z.string().optional(),
        dispensing_method: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .min(1),
  prescribed_date: z.string().min(1),
  prescriber_name: z.string().optional(),
  prescriber_institution_id: z.string().optional(),
  prescriber_institution: z.string().optional(),
});

export const POST = withAuth(
  async (req: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = confirmQrDraftSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const {
      patient_id,
      case_id,
      lines,
      prescribed_date,
      prescriber_name,
      prescriber_institution_id,
      prescriber_institution,
    } = parsed.data;
    const assignedPatientIds = await getAssignedPatientIds(prisma, req.orgId, req);
    const assignmentWhere = buildQrDraftAssignmentWhere(req, assignedPatientIds ?? []);

    // Fetch draft and verify it belongs to this org and is pending
    const draft = await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: {
          id,
          org_id: req.orgId,
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
        select: {
          id: true,
          status: true,
          org_id: true,
          patient_id: true,
          scanned_by: true,
          parsed_data: true,
        },
      });
    });

    if (!draft) {
      return notFound('QRスキャン下書きが見つかりません');
    }

    if (draft.status !== 'pending') {
      return validationError('このQRスキャン下書きはすでに処理済みです');
    }

    if (draft.patient_id && draft.patient_id !== patient_id) {
      return validationError('QRスキャン下書きに紐付く患者と確定先患者が一致しません', {
        patient_id: ['QRスキャン下書きに紐付く患者と確定先患者が一致しません'],
      });
    }

    // Build intake input — data is fully validated by PC review UI
    const intakeInput = {
      case_id,
      patient_id,
      source_type: 'qr_scan' as const,
      prescribed_date,
      prescriber_name,
      prescriber_institution_id,
      prescriber_institution,
      lines: lines.map((line, index) => ({
        line_number: index + 1,
        drug_name: line.drug_name,
        drug_code: line.drug_code,
        dosage_form: line.dosage_form,
        dose: line.dose,
        frequency: line.frequency,
        days: line.days,
        quantity: line.quantity,
        unit: line.unit,
        is_generic: line.is_generic,
        packaging_instructions: line.packaging_instructions,
        route: line.route as 'internal' | 'external' | 'injection' | 'other' | undefined,
        dispensing_method: line.dispensing_method as
          | 'standard'
          | 'unit_dose'
          | 'crushed'
          | 'other'
          | undefined,
        start_date: line.start_date,
        end_date: line.end_date,
        notes: line.notes,
      })),
    };

    const result = await createPrescriptionIntake(intakeInput, req.orgId, req.userId, {
      skipStructuringCheck: true,
      accessContext: { userId: req.userId, role: req.role },
    });

    if (!result.ok) {
      if (result.error === 'cycle_not_found') {
        return validationError('指定されたサイクルが見つかりません');
      }
      if (result.error === 'duplicate_prescription_lines') {
        return validationError('重複候補の処方明細があるため受付できません', {
          duplicates: result.duplicates,
        });
      }
      if (result.error === 'expiry_exceeded') {
        return validationError('処方箋の有効期限が切れています（発行日から4日以内が有効です）');
      }
      if (result.error === 'prescriber_institution_not_found') {
        return validationError(result.message);
      }
      return validationError('処方受付の作成に失敗しました');
    }

    const parsedData = draft.parsed_data as Record<string, unknown> | null;
    const supplementalRecords = readJahisSupplementalRecords(parsedData?.supplementalRecords);

    // Update draft status to confirmed
    await withOrgContext(req.orgId, async (tx) => {
      await attachJahisSupplementalRecordsToIntake(tx, {
        orgId: req.orgId,
        patientId: patient_id,
        qrDraftId: id,
        prescriptionIntakeId: result.intake.id,
        fallbackRecords: supplementalRecords,
      });

      return tx.qrScanDraft.update({
        where: { id },
        data: {
          patient_id,
          status: 'confirmed',
          confirmed_intake_id: result.intake.id,
        },
      });
    });

    // Cross-user confirmation audit log (best-effort)
    if (draft.scanned_by && draft.scanned_by !== req.userId) {
      try {
        await withOrgContext(req.orgId, async (tx) => {
          return tx.cycleTransitionLog.create({
            data: {
              org_id: req.orgId,
              cycle_id: result.cycle.id,
              from_status: 'qr_cross_user_confirm',
              to_status: 'qr_cross_user_confirm',
              actor_id: req.userId,
              note: `QR下書き確定: スキャン者=${draft.scanned_by}, 確定者=${req.userId}`,
            },
          });
        });
      } catch {
        // Audit log is best-effort
      }
    }

    // Broadcast realtime event (best-effort)
    await broadcastOrgRealtimeEvent({
      orgId: req.orgId,
      type: 'qr_draft_confirmed',
    });

    return success(
      {
        intake: result.intake,
        cycle: result.cycle,
        medicationChanges: result.medicationChanges,
        profileSyncResult: result.profileSyncResult,
      },
      201,
    );
  },
  {
    permission: 'canVisit',
    message: '処方受付の作成権限がありません',
  },
);
