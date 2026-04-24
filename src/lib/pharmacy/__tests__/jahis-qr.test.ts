import { describe, expect, it } from 'vitest';
import {
  parseJahisQR,
  parseJahisQRSafe,
  parseDaysOrTimes,
  isJahisQR,
  detectMultiQR,
  mergeJahisQRPages,
  parseJahisDate,
} from '../jahis-qr';
import {
  SIMPLE_QR,
  MULTI_MED_QR,
  QR_WITH_ERRORS,
  EMPTY_MEDS_QR,
  QR_WITH_REMARKS,
  TIMES_PATTERN_QR,
  MULTI_QR_PART1,
  MULTI_QR_PART2,
  ERA_DATE_QR,
  SUPPLEMENTAL_RECORDS_QR,
} from './fixtures/jahis-samples';

// ── parseJahisDate ──

describe('parseJahisDate', () => {
  it('parses YYYYMMDD format', () => {
    expect(parseJahisDate('19500315')).toBe('1950-03-15');
  });

  it('parses YYYY/MM/DD format', () => {
    expect(parseJahisDate('2026/04/01')).toBe('2026-04-01');
  });

  it('returns undefined for invalid dates', () => {
    expect(parseJahisDate('invalid_date')).toBeUndefined();
    expect(parseJahisDate('')).toBeUndefined();
    expect(parseJahisDate('12345')).toBeUndefined();
  });

  it('returns undefined when month is out of range', () => {
    expect(parseJahisDate('20261301')).toBeUndefined();
  });

  it('returns undefined when day is out of range', () => {
    expect(parseJahisDate('20260132')).toBeUndefined();
  });

  it('returns undefined when year is out of range', () => {
    expect(parseJahisDate('18991231')).toBeUndefined();
    expect(parseJahisDate('21010101')).toBeUndefined();
  });

  it('parses Japanese era format S (昭和)', () => {
    // S33 = 1925+33 = 1958
    expect(parseJahisDate('S330303')).toBe('1958-03-03');
  });

  it('parses Japanese era format H (平成)', () => {
    // H10 = 1988+10 = 1998
    expect(parseJahisDate('H100101')).toBe('1998-01-01');
  });

  it('parses Japanese era format R (令和)', () => {
    // R01 = 2018+01 = 2019
    expect(parseJahisDate('R010501')).toBe('2019-05-01');
  });

  it('parses Japanese era format M (明治)', () => {
    // M45 = 1867+45 = 1912
    expect(parseJahisDate('M450101')).toBe('1912-01-01');
  });

  it('parses Japanese era format T (大正)', () => {
    // T10 = 1911+10 = 1921
    expect(parseJahisDate('T100601')).toBe('1921-06-01');
  });
});

// ── isJahisQR ──

describe('isJahisQR', () => {
  it('returns true for valid JAHIS headers', () => {
    expect(isJahisQR('JAHISTC\n1,患者名')).toBe(true);
    expect(isJahisQR('JAHISTC08,1\n1,患者名')).toBe(true);
  });

  it('returns false for invalid headers', () => {
    expect(isJahisQR('')).toBe(false);
    expect(isJahisQR('HELLO\n1,患者名')).toBe(false);
    expect(isJahisQR('1,患者名')).toBe(false);
  });

  it('handles leading whitespace', () => {
    expect(isJahisQR('  JAHISTC\n1,患者名')).toBe(true);
  });
});

// ── parseDaysOrTimes ──

describe('parseDaysOrTimes', () => {
  it('parses "14日分" as days: 14', () => {
    expect(parseDaysOrTimes('14日分')).toEqual({ days: 14, raw: '14日分' });
  });

  it('parses "14日" as days: 14', () => {
    expect(parseDaysOrTimes('14日')).toEqual({ days: 14, raw: '14日' });
  });

  it('parses "5回分" as times: 5', () => {
    expect(parseDaysOrTimes('5回分')).toEqual({ times: 5, raw: '5回分' });
  });

  it('parses "5回" as times: 5', () => {
    expect(parseDaysOrTimes('5回')).toEqual({ times: 5, raw: '5回' });
  });

  it('parses pure number "14" as days: 14', () => {
    expect(parseDaysOrTimes('14')).toEqual({ days: 14, raw: '14' });
  });

  it('parses "頓服" as raw only', () => {
    expect(parseDaysOrTimes('頓服')).toEqual({ raw: '頓服' });
  });

  it('returns raw for empty string', () => {
    expect(parseDaysOrTimes('')).toEqual({ raw: '' });
  });

  it('parses "適量" as raw only', () => {
    expect(parseDaysOrTimes('適量')).toEqual({ raw: '適量' });
  });
});

// ── detectMultiQR ──

describe('detectMultiQR', () => {
  it('detects record 911 as split info', () => {
    expect(detectMultiQR(MULTI_QR_PART1)).toEqual({
      dataId: '12345678901234',
      splitCount: 2,
      sequenceNumber: 1,
    });
  });

  it('detects second part split info', () => {
    expect(detectMultiQR(MULTI_QR_PART2)).toEqual({
      dataId: '12345678901234',
      splitCount: 2,
      sequenceNumber: 2,
    });
  });

  it('returns null for QR without record 911', () => {
    expect(detectMultiQR(SIMPLE_QR)).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(detectMultiQR('')).toBeNull();
  });
});

// ── parseJahisQR ──

describe('parseJahisQR', () => {
  describe('with SIMPLE_QR', () => {
    it('parses patient name correctly', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.patient.name).toBe('山田太郎');
    });

    it('parses patient gender correctly', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.patient.gender).toBe('male');
    });

    it('parses patient birthDate correctly', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.patient.birthDate).toBe('1950-03-15');
    });

    it('parses dispensing date from record 5', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.dispensingDate).toBe('2026-04-01');
    });

    it('parses dispensing institution from record 11', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.dispensingInstitution.name).toBe('株式会社テスト薬局');
      expect(result.dispensingInstitution.institutionCode).toBe('1234567');
    });

    it('parses dispensing pharmacist from record 15', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.dispensingPharmacist).toBe('鈴木薬剤師');
    });

    it('parses prescribing institution from record 51', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.prescribingInstitution.name).toBe('テスト医院');
      expect(result.prescribingInstitution.institutionCode).toBe('9876543');
    });

    it('parses prescribing doctor and department from record 55', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.prescribingDoctor).toBe('鈴木医師');
      expect(result.prescribingDepartment).toBe('内科');
    });

    it('parses single medication correctly', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.medications).toHaveLength(1);
      const med = result.medications[0];
      expect(med.rpNumber).toBe(1);
      expect(med.drugName).toBe('アムロジピン錠5mg');
      expect(med.dose).toBe('5');
      expect(med.unit).toBe('mg');
      expect(med.drugCode).toBe('612170709');
      expect(med.drugCodeType).toBe(2);
    });

    it('parses usage from record 301', () => {
      const result = parseJahisQR(SIMPLE_QR);
      const med = result.medications[0];
      expect(med.usage).toBe('1日1回朝食後服用');
      expect(med.usageQuantity).toBe('14');
      expect(med.usageUnit).toBe('日分');
      expect(med.formCode).toBe(1);
    });

    it('sets backward-compat daysOrTimes from record 301', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.medications[0].daysOrTimes).toBe('14日分');
    });

    it('initializes supplements and usageNotes as empty arrays', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.medications[0].supplements).toEqual([]);
      expect(result.medications[0].usageNotes).toEqual([]);
    });

    it('initializes remarks and patientNotes as empty arrays', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.remarks).toEqual([]);
      expect(result.patientNotes).toEqual([]);
    });

    it('has no splitInfo for single QR', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.splitInfo).toBeUndefined();
    });

    it('preserves rawText', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.rawText).toBe(SIMPLE_QR);
    });

    it('provides backward-compat pharmacy field', () => {
      const result = parseJahisQR(SIMPLE_QR);
      expect(result.pharmacy.institutionName).toBe('テスト医院');
      expect(result.pharmacy.institutionCode).toBe('9876543');
      expect(result.pharmacy.doctorName).toBe('鈴木医師');
    });
  });

  describe('with MULTI_MED_QR', () => {
    it('parses three medications', () => {
      const result = parseJahisQR(MULTI_MED_QR);
      expect(result.medications).toHaveLength(3);
    });

    it('parses female patient', () => {
      const result = parseJahisQR(MULTI_MED_QR);
      expect(result.patient.gender).toBe('female');
    });

    it('parses each medication independently', () => {
      const result = parseJahisQR(MULTI_MED_QR);
      expect(result.medications[0].drugName).toBe('アムロジピン錠5mg');
      expect(result.medications[1].drugName).toBe('メトホルミン錠500mg');
      expect(result.medications[2].drugName).toBe('ワーファリン錠1mg');
    });

    it('parses rpNumber for each medication', () => {
      const result = parseJahisQR(MULTI_MED_QR);
      expect(result.medications[0].rpNumber).toBe(1);
      expect(result.medications[1].rpNumber).toBe(2);
      expect(result.medications[2].rpNumber).toBe(3);
    });

    it('parses usageQuantity and usageUnit for each medication', () => {
      const result = parseJahisQR(MULTI_MED_QR);
      expect(result.medications[0].usageQuantity).toBe('14');
      expect(result.medications[0].usageUnit).toBe('日分');
      expect(result.medications[1].usageQuantity).toBe('28');
      expect(result.medications[1].usageUnit).toBe('日分');
      expect(result.medications[2].usageQuantity).toBe('14');
      expect(result.medications[2].usageUnit).toBe('日分');
    });

    it('parses prescribing doctor department', () => {
      const result = parseJahisQR(MULTI_MED_QR);
      expect(result.prescribingDepartment).toBe('糖尿病内科');
    });
  });

  describe('with EMPTY_MEDS_QR', () => {
    it('returns empty medications array', () => {
      const result = parseJahisQR(EMPTY_MEDS_QR);
      expect(result.medications).toHaveLength(0);
    });

    it('still parses patient and prescribing institution', () => {
      const result = parseJahisQR(EMPTY_MEDS_QR);
      expect(result.patient.name).toBe('患者名');
      expect(result.prescribingInstitution.institutionCode).toBe('1111111');
    });
  });

  describe('with QR_WITH_REMARKS', () => {
    it('parses remarks from record 401', () => {
      const result = parseJahisQR(QR_WITH_REMARKS);
      expect(result.remarks).toContain('頓服指示あり');
    });
  });

  describe('with TIMES_PATTERN_QR', () => {
    it('parses usageUnit as "回分"', () => {
      const result = parseJahisQR(TIMES_PATTERN_QR);
      expect(result.medications[0].usageQuantity).toBe('5');
      expect(result.medications[0].usageUnit).toBe('回分');
      expect(result.medications[0].daysOrTimes).toBe('5回分');
    });
  });

  describe('with ERA_DATE_QR', () => {
    it('parses Japanese era birthDate (S33=1958)', () => {
      const result = parseJahisQR(ERA_DATE_QR);
      expect(result.patient.birthDate).toBe('1958-03-03');
    });
  });

  describe('with SUPPLEMENTAL_RECORDS_QR', () => {
    it('parses JAHIS supplemental records without warning as unknown records', () => {
      const result = parseJahisQRSafe(SUPPLEMENTAL_RECORDS_QR);
      expect(result.success).toBe(true);
      expect(result.warnings.map((warning) => warning.recordType)).not.toEqual(
        expect.arrayContaining(['3', '31', '4', '411', '421', '601', '701']),
      );
    });

    it('keeps OTC, residual medication, patient note, and primary pharmacist records', () => {
      const result = parseJahisQR(SUPPLEMENTAL_RECORDS_QR);
      expect(result.supplementalRecords).toHaveLength(7);
      expect(result.supplementalRecords?.map((record) => record.recordType)).toEqual([
        '3',
        '31',
        '4',
        '411',
        '421',
        '601',
        '701',
      ]);
    });

    it('builds labels, details, and summaries for visit-management display', () => {
      const result = parseJahisQR(SUPPLEMENTAL_RECORDS_QR);
      const memo = result.supplementalRecords?.find((record) => record.recordType === '4');
      const residual = result.supplementalRecords?.find((record) => record.recordType === '421');
      const primaryPharmacist = result.supplementalRecords?.find(
        (record) => record.recordType === '701',
      );

      expect(memo?.recordLabel).toBe('手帳メモ');
      expect(memo?.summary).toBe('市販薬服用中は胃部不快感に注意');
      expect(residual?.recordLabel).toBe('残薬確認');
      expect(residual?.summary).toContain('アムロジピンが10錠残薬');
      expect(residual?.details).toContainEqual({
        label: '残薬内容',
        value: 'アムロジピンが10錠残薬。症状改善による自己判断で服用中断。',
      });
      expect(primaryPharmacist?.summary).toBe('工業会 次郎 / 工業会薬局 駅前店');
      expect(primaryPharmacist?.details).toContainEqual({
        label: '連絡先',
        value: '03-3506-8010',
      });
    });
  });

  describe('with MULTI_QR_PART1', () => {
    it('parses splitInfo from record 911', () => {
      const result = parseJahisQR(MULTI_QR_PART1);
      expect(result.splitInfo).toEqual({
        dataId: '12345678901234',
        splitCount: 2,
        sequenceNumber: 1,
      });
    });
  });
});

// ── parseJahisQRSafe ──

describe('parseJahisQRSafe', () => {
  describe('with QR_WITH_ERRORS', () => {
    it('collects warnings for unknown record types', () => {
      const result = parseJahisQRSafe(QR_WITH_ERRORS);
      const unknownWarning = result.warnings.find((w) => w.recordType === '999');
      expect(unknownWarning).toBeDefined();
      expect(unknownWarning?.field).toBe('unknown');
    });

    it('still returns partial patient data', () => {
      const result = parseJahisQRSafe(QR_WITH_ERRORS);
      expect(result.data.patient?.name).toBe('テスト患者');
    });

    it('returns undefined dispensingDate for invalid date string', () => {
      const result = parseJahisQRSafe(QR_WITH_ERRORS);
      expect(result.data.dispensingDate).toBeUndefined();
    });
  });

  describe('with QR_WITH_REMARKS', () => {
    it('returns a warning for record type 401 (remarks)', () => {
      const result = parseJahisQRSafe(QR_WITH_REMARKS);
      const remarksWarning = result.warnings.find((w) => w.recordType === '401');
      expect(remarksWarning).toBeDefined();
      expect(remarksWarning?.message).toContain('頓服指示あり');
    });

    it('still parses medication correctly alongside remarks', () => {
      const result = parseJahisQRSafe(QR_WITH_REMARKS);
      expect(result.data.medications).toHaveLength(1);
      expect(result.data.medications?.[0].drugName).toBe('ロキソニン錠60mg');
    });
  });

  describe('with SIMPLE_QR (clean input)', () => {
    it('returns success:true with no errors', () => {
      const result = parseJahisQRSafe(SIMPLE_QR);
      expect(result.success).toBe(true);
    });

    it('returns full data on success', () => {
      const result = parseJahisQRSafe(SIMPLE_QR);
      expect(result.data.patient?.name).toBe('山田太郎');
      expect(result.data.medications).toHaveLength(1);
    });
  });

  describe('with MULTI_MED_QR', () => {
    it('returns success:true for clean multi-med input', () => {
      const result = parseJahisQRSafe(MULTI_MED_QR);
      expect(result.success).toBe(true);
    });

    it('parses all three medications', () => {
      const result = parseJahisQRSafe(MULTI_MED_QR);
      expect(result.data.medications).toHaveLength(3);
    });
  });
});

// ── mergeJahisQRPages ──

describe('mergeJahisQRPages', () => {
  it('throws when given an empty array', () => {
    expect(() => mergeJahisQRPages([])).toThrow('No QR pages to merge');
  });

  it('returns the single page unchanged when given one page', () => {
    const page = parseJahisQR(SIMPLE_QR);
    const result = mergeJahisQRPages([page]);
    expect(result).toBe(page);
  });

  it('combines medications from both pages', () => {
    const page1 = parseJahisQR(SIMPLE_QR);
    const page2 = parseJahisQR(MULTI_MED_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    // SIMPLE_QR has 1 med, MULTI_MED_QR has 3 meds → 4 total
    expect(merged.medications).toHaveLength(4);
  });

  it('uses patient data from the first page', () => {
    const page1 = parseJahisQR(SIMPLE_QR);
    const page2 = parseJahisQR(MULTI_MED_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    expect(merged.patient.name).toBe('山田太郎');
  });

  it('uses prescribingInstitution from first page that has it', () => {
    const page1 = parseJahisQR(SIMPLE_QR);
    const page2 = parseJahisQR(MULTI_MED_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    expect(merged.prescribingInstitution.institutionCode).toBe('9876543');
  });

  it('provides backward-compat pharmacy field after merge', () => {
    const page1 = parseJahisQR(SIMPLE_QR);
    const page2 = parseJahisQR(MULTI_MED_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    expect(merged.pharmacy.institutionCode).toBe('9876543');
  });

  it('joins rawText with page break marker', () => {
    const page1 = parseJahisQR(SIMPLE_QR);
    const page2 = parseJahisQR(MULTI_MED_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    expect(merged.rawText).toContain('---QR_PAGE_BREAK---');
  });

  it('sorts by sequenceNumber when merging split QR parts', () => {
    // Parse in reverse order (part2 first, part1 second)
    const part2 = parseJahisQR(MULTI_QR_PART2);
    const part1 = parseJahisQR(MULTI_QR_PART1);
    const merged = mergeJahisQRPages([part2, part1]);
    // After sort by sequenceNumber, part1 (seq=1) should be first
    // Part1 has 1 med (アムロジピン), Part2 has 1 med (メトホルミン)
    expect(merged.medications[0].drugName).toBe('アムロジピン錠5mg');
    expect(merged.medications[1].drugName).toBe('メトホルミン錠500mg');
  });

  it('merges remarks from all pages', () => {
    const page1 = parseJahisQR(QR_WITH_REMARKS);
    const page2 = parseJahisQR(SIMPLE_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    expect(merged.remarks).toContain('頓服指示あり');
  });

  it('picks dispensingDate from the first page that has it', () => {
    const page1 = parseJahisQR(SIMPLE_QR);
    const page2 = parseJahisQR(MULTI_MED_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    expect(merged.dispensingDate).toBe('2026-04-01');
  });

  it('merges supplemental records from all pages', () => {
    const page1 = parseJahisQR(SUPPLEMENTAL_RECORDS_QR);
    const page2 = parseJahisQR(SIMPLE_QR);
    const merged = mergeJahisQRPages([page1, page2]);
    expect(merged.supplementalRecords).toHaveLength(7);
    expect(merged.supplementalRecords?.[0].recordLabel).toBe('要指導医薬品・一般用医薬品服用');
  });
});
