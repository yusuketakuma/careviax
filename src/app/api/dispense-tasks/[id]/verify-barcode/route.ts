import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, validationError, notFound } from '@/lib/api/response';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';
import { parseGS1Barcode, isExpired } from '@/lib/pharmacy/barcode';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';

const verifyBarcodeSchema = z.object({
  barcode: z.string().min(1, 'バーコードは必須です'),
  line_id: z.string().min(1, '処方明細IDは必須です'),
});

export const POST = withAuthContext<{ id: string }>(
  async (req: NextRequest, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('調剤タスクIDが不正です');

    const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = verifyBarcodeSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const task = await prisma.dispenseTask.findFirst({
      where: {
        id,
        org_id: ctx.orgId,
        ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
      },
      select: { id: true, cycle_id: true },
    });
    if (!task) return notFound('タスクが見つかりません');

    const { barcode, line_id } = parsed.data;

    const line = await prisma.prescriptionLine.findFirst({
      where: {
        id: line_id,
        org_id: ctx.orgId,
        intake: {
          cycle_id: task.cycle_id,
        },
      },
      select: {
        id: true,
        drug_code: true,
        drug_name: true,
      },
    });
    if (!line) return notFound('処方明細が見つかりません');

    const decoded = parseGS1Barcode(barcode);

    // GTIN → YJコード照合
    // DrugMaster の jan_code または yj_code で照合する
    // GTIN (14桁) の先頭1桁はインジケーター桁なので、実質 JAN は後ろ13桁
    let gtinMatchesDrugCode = false;

    if (decoded.gtin) {
      const gtin = decoded.gtin;
      // Jan コード (13桁) は GTIN (14桁) の2〜14桁目
      const janFromGtin = gtin.length === 14 ? gtin.substring(1) : gtin;

      // 1) DrugMaster の jan_code または yj_code で完全一致照合
      const drugByJan = await prisma.drugMaster.findFirst({
        where: {
          OR: [{ jan_code: janFromGtin }, { jan_code: gtin }],
        },
        select: { yj_code: true },
      });

      if (drugByJan) {
        // DrugMaster で見つかった場合、処方明細の drug_code (YJコード) と比較
        gtinMatchesDrugCode = drugByJan.yj_code === line.drug_code;
      } else if (line.drug_code) {
        // 2) DrugMaster に GTIN が登録されていない場合、GTIN 先頭桁の部分マッチを試みる
        // YJコード (12桁) と GTIN の先頭12桁を比較
        const gtinPrefix = gtin.substring(0, 12);
        gtinMatchesDrugCode = line.drug_code.startsWith(gtinPrefix.substring(0, 7));
      }
    }

    const warnings: string[] = [];

    if (decoded.expiryDate && isExpired(decoded.expiryDate)) {
      warnings.push('有効期限切れの薬剤です');
    }

    if (!gtinMatchesDrugCode) {
      warnings.push('バーコードが処方薬と一致しません');
    }

    return success({
      match: gtinMatchesDrugCode,
      decoded: {
        gtin: decoded.gtin,
        expiryDate: decoded.expiryDate,
        lotNumber: decoded.lotNumber,
      },
      expected: {
        drug_code: line.drug_code,
        drug_name: line.drug_name,
      },
      warnings,
    });
  },
  {
    permission: 'canDispense',
    message: 'バーコード照合権限がありません',
  },
);
