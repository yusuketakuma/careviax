'use client';

/**
 * 調剤ワークベンチ view model フック（設計プロト renderVals L827-1086 の移植）
 *
 * phase（ルート props）と store state から、コンポーネントが消費する派生 view model を
 * useMemo で組み立てて返す。renderVals の生 onClick は store action へ写像済みのため、
 * このフックは「表示データ」を返し、ハンドラはコンポーネントが store から直接取得する。
 *
 * 設計プロトの accent/showKana props はデフォルト固定（accent=var(--wb-accent)≒#1f4e79, showKana=true）。
 * F-011 Stage1b(A-prime): view が返す全色は module.css 定義の workbench theme 安定トークン
 * （wb-state / wb-tint / wb-phase / wb-tag / wb-surface・ink・line 系）。data 面を light-first で
 * 安定させ light/dark 双方 AA を保証（hue は 6 軸 SSOT を踏襲）。外殻 chrome は Stage1a の adaptive を維持。
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
import {
  areQuantitiesEquivalentForUnit,
  quantityInputModeForUnit,
  quantityStepAttribute,
} from '@/lib/dispensing/quantity-unit';
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

const ACCENT = 'var(--wb-accent)';
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

// 患者アバター回転パレット（装飾・category）。値は module.css のローカルトークン参照。
const AV_PAL = [
  'var(--wb-avatar-1)',
  'var(--wb-avatar-2)',
  'var(--wb-avatar-3)',
  'var(--wb-avatar-4)',
  'var(--wb-avatar-5)',
  'var(--wb-avatar-6)',
  'var(--wb-avatar-7)',
  'var(--wb-avatar-8)',
];
// 属性チップ回転パレット（装飾・category）。値は module.css のローカルトークン参照。
const CHIP_PAL: Pick<ChipView, 'bg' | 'border' | 'color'>[] = [
  { bg: 'var(--wb-chip-1-bg)', border: 'var(--wb-chip-1-border)', color: 'var(--wb-chip-1-fg)' },
  { bg: 'var(--wb-chip-2-bg)', border: 'var(--wb-chip-2-border)', color: 'var(--wb-chip-2-fg)' },
  { bg: 'var(--wb-chip-3-bg)', border: 'var(--wb-chip-3-border)', color: 'var(--wb-chip-3-fg)' },
  { bg: 'var(--wb-chip-4-bg)', border: 'var(--wb-chip-4-border)', color: 'var(--wb-chip-4-fg)' },
  { bg: 'var(--wb-chip-5-bg)', border: 'var(--wb-chip-5-border)', color: 'var(--wb-chip-5-fg)' },
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
  const quantityConfirmedByDid = useWorkbenchStore((s) => s.quantityConfirmedByDid);
  const actualQuantityInputByDid = useWorkbenchStore((s) => s.actualQuantityInputByDid);
  const discrepancyReasonByDid = useWorkbenchStore((s) => s.discrepancyReasonByDid);
  const auditDoubleCountByDid = useWorkbenchStore((s) => s.auditDoubleCountByDid);
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
        quantityConfirmedByDid,
        actualQuantityInputByDid,
        discrepancyReasonByDid,
        auditDoubleCountByDid,
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
      quantityConfirmedByDid,
      actualQuantityInputByDid,
      discrepancyReasonByDid,
      auditDoubleCountByDid,
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
  quantityConfirmedByDid?: Record<string, boolean>;
  actualQuantityInputByDid?: Record<string, string>;
  discrepancyReasonByDid?: Record<string, string>;
  auditDoubleCountByDid?: Record<string, { first: string; second: string }>;
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
    quantityConfirmedByDid = {},
    actualQuantityInputByDid = {},
    discrepancyReasonByDid = {},
    auditDoubleCountByDid = {},
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
    let sc = 'var(--wb-state-readonly)';
    if (pr.audit > 0 && pr.audit === pr.total) {
      sl = '監査済';
      sc = 'var(--wb-state-done)';
    } else if (pr.done > 0) {
      sl = '作業中';
      sc = 'var(--wb-state-confirm)';
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
      bg: isSel ? 'var(--wb-surface-selected)' : 'var(--wb-surface-alt)',
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
    color: sortMode === sb.key ? 'var(--wb-primary-fg)' : 'var(--wb-ink-muted)',
    bg: sortMode === sb.key ? 'var(--wb-primary-bg)' : 'var(--wb-surface)',
    border: sortMode === sb.key ? 'var(--wb-accent)' : 'var(--wb-line)',
  }));

  // ---- 工程タブ ----
  const pdDefs: { id: Phase; label: string; dot: string }[] = [
    { id: 'dispense', label: '調剤', dot: 'var(--wb-phase-disp)' },
    { id: 'audit', label: '調剤監査', dot: 'var(--wb-phase-audit)' },
    { id: 'setp', label: 'セット', dot: 'var(--wb-phase-setp)' },
    { id: 'seta', label: 'セット監査', dot: 'var(--wb-phase-seta)' },
  ];
  const phases = pdDefs.map((pd) => ({
    id: pd.id,
    label: pd.label,
    bg: pd.id === ph ? 'var(--wb-surface)' : 'var(--wb-surface-alt)',
    color: pd.id === ph ? 'var(--wb-ink)' : 'var(--wb-ink-muted)',
    dot: pd.id === ph ? pd.dot : 'var(--wb-ink-muted)',
    active: pd.id === ph,
  }));
  const flowHint = '調剤 → 調剤監査 → セット → セット監査';

  const chips: ChipView[] = p.chips.map((c, i) => ({ label: c, ...CHIP_PAL[i % CHIP_PAL.length] }));

  // ---- グリッド行（model groups から）----
  const tagColors: Record<string, string> = {
    頓用: 'var(--wb-tag-tonyo)',
    PTP: 'var(--wb-tag-ptp)',
    外用: 'var(--wb-tag-gaiyo)',
  };
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
      periodWarning: g.periodWarning,
    });
    g.drugs.forEach((r) => {
      no++;
      const did = r.did;
      const isDone = !!done[did];
      const isAu = !!audit[did];
      const auditDoubleCount = auditDoubleCountByDid[did] ?? { first: '', second: '' };
      const hasSavedQuantity = typeof r.dispensedQuantity === 'number';
      const quantityConfirmed = hasSavedQuantity || !!quantityConfirmedByDid[did];
      const prescribedQuantity =
        typeof r.prescribedQuantity === 'number' ? r.prescribedQuantity : null;
      const savedOrPrescribedQuantity =
        typeof r.dispensedQuantity === 'number' ? r.dispensedQuantity : prescribedQuantity;
      const actualQuantityInput =
        actualQuantityInputByDid[did] ??
        (typeof savedOrPrescribedQuantity === 'number'
          ? formatQuantity(savedOrPrescribedQuantity)
          : '');
      const parsedActualQuantity = parseQuantityInput(actualQuantityInput);
      const requiresDiscrepancyReason =
        ph === 'dispense' &&
        typeof parsedActualQuantity === 'number' &&
        typeof prescribedQuantity === 'number' &&
        !areQuantitiesEquivalentForUnit({
          left: parsedActualQuantity,
          right: prescribedQuantity,
          unit: r.unit,
          referenceQuantity: prescribedQuantity,
        });
      const hasSavedQuantityDifference =
        typeof r.dispensedQuantity === 'number' &&
        typeof r.prescribedQuantity === 'number' &&
        !areQuantitiesEquivalentForUnit({
          left: r.dispensedQuantity,
          right: r.prescribedQuantity,
          unit: r.unit,
          referenceQuantity: r.prescribedQuantity,
        });
      const hasInputQuantityDifference =
        parsedActualQuantity != null &&
        typeof r.prescribedQuantity === 'number' &&
        !areQuantitiesEquivalentForUnit({
          left: parsedActualQuantity,
          right: r.prescribedQuantity,
          unit: r.unit,
          referenceQuantity: r.prescribedQuantity,
        });
      const quantityLabel =
        typeof r.dispensedQuantity === 'number'
          ? prescribedQuantity != null && hasSavedQuantityDifference
            ? `処方 ${formatQuantity(prescribedQuantity)}${r.unit ?? ''} / 実 ${formatQuantity(r.dispensedQuantity)}${r.unit ?? ''}`
            : `実 ${formatQuantity(r.dispensedQuantity)}${r.unit ?? ''}`
          : parsedActualQuantity != null && prescribedQuantity != null && hasInputQuantityDifference
            ? `処方 ${formatQuantity(prescribedQuantity)}${r.unit ?? ''} / 実 ${formatQuantity(parsedActualQuantity)}${r.unit ?? ''}`
            : prescribedQuantity != null
              ? `処方 ${formatQuantity(prescribedQuantity)}${r.unit ?? ''}`
              : '数量未確定';
      let cBg = 'var(--wb-surface)';
      let cBd = 'var(--wb-line)';
      let cMk = '';
      let bg = no % 2 === 0 ? 'var(--wb-surface-alt)' : 'var(--wb-surface)';
      let note = r.note || '';
      let noteColor = /賦形なし/.test(note)
        ? 'var(--wb-state-confirm)'
        : /要/.test(note)
          ? 'var(--wb-state-blocked)'
          : 'var(--wb-ink-muted)';
      if (ph === 'dispense') {
        if (isDone) {
          cBg = 'var(--wb-state-done)';
          cBd = 'var(--wb-state-done)';
          cMk = '✓';
          bg = 'var(--wb-done-bg)';
        }
      } else {
        if (!isDone) {
          bg = 'var(--wb-blocked-bg)';
          note = '未調剤';
          noteColor = 'var(--wb-state-blocked)';
        } else if (isAu) {
          cBg = 'var(--wb-info)';
          cBd = 'var(--wb-info)';
          cMk = '✓';
          bg = 'var(--wb-disp-tint-bg)';
          note = r.note ? r.note + ' ・監査OK' : '監査OK';
          noteColor = 'var(--wb-state-done)';
        } else {
          bg = 'var(--wb-confirm-bg-pale)';
          note = r.note ? r.note + ' ・監査待ち' : '監査待ち';
          noteColor = 'var(--wb-state-confirm)';
        }
      }
      const f = formOf(r);
      const oth = otherTiming(r);
      const chgBadge =
        r.chg === 'new'
          ? { t: '新規', c: 'var(--wb-info)' }
          : r.chg === 'changed'
            ? { t: '変更', c: 'var(--wb-info)' }
            : null;
      if (r.chg === 'new' && ph === 'dispense') bg = 'var(--wb-dispnew-bg)';
      else if (r.chg === 'changed' && ph === 'dispense') bg = 'var(--wb-dispchg-bg)';
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
        chgColor: chgBadge ? chgBadge.c : 'var(--wb-ink-muted)',
        asa: normCell(r.a),
        hiru: normCell(r.h),
        yu: normCell(r.y),
        nemae: normCell(r.n),
        daily: dailyDose(r),
        daysLabel: (g.days || 0) + '日',
        funsai: r.funsai,
        hasTag: !!r.tag,
        tag: r.tag,
        tagColor: tagColors[r.tag] || 'var(--wb-ink-muted)',
        note,
        noteColor,
        bg,
        checkBg: cBg,
        checkBorder: cBd,
        checkMark: cMk,
        showQuantityConfirm: ph === 'dispense',
        quantityConfirmed,
        quantityConfirmLocked: hasSavedQuantity,
        quantityConfirmLabel: hasSavedQuantity
          ? '実績あり'
          : quantityConfirmed
            ? '確認済'
            : '実数量確認',
        quantityLabel,
        actualQuantityInput,
        actualQuantityStep: quantityStepAttribute(r.unit, r.prescribedQuantity),
        actualQuantityInputMode: quantityInputModeForUnit(r.unit, r.prescribedQuantity),
        actualQuantityDisabled: hasSavedQuantity,
        discrepancyReasonValue: discrepancyReasonByDid[did] ?? r.discrepancyReason ?? '',
        requiresDiscrepancyReason,
        showAuditDoubleCount: ph === 'audit' && !!r.isNarcotic,
        auditFirstCountInput: auditDoubleCount.first,
        auditSecondCountInput: auditDoubleCount.second,
        auditCountExpectedLabel:
          typeof r.dispensedQuantity === 'number'
            ? `${formatQuantity(r.dispensedQuantity)}${r.unit ?? ''}`
            : '実績なし',
        auditCountExpectedQuantity:
          typeof r.dispensedQuantity === 'number' ? r.dispensedQuantity : null,
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
    // 日曜=赤 / 土曜=青 のカレンダー慣習色は維持（state ではなく曜日 category）。
    color: dd.cross
      ? 'var(--wb-state-blocked)'
      : dd.w === '日'
        ? 'var(--wb-state-blocked)'
        : dd.w === '土'
          ? 'var(--wb-info)'
          : 'var(--wb-ink)',
    bg: dd.cross ? 'var(--wb-blocked-bg)' : 'var(--wb-surface-alt)',
  }));

  const tg = autoTarget({ phase: ph, model, id, setCells, auditCells, current: stateTarget });

  const calRows = cal.active.map((tk) => {
    const c = cal.content[tk];
    const cells = days.map((day) => {
      const key = cellKey(id, day.idx, tk);
      const st = isSeta ? auditCells[key] || '' : setCells[key] || '';
      const isT = !!tg && tg.di === day.idx && tg.tk === tk;
      let bg = 'var(--wb-surface)';
      let bd = '1px solid var(--wb-line)';
      let mark = '';
      let markColor = 'var(--wb-ink-muted)';
      let stateLabel = '未セット';
      let stateColor = 'var(--wb-state-readonly)';
      if (isSeta) {
        stateLabel = '未監査';
        if (st === 'ok') {
          bg = 'var(--wb-done-bg)';
          bd = '1px solid var(--wb-done-border)';
          mark = '✓';
          markColor = 'var(--wb-state-done)';
          stateLabel = '監査OK';
          stateColor = 'var(--wb-state-done)';
        } else if (st === 'ng') {
          bg = 'var(--wb-blocked-bg)';
          bd = '1px solid var(--wb-blocked-border)';
          mark = '✕';
          markColor = 'var(--wb-state-blocked)';
          stateLabel = 'NG・差戻し';
          stateColor = 'var(--wb-state-blocked)';
        } else if (st === 'hold') {
          bg = 'var(--wb-confirm-bg-soft)';
          bd = '1px solid var(--wb-confirm-border)';
          mark = '⏸';
          markColor = 'var(--wb-state-confirm)';
          stateLabel = '保留';
          stateColor = 'var(--wb-state-confirm)';
        }
      } else {
        if (st === 'set') {
          bg = 'var(--wb-done-bg)';
          bd = '1px solid var(--wb-done-border)';
          mark = '✓';
          markColor = 'var(--wb-state-done)';
          stateLabel = 'セット済';
          stateColor = 'var(--wb-state-done)';
        } else if (st === 'hold') {
          bg = 'var(--wb-confirm-bg-soft)';
          bd = '1px solid var(--wb-confirm-border)';
          mark = '⏸';
          markColor = 'var(--wb-state-confirm)';
          stateLabel = '保留';
          stateColor = 'var(--wb-state-confirm)';
        }
      }
      // 選択セル枠は工程アクセント（state でなく phase。現値維持）。
      if (isT)
        bd = '2px solid ' + (isSeta ? 'var(--wb-phase-audit)' : 'var(--wb-phase-disp-strong)');
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
        packetColor: c.packets > 0 ? 'var(--wb-ink)' : 'var(--wb-ink-muted)',
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
        { label: '監査OK', bg: 'var(--wb-done-bg)', bd: 'var(--wb-done-border)' },
        { label: 'NG・差戻し', bg: 'var(--wb-blocked-bg)', bd: 'var(--wb-blocked-border)' },
        { label: '保留', bg: 'var(--wb-confirm-bg-soft)', bd: 'var(--wb-confirm-border)' },
        { label: '未監査', bg: 'var(--wb-surface)', bd: 'var(--wb-line)' },
      ]
    : [
        { label: 'セット済', bg: 'var(--wb-done-bg)', bd: 'var(--wb-done-border)' },
        { label: '保留', bg: 'var(--wb-confirm-bg-soft)', bd: 'var(--wb-confirm-border)' },
        { label: '未セット', bg: 'var(--wb-surface)', bd: 'var(--wb-line)' },
        { label: '選択中', bg: 'var(--wb-surface)', bd: 'var(--wb-phase-disp-strong)' },
      ];

  // ---- セット注意 / 監査リスク チップ ----
  const sjoin = p.biko.join('');
  const setChips: WorkbenchView['setChips'] = [];
  const SC = (l: string, c: string, b: string, bd: string) =>
    setChips.push({ label: l, color: c, bg: b, border: bd });
  if (dr.some((r) => r.funsai))
    SC(
      '粉砕あり',
      'var(--wb-state-blocked)',
      'var(--wb-blocked-bg)',
      'var(--wb-blocked-border-warm)',
    );
  if (p.chips.indexOf('賦形') >= 0)
    SC(
      '賦形あり',
      'var(--wb-state-confirm)',
      'var(--wb-confirm-bg-warm)',
      'var(--wb-confirm-border-warm)',
    );
  if (dr.some((r) => /PTP/.test(r.note)))
    SC('PTPあり', 'var(--wb-tag-ptp)', 'var(--wb-tag-ptp-bg)', 'var(--wb-tag-ptp-border)');
  if (cal.outside.some((o) => o.kind === '頓服'))
    SC('頓服あり', 'var(--wb-tag-tonyo)', 'var(--wb-tag-tonyo-bg)', 'var(--wb-tag-tonyo-border)');
  if (dr.some((r) => /別包/.test(r.note)))
    SC(
      '別包あり',
      'var(--wb-tag-reisho)',
      'var(--wb-tag-reisho-bg)',
      'var(--wb-tag-reisho-border)',
    );
  if (/残薬/.test(sjoin))
    SC('残薬調整', 'var(--wb-tag-gaiyo)', 'var(--wb-tag-gaiyo-bg)', 'var(--wb-tag-gaiyo-border)');
  if (p.chips.indexOf('小児') >= 0)
    SC('小児', 'var(--wb-tag-shoni)', 'var(--wb-tag-shoni-bg)', 'var(--wb-tag-shoni-border)');
  if (/懸濁|冷所/.test(sjoin))
    SC(
      '冷所/特殊',
      'var(--wb-tag-reisho)',
      'var(--wb-tag-reisho-bg)',
      'var(--wb-tag-reisho-border)',
    );
  const narcoticClassificationUnresolvedCount = groups.reduce(
    (sum, group) => sum + (group.narcoticClassification?.unresolvedLineCount ?? 0),
    0,
  );
  if (narcoticClassificationUnresolvedCount > 0) {
    // 麻薬は 6 軸の hazard タグ（琥珀）。淡背景/枠は confirm 系パステルを流用（同系色）。
    SC(
      `麻薬分類未確認 ${narcoticClassificationUnresolvedCount}剤`,
      'var(--wb-hazard)',
      'var(--wb-confirm-bg-soft)',
      'var(--wb-confirm-border)',
    );
  }
  if (!setChips.length)
    SC('特記なし', 'var(--wb-ink-muted)', 'var(--wb-surface-alt)', 'var(--wb-line)');

  // ---- 比較 ----
  const cmp = comparison(model, id, p.discontinued);
  // 処方差分の種別色は docs/ui-ux-design-guidelines SSOT に従う（追加/変更=info, 解除/中止=readonly）。
  // workflow state(done/confirm/blocked)とは別系統＝混同しない。
  const changeColors: Record<string, string> = {
    新規: 'var(--wb-info)',
    変更: 'var(--wb-info)',
    中止: 'var(--wb-state-readonly)',
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
      color: 'var(--wb-ink-muted)',
      items: cmp.cont.map((d) => ({ name: d.name, sub: d.yoho })),
    },
    {
      key: 'neu',
      title: '新規',
      color: 'var(--wb-info)',
      items: cmp.neu.map((d) => ({ name: d.name, sub: d.yoho + '（今回追加）' })),
    },
    {
      key: 'chg',
      title: '変更',
      color: 'var(--wb-info)',
      items: cmp.chg.map((d) => ({
        name: d.name,
        sub: (d.prevText || '前回') + ' → ' + (d.note || '今回'),
      })),
    },
    {
      key: 'disc',
      title: '中止',
      color: 'var(--wb-state-readonly)',
      items: cmp.disc.map((d) => ({ name: d.name, sub: (d.yoho || '') + '（前回まで）' })),
    },
  ];

  // ---- カレンダー外薬 ----
  const outsideMeds = cal.outside.map((o) => {
    const k = id + ':' + o.name;
    const on = !!outChk[k];
    const kc: Record<string, string> = {
      頓服: 'var(--wb-tag-tonyo)',
      外用: 'var(--wb-tag-gaiyo)',
      冷所: 'var(--wb-tag-reisho)',
      注射: 'var(--wb-tag-shoni)',
    };
    return {
      name: o.name,
      kind: o.kind,
      kindColor: kc[o.kind] || 'var(--wb-ink-muted)',
      checked: on,
    };
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
  if (changes.length) RK('処方変更点', 'var(--wb-state-blocked)');
  if (dr.some((r) => /平日|隔日|曜日|週/.test(r.note + r.yoho)))
    RK('曜日・隔日指定', 'var(--wb-state-blocked)');
  if (dr.some((r) => r.funsai)) RK('粉砕・賦形', 'var(--wb-state-confirm)');
  if (dr.some((r) => /PTP/.test(r.note))) RK('追加PTP混在', 'var(--wb-tag-ptp)');
  if (cal.outside.length) RK('カレンダー外薬', 'var(--wb-tag-tonyo)');
  if (/残薬/.test(sjoin)) RK('残薬調整', 'var(--wb-tag-gaiyo)');
  if (!riskList.length) RK('通常の定時薬', 'var(--wb-state-done)');

  // ---- progress + gate + primary ----
  const gateResult = calcGate({
    phase: ph,
    model,
    id,
    done,
    audit,
    setCells,
    auditCells,
    outChk,
    packet,
    checks,
  });
  let progress: WorkbenchView['progress'];
  let bulkLabel: string;
  let primaryLabel: string;
  let primaryBg: string;
  let primaryBorder: string;
  let checkHead: string;
  let primaryCursor = 'pointer';
  let primaryOpacity = '1';
  let gateText = '';
  let gateColor = 'var(--wb-state-done)';
  let gateBg = 'var(--wb-done-bg)';
  let gateBorder = 'var(--wb-done-border)';
  let gateOk = gateResult.ok;
  const auditDoubleCountIncomplete =
    ph === 'audit' &&
    rows.some((row) => {
      if (row.kind !== 'drug' || !row.showAuditDoubleCount || !audit[row.did]) return false;
      if (row.auditCountExpectedQuantity == null) return true;
      const first = parseQuantityInput(row.auditFirstCountInput);
      const second = parseQuantityInput(row.auditSecondCountInput);
      return (
        first == null ||
        second == null ||
        !quantitiesMatch(first, row.auditCountExpectedQuantity) ||
        !quantitiesMatch(second, row.auditCountExpectedQuantity)
      );
    });

  if (ph === 'dispense') {
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    progress = {
      label: '調剤ピッキング進捗',
      pct: pct + '%',
      color: 'var(--wb-phase-disp)',
      fraction: prog.done + ' / ' + prog.total,
    };
    bulkLabel = '全て調剤済';
    primaryLabel = '調剤完了 → 監査へ ▶';
    primaryBg = dataUnavailable ? 'var(--wb-state-readonly)' : 'var(--wb-phase-disp-strong)';
    primaryBorder = dataUnavailable ? 'var(--wb-state-readonly)' : 'var(--wb-phase-disp-border)';
    checkHead = '調剤';
    if (!gateResult.ok) {
      primaryBg = 'var(--wb-state-readonly)';
      primaryBorder = 'var(--wb-state-readonly)';
      primaryCursor = 'not-allowed';
      primaryOpacity = '.7';
    }
  } else if (ph === 'audit') {
    const pct = prog.total ? Math.round((prog.audit / prog.total) * 100) : 0;
    progress = {
      label: '調剤監査 進捗',
      pct: pct + '%',
      color: 'var(--wb-phase-audit)',
      fraction: prog.audit + ' / ' + prog.total,
    };
    bulkLabel = '全て監査OK';
    primaryLabel = '監査確定 → セットへ ▶';
    primaryBg = dataUnavailable ? 'var(--wb-state-readonly)' : 'var(--wb-phase-audit-strong)';
    primaryBorder = dataUnavailable ? 'var(--wb-state-readonly)' : 'var(--wb-phase-audit-border)';
    checkHead = '監査';
    if (!gateResult.ok || auditDoubleCountIncomplete) {
      primaryBg = 'var(--wb-state-readonly)';
      primaryBorder = 'var(--wb-state-readonly)';
      primaryCursor = 'not-allowed';
      primaryOpacity = '.7';
    }
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
        color: 'var(--wb-phase-setp)',
        fraction: dnC + ' / ' + totC,
      };
      bulkLabel = '全セルをセット済';
      primaryLabel = 'セット完了 → 監査へ ▶';
      primaryBg = 'var(--wb-phase-setp-strong)';
      primaryBorder = 'var(--wb-phase-setp-border)';
      checkHead = 'セット';
    } else {
      progress = {
        label: 'セット監査 進捗',
        pct: pct + '%',
        color: 'var(--wb-phase-seta)',
        fraction: dnC + ' / ' + totC,
      };
      bulkLabel = '全セルOK';
      primaryLabel = '監査承認（薬剤師）✓';
      primaryBg = 'var(--wb-phase-seta-strong)';
      primaryBorder = 'var(--wb-phase-seta-border)';
      checkHead = '監査';
    }
    gateText = gateResult.text;
    if (gateResult.ok) {
      gateColor = 'var(--wb-state-done)';
      gateBg = 'var(--wb-done-bg)';
      gateBorder = 'var(--wb-done-border)';
    } else {
      gateColor = 'var(--wb-state-blocked)';
      gateBg = 'var(--wb-blocked-bg)';
      gateBorder = 'var(--wb-blocked-border-soft)';
      primaryBg = 'var(--wb-state-readonly)';
      primaryBorder = 'var(--wb-state-readonly)';
      primaryCursor = 'not-allowed';
      primaryOpacity = '.7';
    }
  }
  if (dataUnavailable) {
    gateOk = false;
    gateText = '実データを取得できませんでした';
    gateColor = 'var(--wb-state-blocked)';
    gateBg = 'var(--wb-blocked-bg)';
    gateBorder = 'var(--wb-blocked-border-soft)';
    primaryBg = 'var(--wb-state-readonly)';
    primaryBorder = 'var(--wb-state-readonly)';
    primaryCursor = 'not-allowed';
    primaryOpacity = '.7';
  }
  if (auditDoubleCountIncomplete) {
    gateOk = false;
    gateText = '麻薬ダブルカウント未完了';
    gateColor = 'var(--wb-state-confirm)';
    gateBg = 'var(--wb-confirm-bg-soft)';
    gateBorder = 'var(--wb-confirm-border)';
  }

  // ---- 実装済み物理 F-key shortcuts ----
  const fkeys: WorkbenchView['fkeys'] = [
    fkey('F3', '前患者', 'prevPatient'),
    fkey('F4', '次患者', 'nextPatient'),
    fkey('F5', '一括処理', 'bulk', true),
    fkey('F7', '保留', 'hold'),
    fkey('F8', '調剤', 'phaseDispense', ph === 'dispense'),
    fkey('F9', '調剤監査', 'phaseAudit', ph === 'audit'),
    fkey('F10', 'セット', 'phaseSet', ph === 'setp'),
    fkey('F11', 'セット監査', 'phaseSetAudit', ph === 'seta'),
    fkey('F12', '次工程へ', 'next', true),
  ];

  // ---- 右ペイン タイトル / カレンダーバー / 写真 ----
  const rightTitle = isGrid ? '患者情報' : isSet ? 'セット作業' : 'セット監査';
  // 右ペインバー背景は工程の淡いテーマ着色（phase tint）。token 由来 + theme 追従に。
  const calBarBg = isSet
    ? 'color-mix(in oklch, var(--wb-phase-setp) 8%, var(--wb-surface))'
    : 'color-mix(in oklch, var(--wb-phase-seta) 8%, var(--wb-surface))';
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
      bg: holdReady ? 'var(--wb-state-confirm)' : 'var(--wb-state-readonly)',
      border: holdReady ? 'var(--wb-state-confirm)' : 'var(--wb-state-readonly)',
      cursor: holdReady ? 'pointer' : 'not-allowed',
      opacity: holdReady ? '1' : '.7',
    },

    compareOpen,
    compareSections,
    cmpCount,
  };
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function parseQuantityInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function quantitiesMatch(left: number, right: number) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-9;
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
    keyColor: active ? 'var(--wb-state-blocked)' : 'var(--wb-ink-muted)',
    labelColor: active ? 'var(--wb-ink)' : 'var(--wb-ink)',
  };
}
