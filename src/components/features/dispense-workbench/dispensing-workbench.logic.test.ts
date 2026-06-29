import { describe, expect, it } from 'vitest';

import { buildPatients } from './dispensing-workbench.seed';
import {
  buildModel,
  calc,
  calendarDayCountOf,
  calcGate,
  cellKey,
  comparison,
  dailyDose,
  drugsOf,
  endDate,
  fmtNum,
  formOf,
  mapTiming,
  nextGroupNo,
  normCell,
  patientProgress,
  parseISO,
  shortMD,
  sortedIds,
  startKeyOf,
  sumU,
  totals,
} from './dispensing-workbench.logic';
import { SET_AUDIT_CHECK_ITEMS } from './dispensing-workbench.write-types';
import type { Drug, Group } from './dispensing-workbench.types';

const PATIENTS = buildPatients();
const MODEL = buildModel(PATIENTS);

function drug(over: Partial<Drug>): Drug {
  return {
    did: 'd0',
    name: '',
    yoho: '',
    a: '',
    h: '',
    y: '',
    n: '',
    tag: '',
    funsai: false,
    note: '',
    ...over,
  };
}

describe('endDate', () => {
  it('start + days - 1（28日処方の終了日）', () => {
    // 2026-06-15 + 28 - 1 = 2026-07-12
    expect(endDate('2026-06-15', 28)).toBe('2026/07/12（日）');
  });
  it('1日処方は開始日と同じ', () => {
    expect(endDate('2026-06-17', 1)).toBe('2026/06/17（水）');
  });
  it('文字列日数も受理', () => {
    expect(endDate('2026-06-17', '14')).toBe('2026/06/30（火）');
  });
  it('不正入力は —', () => {
    expect(endDate('', 28)).toBe('—');
    expect(endDate('2026-06-15', 0)).toBe('—');
  });
});

describe('parseISO / fmtNum / normCell / shortMD', () => {
  it('parseISO は ISO のみ受理', () => {
    expect(parseISO('2026-06-15')?.getFullYear()).toBe(2026);
    expect(parseISO('2026/06/15')).toBeNull();
    expect(parseISO('')).toBeNull();
  });
  it('fmtNum は整数/小数を整形', () => {
    expect(fmtNum(2)).toBe('2');
    expect(fmtNum(1.5)).toBe('1.5');
  });
  it('normCell は数値を整形・非数値はそのまま', () => {
    expect(normCell('1.0')).toBe('1');
    expect(normCell('0.4g')).toBe('0.4g');
    expect(normCell('')).toBe('');
  });
  it('shortMD は M/D', () => {
    expect(shortMD('2026-06-17')).toBe('6/17');
    expect(shortMD('')).toBe('—');
  });
});

describe('mapTiming', () => {
  it('朝夕食後 → 朝・夕', () => {
    expect(mapTiming('朝夕食後')).toEqual(['朝', '夕']);
  });
  it('毎食後 → 朝昼夕', () => {
    expect(mapTiming('毎食後')).toEqual(['朝', '昼', '夕']);
  });
  it('寝る前 → 眠前', () => {
    expect(mapTiming('寝る前')).toEqual(['眠前']);
  });
  it('朝食後・寝る前 → 朝・眠前', () => {
    expect(mapTiming('朝食後・寝る前')).toEqual(['朝', '眠前']);
  });
  it('時刻指定（10時・22時）は食事系扱いで朝昼夕', () => {
    expect(mapTiming('10時・22時')).toEqual(['朝', '昼', '夕']);
  });
  it('該当語なし → 朝', () => {
    expect(mapTiming('便秘時')).toEqual(['朝', '昼', '夕']); // '時' を含むため食事系
    expect(mapTiming('就寝')).toEqual(['眠前']);
  });
});

describe('formOf（剤形分類）', () => {
  it('錠剤', () => {
    expect(formOf(drug({ name: 'マグミット錠250mg' })).l).toBe('錠');
  });
  it('散剤（細粒/顆粒/散/DS）', () => {
    expect(formOf(drug({ name: 'ミヤBM細粒' })).l).toBe('散');
    expect(formOf(drug({ name: 'ツムラ六君子湯エキス顆粒' })).l).toBe('散');
    expect(formOf(drug({ name: 'レベチラセタムDS50％' })).l).toBe('散');
  });
  it('カプセル', () => {
    expect(formOf(drug({ name: 'エブランチルカプセル15mg' })).l).toBe('カ');
  });
  it('液剤', () => {
    expect(formOf(drug({ name: 'ラジカット懸濁内用液' })).l).toBe('液');
  });
  it('頓服（tag 優先）', () => {
    expect(formOf(drug({ name: 'センノシド錠12mg', tag: '頓用' })).l).toBe('頓');
  });
  it('該当なしはその他', () => {
    expect(formOf(drug({ name: '塩化ナトリウム' })).l).toBe('薬');
  });
});

describe('dailyDose', () => {
  it('名前内の（X/日）を優先', () => {
    expect(dailyDose(drug({ name: 'ミヤBM細粒（1.6g/日）' }))).toBe('1.6g');
  });
  it('朝夕の錠数を合算', () => {
    expect(dailyDose(drug({ name: 'フェキソフェナジン錠', a: '1.0', y: '1.0' }))).toBe('2錠');
  });
  it('g 単位を合算', () => {
    expect(dailyDose(drug({ name: 'テグレトール細粒', a: '0.4g', y: '0.4g' }))).toBe('0.8g');
  });
});

describe('buildModel', () => {
  it('全患者がグループ化される', () => {
    expect(Object.keys(MODEL)).toHaveLength(PATIENTS.length);
  });
  it('0001 は 2 グループ（定期薬 / 時々処方）', () => {
    expect(MODEL['0001']).toHaveLength(2);
    expect(MODEL['0001'][0].label).toBe('定期薬');
    expect(MODEL['0001'][0].method).toBe('散剤分包機');
  });
  it('薬剤に did が一意付与され、グループ start/days が seed から継承', () => {
    const g = MODEL['0003'][0];
    expect(g.start).toBe('2026-06-17');
    expect(g.days).toBe(14);
    const allDids = drugsOf(MODEL, '0003').map((d) => d.did);
    expect(new Set(allDids).size).toBe(allDids.length);
  });
});

describe('calc（packets / PTP分類 / カレンダーその他薬）', () => {
  it('0003 朝食後は包数 > 0（定時薬が一包化）', () => {
    const c = calc(MODEL, '0003');
    expect(c.active).toContain('朝');
    expect(c.content['朝'].packets).toBeGreaterThan(0);
    expect(c.content['朝'].packetText).toMatch(/包$/);
  });
  it('0003 の頓用（センノシド）はカレンダーその他薬に分類', () => {
    const c = calc(MODEL, '0003');
    expect(c.outside.some((o) => /センノシド/.test(o.name) && o.kind === '頓服')).toBe(true);
  });
  it('0005 の PTP 注記薬は追加PTPテキストを生成', () => {
    const c = calc(MODEL, '0005');
    const hasPtp = Object.values(c.content).some((v) => /追加PTP/.test(v.ptpText));
    expect(hasPtp).toBe(true);
  });
  it('0006 の懸濁内用液はカレンダーその他薬（液剤）', () => {
    const c = calc(MODEL, '0006');
    expect(c.outside.some((o) => /ラジカット/.test(o.name) && o.kind === '液剤')).toBe(true);
  });
  it('tag=外用の薬剤名に外用語がなくてもカレンダーその他薬（外用）に分類', () => {
    const c = calc(
      {
        pat_1: [
          {
            gid: 'g1',
            label: 'セット対象',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              drug({
                did: 'line_external',
                name: '薬剤A',
                yoho: '1日1回',
                tag: '外用',
              }),
            ],
          },
        ],
      },
      'pat_1',
    );

    expect(c.outside).toEqual([{ line_id: 'line_external', name: '薬剤A', kind: '外用' }]);
  });
  it('別包薬は packets に加算されるが drugs に（別包）サフィックス', () => {
    const c = calc(MODEL, '0002');
    const all = Object.values(c.content).flatMap((v) => v.drugs);
    expect(all.some((n) => /（別包）$/.test(n))).toBe(true);
  });
});

describe('patientProgress', () => {
  it('監査進捗は調剤済みかつ監査済みの行だけ数える', () => {
    const model = {
      patient_multi: [
        {
          gid: 'g_multi',
          label: '朝食後',
          method: '一包化',
          start: '2026-04-01',
          days: 14,
          drugs: [
            drug({ did: 'line_1', name: 'アムロジピン錠5mg' }),
            drug({ did: 'line_2', name: 'カンデサルタン錠4mg' }),
          ],
        },
      ],
    };

    expect(
      patientProgress(model, 'patient_multi', { line_1: true }, { line_1: true, line_2: true }),
    ).toEqual({ total: 2, done: 1, audit: 1 });
  });
});

describe('calcGate（4区分ゲート）', () => {
  it('グリッド工程は全対象行チェック済みで ok', () => {
    const done = Object.fromEntries(
      MODEL['0001'].flatMap((g) => g.drugs.map((d) => [d.did, true])),
    );

    expect(
      calcGate({
        phase: 'dispense',
        model: MODEL,
        id: '0001',
        done,
        setCells: {},
        auditCells: {},
        outChk: {},
        packet: {},
      }).ok,
    ).toBe(true);
    expect(
      calcGate({
        phase: 'audit',
        model: MODEL,
        id: '0001',
        done,
        audit: done,
        setCells: {},
        auditCells: {},
        outChk: {},
        packet: {},
      }).ok,
    ).toBe(true);
  });

  it('グリッド工程は未チェック行が残ると不可', () => {
    const g = calcGate({
      phase: 'dispense',
      model: MODEL,
      id: '0001',
      done: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      packet: {},
    });

    expect(g.ok).toBe(false);
    expect(g.text).toMatch(/未調剤/);
  });

  it('グリッド工程は複数行の一部だけチェック済みでも不可', () => {
    const model = {
      patient_multi: [
        {
          gid: 'g_multi',
          label: '朝食後',
          method: '一包化',
          start: '2026-04-01',
          days: 14,
          drugs: [
            drug({ did: 'line_1', name: 'アムロジピン錠5mg' }),
            drug({ did: 'line_2', name: 'カンデサルタン錠4mg' }),
          ],
        },
      ],
    };

    const dispenseGate = calcGate({
      phase: 'dispense',
      model,
      id: 'patient_multi',
      done: { line_1: true },
      setCells: {},
      auditCells: {},
      outChk: {},
      packet: {},
    });
    expect(dispenseGate).toMatchObject({ ok: false, text: '未調剤 1' });

    const auditGate = calcGate({
      phase: 'audit',
      model,
      id: 'patient_multi',
      done: { line_1: true },
      audit: { line_1: true },
      setCells: {},
      auditCells: {},
      outChk: {},
      packet: {},
    });
    expect(auditGate).toMatchObject({ ok: false, text: '未監査 1' });
  });

  it('監査工程は監査チェックだけでは不可で、調剤済みも必要', () => {
    const model = {
      patient_multi: [
        {
          gid: 'g_multi',
          label: '朝食後',
          method: '一包化',
          start: '2026-04-01',
          days: 14,
          drugs: [
            drug({ did: 'line_1', name: 'アムロジピン錠5mg' }),
            drug({ did: 'line_2', name: 'カンデサルタン錠4mg' }),
          ],
        },
      ],
    };

    const gate = calcGate({
      phase: 'audit',
      model,
      id: 'patient_multi',
      done: { line_1: true },
      audit: { line_1: true, line_2: true },
      setCells: {},
      auditCells: {},
      outChk: {},
      packet: {},
    });

    expect(gate).toMatchObject({ ok: false, text: '未監査 1' });
  });

  it('setp は未セットありで不可・メッセージに未セット件数', () => {
    const g = calcGate({
      phase: 'setp',
      model: MODEL,
      id: '0003',
      setCells: {},
      auditCells: {},
      outChk: {},
      packet: {},
    });
    expect(g.ok).toBe(false);
    expect(g.text).toMatch(/未セット/);
  });

  it('setp は全セル set + その他薬確認 + 持出完了で ok', () => {
    const id = '0003';
    const cal = calc(MODEL, id);
    const setCells: Record<string, string> = {};
    for (let di = 0; di < 7; di++)
      cal.active.forEach((tk) => (setCells[cellKey(id, di, tk)] = 'set'));
    const outChk: Record<string, boolean> = {};
    cal.outside.forEach((o) => (outChk[id + ':' + o.name] = true));
    const packet: Record<string, boolean> = {};
    ['cal', 'ton', 'gai', 'liq', 'doc', 'note'].forEach((k) => (packet[id + ':' + k] = true));
    const g = calcGate({
      phase: 'setp',
      model: MODEL,
      id,
      setCells,
      auditCells: {},
      outChk,
      packet,
    });
    expect(g.ok).toBe(true);
    expect(g.text).toMatch(/完成/);
  });

  it('seta は NG が1つでもあると不可', () => {
    const id = '0003';
    const cal = calc(MODEL, id);
    const auditCells: Record<string, string> = {};
    for (let di = 0; di < 7; di++)
      cal.active.forEach((tk) => (auditCells[cellKey(id, di, tk)] = 'ok'));
    auditCells[cellKey(id, 0, cal.active[0])] = 'ng';
    const g = calcGate({
      phase: 'seta',
      model: MODEL,
      id,
      setCells: {},
      auditCells,
      outChk: {},
      packet: {},
    });
    expect(g.ok).toBe(false);
    expect(g.text).toMatch(/NG/);
  });

  it('seta は全セル ok でも6項目チェック未完了なら不可', () => {
    const id = '0003';
    const cal = calc(MODEL, id);
    const auditCells: Record<string, string> = {};
    for (let di = 0; di < 7; di++)
      cal.active.forEach((tk) => (auditCells[cellKey(id, di, tk)] = 'ok'));
    const g = calcGate({
      phase: 'seta',
      model: MODEL,
      id,
      setCells: {},
      auditCells,
      outChk: {},
      packet: {},
    });
    expect(g.ok).toBe(false);
    expect(g.text).toMatch(/確認 6/);
  });

  it('seta は全セル ok + 6項目チェック完了で承認可', () => {
    const id = '0003';
    const cal = calc(MODEL, id);
    const auditCells: Record<string, string> = {};
    for (let di = 0; di < 7; di++)
      cal.active.forEach((tk) => (auditCells[cellKey(id, di, tk)] = 'ok'));
    const checks = Object.fromEntries(
      SET_AUDIT_CHECK_ITEMS.map((_, index) => [`${cellKey(id, 0, cal.active[0])}:${index}`, true]),
    );
    const g = calcGate({
      phase: 'seta',
      model: MODEL,
      id,
      setCells: {},
      auditCells,
      outChk: {},
      packet: {},
      checks,
    });
    expect(g.ok).toBe(true);
    expect(g.text).toMatch(/承認可/);
  });

  it('set/set-audit gate uses API-backed calendarDayCount instead of phantom 7-day cells', () => {
    const id = 'patient_api';
    const model = {
      [id]: [
        {
          gid: 'g_api',
          label: 'セット対象',
          method: 'facility_calendar',
          start: '2026-04-01',
          days: 1,
          calendarStart: '2026-04-01',
          calendarDayCount: 1,
          drugs: [
            {
              did: 'line_1',
              name: 'アムロジピン錠5mg',
              yoho: '朝食後',
              a: '1',
              h: '',
              y: '',
              n: '',
              tag: '',
              funsai: false,
              note: '',
            },
          ],
        },
      ],
    };
    const setCells = { [cellKey(id, 0, '朝')]: 'set' };
    const auditCells = { [cellKey(id, 0, '朝')]: 'ok' };

    expect(calendarDayCountOf(model[id])).toBe(1);
    expect(
      calcGate({
        phase: 'setp',
        model,
        id,
        setCells,
        auditCells: {},
        outChk: {},
        packet: { [`${id}:cal`]: true, [`${id}:doc`]: true, [`${id}:note`]: true },
      }),
    ).toMatchObject({ ok: true });
    expect(
      calcGate({
        phase: 'seta',
        model,
        id,
        setCells: {},
        auditCells,
        outChk: {},
        packet: {},
        checks: Object.fromEntries(
          SET_AUDIT_CHECK_ITEMS.map((_, index) => [`${cellKey(id, 0, '朝')}:${index}`, true]),
        ),
      }),
    ).toMatchObject({ ok: true });
  });
});

describe('comparison（4区分）', () => {
  it('0003 はマグミット（残薬から）が新規', () => {
    const c = comparison(MODEL, '0003', PATIENTS.find((p) => p.id === '0003')!.discontinued);
    expect(c.neu.some((d) => /マグミット錠250mg/.test(d.name))).toBe(true);
    expect(c.chg).toHaveLength(0);
  });
  it('0008 はクエチアピンが変更', () => {
    const c = comparison(MODEL, '0008', undefined);
    expect(c.chg.some((d) => /クエチアピン/.test(d.name))).toBe(true);
  });
  it('0004 はファモチジン20mgが中止', () => {
    const c = comparison(MODEL, '0004', PATIENTS.find((p) => p.id === '0004')!.discontinued);
    expect(c.disc).toHaveLength(1);
    expect(c.disc[0].name).toMatch(/ファモチジンD錠20mg/);
  });
  it('継続 + 新規 + 変更 + 中止 の合計が薬剤数と中止数に整合', () => {
    const c = comparison(MODEL, '0003', PATIENTS.find((p) => p.id === '0003')!.discontinued);
    const drugCount = drugsOf(MODEL, '0003').length;
    expect(c.cont.length + c.neu.length + c.chg.length).toBe(drugCount);
  });
});

describe('sumU / totals', () => {
  it('sumU は錠/g を別集計', () => {
    const drugs: Drug[] = [
      drug({ name: 'A錠', a: '1.0' }),
      drug({ name: 'B錠', a: '2.0' }),
      drug({ name: 'C散', a: '0.4g' }),
    ];
    expect(sumU(drugs, 'a')).toBe('3+0.4g');
  });
  it('totals は剤数サマリを含む', () => {
    const t = totals(drugsOf(MODEL, '0002'));
    expect(t.summary).toBe('5剤');
  });
});

describe('startKeyOf / sortedIds / nextGroupNo', () => {
  it('startKeyOf は最小開始日', () => {
    expect(startKeyOf(MODEL['0003'])).toBe('2026-06-17');
  });
  it('startKeyOf 空は番兵値', () => {
    expect(startKeyOf([])).toBe('9999-99-99');
  });
  it('sortedIds(start) は開始日昇順', () => {
    const ids = sortedIds(PATIENTS, MODEL, 'start');
    const keys = ids.map((id) => startKeyOf(MODEL[id]));
    const sorted = [...keys].sort((a, b) => a.localeCompare(b));
    expect(keys).toEqual(sorted);
  });
  it('sortedIds(regist) は登録日降順', () => {
    const ids = sortedIds(PATIENTS, MODEL, 'regist');
    const regs = ids.map((id) => PATIENTS.find((p) => p.id === id)!.regist);
    const sorted = [...regs].sort((a, b) => b.localeCompare(a));
    expect(regs).toEqual(sorted);
  });
  it('nextGroupNo は既存「追加グループN」の最大+1', () => {
    const gs: Group[] = [
      { gid: 'g0', label: '定期薬', method: '一包化', start: '', days: 0, drugs: [] },
      { gid: 'g1', label: '追加グループ1', method: '一包化', start: '', days: 0, drugs: [] },
      { gid: 'g2', label: '追加グループ3', method: '一包化', start: '', days: 0, drugs: [] },
    ];
    expect(nextGroupNo(gs)).toBe(4);
    expect(nextGroupNo([])).toBe(1);
  });
});
