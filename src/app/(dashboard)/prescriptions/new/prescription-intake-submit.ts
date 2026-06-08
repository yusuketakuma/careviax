type PrescriptionLineDraft = {
  drug_name: string;
  dose: string;
  frequency: string;
  drug_code?: string;
};

type PrescriptionSubmitState = {
  sourceType: string;
  selectedPatientId: string;
  selectedCaseId: string;
  prescriptionCategory: 'regular' | 'emergency';
  emergencyCategory: string;
  lines: PrescriptionLineDraft[];
  facilityBatchEntryCount: number;
  inquiryReason: string;
  inquiryToPhysician: string;
  inquiryContent: string;
};

type PrescriptionApiErrorBody = {
  message?: string;
  details?: {
    blocked_lines?: Array<{
      line_number?: number;
      drug_name?: string;
      reason?: string;
    }>;
  };
};

export class PrescriptionSubmitError extends Error {
  constructor(
    message: string,
    public readonly blockedLines: NonNullable<
      NonNullable<PrescriptionApiErrorBody['details']>['blocked_lines']
    > = [],
  ) {
    super(message);
    this.name = 'PrescriptionSubmitError';
  }
}

export function formatPrescriptionSubmitError(error: unknown, fallbackMessage: string): string {
  if (error instanceof PrescriptionSubmitError && error.blockedLines.length > 0) {
    return [
      error.message,
      ...error.blockedLines.map((line) => {
        const lineLabel =
          typeof line.line_number === 'number' ? `${line.line_number}行目` : '行番号未設定';
        const drugName = line.drug_name?.trim() || '薬剤名未設定';
        const reason = line.reason?.trim();
        return reason ? `${lineLabel}: ${drugName} - ${reason}` : `${lineLabel}: ${drugName}`;
      }),
    ].join('\n');
  }

  if (error instanceof Error) return error.message;
  return fallbackMessage;
}

export async function parsePrescriptionSubmitError(
  response: Response,
  fallbackMessage: string,
): Promise<PrescriptionSubmitError> {
  const body = (await response.json().catch(() => null)) as PrescriptionApiErrorBody | null;
  return new PrescriptionSubmitError(
    body?.message ?? fallbackMessage,
    Array.isArray(body?.details?.blocked_lines) ? body.details.blocked_lines : [],
  );
}

export function getPrescriptionSubmitBlockers({
  sourceType,
  selectedPatientId,
  selectedCaseId,
  prescriptionCategory,
  emergencyCategory,
  lines,
  facilityBatchEntryCount,
  inquiryReason,
  inquiryToPhysician,
  inquiryContent,
}: PrescriptionSubmitState): string[] {
  const blockers: string[] = [];
  const hasDraftLines = lines.some((line) => line.drug_name || line.dose || line.frequency);
  const emptyLines = lines.filter((line) => !line.drug_name || !line.dose || !line.frequency);
  const unstructuredLines = lines.filter((line) => {
    const hasAnyValue = line.drug_name || line.dose || line.frequency;
    return hasAnyValue && !line.drug_code?.trim();
  });
  const hasInquiryDraft =
    inquiryReason.trim().length > 0 ||
    inquiryToPhysician.trim().length > 0 ||
    inquiryContent.trim().length > 0;
  const requiresEmergencyCategory =
    prescriptionCategory === 'emergency' && !emergencyCategory.trim();

  if (requiresEmergencyCategory) {
    blockers.push('緊急処方の場合は緊急区分を選択してください');
  }

  if (sourceType === 'facility_batch') {
    if (selectedCaseId || selectedPatientId || hasDraftLines) {
      blockers.push('現在入力中の患者は一括リストへ追加するか、入力を消してから登録してください');
    }
    if (facilityBatchEntryCount < 2) {
      blockers.push('施設まとめ処方は2名以上の患者を一括リストへ追加してください');
    }
    return blockers;
  }

  if (!selectedCaseId) {
    blockers.push('患者とケースを選択してください');
  }

  if (emptyLines.length > 0) {
    blockers.push(
      hasDraftLines
        ? 'すべての処方明細行を入力してください'
        : '少なくとも1行の処方明細を入力してください',
    );
  }

  if (unstructuredLines.length > 0) {
    blockers.push('薬剤名は候補から選択し、薬剤マスターと紐づけてください');
  }

  if (
    hasInquiryDraft &&
    (!inquiryReason.trim() || !inquiryToPhysician.trim() || !inquiryContent.trim())
  ) {
    blockers.push('疑義照会を起票する場合は、理由・照会先医師・内容をすべて入力してください');
  }

  return blockers;
}
