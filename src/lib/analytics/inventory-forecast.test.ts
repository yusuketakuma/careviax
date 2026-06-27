import { describe, expect, it } from 'vitest';
import {
  buildInventoryForecast,
  classifyStockStatus,
  countFacilityPatients,
  coveragePercent,
  drugBaseName,
  estimateDailyDose,
  nextWeekUtcRange,
  resolveInventoryForecastUrgency,
  resolveLineRunOut,
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
    startDate: null,
    endDate: null,
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

describe('resolveLineRunOut / resolveInventoryForecastUrgency', () => {
  it('uses the line end date before falling back to line start date plus days', () => {
    expect(
      resolveLineRunOut({
        line: line({ endDate: new Date('2026-06-20T00:00:00.000Z'), days: 28 }),
      }),
    ).toEqual({ runOutDateKey: '2026-06-20', basis: 'line_end_date' });

    expect(
      resolveLineRunOut({
        line: line({ startDate: new Date('2026-06-10T00:00:00.000Z'), endDate: null, days: 7 }),
      }),
    ).toEqual({ runOutDateKey: '2026-06-16', basis: 'line_start_date_plus_days' });
  });

  it('does not invent a run-out date from prescribed date when line dates are missing', () => {
    expect(
      resolveLineRunOut({
        line: line({ startDate: null, endDate: null, days: 7 }),
      }),
    ).toEqual({ runOutDateKey: null, basis: 'unknown' });
  });

  it('classifies run-out urgency against the first visit date', () => {
    expect(
      resolveInventoryForecastUrgency({
        runOutDateKey: '2026-06-14',
        firstVisitDateKey: '2026-06-15',
      }),
    ).toBe('critical');
    expect(
      resolveInventoryForecastUrgency({
        runOutDateKey: '2026-06-18',
        firstVisitDateKey: '2026-06-15',
      }),
    ).toBe('warning');
    expect(
      resolveInventoryForecastUrgency({
        runOutDateKey: '2026-06-30',
        firstVisitDateKey: '2026-06-15',
      }),
    ).toBe('normal');
    expect(
      resolveInventoryForecastUrgency({
        runOutDateKey: null,
        firstVisitDateKey: '2026-06-15',
      }),
    ).toBe('unknown');
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
          patientId: 'p1',
          label: '田中 一郎',
          firstVisitDateKey: '2026-06-22',
          isFacilityBatch: false,
          facilityPatientCount: null,
          shortagePatientCount: 1,
          dataBackedPatientCount: 1,
          shortageDrugKeys: ['トラセミド'],
          runOutDateKey: '2026-06-28',
          runOutBasis: 'line_start_date_plus_days',
          urgency: 'critical',
          shortageDetails: [
            {
              drugKey: 'トラセミド',
              requiredQty: 7,
              stockQty: 3,
              unit: '錠',
              status: 'order_required',
              affectedPatientCount: 1,
              runOutDateKey: '2026-06-28',
              runOutBasis: 'line_start_date_plus_days',
              urgency: 'critical',
            },
          ],
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
        lines: [
          line({
            drugName: 'アムロジピン 5mg',
            quantity: 28,
            days: 28,
            startDate: new Date('2026-06-10T00:00:00.000Z'),
          }),
        ],
      },
      {
        patientId: 'p-sato',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [
          line({
            drugName: 'トラセミド 4mg',
            quantity: 28,
            days: 28,
            startDate: new Date('2026-06-08T00:00:00.000Z'),
          }),
          line({
            drugName: '酸化Mg 330mg',
            quantity: 84,
            days: 28,
            startDate: new Date('2026-06-08T00:00:00.000Z'),
          }),
        ],
      },
      {
        patientId: 'p-res1',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [
          line({
            drugName: 'アムロジピン 5mg',
            quantity: 28,
            days: 28,
            startDate: new Date('2026-06-08T00:00:00.000Z'),
          }),
        ],
      },
      {
        patientId: 'p-res2',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [
          line({
            drugName: 'トラセミド 4mg',
            quantity: 28,
            days: 28,
            startDate: new Date('2026-06-08T00:00:00.000Z'),
          }),
        ],
      },
      // 来週訪問のない患者の処方は集計対象外
      {
        patientId: 'p-offweek',
        prescribedDate: new Date('2026-06-08T00:00:00.000Z'),
        createdAt: new Date('2026-06-08T10:00:00.000Z'),
        lines: [
          line({
            drugName: 'アムロジピン 5mg',
            quantity: 280,
            days: 28,
            startDate: new Date('2026-06-08T00:00:00.000Z'),
          }),
        ],
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
        patientId: 'p-tanaka',
        label: '田中 一郎',
        firstVisitDateKey: '2026-06-15',
        isFacilityBatch: false,
        facilityPatientCount: null,
        shortagePatientCount: 1,
        dataBackedPatientCount: 1,
        shortageDrugKeys: ['アムロジピン'],
        runOutDateKey: '2026-07-07',
        runOutBasis: 'line_start_date_plus_days',
        urgency: 'normal',
        shortageDetails: [
          {
            drugKey: 'アムロジピン',
            requiredQty: 7,
            stockQty: 10,
            unit: '錠',
            status: 'order_candidate',
            affectedPatientCount: 1,
            runOutDateKey: '2026-07-07',
            runOutBasis: 'line_start_date_plus_days',
            urgency: 'normal',
          },
        ],
      },
      {
        key: 'patient:p-sato',
        patientId: 'p-sato',
        label: '佐藤 花子',
        firstVisitDateKey: '2026-06-16',
        isFacilityBatch: false,
        facilityPatientCount: null,
        shortagePatientCount: 1,
        dataBackedPatientCount: 1,
        shortageDrugKeys: ['トラセミド'],
        runOutDateKey: '2026-07-05',
        runOutBasis: 'line_start_date_plus_days',
        urgency: 'normal',
        shortageDetails: [
          {
            drugKey: 'トラセミド',
            requiredQty: 7,
            stockQty: 3,
            unit: '錠',
            status: 'order_required',
            affectedPatientCount: 1,
            runOutDateKey: '2026-07-05',
            runOutBasis: 'line_start_date_plus_days',
            urgency: 'normal',
          },
        ],
      },
      {
        key: 'facility-batch:batch-a',
        patientId: null,
        label: '施設A 5名',
        firstVisitDateKey: '2026-06-18',
        isFacilityBatch: true,
        facilityPatientCount: 5,
        shortagePatientCount: 2,
        dataBackedPatientCount: 2,
        shortageDrugKeys: ['トラセミド', 'アムロジピン'],
        runOutDateKey: '2026-07-05',
        runOutBasis: 'line_start_date_plus_days',
        urgency: 'normal',
        shortageDetails: [
          {
            drugKey: 'トラセミド',
            requiredQty: 7,
            stockQty: 3,
            unit: '錠',
            status: 'order_required',
            affectedPatientCount: 1,
            runOutDateKey: '2026-07-05',
            runOutBasis: 'line_start_date_plus_days',
            urgency: 'normal',
          },
          {
            drugKey: 'アムロジピン',
            requiredQty: 7,
            stockQty: 10,
            unit: '錠',
            status: 'order_candidate',
            affectedPatientCount: 1,
            runOutDateKey: '2026-07-05',
            runOutBasis: 'line_start_date_plus_days',
            urgency: 'normal',
          },
        ],
      },
    ]);
  });

  it('aggregates facility-batch same-drug details with the earliest run-out and highest urgency', () => {
    const input = baseInput();
    input.intakes[2] = {
      ...input.intakes[2],
      lines: [
        line({
          drugName: 'トラセミド 4mg',
          quantity: 28,
          days: 28,
          endDate: new Date('2026-06-17T00:00:00.000Z'),
        }),
      ],
    };

    const facilityCard = buildInventoryForecast(input).patients.find(
      (card) => card.key === 'facility-batch:batch-a',
    );

    expect(facilityCard).toMatchObject({
      patientId: null,
      facilityPatientCount: 5,
      shortagePatientCount: 2,
      dataBackedPatientCount: 2,
      shortageDrugKeys: ['トラセミド'],
      runOutDateKey: '2026-06-17',
      runOutBasis: 'line_end_date',
      urgency: 'critical',
      shortageDetails: [
        {
          drugKey: 'トラセミド',
          requiredQty: 14,
          stockQty: 3,
          unit: '錠',
          status: 'order_required',
          affectedPatientCount: 2,
          runOutDateKey: '2026-06-17',
          runOutBasis: 'line_end_date',
          urgency: 'critical',
        },
      ],
    });
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
