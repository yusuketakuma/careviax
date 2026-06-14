import { NextRequest } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { success, notFound, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { decodeKeysetCursor, encodeKeysetCursor } from '@/lib/api/keyset-cursor';
import { prisma } from '@/lib/db/client';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import type { Prisma } from '@prisma/client';
import { applyPatientAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import { listAccessiblePatientCaseIds } from '@/server/services/patient-access';
import { detectMedicationChanges, prescriptionLineKey } from '@/lib/prescription/medication-diff';

const PATIENT_PRESCRIPTION_CURSOR_KEYS = ['prescribed_date', 'created_at'] as const;

// p0_11「処方の変化を確認」: 変化 / 前回 / 今回 / 薬剤師メモ の 4 列 + サブカード用の差分集約

type DiffReviewLine = {
  drug_name: string;
  drug_code: string | null;
  dose: string;
  frequency: string;
  days: number;
  packaging_instructions: string | null;
  dispensing_method: string | null;
  /** Prisma の DateTime? @db.Date(JS Date)。JSON 化前は Date 型 */
  start_date: Date | null;
  notes: string | null;
};

type DiffReviewChangeType = 'added' | 'removed' | 'changed' | 'unchanged';

type DiffReviewRow = {
  /** 安定キー(drug_code 優先、なければ drug_name) */
  key: string;
  drug_name: string;
  /** added | removed | changed | unchanged */
  change_type: DiffReviewChangeType;
  /** 変化列ラベル: 追加 / 中止 / 変更 / 変化なし */
  change_label: string;
  /** 前回列: dose / frequency / days を畳んだ表示(無ければ「なし」) */
  previous_label: string | null;
  /** 今回列: 同上(中止のときは「中止」、変化なしのときは「同じ」) */
  current_label: string | null;
  /** 薬剤師メモ列: 現行行(中止時は前回行)の notes */
  pharmacist_memo: string | null;
};

const CHANGE_LABELS: Record<DiffReviewChangeType, string> = {
  added: '追加',
  removed: '中止',
  changed: '変更',
  unchanged: '変化なし',
};

/** dose / frequency / days を 1 行ラベルへ。例: 「4mg 朝食後 28日」 */
function formatLineLabel(line: DiffReviewLine): string {
  return [line.dose, line.frequency, `${line.days}日`].filter(Boolean).join(' ');
}

/** 開始日(Date)を「M/d」へ */
function formatStartDate(value: Date): string {
  return `${value.getMonth() + 1}/${value.getDate()}`;
}

/** 一包化・粉砕などセット(配薬)に影響する加工が指定されているか */
function hasSetProcessing(line: DiffReviewLine): boolean {
  const method = line.dispensing_method;
  if (method === 'unit_dose' || method === 'crushed' || method === 'separate_pack') return true;
  const pkg = line.packaging_instructions ?? '';
  return /一包化|粉砕|別包/.test(pkg);
}

/**
 * 最新 intake と前回 intake から p0_11 の差分レビュー構造を組み立てる。
 * 既存の detectMedicationChanges を流用し、変化なしの行も含めて 4 列テーブルを作る。
 */
function buildDiffReview(latest: DiffReviewLine[], previous: DiffReviewLine[]) {
  // サブカード集約・件数には既存の detectMedicationChanges を流用する
  const changes = detectMedicationChanges(latest, previous);
  const prevByKey = new Map(previous.map((line) => [prescriptionLineKey(line), line]));

  const rows: DiffReviewRow[] = [];

  // 今回処方に存在する行(追加 / 変更 / 変化なし)。
  // detectMedicationChanges と同じ prescriptionLineKey 同定で前回行と突き合わせる
  for (const line of latest) {
    const key = prescriptionLineKey(line);
    const prev = prevByKey.get(key) ?? null;
    let changeType: DiffReviewChangeType;
    if (!prev) {
      changeType = 'added';
    } else if (prev.dose !== line.dose || prev.frequency !== line.frequency) {
      changeType = 'changed';
    } else {
      changeType = 'unchanged';
    }
    rows.push({
      key,
      drug_name: line.drug_name,
      change_type: changeType,
      change_label: CHANGE_LABELS[changeType],
      previous_label: prev ? formatLineLabel(prev) : 'なし',
      current_label: changeType === 'unchanged' ? '同じ' : formatLineLabel(line),
      pharmacist_memo: line.notes?.trim() || null,
    });
  }

  // 前回のみ存在する行(中止)
  for (const line of previous) {
    const key = prescriptionLineKey(line);
    if (latest.some((current) => prescriptionLineKey(current) === key)) continue;
    rows.push({
      key,
      drug_name: line.drug_name,
      change_type: 'removed',
      change_label: CHANGE_LABELS.removed,
      previous_label: formatLineLabel(line),
      current_label: '中止',
      pharmacist_memo: line.notes?.trim() || null,
    });
  }

  // 変化のある行を上に、変化なしを下に並べる
  const order: Record<DiffReviewChangeType, number> = { added: 0, removed: 1, changed: 2, unchanged: 3 };
  rows.sort((a, b) => order[a.change_type] - order[b.change_type]);

  // サブカード「セットにも影響する変化」: 中止薬回収 / 加工指定 / 開始日指定
  const setImpacts: string[] = [];
  const removedLines = previous.filter(
    (line) => !latest.some((current) => prescriptionLineKey(current) === prescriptionLineKey(line)),
  );
  if (removedLines.length > 0) {
    setImpacts.push(`中止薬回収が必要: ${removedLines.map((line) => line.drug_name).join('、')}`);
  }
  const hasDoseOrFreqChange = changes.some(
    (change) => change.change_type === 'dose_changed' || change.change_type === 'frequency_changed',
  );
  if (hasDoseOrFreqChange) {
    setImpacts.push('残薬を今回セットに使う(用量・日数の変化あり)');
  }
  const processingLines = latest.filter(hasSetProcessing);
  if (processingLines.length > 0) {
    setImpacts.push(`加工指定あり: ${processingLines.map((line) => line.drug_name).join('、')}`);
  }
  const startDated = latest.find((line) => Boolean(line.start_date));
  if (startDated?.start_date) {
    setImpacts.push(`開始日指定あり：${formatStartDate(startDated.start_date)}から`);
  }

  // サブカード「患者さんに確認したいこと」: 追加・変更・中止の薬剤名から確認観点を生成
  const patientChecks: string[] = [];
  for (const change of changes) {
    if (change.change_type === 'added') {
      patientChecks.push(`${change.drug_name}を開始して体調変化がないか`);
    } else if (change.change_type === 'removed') {
      patientChecks.push(`${change.drug_name}の中止後の症状変化`);
    } else {
      patientChecks.push(`${change.drug_name}の変更前後で困りごとがないか`);
    }
  }

  return {
    rows,
    set_impacts: setImpacts,
    patient_checks: patientChecks.slice(0, 6),
    change_count: changes.length,
  };
}

function buildKeysetWhere(
  cursor: ReturnType<typeof decodeKeysetCursor<(typeof PATIENT_PRESCRIPTION_CURSOR_KEYS)[number]>>,
): Prisma.PrescriptionIntakeWhereInput | null {
  if (!cursor) return null;

  return {
    OR: [
      { prescribed_date: { lt: cursor.prescribed_date } },
      {
        prescribed_date: cursor.prescribed_date,
        created_at: { lt: cursor.created_at },
      },
      {
        prescribed_date: cursor.prescribed_date,
        created_at: cursor.created_at,
        id: { lt: cursor.id },
      },
    ],
  };
}

export const GET = withAuthContext(
  async (req: NextRequest, ctx, { params }: { params: Promise<{ id: string }> }) => {
    const { id: rawPatientId } = await params;
    const patientId = normalizeRequiredRouteParam(rawPatientId);
    if (!patientId) return validationError('患者IDが不正です');

    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);
    const keysetWhere = buildKeysetWhere(
      decodeKeysetCursor(PATIENT_PRESCRIPTION_CURSOR_KEYS, cursor),
    );

    const patient = await prisma.patient.findFirst({
      where: applyPatientAssignmentWhere(
        { id: patientId, org_id: ctx.orgId },
        { userId: ctx.userId, role: ctx.role },
      ),
      select: { id: true, name: true, name_kana: true },
    });
    if (!patient) return notFound('患者が見つかりません');
    const caseIds = await listAccessiblePatientCaseIds({
      db: prisma,
      orgId: ctx.orgId,
      patientId,
      accessContext: { userId: ctx.userId, role: ctx.role },
    });

    const intakes = await prisma.prescriptionIntake.findMany({
      where: {
        org_id: ctx.orgId,
        cycle: { patient_id: patientId, case_id: { in: caseIds } },
        ...(keysetWhere ?? {}),
      },
      orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        cycle_id: true,
        source_type: true,
        prescribed_date: true,
        prescriber_name: true,
        prescriber_institution: true,
        prescription_expiry_date: true,
        original_document_url: true,
        original_collected_at: true,
        original_collected_by: true,
        refill_remaining_count: true,
        refill_next_dispense_date: true,
        split_dispense_total: true,
        split_dispense_current: true,
        split_next_dispense_date: true,
        created_at: true,
        cycle: {
          select: { overall_status: true },
        },
        lines: {
          orderBy: { line_number: 'asc' },
          select: {
            id: true,
            line_number: true,
            drug_name: true,
            drug_code: true,
            dosage_form: true,
            dose: true,
            frequency: true,
            days: true,
            quantity: true,
            unit: true,
            is_generic: true,
            packaging_instructions: true,
            notes: true,
            route: true,
            dispensing_method: true,
            start_date: true,
            end_date: true,
          },
        },
      },
    });

    const hasMore = intakes.length > limit;
    const data = hasMore ? intakes.slice(0, limit) : intakes;
    const nextCursor = hasMore ? data[data.length - 1] : null;

    // p0_11「処方の変化を確認」用の差分。最初のページ(カーソル無し)でのみ最新 2 件を比較する
    const diffReview =
      !cursor && data.length >= 2
        ? buildDiffReview(
            data[0].lines as DiffReviewLine[],
            data[1].lines as DiffReviewLine[],
          )
        : null;
    const diffMeta =
      !cursor && data.length >= 2
        ? {
            current: {
              id: data[0].id,
              prescribed_date: data[0].prescribed_date,
            },
            previous: {
              id: data[1].id,
              prescribed_date: data[1].prescribed_date,
            },
          }
        : null;

    return success({
      patient,
      data,
      hasMore,
      nextCursor: nextCursor
        ? encodeKeysetCursor(PATIENT_PRESCRIPTION_CURSOR_KEYS, nextCursor)
        : undefined,
      diff_review: diffReview,
      diff_meta: diffMeta,
    });
  },
  {
    permission: 'canVisit',
    message: '患者処方履歴の閲覧権限がありません',
  },
);
