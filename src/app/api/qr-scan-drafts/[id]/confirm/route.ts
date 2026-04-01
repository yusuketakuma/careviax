import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { createPrescriptionIntake } from '@/server/services/prescription-intake-service';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import { z } from 'zod';

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
      })
    )
    .min(1),
  prescribed_date: z.string().min(1),
  prescriber_name: z.string().optional(),
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

    const { patient_id, case_id, lines, prescribed_date, prescriber_name, prescriber_institution } =
      parsed.data;

    // Fetch draft and verify it belongs to this org and is pending
    const draft = await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.findFirst({
        where: { id, org_id: req.orgId },
        select: { id: true, status: true, org_id: true, scanned_by: true },
      });
    });

    if (!draft) {
      return notFound('QRスキャン下書きが見つかりません');
    }

    if (draft.status !== 'pending') {
      return validationError('このQRスキャン下書きはすでに処理済みです');
    }

    // Resolve cycle_id from case_id
    const cycle = await withOrgContext(req.orgId, async (tx) => {
      return tx.medicationCycle.findFirst({
        where: { org_id: req.orgId, case_id, patient_id },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      });
    });

    if (!cycle) {
      return validationError('指定された患者・ケースに対応する服薬サイクルが見つかりません');
    }

    // Build intake input — data is fully validated by PC review UI
    const intakeInput = {
      cycle_id: cycle.id,
      source_type: 'qr_scan' as const,
      prescribed_date,
      prescriber_name,
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

    // Update draft status to confirmed
    await withOrgContext(req.orgId, async (tx) => {
      return tx.qrScanDraft.update({
        where: { id },
        data: {
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
    try {
      const adapter = getRealtimeAdapter();
      adapter.broadcastStatusUpdate(`org:${req.orgId}:qr-drafts`, {
        type: 'qr_draft_confirmed',
        payload: { draftId: id, intakeId: result.intake.id, cycleId: result.cycle.id },
      });
    } catch {
      // Realtime broadcast is best-effort
    }

    return success({
      intake: result.intake,
      cycle: result.cycle,
      medicationChanges: result.medicationChanges,
      profileSyncResult: result.profileSyncResult,
    }, 201);
  },
  {
    permission: 'canVisit',
    message: '処方受付の作成権限がありません',
  }
);
