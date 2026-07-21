import { resolveCanonicalActualUnit } from '@/lib/dispensing/dispense-result-validation';
import { verifyDispenseBarcodeForLine } from '@/lib/dispensing/dispense-barcode-verification';
import { Prisma } from '@prisma/client';
import type { SubmittedDispenseResultLine } from './route.schema';

export type ReplayableDispenseResult = {
  id: string;
  line_id: string;
  actual_drug_name: string;
  actual_drug_code: string | null;
  actual_quantity: unknown;
  actual_unit: string | null;
  discrepancy_reason: string | null;
  carry_type: string | null;
  special_notes: string | null;
};

export type ReplayablePrescriptionLine = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  drug_master_id: string | null;
  unit: string | null;
};

export function normalizeOptionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function actualDrugIdentityMatches(args: {
  existingResult: Pick<ReplayableDispenseResult, 'actual_drug_name' | 'actual_drug_code'>;
  submittedLine: Pick<SubmittedDispenseResultLine, 'actual_drug_name' | 'actual_drug_code'>;
}) {
  const existingCode = normalizeOptionalText(args.existingResult.actual_drug_code);
  const submittedCode = normalizeOptionalText(args.submittedLine.actual_drug_code);
  if (existingCode || submittedCode) return existingCode != null && existingCode === submittedCode;

  return args.existingResult.actual_drug_name === args.submittedLine.actual_drug_name;
}

function dispenseResultMatchesSubmittedLine(args: {
  existingResult: ReplayableDispenseResult;
  submittedLine: SubmittedDispenseResultLine;
  prescribedUnit: string | null | undefined;
}) {
  const canonicalActualUnit = resolveCanonicalActualUnit({
    prescribedUnit: args.prescribedUnit,
    actualUnit: args.submittedLine.actual_unit,
  });

  return (
    actualDrugIdentityMatches(args) &&
    Number(args.existingResult.actual_quantity) === args.submittedLine.actual_quantity &&
    normalizeOptionalText(args.existingResult.actual_unit) ===
      normalizeOptionalText(canonicalActualUnit) &&
    normalizeOptionalText(args.existingResult.discrepancy_reason) ===
      normalizeOptionalText(args.submittedLine.discrepancy_reason) &&
    args.existingResult.carry_type === args.submittedLine.carry_type &&
    normalizeOptionalText(args.existingResult.special_notes) ===
      normalizeOptionalText(args.submittedLine.special_notes)
  );
}

export async function buildIdempotentDispenseResultReplay(args: {
  tx: Prisma.TransactionClient;
  taskId: string;
  submittedLines: Array<SubmittedDispenseResultLine>;
  prescribedLines: Array<ReplayablePrescriptionLine>;
  existingResults: Array<ReplayableDispenseResult>;
}) {
  const prescribedLineById = new Map(args.prescribedLines.map((line) => [line.id, line]));
  const existingResultByLineId = new Map(
    args.existingResults.map((result) => [result.line_id, result]),
  );
  const seenSubmittedLineIds = new Set<string>();
  const replayResults = [];

  for (const submittedLine of args.submittedLines) {
    if (seenSubmittedLineIds.has(submittedLine.line_id)) return null;
    seenSubmittedLineIds.add(submittedLine.line_id);

    const prescribedLine = prescribedLineById.get(submittedLine.line_id);
    if (!prescribedLine) return null;

    const existingResult = existingResultByLineId.get(submittedLine.line_id);
    if (!existingResult) return null;

    if (
      !dispenseResultMatchesSubmittedLine({
        existingResult,
        submittedLine,
        prescribedUnit: prescribedLine.unit,
      })
    ) {
      return null;
    }

    if (submittedLine.barcode_scan) {
      const verification = await verifyDispenseBarcodeForLine({
        client: args.tx,
        line: prescribedLine,
        barcode: submittedLine.barcode_scan.barcode,
      });
      if (!verification.evidence.match || verification.evidence.expired) return null;
    }

    replayResults.push(existingResult);
  }

  const persistedLineIds = new Set(args.existingResults.map((result) => result.line_id));
  const hasAllResults =
    args.prescribedLines.length > 0 &&
    args.prescribedLines.every((line) => persistedLineIds.has(line.id));

  return {
    results: replayResults,
    task_id: args.taskId,
    partial: !hasAllResults,
    idempotent: true as const,
  };
}
