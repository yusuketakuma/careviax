import { withAuthContext } from '@/lib/auth/context';
import { conflict, internalError, success, validationError } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  createReferralIntake,
  ReferralIntakeTransactionError,
} from '@/server/services/referral-intake-service';
import { createReferralSchema } from '@/lib/validations/referral';

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createReferralSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    try {
      const result = await createReferralIntake(ctx, parsed.data);
      if (result.status === 'duplicate') {
        return conflict('重複している可能性がある患者が存在します', {
          duplicate_type: 'patient_identity',
          duplicate_count: result.duplicate_count,
          duplicates: result.duplicates,
        });
      }

      return success(
        {
          patient: result.patient,
          case: result.case,
          warnings: result.warnings,
          metadata: result.metadata,
        },
        201,
      );
    } catch (error) {
      if (error instanceof ReferralIntakeTransactionError) {
        return internalError('紹介受付の登録に失敗しました');
      }
      throw error;
    }
  },
  {
    permission: 'canVisit',
    message: '紹介受付の作成権限がありません',
  },
);
