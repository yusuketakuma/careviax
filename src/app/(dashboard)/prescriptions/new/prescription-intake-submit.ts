type PrescriptionLineDraft = {
  drug_name: string;
  dose: string;
  frequency: string;
};

type PrescriptionSubmitState = {
  sourceType: string;
  selectedPatientId: string;
  selectedCaseId: string;
  lines: PrescriptionLineDraft[];
  facilityBatchEntryCount: number;
  inquiryReason: string;
  inquiryToPhysician: string;
  inquiryContent: string;
};

export function getPrescriptionSubmitBlockers({
  sourceType,
  selectedPatientId,
  selectedCaseId,
  lines,
  facilityBatchEntryCount,
  inquiryReason,
  inquiryToPhysician,
  inquiryContent,
}: PrescriptionSubmitState): string[] {
  const blockers: string[] = [];
  const hasDraftLines = lines.some((line) => line.drug_name || line.dose || line.frequency);
  const emptyLines = lines.filter((line) => !line.drug_name || !line.dose || !line.frequency);
  const hasInquiryDraft =
    inquiryReason.trim().length > 0 ||
    inquiryToPhysician.trim().length > 0 ||
    inquiryContent.trim().length > 0;

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

  if (
    hasInquiryDraft &&
    (!inquiryReason.trim() || !inquiryToPhysician.trim() || !inquiryContent.trim())
  ) {
    blockers.push('疑義照会を起票する場合は、理由・照会先医師・内容をすべて入力してください');
  }

  return blockers;
}
