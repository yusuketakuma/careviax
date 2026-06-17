'use client';

/**
 * 調剤ワークベンチ view model フック（設計プロト renderVals L827-1086 の移植）
 *
 * phase（ルート props）と store state から、コンポーネントが消費する派生 view model を
 * useMemo で組み立てて返す。renderVals の生 onClick は store action へ写像済みのため、
 * このフックは「表示データ」を返し、ハンドラはコンポーネントが store から直接取得する。
 *
 * 設計プロトの accent/showKana props はデフォルト固定（accent='#1f4e79', showKana=true）。
 */

import { useMemo } from 'react';

import { useWorkbenchStore } from './dispensing-workbench.store';
import {
  autoTarget,
  calc,
  calendarDayCountOf,
  calendarStartKeyOf,
  calcGate,
  cellKey,
  comparison,
  dailyDose,
  drugsOf,
  endDate,
  fmtJ,
  formOf,
  normCell,
  otherTiming,
  parseISO,
  patientProgress,
  shortMD,
  sortedIds,
  startKeyOf,
  totals as calcTotals,
} from './dispensing-workbench.logic';
import { loadPatients } from './dispensing-workbench.adapter';
import { SET_AUDIT_CHECK_ITEMS } from './dispensing-workbench.write-types';
import type {
  CalcResult,
  CellTarget,
  ChangeChip,
  ChipView,
  CompareSection,
  DispenseMethod,
  Group,
  HoldDraft,
  HoldInfo,
  NgCode,
  Phase,
  SeedPatient,
  WorkbenchModel,
  WorkbenchView,
} from './dispensing-workbench.types';
import { isCalendarPhase, isGridPhase } from './dispensing-workbench.types';

const ACCENT = '#1f4e79';
const SHOW_KANA = true;

const METHOD_OPTIONS: DispenseMethod[] = [
  '一包化',
  '錠剤分包機',
  '散剤分包機',
  '自動分包機',
  'PTP（手撒き）',
  '別包',
  '頓用',
];

const NG_OPTIONS: NgCode[] = [
  '患者違い',
  'セット期間違い',
  '日付違い',
  '用法違い',
  '薬剤違い',
  '数量不足',
  '数量超過',
  '中止薬混入',
  '休薬反映漏れ',
  '変更前薬剤混入',
  'カレンダー外薬未同梱',
  '残薬指示反映漏れ',
  '写真不鮮明',
  '判断不能',
];

const HOLD_REASON_OPTS = [
  '処方変更待ち',
  '医師確認待ち',
  '残薬確認待ち',
  '在庫不足',
  '家族・施設確認待ち',
  '訪問時に現地でセット',
  'その他',
];

const SEED_PATIENTS: SeedPatient[] = loadPatients();

const AV_PAL = [
  '#3a6ea5',
  '#5a8f4a',
  '#b06a2a',
  '#7b4ba0',
  '#2a7d8f',
  '#a04a6a',
  '#4a6aa0',
  '#8a6a2a',
];
const CHIP_PAL: Pick<ChipView, 'bg' | 'border' | 'color'>[] = [
  { bg: '#e8f0fb', border: '#b9d0ee', color: '#1f4e79' },
  { bg: '#eaf6ec', border: '#bfe0c4', color: '#2c7a3d' },
  { bg: '#fdeee6', border: '#f3cbb3', color: '#b75a28' },
  { bg: '#f3ecf8', border: '#ddc8ec', color: '#7b4ba0' },
  { bg: '#fef4e2', border: '#f0dca6', color: '#9a6a18' },
];

const DNW = ['日', '月', '火', '水', '木', '金', '土'];

const UNAVAILABLE_PATIENT: SeedPatient = {
  id: '',
  name: '実データ未取得',
  kana: '',
  dob: '—',
  age: 0,
  sex: '—',
  sub: '患者データを取得できません',
  short: '未',
  chips: ['取得失敗'],
  regist: '—',
  seedStart: '',
  seedDays: 0,
  yosei: '—',
  changes: [],
  biko: ['実データ取得に失敗しました。再読み込み後も続く場合は管理者に確認してください。'],
  discontinued: [],
  rows: [],
};

/**
 * phase 用 view model を組み立てて返す。コンポーネントはこの view と store actions を消費する。
 */
export function useWorkbenchView(phase: Phase): WorkbenchView {
  const selId = useWorkbenchStore((s) => s.selId);
  const sortMode = useWorkbenchStore((s) => s.sortMode);
  const done = useWorkbenchStore((s) => s.done);
  const audit = useWorkbenchStore((s) => s.audit);
  const setCells = useWorkbenchStore((s) => s.setCells);
  const auditCells = useWorkbenchStore((s) => s.auditCells);
  const outChk = useWorkbenchStore((s) => s.outChk);
  const checks = useWorkbenchStore((s) => s.checks);
  const ng = useWorkbenchStore((s) => s.ng);
  const target = useWorkbenchStore((s) => s.target);
  const holdModal = useWorkbenchStore((s) => s.holdModal);
  const holdInfo = useWorkbenchStore((s) => s.holdInfo);
  const packet = useWorkbenchStore((s) => s.packet);
  const compareOpen = useWorkbenchStore((s) => s.compareOpen);
  const model = useWorkbenchStore((s) => s.model);
  const patients = useWorkbenchStore((s) => s.patients);

  return useMemo(
    () =>
      buildView({
        phase,
        selId,
        sortMode,
        done,
        audit,
        setCells,
        auditCells,
        outChk,
        checks,
        ng,
        target,
        holdModal,
        holdInfo,
        packet,
        compareOpen,
        model,
        patients,
      }),
    [
      phase,
      selId,
      sortMode,
      done,
      audit,
      setCells,
      auditCells,
      outChk,
      checks,
      ng,
      target,
      holdModal,
      holdInfo,
      packet,
      compareOpen,
      model,
      patients,
    ],
  );
}

interface BuildViewArgs {
  phase: Phase;
  selId: string;
  sortMode: 'start' | 'regist';
  done: Record<string, boolean>;
  audit: Record<string, boolean>;
  setCells: Record<string, string>;
  auditCells: Record<string, string>;
  outChk: Record<string, boolean>;
  checks: Record<string, boolean>;
  ng: Record<string, string>;
  target: CellTarget | null;
  holdModal: HoldDraft | null;
  holdInfo: Record<string, HoldInfo>;
  packet: Record<string, boolean>;
  compareOpen: boolean;
  model: WorkbenchModel;
  /** 患者リスト。省略時はモック seed（既定パス / 既存テスト互換）*/
  patients?: SeedPatient[];
}

/**
 * renderVals 本体（L827-1086）の純粋移植。テスト容易性のため store と分離した純関数。
 */
export function buildView(args: BuildViewArgs): WorkbenchView {
  const {
    phase: ph,
    selId: id,
    sortMode,
    done,
    audit,
    setCells,
    auditCells,
    outChk,
    checks,
    ng,
    target: stateTarget,
    holdModal: hm,
    holdInfo,
    packet,
    compareOpen,
    model,
  } = args;

  // patients は store 由来（実データ hydrate 後は実患者、既定はモック seed）。
  // 実データ取得失敗時は patients=[] を明示して seed/mock に戻さない。
  const pts = args.patients === undefined ? SEED_PATIENTS : args.patients;
  const dataUnavailable = pts.length === 0;

  const p = pts.find((x) => x.id === id) ?? pts[0] ?? UNAVAILABLE_PATIENT;
  const isGrid = isGridPhase(ph);
  const isSet = ph === 'setp';
  const isSeta = ph === 'seta';
  const isCal = isCalendarPhase(ph);
  const prog = patientProgress(model, id, done, audit);

  const idxOf = (pid: string) => pts.findIndex((x) => x.id === pid);

  // ---- 左ペイン 患者リスト ----
  const patients = sortedIds(pts, model, sortMode).map((pid) => {
    const pp = pts.find((x) => x.id === pid)!;
    const pr = patientProgress(model, pid, done, audit);
    let sl = '未着手';
    let sc = '#9aa6b4';
    if (pr.audit > 0 && pr.audit === pr.total) {
      sl = '監査済';
      sc = '#5aa84a';
    } else if (pr.done > 0) {
      sl = '作業中';
      sc = '#e0972b';
    }
    const isSel = pid === id;
    const sk = startKeyOf(model[pid] ?? []);
    return {
      id: pid,
      name: pp.name,
      startLabel: shortMD(sk === '9999-99-99' ? '' : sk),
      registLabel: shortMD(pp.regist.replace(/\//g, '-')),
      age: pp.age + '歳',
      initial: pp.short,
      avatarBg: isSel ? ACCENT : AV_PAL[idxOf(pid) % AV_PAL.length],
      bg: isSel ? '#dde9f8' : '#f5f6f8',
      barColor: isSel ? ACCENT : 'transparent',
      statusLabel: sl,
      statusColor: sc,
      selected: isSel,
    };
  });

  const sortButtons = [
    { key: 'start' as const, label: '服用開始' },
    { key: 'regist' as const, label: '登録日' },
  ].map((sb) => ({
    key: sb.key,
    label: sb.label,
    active: sortMode === sb.key,
    color: sortMode === sb.key ? '#fff' : '#3f5878',
    bg: sortMode === sb.key ? '#3a5e8c' : '#fff',
    border: sortMode === sb.key ? '#2c4a6e' : '#bcc7d4',
  }));

  // ---- 工程タブ ----
  const pdDefs: { id: Phase; label: string; dot: string }[] = [
    { id: 'dispense', label: '調剤', dot: '#2f80ed' },
    { id: 'audit', label: '調剤監査', dot: '#27ae60' },
    { id: 'setp', label: 'セット', dot: '#b07cd6' },
    { id: 'seta', label: 'セット監査', dot: '#d6905a' },
  ];
  const phases = pdDefs.map((pd) => ({
    id: pd.id,
    label: pd.label,
    bg: pd.id === ph ? '#fff' : '#dde4ec',
    color: pd.id === ph ? '#16345a' : '#3f5878',
    dot: pd.id === ph ? pd.dot : '#b3bdc8',
    active: pd.id === ph,
  }));
  const flowHint = '調剤 → 調剤監査 → セット → セット監査';

  const chips: ChipView[] = p.chips.map((c, i) => ({ label: c, ...CHIP_PAL[i % CHIP_PAL.length] }));

  // ---- グリッド行（model groups から）----
  const tagColors: Record<string, string> = { 頓用: '#7b4ba0', PTP: '#1d6fb8', 外用: '#b75a28' };
  const groups: Group[] = model[id] ?? [];
  let no = 0;
  const rows: WorkbenchView['rows'] = [];
  groups.forEach((g) => {
    rows.push({
      kind: 'sec',
      gid: g.gid,
      secLabel: g.label,
      method: g.method,
      start: g.start,
      days: g.days,
      endDate: endDate(g.start, g.days),
    });
    g.drugs.forEach((r) => {
      no++;
      const did = r.did;
      const isDone = !!done[did];
      const isAu = !!audit[did];
      let cBg = '#fff';
      let cBd = '#9aa8b8';
      let cMk = '';
      let bg = no % 2 === 0 ? '#f6f8fa' : '#fff';
      let note = r.note || '';
      let noteColor = /賦形なし/.test(note) ? '#a06a2a' : /要/.test(note) ? '#b3402f' : '#5a6878';
      if (ph === 'dispense') {
        if (isDone) {
          cBg = '#3a9d4f';
          cBd = '#3a9d4f';
          cMk = '✓';
          bg = '#eef8f0';
        }
      } else {
        if (!isDone) {
          bg = '#fdeeec';
          note = '未調剤';
          noteColor = '#c0392b';
        } else if (isAu) {
          cBg = '#2f80ed';
          cBd = '#2f80ed';
          cMk = '✓';
          bg = '#eef4fd';
          note = r.note ? r.note + ' ・監査OK' : '監査OK';
          noteColor = '#1d6f33';
        } else {
          bg = '#fff8e8';
          note = r.note ? r.note + ' ・監査待ち' : '監査待ち';
          noteColor = '#9a6a18';
        }
      }
      const f = formOf(r);
      const oth = otherTiming(r);
      const chgBadge =
        r.chg === 'new'
          ? { t: '新規', c: '#2c7a3d' }
          : r.chg === 'changed'
            ? { t: '変更', c: '#9a6a18' }
            : null;
      if (r.chg === 'new' && ph === 'dispense') bg = '#f1f9f2';
      else if (r.chg === 'changed' && ph === 'dispense') bg = '#fdf7ea';
      rows.push({
        kind: 'drug',
        did,
        gid: g.gid,
        no,
        name: r.name,
        yoho: r.yoho,
        formL: f.l,
        formBg: f.bg,
        other: oth || '－',
        hasChg: !!chgBadge,
        chgText: chgBadge ? chgBadge.t : '',
        chgColor: chgBadge ? chgBadge.c : '#6b7280',
        asa: normCell(r.a),
        hiru: normCell(r.h),
        yu: normCell(r.y),
        nemae: normCell(r.n),
        daily: dailyDose(r),
        daysLabel: (g.days || 0) + '日',
        funsai: r.funsai,
        hasTag: !!r.tag,
        tag: r.tag,
        tagColor: tagColors[r.tag] || '#6b7280',
        note,
        noteColor,
        bg,
        checkBg: cBg,
        checkBorder: cBd,
        checkMark: cMk,
      });
    });
  });

  const dr = drugsOf(model, id);
  const totals = calcTotals(dr);

  const methodSummary = [...new Set(groups.map((g) => g.method))].join('・') || '一包化';
  const startMin = startKeyOf(groups);
  const infoItems = [
    { label: '患者番号', value: p.id },
    { label: 'フリガナ', value: p.kana },
    { label: '生年月日', value: p.dob },
    { label: '年齢 / 性別', value: p.age + '歳 / ' + p.sex },
    { label: '区分', value: '在宅（訪問）' },
    { label: '処方登録日', value: p.regist },
    {
      label: '服用開始日',
      value: startMin === '9999-99-99' ? '—' : fmtJ(parseISO(startMin)!),
    },
    { label: '主たる調剤方法', value: methodSummary },
    { label: '予製可否', value: p.yosei },
  ];

  // ---- カレンダー ----
  const cal: CalcResult = calc(model, id);
  const calendarStart = calendarStartKeyOf(groups);
  const calendarStartDate = parseISO(calendarStart) ?? new Date(2026, 5, 17);
  const calendarDayCount = dataUnavailable ? 0 : calendarDayCountOf(groups);
  const days = [...Array(calendarDayCount)].map((_, i) => {
    const dt = new Date(calendarStartDate);
    dt.setDate(calendarStartDate.getDate() + i);
    const first = dt.getDate() === 1;
    return { idx: i, d: dt.getMonth() + 1 + '/' + dt.getDate(), w: DNW[dt.getDay()], cross: first };
  });
  const periodLabel =
    days.length > 0
      ? `${calendarStartDate.getFullYear()}/${days[0].d}（${days[0].w}）〜${days[days.length - 1].d}（${days[days.length - 1].w}）`
      : '—';
  const calDays = days.map((dd) => ({
    d: dd.d,
    w: dd.w,
    color: dd.cross ? '#b3402f' : dd.w === '日' ? '#c0392b' : dd.w === '土' ? '#1d6fb8' : '#274268',
    bg: dd.cross ? '#fdeeec' : '#e7edf4',
  }));

  const tg = autoTarget({ phase: ph, model, id, setCells, auditCells, current: stateTarget });

  const calRows = cal.active.map((tk) => {
    const c = cal.content[tk];
    const cells = days.map((day) => {
      const key = cellKey(id, day.idx, tk);
      const st = isSeta ? auditCells[key] || '' : setCells[key] || '';
      const isT = !!tg && tg.di === day.idx && tg.tk === tk;
      let bg = '#fff';
      let bd = '1px solid #d2dae3';
      let mark = '';
      let markColor = '#999';
      let stateLabel = '未セット';
      let stateColor = '#9aa6b4';
      if (isSeta) {
        stateLabel = '未監査';
        if (st === 'ok') {
          bg = '#eef8f0';
          bd = '1px solid #9ed6ad';
          mark = '✓';
          markColor = '#1f9150';
          stateLabel = '監査OK';
          stateColor = '#1f9150';
        } else if (st === 'ng') {
          bg = '#fdeeec';
          bd = '1px solid #e7a59e';
          mark = '✕';
          markColor = '#c0392b';
          stateLabel = 'NG・差戻し';
          stateColor = '#c0392b';
        } else if (st === 'hold') {
          bg = '#fff6e6';
          bd = '1px solid #e8c884';
          mark = '⏸';
          markColor = '#9a6a18';
          stateLabel = '保留';
          stateColor = '#9a6a18';
        }
      } else {
        if (st === 'set') {
          bg = '#eef8f0';
          bd = '1px solid #9ed6ad';
          mark = '✓';
          markColor = '#1f9150';
          stateLabel = 'セット済';
          stateColor = '#1f9150';
        } else if (st === 'hold') {
          bg = '#fff6e6';
          bd = '1px solid #e8c884';
          mark = '⏸';
          markColor = '#9a6a18';
          stateLabel = '保留';
          stateColor = '#9a6a18';
        }
      }
      if (isT) bd = '2px solid ' + (isSeta ? '#27ae60' : '#2f6fd6');
      const hi = holdInfo[key];
      if (st === 'hold' && hi && hi.reason) stateLabel = '保留：' + hi.reason;
      const title =
        st === 'hold' && hi
          ? '保留理由：' +
            hi.reason +
            (hi.due ? ' / 期限 ' + hi.due : '') +
            (hi.owner ? ' / 担当 ' + hi.owner : '') +
            (hi.memo ? ' / ' + hi.memo : '')
          : '';
      return {
        packetText: c.packetText,
        packetColor: c.packets > 0 ? '#16345a' : '#b9c2cc',
        ptpText: c.ptpText,
        hasPtp: !!c.ptpText,
        bg,
        border: bd,
        mark,
        markColor,
        stateLabel,
        stateColor,
        title,
        di: day.idx,
        tk,
        selected: isT,
      };
    });
    return { label: cal.tlabel[tk], cells };
  });

  const calLegend = isSeta
    ? [
        { label: '監査OK', bg: '#eef8f0', bd: '#9ed6ad' },
        { label: 'NG・差戻し', bg: '#fdeeec', bd: '#e7a59e' },
        { label: '保留', bg: '#fff6e6', bd: '#e8c884' },
        { label: '未監査', bg: '#fff', bd: '#d2dae3' },
      ]
    : [
        { label: 'セット済', bg: '#eef8f0', bd: '#9ed6ad' },
        { label: '保留', bg: '#fff6e6', bd: '#e8c884' },
        { label: '未セット', bg: '#fff', bd: '#d2dae3' },
        { label: '選択中', bg: '#fff', bd: '#2f6fd6' },
      ];

  // ---- セット注意 / 監査リスク チップ ----
  const sjoin = p.biko.join('');
  const setChips: WorkbenchView['setChips'] = [];
  const SC = (l: string, c: string, b: string, bd: string) =>
    setChips.push({ label: l, color: c, bg: b, border: bd });
  if (dr.some((r) => r.funsai)) SC('粉砕あり', '#c0392b', '#fdeeec', '#f3cbb3');
  if (p.chips.indexOf('賦形') >= 0) SC('賦形あり', '#9a6a18', '#fef4e2', '#f0dca6');
  if (dr.some((r) => /PTP/.test(r.note))) SC('PTPあり', '#1d6fb8', '#e6f0fb', '#bcd8f3');
  if (cal.outside.some((o) => o.kind === '頓服')) SC('頓服あり', '#7b4ba0', '#f3ecf8', '#ddc8ec');
  if (dr.some((r) => /別包/.test(r.note))) SC('別包あり', '#2a7d8f', '#e4f3f5', '#bce0e5');
  if (/残薬/.test(sjoin)) SC('残薬調整', '#b75a28', '#fdeee6', '#f3cbb3');
  if (p.chips.indexOf('小児') >= 0) SC('小児', '#a04a6a', '#fbe9f0', '#eec4d4');
  if (/懸濁|冷所/.test(sjoin)) SC('冷所/特殊', '#2a7d8f', '#e4f3f5', '#bce0e5');
  if (!setChips.length) SC('特記なし', '#5a6878', '#eef1f4', '#d4dae1');

  // ---- 比較 ----
  const cmp = comparison(model, id, p.discontinued);
  const changeColors: Record<string, string> = {
    新規: '#2c7a3d',
    変更: '#9a6a18',
    中止: '#c0392b',
  };
  const changes: ChangeChip[] = ([] as ChangeChip[])
    .concat(cmp.neu.map((d) => ({ type: '新規', text: d.name, color: changeColors['新規'] })))
    .concat(
      cmp.chg.map((d) => ({
        type: '変更',
        text: d.name + '（' + (d.prevText || '前回') + ' → ' + (d.note || '今回') + '）',
        color: changeColors['変更'],
      })),
    )
    .concat(cmp.disc.map((d) => ({ type: '中止', text: d.name, color: changeColors['中止'] })));
  const changesEmpty = changes.length === 0;
  const cmpCount = {
    neu: cmp.neu.length,
    chg: cmp.chg.length,
    disc: cmp.disc.length,
    cont: cmp.cont.length,
  };
  const compareSections: CompareSection[] = [
    {
      key: 'cont',
      title: '継続',
      color: '#5a8f4a',
      items: cmp.cont.map((d) => ({ name: d.name, sub: d.yoho })),
    },
    {
      key: 'neu',
      title: '新規',
      color: '#2c7a3d',
      items: cmp.neu.map((d) => ({ name: d.name, sub: d.yoho + '（今回追加）' })),
    },
    {
      key: 'chg',
      title: '変更',
      color: '#9a6a18',
      items: cmp.chg.map((d) => ({
        name: d.name,
        sub: (d.prevText || '前回') + ' → ' + (d.note || '今回'),
      })),
    },
    {
      key: 'disc',
      title: '中止',
      color: '#c0392b',
      items: cmp.disc.map((d) => ({ name: d.name, sub: (d.yoho || '') + '（前回まで）' })),
    },
  ];

  // ---- カレンダー外薬 ----
  const outsideMeds = cal.outside.map((o) => {
    const k = id + ':' + o.name;
    const on = !!outChk[k];
    const kc: Record<string, string> = {
      頓服: '#7b4ba0',
      外用: '#b75a28',
      冷所: '#2a7d8f',
      注射: '#a04a6a',
    };
    return { name: o.name, kind: o.kind, kindColor: kc[o.kind] || '#6b7280', checked: on };
  });
  const outsideEmpty = outsideMeds.length === 0;

  // ---- ターゲット表示 ----
  let target: WorkbenchView['target'] = {
    date: '—',
    timing: '',
    packetText: '—',
    ptpText: '',
    hasPtp: false,
    drugs: [],
    note: '',
    hasNote: false,
  };
  if (tg) {
    const c = cal.content[tg.tk];
    const day = days[tg.di];
    target = {
      date: day.d + '（' + day.w + '）',
      timing: cal.tlabel[tg.tk],
      packetText: c.packetText,
      ptpText: c.ptpText,
      hasPtp: !!c.ptpText,
      drugs: c.drugs,
      note: c.note,
      hasNote: !!c.note,
    };
  }

  // ---- セット方法（詳細）----
  let setMethod = 'お薬BOXの該当仕切りへ投入';
  if (p.chips.indexOf('お薬カレンダー') >= 0 || /カレンダー/.test(sjoin))
    setMethod = 'お薬カレンダーの該当ポケットへ投入';
  else if (/ホッチキス/.test(sjoin)) setMethod = '用法ごとにホッチキス止めしてお薬BOXへ';
  else if (/アルミ薬袋/.test(sjoin)) setMethod = 'アルミ薬袋へ封入';
  else if (/薬袋/.test(sjoin)) setMethod = '薬袋に入れて交付';

  const setSteps = [
    { n: '1', label: '患者ラベルを照合', sub: p.name + '（' + p.id + '）' },
    { n: '2', label: '一包化袋をスキャン', sub: target.date + ' ' + target.timing },
    { n: '3', label: '該当セルへセット', sub: setMethod },
    { n: '4', label: '［セット済］を押す', sub: 'または セルQRをスキャン' },
  ];

  // ---- 訪問持出パケット ----
  const hasTon = cal.outside.some((o) => o.kind === '頓服');
  const hasGai = cal.outside.some((o) => o.kind === '外用');
  const hasLiq = cal.outside.some((o) => o.kind === '液剤' || o.kind === '冷所');
  const pkDefs: { k: string; label: string }[] = [{ k: 'cal', label: 'お薬カレンダー完成' }];
  if (hasTon) pkDefs.push({ k: 'ton', label: '頓服薬の同梱' });
  if (hasGai) pkDefs.push({ k: 'gai', label: '外用薬の同梱' });
  if (hasLiq) pkDefs.push({ k: 'liq', label: '液剤・冷所薬の同梱' });
  pkDefs.push({ k: 'doc', label: '服薬説明書' }, { k: 'note', label: 'お薬手帳シール' });
  const packetItems = pkDefs.map((d) => ({
    key: d.k,
    label: d.label,
    checked: !!packet[id + ':' + d.k],
  }));
  const packetDone = pkDefs.every((d) => packet[id + ':' + d.k]);

  // ---- 差戻しリスト（監査NG）----
  const rejectList: WorkbenchView['rejectList'] = [];
  for (let di = 0; di < calendarDayCount; di++)
    cal.active.forEach((tk) => {
      if (auditCells[cellKey(id, di, tk)] === 'ng') {
        const day = days[di];
        rejectList.push({
          di,
          tk,
          label: day.d + '（' + day.w + '）' + cal.tlabel[tk],
          ng: ng[cellKey(id, di, tk)] || '分類未設定',
        });
      }
    });

  // ---- セット監査 確認項目 ----
  const checkItems = SET_AUDIT_CHECK_ITEMS.map((item, i) => {
    const on = !!tg && !!checks[cellKey(id, tg.di, tg.tk) + ':' + i];
    return { index: i, label: item.label, checked: on };
  });
  const ngValue = tg ? ng[cellKey(id, tg.di, tg.tk)] || '' : '';

  // ---- リスク確認順 ----
  const riskList: WorkbenchView['riskList'] = [];
  let rkn = 0;
  const RK = (l: string, c: string) => riskList.push({ rank: ++rkn, label: l, color: c });
  if (changes.length) RK('処方変更点', '#c0392b');
  if (dr.some((r) => /平日|隔日|曜日|週/.test(r.note + r.yoho))) RK('曜日・隔日指定', '#c0392b');
  if (dr.some((r) => r.funsai)) RK('粉砕・賦形', '#d2691e');
  if (dr.some((r) => /PTP/.test(r.note))) RK('追加PTP混在', '#1d6fb8');
  if (cal.outside.length) RK('カレンダー外薬', '#7b4ba0');
  if (/残薬/.test(sjoin)) RK('残薬調整', '#b75a28');
  if (!riskList.length) RK('通常の定時薬', '#5a8f4a');

  // ---- progress + gate + primary ----
  const gateResult = calcGate({ phase: ph, model, id, setCells, auditCells, outChk, packet });
  let progress: WorkbenchView['progress'];
  let bulkLabel: string;
  let primaryLabel: string;
  let primaryBg: string;
  let primaryBorder: string;
  let checkHead: string;
  let primaryCursor = 'pointer';
  let primaryOpacity = '1';
  let gateText = '';
  let gateColor = '#1f9150';
  let gateBg = '#eef8f0';
  let gateBorder = '#9ed6ad';
  let gateOk = gateResult.ok;

  if (ph === 'dispense') {
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    progress = {
      label: '調剤ピッキング進捗',
      pct: pct + '%',
      color: '#2f80ed',
      fraction: prog.done + ' / ' + prog.total,
    };
    bulkLabel = '全て調剤済';
    primaryLabel = '調剤完了 → 監査へ ▶';
    primaryBg = dataUnavailable ? '#b8bfc8' : '#2f6fd6';
    primaryBorder = dataUnavailable ? '#a3abb5' : '#245aad';
    checkHead = '調剤';
  } else if (ph === 'audit') {
    const pct = prog.total ? Math.round((prog.audit / prog.total) * 100) : 0;
    progress = {
      label: '調剤監査 進捗',
      pct: pct + '%',
      color: '#27ae60',
      fraction: prog.audit + ' / ' + prog.total,
    };
    bulkLabel = '全て監査OK';
    primaryLabel = '監査確定 → セットへ ▶';
    primaryBg = dataUnavailable ? '#b8bfc8' : '#2c9a4e';
    primaryBorder = dataUnavailable ? '#a3abb5' : '#218040';
    checkHead = '監査';
  } else {
    const totC = cal.active.length * calendarDayCount;
    let dnC = 0;
    for (let di = 0; di < calendarDayCount; di++)
      cal.active.forEach((tk) => {
        const st = isSeta ? auditCells[cellKey(id, di, tk)] : setCells[cellKey(id, di, tk)];
        if (isSeta ? st === 'ok' : st === 'set' || st === 'hold') dnC++;
      });
    const pct = totC ? Math.round((dnC / totC) * 100) : 0;
    if (isSet) {
      progress = {
        label: 'セット進捗',
        pct: pct + '%',
        color: '#b07cd6',
        fraction: dnC + ' / ' + totC,
      };
      bulkLabel = '全セルをセット済';
      primaryLabel = 'セット完了 → 監査へ ▶';
      primaryBg = '#9558c4';
      primaryBorder = '#7c43ab';
      checkHead = 'セット';
    } else {
      progress = {
        label: 'セット監査 進捗',
        pct: pct + '%',
        color: '#d6905a',
        fraction: dnC + ' / ' + totC,
      };
      bulkLabel = '全セルOK';
      primaryLabel = '監査承認（薬剤師）✓';
      primaryBg = '#c97b3e';
      primaryBorder = '#a9632c';
      checkHead = '監査';
    }
    gateText = gateResult.text;
    if (gateResult.ok) {
      gateColor = '#1f9150';
      gateBg = '#eef8f0';
      gateBorder = '#9ed6ad';
    } else {
      gateColor = '#b3402f';
      gateBg = '#fdeeec';
      gateBorder = '#f0c4bd';
      primaryBg = '#b8bfc8';
      primaryBorder = '#a3abb5';
      primaryCursor = 'not-allowed';
      primaryOpacity = '.7';
    }
  }
  if (dataUnavailable) {
    gateOk = false;
    gateText = '実データを取得できませんでした';
    gateColor = '#b3402f';
    gateBg = '#fdeeec';
    gateBorder = '#f0c4bd';
    primaryBg = '#b8bfc8';
    primaryBorder = '#a3abb5';
    primaryCursor = 'not-allowed';
    primaryOpacity = '.7';
  }

  // ---- F-keys ----
  const fkeys: WorkbenchView['fkeys'] = [
    fkey('F1', 'ヘルプ', 'help'),
    fkey('F2', '患者検索', 'searchPatient'),
    fkey('F3', '前患者', 'prevPatient'),
    fkey('F4', '次患者', 'nextPatient'),
    fkey('F5', '一括処理', 'bulk', true),
    fkey('F6', '写真', 'photo'),
    fkey('F7', '保留', 'hold'),
    fkey('F8', '調剤', 'phaseDispense', ph === 'dispense'),
    fkey('F9', '調剤監査', 'phaseAudit', ph === 'audit'),
    fkey('F10', 'セット', 'phaseSet', ph === 'setp'),
    fkey('F11', 'セット監査', 'phaseSetAudit', ph === 'seta'),
    fkey('F12', '次工程へ', 'next', true),
  ];

  // ---- 右ペイン タイトル / カレンダーバー / 写真 ----
  const rightTitle = isGrid ? '患者情報' : isSet ? 'セット作業' : 'セット監査';
  const calBarBg = isSet ? '#f7f3fb' : '#fbf3ec';
  const calBarTitle = isSet ? 'セット注意' : '監査リスク';
  const calBarMeta = isSet
    ? `セット者：山田 花子 ／ 期間 ${periodLabel}`
    : 'セット完了：6/16 15:10 ／ 監査者：佐々木 健';
  const photoTitle = isSet ? '作業証跡写真（セット前 / セット後）' : '監査証跡写真';
  const photos = isSet ? ['セット前', 'セット後', 'カレンダー全体'] : ['監査完了', '該当セル拡大'];

  // ---- 保留モーダル ----
  const holdOpen = !!hm;
  const holdReasons = HOLD_REASON_OPTS.map((r) => ({
    label: r,
    selected: !!hm && hm.reason === r,
  }));
  const holdReady = !!hm && !!hm.reason;
  const holdCellLabel = hm
    ? (days[hm.di] ? days[hm.di].d : '') + ' ' + (cal.tlabel[hm.tk] || '')
    : '';

  const phaseLabel =
    ph === 'dispense'
      ? '調剤'
      : ph === 'audit'
        ? '調剤監査'
        : ph === 'setp'
          ? 'セット'
          : 'セット監査';

  return {
    phase: ph,
    isGrid,
    isCal,
    isSet,
    isSeta,
    phaseLabel,

    patients,
    patientCount: pts.length + '',
    sortButtons,

    phases,
    flowHint,

    cur: {
      no: p.id,
      kana: SHOW_KANA ? p.kana : '',
      name: p.name,
      dob: p.dob,
      ageSex: dataUnavailable ? '—' : p.age + '歳 / ' + p.sex,
      kubun: '在宅（訪問）',
      regist: p.regist,
      period: periodLabel,
      avatarBg: AV_PAL[Math.max(idxOf(p.id), 0) % AV_PAL.length],
      initial: p.short,
      chips,
      rule: '※基本 0.2g/包になるよう賦形',
      biko: p.biko,
    },
    chips,

    checkHead,
    rows,
    methodOptions: METHOD_OPTIONS,
    totals,
    infoItems,

    calDays,
    calRows,
    calLegend,
    calBarTitle,
    calBarBg,
    calBarMeta,
    setChips,
    changes,
    changesEmpty,
    photoTitle,
    photos,

    rightTitle,
    target,
    setMethod,
    setSteps,
    outsideMeds,
    outsideEmpty,
    packetItems,
    packetDone,
    checkItems,
    riskList,
    rejectList,
    rejectEmpty: rejectList.length === 0,
    ngValue,
    ngOptions: NG_OPTIONS,

    progress,
    gate: { ok: gateOk, text: gateText, color: gateColor, bg: gateBg, border: gateBorder },
    primary: {
      label: primaryLabel,
      bg: primaryBg,
      border: primaryBorder,
      cursor: primaryCursor,
      opacity: primaryOpacity,
    },
    bulkLabel,

    fkeys,

    holdOpen,
    holdReasons,
    holdCellLabel,
    holdDue: hm ? hm.due : '',
    holdOwner: hm ? hm.owner : '',
    holdMemo: hm ? hm.memo : '',
    holdReady,
    holdSave: {
      label: '保留登録',
      bg: holdReady ? '#e0972b' : '#d8c39a',
      border: holdReady ? '#c97f18' : '#c6ad7e',
      cursor: holdReady ? 'pointer' : 'not-allowed',
      opacity: holdReady ? '1' : '.7',
    },

    compareOpen,
    compareSections,
    cmpCount,
  };
}

function fkey(
  key: string,
  label: string,
  action: WorkbenchView['fkeys'][number]['action'],
  active = false,
): WorkbenchView['fkeys'][number] {
  return {
    key,
    label,
    action,
    keyColor: active ? '#c0392b' : '#5a6878',
    labelColor: active ? '#16345a' : '#243040',
  };
}
