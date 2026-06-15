import { describe, expect, it } from 'vitest';
import {
  buildInventoryForecast,
  classifyStockStatus,
  countFacilityPatients,
  coveragePercent,
  drugBaseName,
  estimateDailyDose,
  nextWeekUtcRange,
  selectLatestLinesByPatient,
  summarizeInventoryForecast,
  type ForecastIntakeInput,
  type ForecastLineInput,
} from './inventory-forecast';

function line(overrides: Partial<ForecastLineInput> = {}): ForecastLineInput {
  return {
    drugName: 'アムロジピン 5mg',
    dose: '1錠',
    frequency: '朝',
    days: 28,
    quantity: 28,
    unit: '錠',
    ...overrides,
  };
}

describe('nextWeekUtcRange', () => {
  it('returns next Monday through Sunday for a midweek date', () => {
    // 2026-06-10 は水曜 → 来週 = 6/15(月)〜6/21(日)
    const range = nextWeekUtcRange(new Date('2026-06-10T12:00:00'));
    expect(range.startKey).toBe('2026-06-15');
    expect(range.endKey).toBe('2026-06-21');
    expect(range.gte.toISOString()).toBe('2026-06-15T00:00:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });

  it('skips to the following Monday when today is Monday', () => {
    // 2026-06-15 は月曜 → 来週 = 6/22(月)〜6/28(日)
    const range = nextWeekUtcRange(new Date('2026-06-15T09:00:00'));
    expect(range.startKey).toBe('2026-06-22');
    expect(range.endKey).toBe('2026-06-28');
  });

  it('uses tomorrow as Monday when today is Sunday', () => {
    // 2026-06-14 は日曜 → 来週 = 6/15(月)〜6/21(日)
    const range = nextWeekUtcRange(new Date('2026-06-14T23:00:00'));
    expect(range.startKey).toBe('2026-06-15');
    expect(range.endKey).toBe('2026-06-21');
  });
});

describe('drugBaseName', () => {
  it('strips strength after whitespace', () => {
    expect(drugBaseName('アムロジピン 5mg')).toBe('アムロジピン');
    expect(drugBaseName('酸化Mg 330mg')).toBe('酸化Mg');
  });

  it('strips strength even without whitespace', () => {
    expect(drugBaseName('トラセミド4mg')).toBe('トラセミド');
  });

  it('keeps names that have no strength suffix', () => {
    expect(drugBaseName('インスリン グラルギン')).toBe('インスリン');
    expect(drugBaseName('酸化Mg')).toBe('酸化Mg');
  });
});

describe('estimateDailyDose', () => {
  it('prefers quantity / days when available', () => {
    expect(estimateDailyDose(line({ quantity: 84, days: 28 }))).toBe(3);
    expect(estimateDailyDose(line({ quantity: 28, days: 28 }))).toBe(1);
  });

  it('falls back to dose number times frequency count', () => {
    expect(estimateDailyDose(line({ quantity: null, dose: '2錠', frequency: '毎食後' }))).toBe(6);
    expect(estimateDailyDose(line({ quantity: null, dose: '1錠', frequency: '朝夕' }))).toBe(2);
    expect(estimateDailyDose(line({ quantity: null, dose: '1錠', frequency: '1日3回' }))).toBe(3);
  });

  it('defaults to once daily when nothing is parseable', () => {
    expect(estimateDailyDose(line({ quantity: null, dose: '適量', frequency: '疼痛時' }))).toBe(1);
  });
});

describe('selectLatestLinesByPatient', () => {
  it('keeps only the most recent intake per patient', () => {
    const intakes: ForecastIntakeInput[] = [
      {
        patientId: 'p1',
        prescribedDate: new Date('2026-06-01T00:00:00.000Z'),
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
        lines: [line({ drugName: '旧薬 5mg' })],
      },
      {
        patientId: 'p1',
        prescribedDate: new Date('2026-06-10T00:00:00.000Z'),
        createdAt: new Date('2026-06-10T10:00:00.000Z'),
        lines: [line({ drugName: '新薬 5mg' })],
      },
    ];
    const byPatient = selectLatestLinesByPatient(intakes);
    expect(byPatient.get('p1')?.map((l) => l.drugName)).toEqual(['新薬 5mg']);
  });

  it('breaks prescribed-date ties with createdAt', () => {
    const prescribedDate = new Date('2026-06-10T00:00:00.000Z');
    const intakes: ForecastIntakeInput[] = [
      {
        patientId: 'p1',
        prescribedDate,
        createdAt: new Date('2026-06-10T09:00:00.000Z'),
        lines: [line({ drugName: '先 5mg' })],
      },
      {
        patientId: 'p1',
        prescribedDate,
        createdAt: new Date('2026-06-10T11:00:00.000Z'),
        lines: [line({ drugName: '後 5mg' })],
      },
    ];
    expect(selectLatestLinesByPatient(intakes).get('p1')?.[0]?.drugName).toBe('後 5mg');
  });
});

describe('countFacilityPatients', () => {
  it('counts array payloads and rejects non-arrays', () => {
    expect(countFacilityPatients(['a', 'b', 'c'])).toBe(3);
    expect(countFacilityPatients(null)).toBe(0);
    expect(countFacilityPatients({})).toBe(0);
  });
});

describe('classifyStockStatus', () => {
  it('classifies into 要発注 / 発注候補 / 余裕あり', () => {
    expect(classifyStockStatus(21, 3)).toBe('order_required'); // 3 < 10.5
    expect(classifyStockStatus(35, 20)).toBe('order_candidate'); // 17.5 <= 20 < 35
    expect(classifyStockStatus(84, 112)).toBe('sufficient');
    // 境界: ちょうど 50% は発注候補、ちょうど100% は余裕あり
    expect(classifyStockStatus(40, 20)).toBe('order_candidate');
    expect(classifyStockStatus(40, 40)).toBe('sufficient');
  });
});

describe('coveragePercent / summarizeInventoryForecast', () => {
  it('computes stock coverage and chooses the highest priority shortage', () => {
    const drugs = [
      {
        drugKey: 'アムロジピン',
        requiredQty: 35,
        stockQty: 20,
        unit: '錠',
        status: 'order_candidate' as const,
      },
      {
        drugKey: 'トラセミド',
        requiredQty: 21,
        stockQty: 3,
        unit: '錠',
        status: 'order_required' as const,
      },
      {
        drugKey: '酸化Mg',
        requiredQty: 84,
        stockQty: 112,
        unit: '錠',
        status: 'sufficient' as const,
      },
    ];

    expect(coveragePercent(drugs[0])).toBe(57);
    const summary = summarizeInventoryForecast({
      drugs,
      patients: [
        {
          key: 'patient:p1',
          label: '田中 一郎',
          firstVisitDateKey: '2026-06-22',
          isFacilityBatch: false,
        },
      ],
    });

    expect(summary.orderRequiredCount).toBe(1);
    expect(summary.orderCandidateCount).toBe(1);
    expect(summary.shortageDrugCount).toBe(2);
    expect(summary.affectedPatientCount).toBe(1);
    expect(summary.priorityDrug?.drugKey).toBe('トラセミド');
    expect(summary.nextAction).toBe('トラセミドを発注確認');
  });

  it('falls back to recheck guidance when there is no shortage', () => {
    const summary = summarizeInventoryForecast({
      drugs: [
        {
          drugKey: '酸化Mg',
          requiredQty: 84,
          stockQty: 112,
          unit: '錠',
          status: 'sufficient',
        },
      ],
      patients: [],
    });

    expect(summary.priorityDrug).toBeNull();
    expect(summary.nextAction).toBe('定期処方更新後に再確認');
  });
});

describe('buildInventoryForecast', () => {
  const monday = new Date('2026-06-15T00:00:00.000Z');
  const tuesday = new Date('2026-06-16T00:00:00.000Z');
  const thursday = new Date('2026-06-18T00:00:00.000Z');

  const baseInput = () => ({
    visits: [
      {
        patientId: 'p-tanaka',
        patientName: '田中 一郎',
        scheduledDate: monday,
        facilityBatch: null,
      },
      {
        patientId: 'p-sato',
        patientName: '佐藤 花子',
        scheduledDate: tuesday,
        facilityBatch: null,
      },
      {
        patientId: 'p-res1',
        patientName: '山田 ウメ',
        scheduledDate: thursday,
        facilityBatch: { id: 'batch-a', facilityName: '施設A', patientCount: 5 },
      },
      {
        patientId: 'p-res2',
        patientName: '田村 正',
        scheduledDate: thursday,
        facilityBatch: { id: 'batch-a', facilityName: '施設A', patientCount: 5 },
      },
    ],
    intakes: [
      {
        patientId: 'p-tanaka',
        prescribedDate: new Date('2026-06-10T00:00:00.000Z'),
        createdAt: new Date('2026-06-10T10:00:00.000Z'),
        lines: [line({ drugName: 'アムロジピン 5mg', quantity: 28, days: 28 })],
      },
      {
        patientId: 'p-sato',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [
          line({ drugName: 'トラセミド 4mg', quantity: 28, days: 28 }),
          line({ drugName: '酸化Mg 330mg', quantity: 84, days: 28 }),
        ],
      },
      {
        patientId: 'p-res1',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [line({ drugName: 'アムロジピン 5mg', quantity: 28, days: 28 })],
      },
      {
        patientId: 'p-res2',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [line({ drugName: 'トラセミド 4mg', quantity: 28, days: 28 })],
      },
      // 来週訪問のない患者の処方は集計対象外
      {
        patientId: 'p-offweek',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [line({ drugName: 'アムロジピン 5mg', quantity: 280, days: 28 })],
      },
    ],
    stocks: [
      {
        drugName: 'アムロジピン 5mg',
        drugNameKana: 'アムロジピン',
        unit: '錠',
        stockQty: 18,
      },
      { drugName: '酸化Mg 330mg', drugNameKana: 'サンカマグネシウム', unit: '錠', stockQty: 112 },
      { drugName: 'トラセミド 4mg', drugNameKana: 'トラセミド', unit: '錠', stockQty: 3 },
      // 需要ゼロの在庫はテーブルに出さない
      { drugName: 'ファモチジン 10mg', drugNameKana: 'ファモチジン', unit: '錠', stockQty: 50 },
    ],
  });

  it('aggregates weekly demand, joins stock, and sorts rows by kana', () => {
    const summary = buildInventoryForecast(baseInput());
    expect(summary.drugs).toEqual([
      // アムロジピン: (1 + 1) 錠/日 × 7日 = 14 / 在庫18 → 余裕あり…ではなく 18 >= 14 → sufficient
      {
        drugKey: 'アムロジピン',
        requiredQty: 14,
        stockQty: 18,
        unit: '錠',
        status: 'sufficient',
      },
      // 酸化Mg: 3錠/日 × 7日 = 21 / 在庫112 → 余裕あり
      { drugKey: '酸化Mg', requiredQty: 21, stockQty: 112, unit: '錠', status: 'sufficient' },
      // トラセミド: (1 + 1) 錠/日 × 7日 = 14 / 在庫3 → 3 < 7 → 要発注
      { drugKey: 'トラセミド', requiredQty: 14, stockQty: 3, unit: '錠', status: 'order_required' },
    ]);
  });

  it('classifies 発注候補 when stock is between 50% and 100% of demand', () => {
    const input = baseInput();
    input.stocks[0] = { ...input.stocks[0], stockQty: 10 }; // アムロジピン 必要14 在庫10
    const summary = buildInventoryForecast(input);
    const amlodipine = summary.drugs.find((drug) => drug.drugKey === 'アムロジピン');
    expect(amlodipine?.status).toBe('order_candidate');
  });

  it('lists affected patients for shortage drugs, aggregating facility batches', () => {
    const input = baseInput();
    input.stocks[0] = { ...input.stocks[0], stockQty: 10 }; // アムロジピンも不足側に
    const summary = buildInventoryForecast(input);
    expect(summary.patients).toEqual([
      {
        key: 'patient:p-tanaka',
        label: '田中 一郎',
        firstVisitDateKey: '2026-06-15',
        isFacilityBatch: false,
      },
      {
        key: 'patient:p-sato',
        label: '佐藤 花子',
        firstVisitDateKey: '2026-06-16',
        isFacilityBatch: false,
      },
      {
        key: 'facility-batch:batch-a',
        label: '施設A 5名',
        firstVisitDateKey: '2026-06-18',
        isFacilityBatch: true,
      },
    ]);
  });

  it('excludes patients who only take sufficient drugs', () => {
    const summary = buildInventoryForecast(baseInput());
    // アムロジピン在庫18は充足 → 田中(アムロジピンのみ)は影響患者に出ない
    expect(summary.patients.map((card) => card.key)).toEqual([
      'patient:p-sato',
      'facility-batch:batch-a',
    ]);
  });

  it('returns empty lists when there are no visits next week', () => {
    const input = baseInput();
    input.visits = [];
    const summary = buildInventoryForecast(input);
    expect(summary.drugs).toEqual([]);
    expect(summary.patients).toEqual([]);
  });
});
