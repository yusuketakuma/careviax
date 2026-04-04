import { describe, expect, it } from 'vitest';
import { getPrescriptionSubmitBlockers } from './prescription-intake-submit';

describe('getPrescriptionSubmitBlockers', () => {
  it('returns blockers for an incomplete standard prescription', () => {
    expect(
      getPrescriptionSubmitBlockers({
        sourceType: 'paper',
        selectedPatientId: '',
        selectedCaseId: '',
        prescriptionCategory: 'regular',
        emergencyCategory: '',
        facilityBatchEntryCount: 0,
        inquiryReason: '',
        inquiryToPhysician: '',
        inquiryContent: '',
        lines: [{ drug_name: '', dose: '', frequency: '' }],
      }),
    ).toEqual(['患者とケースを選択してください', '少なくとも1行の処方明細を入力してください']);
  });

  it('requires every inquiry field when an inquiry draft exists', () => {
    expect(
      getPrescriptionSubmitBlockers({
        sourceType: 'paper',
        selectedPatientId: 'p1',
        selectedCaseId: 'case_1',
        prescriptionCategory: 'regular',
        emergencyCategory: '',
        facilityBatchEntryCount: 0,
        inquiryReason: '疑義',
        inquiryToPhysician: '',
        inquiryContent: '確認したい内容',
        lines: [{ drug_name: 'アムロジピン錠', drug_code: '2149001', dose: '1錠', frequency: '1日1回' }],
      }),
    ).toEqual(['疑義照会を起票する場合は、理由・照会先医師・内容をすべて入力してください']);
  });

  it('blocks submission when a line is not linked to the drug master', () => {
    expect(
      getPrescriptionSubmitBlockers({
        sourceType: 'paper',
        selectedPatientId: 'p1',
        selectedCaseId: 'case_1',
        prescriptionCategory: 'regular',
        emergencyCategory: '',
        facilityBatchEntryCount: 0,
        inquiryReason: '',
        inquiryToPhysician: '',
        inquiryContent: '',
        lines: [{ drug_name: 'アムロジピン錠', dose: '1錠', frequency: '1日1回' }],
      }),
    ).toEqual(['薬剤名は候補から選択し、薬剤マスターと紐づけてください']);
  });

  it('blocks facility batch submission until the current draft is cleared and two entries exist', () => {
    expect(
      getPrescriptionSubmitBlockers({
        sourceType: 'facility_batch',
        selectedPatientId: 'p1',
        selectedCaseId: 'case_1',
        prescriptionCategory: 'regular',
        emergencyCategory: '',
        facilityBatchEntryCount: 1,
        inquiryReason: '',
        inquiryToPhysician: '',
        inquiryContent: '',
        lines: [{ drug_name: 'アムロジピン錠', dose: '1錠', frequency: '1日1回' }],
      }),
    ).toEqual([
      '現在入力中の患者は一括リストへ追加するか、入力を消してから登録してください',
      '施設まとめ処方は2名以上の患者を一括リストへ追加してください',
    ]);
  });

  it('returns no blockers once the intake is ready to submit', () => {
    expect(
      getPrescriptionSubmitBlockers({
        sourceType: 'paper',
        selectedPatientId: 'p1',
        selectedCaseId: 'case_1',
        prescriptionCategory: 'regular',
        emergencyCategory: '',
        facilityBatchEntryCount: 0,
        inquiryReason: '',
        inquiryToPhysician: '',
        inquiryContent: '',
        lines: [{ drug_name: 'アムロジピン錠', drug_code: '2149001', dose: '1錠', frequency: '1日1回' }],
      }),
    ).toEqual([]);
  });

  it('blocks emergency prescriptions until the emergency category is selected', () => {
    expect(
      getPrescriptionSubmitBlockers({
        sourceType: 'paper',
        selectedPatientId: 'p1',
        selectedCaseId: 'case_1',
        prescriptionCategory: 'emergency',
        emergencyCategory: '',
        facilityBatchEntryCount: 0,
        inquiryReason: '',
        inquiryToPhysician: '',
        inquiryContent: '',
        lines: [{ drug_name: 'アムロジピン錠', drug_code: '2149001', dose: '1錠', frequency: '1日1回' }],
      }),
    ).toEqual(['緊急処方の場合は緊急区分を選択してください']);
  });
});
