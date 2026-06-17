import { describe, expect, it } from 'vitest';

import {
  calendarWorkbenchStateFromApi,
  cellMetaFromCalendar,
  patientRowToSeed,
  patientsFromApi,
  workbenchFromApi,
} from './dispensing-workbench.from-api';
import type { CalendarMatrixResponse } from './dispensing-workbench.write-types';
import type {
  DispenseWorkbenchData,
  DispenseWorkbenchPatientRow,
  WorkbenchComparisonRow,
  WorkbenchCountRow,
} from '@/app/(dashboard)/dispense/dispense-workbench.shared';

/**
 * 実データ → model 写像（dispensing-workbench.from-api.ts）の固定マッピングテスト。
 *
 * 計画 §4 アダプタ境界 / §11 / §14。1b スコープ（dispense / audit 読取）の境界契約を
 * 代表フィクスチャで固定する。朝昼夕眠前 slots・is_generic・dispensed_at・グループ化・
 * リボン（chips / biko / changes / discontinued）・患者リスト → PatientListItem 相当の
 * SeedPatient を検証する。書込（楽観更新 / 競合 / 保留）と set / seta は対象外。
 */

// ── フィクスチャ・ファクトリ ──

/** 既定値つき count_row ファクトリ（必要フィールドのみ上書き）。 */
function countRow(over: Partial<WorkbenchCountRow>): WorkbenchCountRow {
  return {
    line_id: 'L0',
    result_id: null,
    line_number: 1,
    drug_name: '薬剤',
    dose: null,
    frequency: '毎食後',
    route: 'internal',
    tags: [],
    is_narcotic: false,
    is_generic: false,
    prescribed_label: '',
    prescribed_quantity: null,
    days: null,
    dispensed_label: null,
    dispensed_at: null,
    dispensed_quantity: null,
    unit: '錠',
    dispensing_method: null,
    packaging_method: null,
    packaging_instructions: null,
    packaging_group_id: null,
    ...over,
  };
}

/** 既定値つき comparison_row ファクトリ。 */
function comparisonRow(over: Partial<WorkbenchComparisonRow>): WorkbenchComparisonRow {
  return {
    key: 'k0',
    drug_name: '薬剤',
    previous_label: null,
    current_label: null,
    change_type: null,
    direction: null,
    inquiry_origin: false,
    ...over,
  };
}

/** 代表的な workbench レスポンスの基本形（テスト毎に部分上書き）。 */
function workbenchData(over: Partial<DispenseWorkbenchData> = {}): DispenseWorkbenchData {
  return {
    task: { id: 'task-1', status: 'in_progress', priority: 'normal', due_date: null },
    cycle: { id: 'cycle-1', overall_status: 'dispensing', version: 1 },
    patient: { id: 'pat-1', name: '佐藤 花子' },
    intake: {
      id: 'intake-1',
      prescribed_date: '2026-06-15',
      prescriber_institution: 'さくら内科クリニック',
      prescriber_name: '田中 一郎',
    },
    previous_intake: { prescribed_date: '2026-05-18' },
    safety: {
      allergy: null,
      renal: null,
      handling_tags: ['麻薬', 'ハイリスク'],
      swallowing: null,
      cautions: ['嚥下機能低下のため粉砕希望', '残薬あり要確認'],
    },
    comparison: [],
    count_rows: [],
    dispenser: { id: 'u1', name: '鈴木', time_label: '09:10' },
    auditor: { id: 'u2', name: '高橋' },
    is_self_audit: false,
    has_narcotic: true,
    visit_time_label: null,
    resolved_inquiry: null,
    team_audit_total: 0,
    stock_check_date_label: null,
    ...over,
  };
}

// ── 患者リスト写像 ──

describe('patientRowToSeed / patientsFromApi', () => {
  const row: DispenseWorkbenchPatientRow = {
    patient_id: 'pat-1',
    cycle_id: 'cycle-1',
    name: '佐藤 花子',
    name_kana: 'サトウ ハナコ',
    overall_status: 'dispensing',
    badge: 'in_progress',
    start_date: '2026-06-10',
    registered_date: '2025-12-01',
  };

  it('id / name / kana / 服用開始日 / 登録日（YYYY/MM/DD）を写す', () => {
    const seed = patientRowToSeed(row);
    expect(seed.id).toBe('pat-1');
    expect(seed.name).toBe('佐藤 花子');
    expect(seed.kana).toBe('サトウ ハナコ');
    expect(seed.seedStart).toBe('2026-06-10');
    expect(seed.regist).toBe('2025/12/01');
  });

  it('アバター頭文字は名前の先頭1文字', () => {
    expect(patientRowToSeed(row).short).toBe('佐');
  });

  it('供給源の無いフィールドは安全なプレースホルダ（落ちない優先）', () => {
    const seed = patientRowToSeed(row);
    expect(seed.dob).toBe('—');
    expect(seed.age).toBe(0);
    expect(seed.sex).toBe('—');
    expect(seed.yosei).toBe('—');
    expect(seed.seedDays).toBe(0);
    expect(seed.chips).toEqual([]);
    expect(seed.changes).toEqual([]);
    expect(seed.biko).toEqual([]);
    expect(seed.rows).toEqual([]);
  });

  it('start_date が null のときは空文字', () => {
    const seed = patientRowToSeed({ ...row, start_date: null });
    expect(seed.seedStart).toBe('');
  });

  it('patientsFromApi は全行を写像', () => {
    const seeds = patientsFromApi([row, { ...row, patient_id: 'pat-2', name: '山田 太郎' }]);
    expect(seeds.map((s) => s.id)).toEqual(['pat-1', 'pat-2']);
    expect(seeds[1].short).toBe('山');
  });
});

// ── ワークベンチ写像: 時点数量（朝昼夕眠前 slots） ──

describe('workbenchFromApi — 朝昼夕眠前 slots の逆算割付', () => {
  it('毎食後（3時点）の錠剤は朝昼夕に均等割付・眠前は空', () => {
    const data = workbenchData({
      count_rows: [
        countRow({
          line_id: 'L1',
          drug_name: 'マグミット錠250mg',
          frequency: '毎食後',
          prescribed_quantity: 84,
          days: 28,
          unit: '錠',
        }),
      ],
    });
    const { groups } = workbenchFromApi(data);
    const d = groups[0].drugs[0];
    // 84 / 28 / 3 = 1
    expect(d.a).toBe('1');
    expect(d.h).toBe('1');
    expect(d.y).toBe('1');
    expect(d.n).toBe('');
    expect(d.prescribedQuantity).toBe(84);
  });

  it('朝夕食後（2時点）の g 製剤は単位付きで朝夕に割付', () => {
    const data = workbenchData({
      count_rows: [
        countRow({
          line_id: 'L2',
          drug_name: 'テグレトール細粒',
          frequency: '朝夕食後',
          prescribed_quantity: 22.4,
          days: 28,
          unit: 'g',
        }),
      ],
    });
    const d = workbenchFromApi(data).groups[0].drugs[0];
    // 22.4 / 28 / 2 = 0.4 → '0.4g'
    expect(d.a).toBe('0.4g');
    expect(d.y).toBe('0.4g');
    expect(d.h).toBe('');
    expect(d.n).toBe('');
  });

  it('寝る前（眠前単独）は n のみ', () => {
    const data = workbenchData({
      count_rows: [
        countRow({
          line_id: 'L3',
          drug_name: 'ゾルピデム錠5mg',
          frequency: '寝る前',
          prescribed_quantity: 28,
          days: 28,
          unit: '錠',
        }),
      ],
    });
    const d = workbenchFromApi(data).groups[0].drugs[0];
    expect(d.n).toBe('1');
    expect(d.a).toBe('');
    expect(d.h).toBe('');
    expect(d.y).toBe('');
  });

  it('数量 / days 不明は全 slot 空欄（view 側で計数空欄）', () => {
    const data = workbenchData({
      count_rows: [
        countRow({ line_id: 'L4', frequency: '毎食後', prescribed_quantity: null, days: null }),
      ],
    });
    const d = workbenchFromApi(data).groups[0].drugs[0];
    expect(d).toMatchObject({ a: '', h: '', y: '', n: '' });
  });

  it('頓用は slot を割り付けず tag=頓用', () => {
    const data = workbenchData({
      count_rows: [
        countRow({
          line_id: 'L5',
          drug_name: 'センノシド錠12mg',
          frequency: '疼痛時',
          prescribed_quantity: 10,
          days: 1,
          unit: '錠',
        }),
      ],
    });
    const d = workbenchFromApi(data).groups[0].drugs[0];
    expect(d.tag).toBe('頓用');
    expect(d).toMatchObject({ a: '', h: '', y: '', n: '' });
  });
});

// ── ワークベンチ写像: Drug フィールド（tag / funsai / note / 用法） ──

describe('workbenchFromApi — Drug フィールド写像', () => {
  it('外用（非内服 route）は tag=外用', () => {
    const data = workbenchData({
      count_rows: [
        countRow({
          line_id: 'L6',
          drug_name: 'ヒルドイドローション',
          frequency: '1日2回',
          route: 'external',
        }),
      ],
    });
    expect(workbenchFromApi(data).groups[0].drugs[0].tag).toBe('外用');
  });

  it('packaging_method=crush_and_pack は funsai=true', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'L7', packaging_method: 'crush_and_pack' })],
    });
    expect(workbenchFromApi(data).groups[0].drugs[0].funsai).toBe(true);
  });

  it('packaging_instructions の「粉砕」記述でも funsai=true', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'L8', packaging_instructions: '粉砕して別包' })],
    });
    expect(workbenchFromApi(data).groups[0].drugs[0].funsai).toBe(true);
  });

  it('note は packaging_instructions を主体に separate_pack タグで別包を補う', () => {
    const data = workbenchData({
      count_rows: [
        countRow({ line_id: 'L9', tags: ['separate_pack'], packaging_instructions: '賦形あり' }),
      ],
    });
    expect(workbenchFromApi(data).groups[0].drugs[0].note).toBe('賦形あり ・ 別包');
  });

  it('did=line_id・空の frequency は「用法未登録」', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'L10', frequency: '' })],
    });
    const d = workbenchFromApi(data).groups[0].drugs[0];
    expect(d.did).toBe('L10');
    expect(d.yoho).toBe('用法未登録');
  });
});

// ── ワークベンチ写像: グループ化（packaging_group_id） ──

describe('workbenchFromApi — グループ化', () => {
  it('packaging_group_id 単位でグループ化し出現順を保持', () => {
    const data = workbenchData({
      count_rows: [
        countRow({ line_id: 'A1', drug_name: 'A1', packaging_group_id: 'g-alpha' }),
        countRow({ line_id: 'B1', drug_name: 'B1', packaging_group_id: 'g-beta' }),
        countRow({ line_id: 'A2', drug_name: 'A2', packaging_group_id: 'g-alpha' }),
      ],
    });
    const { groups } = workbenchFromApi(data);
    expect(groups).toHaveLength(2);
    expect(groups[0].drugs.map((d) => d.did)).toEqual(['A1', 'A2']);
    expect(groups[1].drugs.map((d) => d.did)).toEqual(['B1']);
    expect(groups[0].gid).toBe('task-1-g0');
    expect(groups[1].gid).toBe('task-1-g1');
    expect(groups[1].label).toBe('グループ 2');
  });

  it('packaging_group_id 無しは単一の「定期薬」グループ', () => {
    const data = workbenchData({
      count_rows: [
        countRow({ line_id: 'U1', drug_name: 'U1' }),
        countRow({ line_id: 'U2', drug_name: 'U2' }),
      ],
    });
    const { groups } = workbenchFromApi(data);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('定期薬');
    expect(groups[0].drugs.map((d) => d.did)).toEqual(['U1', 'U2']);
  });

  it('グループ start は intake.prescribed_date を継承', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'S1' })],
    });
    expect(workbenchFromApi(data).groups[0].start).toBe('2026-06-15');
  });
});

// ── ワークベンチ写像: comparison（chg / prevText / changes / discontinued） ──

describe('workbenchFromApi — comparison 写像', () => {
  it('added は drug.chg=new・patient.changes に「追加」', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'C1', drug_name: '新規薬' })],
      comparison: [
        comparisonRow({ drug_name: '新規薬', change_type: 'added', current_label: '今回' }),
      ],
    });
    const { patient, groups } = workbenchFromApi(data);
    expect(groups[0].drugs[0].chg).toBe('new');
    expect(patient.changes).toContainEqual({ type: '追加', text: '新規薬' });
  });

  it('dose_changed は drug.chg=changed・prevText を保持・changes に「変更」', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'C2', drug_name: 'クエチアピン錠25mg' })],
      comparison: [
        comparisonRow({
          drug_name: 'クエチアピン錠25mg',
          change_type: 'dose_changed',
          previous_label: '25mg 1錠',
          current_label: '25mg 2錠',
          direction: 'increase',
        }),
      ],
    });
    const { patient, groups } = workbenchFromApi(data);
    const d = groups[0].drugs[0];
    expect(d.chg).toBe('changed');
    expect(d.prevText).toBe('25mg 1錠');
    expect(patient.changes).toContainEqual({
      type: '変更',
      text: 'クエチアピン錠25mg（25mg 1錠 → 25mg 2錠）',
    });
  });

  it('同一薬剤名の複数行では comparison.key と line_id で対象行だけに変更を付ける', () => {
    const data = workbenchData({
      count_rows: [
        countRow({
          line_id: 'C2a',
          drug_name: 'ロキソプロフェン錠60mg',
          frequency: '朝食後',
        }),
        countRow({
          line_id: 'C2b',
          drug_name: 'ロキソプロフェン錠60mg',
          frequency: '夕食後',
        }),
      ],
      comparison: [
        comparisonRow({
          key: 'C2b',
          drug_name: 'ロキソプロフェン錠60mg',
          change_type: 'dose_changed',
          previous_label: '1回1錠 / 夕食後',
          current_label: '1回2錠 / 夕食後',
          direction: 'increase',
        }),
      ],
    });

    const { groups } = workbenchFromApi(data);
    expect(groups[0].drugs[0].did).toBe('C2a');
    expect(groups[0].drugs[0]).not.toHaveProperty('chg');
    expect(groups[0].drugs[0]).not.toHaveProperty('prevText');
    expect(groups[0].drugs[1]).toMatchObject({
      did: 'C2b',
      chg: 'changed',
      prevText: '1回1錠 / 夕食後',
    });
  });

  it('removed は discontinued と changes「中止」に振り分け（drug 行は生成しない）', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'C3', drug_name: '継続薬' })],
      comparison: [
        comparisonRow({
          drug_name: 'ファモチジンD錠20mg',
          change_type: 'removed',
          previous_label: '朝夕食後',
        }),
      ],
    });
    const { patient, groups } = workbenchFromApi(data);
    expect(groups[0].drugs).toHaveLength(1);
    expect(patient.discontinued).toEqual([{ name: 'ファモチジンD錠20mg', yoho: '朝夕食後' }]);
    expect(patient.changes).toContainEqual({ type: '中止', text: 'ファモチジンD錠20mg' });
  });

  it('frequency_changed も chg=changed として扱う', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'C4', drug_name: '用法変更薬' })],
      comparison: [
        comparisonRow({
          drug_name: '用法変更薬',
          change_type: 'frequency_changed',
          previous_label: '朝',
          current_label: '朝夕',
        }),
      ],
    });
    expect(workbenchFromApi(data).groups[0].drugs[0].chg).toBe('changed');
  });

  it('change_type=null の比較行は無視（変更点に出さない）', () => {
    const data = workbenchData({
      count_rows: [countRow({ line_id: 'C5', drug_name: '継続薬' })],
      comparison: [comparisonRow({ drug_name: '継続薬', change_type: null })],
    });
    const { patient, groups } = workbenchFromApi(data);
    expect(groups[0].drugs[0].chg).toBeUndefined();
    expect(patient.changes).toEqual([]);
    expect(patient.discontinued).toBeUndefined();
  });
});

// ── ワークベンチ写像: patient リボン（chips / biko / regist） ──

describe('workbenchFromApi — patient リボン写像', () => {
  it('id / name / 頭文字 / regist（YYYY/MM/DD）/ seedStart を写す', () => {
    const { patient } = workbenchFromApi(workbenchData({ count_rows: [countRow({})] }));
    expect(patient.id).toBe('pat-1');
    expect(patient.name).toBe('佐藤 花子');
    expect(patient.short).toBe('佐');
    expect(patient.regist).toBe('2026/06/15');
    expect(patient.seedStart).toBe('2026-06-15');
  });

  it('chips は handling_tags を重複排除して載せる', () => {
    const data = workbenchData({
      safety: {
        allergy: null,
        renal: null,
        handling_tags: ['麻薬', 'ハイリスク', '麻薬'],
        swallowing: null,
        cautions: [],
      },
      count_rows: [countRow({})],
    });
    expect(workbenchFromApi(data).patient.chips).toEqual(['麻薬', 'ハイリスク']);
  });

  it('biko は safety.cautions をそのまま載せる', () => {
    const { patient } = workbenchFromApi(workbenchData({ count_rows: [countRow({})] }));
    expect(patient.biko).toEqual(['嚥下機能低下のため粉砕希望', '残薬あり要確認']);
  });

  it('intake が null のとき regist は空・seedStart は空', () => {
    const data = workbenchData({ intake: null, count_rows: [countRow({})] });
    const { patient, groups } = workbenchFromApi(data);
    expect(patient.regist).toBe('');
    expect(patient.seedStart).toBe('');
    expect(groups[0].start).toBe('');
  });
});

// ── カレンダー写像: set / set-audit の実データ state ──

function calendarCell(
  over: Partial<CalendarMatrixResponse['rows'][number]['days'][number]['cells']['morning']> = {},
) {
  return {
    batch_id: null,
    state: 'empty',
    quantity: null,
    carry_type: null,
    set_state: null,
    audit_state: null,
    ng_code: null,
    held_reason: null,
    version: null,
    ...over,
  } satisfies CalendarMatrixResponse['rows'][number]['days'][number]['cells']['morning'];
}

function calendarMatrix(): CalendarMatrixResponse {
  return {
    plan_id: 'plan_1',
    cycle_id: 'cycle_1',
    cycle_version: 7,
    cycle_status: 'setting',
    set_method: 'facility_calendar',
    period_start: '2026-06-17',
    period_end: '2026-06-18',
    day_count: 2,
    slots: ['morning', 'noon', 'evening', 'bedtime', 'prn'],
    rows: [
      {
        line: {
          id: 'line_1',
          drug_name: 'アムロジピン錠5mg',
          dose: '1錠',
          frequency: '朝食後',
          unit: '錠',
        },
        days: [
          {
            day_number: 1,
            date: '2026-06-17',
            cells: {
              morning: calendarCell({
                batch_id: 'batch_m1',
                state: 'ok',
                quantity: 1,
                carry_type: 'carry',
                set_state: 'set',
                audit_state: 'ok',
                version: 3,
              }),
              noon: calendarCell(),
              evening: calendarCell(),
              bedtime: calendarCell(),
              prn: calendarCell(),
            },
          },
          {
            day_number: 2,
            date: '2026-06-18',
            cells: {
              morning: calendarCell({
                batch_id: 'batch_m2',
                state: 'set',
                quantity: 1,
                carry_type: 'carry',
                set_state: 'set',
                audit_state: 'pending',
                version: 4,
              }),
              noon: calendarCell(),
              evening: calendarCell(),
              bedtime: calendarCell(),
              prn: calendarCell(),
            },
          },
        ],
      },
      {
        line: {
          id: 'line_2',
          drug_name: '酸化マグネシウム錠250mg',
          dose: '1錠',
          frequency: '夕食後',
          unit: '錠',
        },
        days: [
          {
            day_number: 1,
            date: '2026-06-17',
            cells: {
              morning: calendarCell(),
              noon: calendarCell(),
              evening: calendarCell({
                batch_id: 'batch_e1',
                state: 'ng',
                quantity: 1,
                carry_type: 'carry',
                set_state: 'set',
                audit_state: 'ng',
                ng_code: 'quantity_short',
                version: 5,
              }),
              bedtime: calendarCell(),
              prn: calendarCell(),
            },
          },
          {
            day_number: 2,
            date: '2026-06-18',
            cells: {
              morning: calendarCell(),
              noon: calendarCell(),
              evening: calendarCell({
                batch_id: 'batch_e2',
                state: 'hold',
                quantity: 1,
                carry_type: 'carry',
                set_state: 'hold',
                audit_state: 'pending',
                held_reason: 'doctor_confirm_wait',
                version: 6,
              }),
              bedtime: calendarCell(),
              prn: calendarCell(),
            },
          },
        ],
      },
    ],
    completion_gate: {
      total_cells: 4,
      set_cells: 3,
      pending_cells: 0,
      hold_cells: 1,
      audited_ok_cells: 1,
      audited_ng_cells: 1,
      unaudited_cells: 2,
      set_complete: false,
      audit_complete: false,
    },
  };
}

describe('calendarWorkbenchStateFromApi / cellMetaFromCalendar', () => {
  it('SetBatch calendar を workbench model と set/audit cell state に写す', () => {
    const state = calendarWorkbenchStateFromApi('patient_1', calendarMatrix());

    expect(state.model.patient_1[0]).toMatchObject({
      label: 'セット対象',
      method: 'facility_calendar',
      start: '2026-06-17',
      days: 2,
      calendarStart: '2026-06-17',
      calendarDayCount: 2,
    });
    expect(state.model.patient_1[0].drugs).toEqual([
      expect.objectContaining({
        did: 'line_1',
        name: 'アムロジピン錠5mg',
        yoho: '朝食後',
        a: '1',
      }),
      expect.objectContaining({
        did: 'line_2',
        name: '酸化マグネシウム錠250mg',
        yoho: '夕食後',
        y: '1',
      }),
    ]);
    expect(state.setCells).toMatchObject({
      'patient_1:0:朝': 'set',
      'patient_1:1:朝': 'set',
      'patient_1:0:夕': 'set',
      'patient_1:1:夕': 'hold',
    });
    expect(state.auditCells).toMatchObject({
      'patient_1:0:朝': 'ok',
      'patient_1:0:夕': 'ng',
      'patient_1:1:夕': 'hold',
    });
    expect(state.ng).toEqual({
      'patient_1:0:夕': '数量不足',
    });
    expect(state.holdInfo).toEqual({
      'patient_1:1:夕': {
        reason: '医師確認待ち',
        due: '',
        owner: '',
        memo: '',
      },
    });
  });

  it('同一セルの複数 batch id/version を cellMeta に束ねる', () => {
    const meta = cellMetaFromCalendar('patient_1', calendarMatrix());

    expect(meta['patient_1:0:朝']).toEqual({
      batchIds: ['batch_m1'],
      versions: [3],
      dayNumber: 1,
      slot: 'morning',
    });
    expect(meta['patient_1:1:夕']).toEqual({
      batchIds: ['batch_e2'],
      versions: [6],
      dayNumber: 2,
      slot: 'evening',
    });
  });
});
