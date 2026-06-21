/**
 * 調剤ワークベンチ ピュア関数（設計プロト L685-1012 の helpers / calc の移植）
 *
 * 副作用なし。store / view フックから参照される。設計プロトはメソッド内で this.state を
 * 参照していたが、ここでは必要な state を引数で受ける純関数に分解する。
 */

import type {
  CalcResult,
  CellTarget,
  ComparisonResult,
  DiscontinuedMed,
  Drug,
  FormInfo,
  GateResult,
  Group,
  PatientProgress,
  Phase,
  SeedPatient,
  TimingContent,
  TimingKey,
  WorkbenchModel,
} from './dispensing-workbench.types';
import { SET_AUDIT_CHECK_ITEMS } from './dispensing-workbench.write-types';

// ============================================================================
// 数値・セル整形
// ============================================================================

/** 整数なら整数文字列、そうでなければ小数1桁 */
export function fmtNum(x: number): string {
  return Number.isInteger(x) ? x.toString() : x.toFixed(1);
}

/** セル値の正規化（数値文字列は整形、それ以外はそのまま、空は ''）*/
export function normCell(v: string): string {
  if (!v) return '';
  if (/^[0-9.]+$/.test(v)) return fmtNum(parseFloat(v));
  return v;
}

// ============================================================================
// 日付
// ============================================================================

/** ISO 'YYYY-MM-DD' を Date へ。不正は null */
export function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = ('' + s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** 'YYYY/MM/DD（曜）' 形式 */
export function fmtJ(dt: Date): string {
  const w = '日月火水木金土'[dt.getDay()];
  return (
    dt.getFullYear() +
    '/' +
    ('0' + (dt.getMonth() + 1)).slice(-2) +
    '/' +
    ('0' + dt.getDate()).slice(-2) +
    '（' +
    w +
    '）'
  );
}

/** 服用終了日（start + days - 1）。算出不能は '—' */
export function endDate(start: string, days: number | string): string {
  const dt = parseISO(start);
  const dnum = typeof days === 'string' ? parseInt(days, 10) : days;
  if (!dt || !dnum) return '—';
  dt.setDate(dt.getDate() + (dnum - 1));
  return fmtJ(dt);
}

/** 'M/D'（短縮）。不正は '—' */
export function shortMD(s: string): string {
  const dt = parseISO(s);
  return dt ? dt.getMonth() + 1 + '/' + dt.getDate() : '—';
}

// ============================================================================
// 用法 → 時点マッピング
// ============================================================================

/** 用法文字列から服用時点（朝/昼/夕/眠前）を抽出。該当なしは食事系→朝昼夕、それ以外→朝 */
export function mapTiming(yoho: string): TimingKey[] {
  const t: TimingKey[] = [];
  if (/朝/.test(yoho)) t.push('朝');
  if (/昼/.test(yoho)) t.push('昼');
  if (/夕/.test(yoho)) t.push('夕');
  if (/(寝る前|眠前|就寝)/.test(yoho)) t.push('眠前');
  if (t.length === 0) {
    if (/(毎食|食後|食前|時)/.test(yoho)) t.push('朝', '昼', '夕');
    else t.push('朝');
  }
  return [...new Set(t)];
}

/** 1日量。名前に（X/日）があればそれを、なければ朝昼夕眠前の合計（錠/g）*/
export function dailyDose(r: Pick<Drug, 'name' | 'a' | 'h' | 'y' | 'n'>): string {
  const m = r.name.match(/（([^（）]*?\/日)）/);
  if (m) return m[1].replace('/日', '');
  let tabs = 0;
  let grams = 0;
  let ht = false;
  let hg = false;
  [r.a, r.h, r.y, r.n].forEach((v) => {
    if (!v) return;
    if (/g$/.test(v)) {
      grams += parseFloat(v);
      hg = true;
    } else if (/^[0-9.]+$/.test(v)) {
      tabs += parseFloat(v);
      ht = true;
    }
  });
  const out: string[] = [];
  if (ht) out.push(fmtNum(tabs) + '錠');
  if (hg) out.push(fmtNum(grams) + 'g');
  return out.join(' ');
}

// ============================================================================
// 剤形
// ============================================================================

/** 薬剤の剤形アイコン情報 */
export function formOf(r: Pick<Drug, 'name' | 'tag' | 'note'>): FormInfo {
  const n = r.name;
  if (r.tag === '頓用' || /頓服|便秘時|疼痛時|必要時/.test(r.note))
    return { l: '頓', bg: 'var(--wb-form-tonyo)', label: '頓服' };
  if (/テープ|軟膏|クリーム|ローション|貼付|坐/.test(n))
    return { l: '外', bg: 'var(--wb-form-gaiyo)', label: '外用' };
  if (/カプセル/.test(n)) return { l: 'カ', bg: 'var(--wb-form-capsule)', label: 'カプセル' };
  if (/(細粒|顆粒|散|末|ＤＳ|DS|ドライシロップ)/.test(n))
    return { l: '散', bg: 'var(--wb-form-powder)', label: '散剤' };
  if (/(内用液|懸濁|シロップ|液)/.test(n))
    return { l: '液', bg: 'var(--wb-form-liquid)', label: '液剤' };
  if (/錠/.test(n)) return { l: '錠', bg: 'var(--wb-form-tablet)', label: '錠剤' };
  return { l: '薬', bg: 'var(--wb-form-other)', label: 'その他' };
}

/** 頓・外他 列の表示（頓服/外用/起床時/食間/時刻/別容器/空文字）*/
export function otherTiming(r: Pick<Drug, 'yoho' | 'tag' | 'note' | 'name'>): string {
  const y = r.yoho;
  if (r.tag === '頓用' || /頓服|便秘時|疼痛時|必要時/.test(r.note)) return '頓服';
  if (/外用|テープ|軟膏/.test(r.note + r.name)) return '外用';
  if (/起床/.test(y)) return '起床時';
  if (/食間/.test(y)) return '食間';
  const tm = y.match(/[\d０-９]+・?[\d０-９]*・?[\d０-９]*時/);
  if (tm && !/朝|昼|夕|食/.test(y)) return tm[0];
  if (/別容器|内用液|懸濁/.test(r.note + r.name)) return '別容器';
  return '';
}

// ============================================================================
// model 構築 / グループ操作
// ============================================================================

/** seed 患者群から model（patientId → グループ配列）を構築 */
export function buildModel(patients: SeedPatient[]): WorkbenchModel {
  const model: WorkbenchModel = {};
  patients.forEach((p) => {
    const groups: Group[] = [];
    let cur: Group | null = null;
    let dc = 0;
    p.rows.forEach((r) => {
      if (r.t === 'sec') {
        cur = {
          gid: p.id + '-g' + groups.length,
          label: r.label,
          method: r.method,
          start: p.seedStart,
          days: p.seedDays,
          drugs: [],
        };
        groups.push(cur);
      } else if (cur) {
        const { t: _t, ...rest } = r;
        void _t;
        cur.drugs.push(Object.assign({ did: p.id + '-d' + dc++ }, rest));
      }
    });
    model[p.id] = groups;
  });
  return model;
}

/** model から指定患者の全薬剤をフラット化 */
export function drugsOf(model: WorkbenchModel, id: string): Drug[] {
  return (model[id] ?? []).reduce<Drug[]>((a, g) => a.concat(g.drugs), []);
}

/** 追加グループ番号（既存の「追加グループN」の最大 + 1）*/
export function nextGroupNo(groups: Group[]): number {
  let n = 0;
  groups.forEach((g) => {
    const m = (g.label || '').match(/^追加グループ(\d+)/);
    if (m) n = Math.max(n, +m[1]);
  });
  return n + 1;
}

// ============================================================================
// 開始日キー / ソート / 進捗
// ============================================================================

/** グループ群の最小開始日（昇順ソートキー）。なしは '9999-99-99' */
export function startKeyOf(groups: Group[]): string {
  let k: string | null = null;
  groups.forEach((g) => {
    if (g.start && (k === null || g.start < k)) k = g.start;
  });
  return k ?? '9999-99-99';
}

/** Calendar UI period start. Legacy mock data keeps the fixed 2026-06-17 window. */
export function calendarStartKeyOf(groups: Group[]): string {
  const explicit = groups.find((g) => g.calendarStart)?.calendarStart;
  return explicit ?? '2026-06-17';
}

/** Calendar UI day count. Legacy mock data keeps the fixed 7-day window. */
export function calendarDayCountOf(groups: Group[]): number {
  const explicit = groups.find((g) => g.calendarDayCount != null)?.calendarDayCount;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return 7;
}

/** patientId 群を sortMode（start | regist）で並べた id 配列 */
export function sortedIds(
  patients: SeedPatient[],
  model: WorkbenchModel,
  sortMode: 'start' | 'regist',
): string[] {
  const ids = patients.map((p) => p.id);
  return ids.slice().sort((a, b) => {
    if (sortMode === 'start') {
      return startKeyOf(model[a] ?? []).localeCompare(startKeyOf(model[b] ?? []));
    }
    const ra = patients.find((p) => p.id === a)?.regist ?? '';
    const rb = patients.find((p) => p.id === b)?.regist ?? '';
    return rb.localeCompare(ra);
  });
}

/** 患者の調剤/監査進捗 */
export function patientProgress(
  model: WorkbenchModel,
  id: string,
  done: Record<string, boolean>,
  audit: Record<string, boolean>,
): PatientProgress {
  let total = 0;
  let dn = 0;
  let au = 0;
  drugsOf(model, id).forEach((dr) => {
    total++;
    if (done[dr.did]) dn++;
    if (done[dr.did] && audit[dr.did]) au++;
  });
  return { total: total, done: dn, audit: au };
}

/** 朝昼夕眠前の合計表示（'錠数+Ng' 形式）*/
export function sumU(drugs: Drug[], key: 'a' | 'h' | 'y' | 'n'): string {
  let t = 0;
  let gm = 0;
  let ht = false;
  let hg = false;
  drugs.forEach((r) => {
    const v = r[key];
    if (!v) return;
    if (/g$/.test(v)) {
      gm += parseFloat(v);
      hg = true;
    } else if (/^[0-9.]+$/.test(v)) {
      t += parseFloat(v);
      ht = true;
    }
  });
  const o: string[] = [];
  if (ht) o.push(fmtNum(t));
  if (hg) o.push(fmtNum(gm) + 'g');
  return o.join('+');
}

/** グリッド合計（朝昼夕眠前 + 剤数サマリ）*/
export function totals(drugs: Drug[]): {
  asa: string;
  hiru: string;
  yu: string;
  nemae: string;
  summary: string;
} {
  return {
    asa: sumU(drugs, 'a'),
    hiru: sumU(drugs, 'h'),
    yu: sumU(drugs, 'y'),
    nemae: sumU(drugs, 'n'),
    summary: drugs.length + '剤',
  };
}

// ============================================================================
// calc — カレンダー導出（packets / PTP 分類 / カレンダー外薬）
// ============================================================================

/** 指定患者のカレンダー構造（時点別包数 / PTP / 別包 / カレンダー外薬）を導出 */
export function calc(model: WorkbenchModel, id: string): CalcResult {
  const drugs = drugsOf(model, id);
  const isOut = (r: Drug) =>
    r.tag === '頓用' ||
    r.tag === '外用' ||
    /頓服|外用|冷所|坐|注射|インスリン|別容器|内用液|懸濁/.test(r.note + r.name);
  const isPTP = (r: Drug) => /(^|[^一包])PTP/.test(r.note);
  const isBess = (r: Drug) => /別包/.test(r.note);
  const order: TimingKey[] = ['朝', '昼', '夕', '眠前'];
  const tlabel: Record<string, string> = { 朝: '朝食後', 昼: '昼食後', 夕: '夕食後', 眠前: '眠前' };
  const outside: CalcResult['outside'] = [];
  drugs.forEach((r) => {
    if (isOut(r)) {
      let kind = '頓服';
      const detail = r.note + r.name;
      if (r.tag === '外用') {
        if (/注射|インスリン/.test(detail)) kind = '注射';
        else if (/別容器|内用液|懸濁|液|mL|ml/.test(detail)) kind = '液剤';
        else kind = '外用';
      } else if (/冷所|坐/.test(detail)) kind = '冷所';
      else if (/注射|インスリン/.test(detail)) kind = '注射';
      else if (/外用|テープ|軟膏|点眼|点鼻/.test(detail)) kind = '外用';
      else if (/別容器|内用液|懸濁|液|mL|ml/.test(detail)) kind = '液剤';
      outside.push({ line_id: r.did, name: r.name, kind });
    }
  });
  const content: Record<string, TimingContent> = {};
  order.forEach((tk) => {
    const pd: Drug[] = [];
    const ptp: Drug[] = [];
    const bs: Drug[] = [];
    drugs.forEach((r) => {
      if (isOut(r)) return;
      if (mapTiming(r.yoho).indexOf(tk) < 0) return;
      if (isPTP(r)) ptp.push(r);
      else if (isBess(r)) bs.push(r);
      else pd.push(r);
    });
    const packets = (pd.length > 0 ? 1 : 0) + bs.length;
    content[tk] = {
      active: packets > 0 || ptp.length > 0,
      packets,
      packetText: packets > 0 ? packets + '包' : '—',
      ptpText: ptp.length ? '追加PTP ' + ptp.length + '錠' : '',
      drugs: pd
        .map((r) => r.name)
        .concat(bs.map((r) => r.name + '（別包）'))
        .concat(ptp.map((r) => r.name + '（PTP）')),
      note:
        pd
          .concat(ptp, bs)
          .map((r) => r.note)
          .filter((x) => /要|変更|残薬|平日|別包/.test(x))[0] || '',
    };
  });
  const active = order.filter((tk) => content[tk].active);
  return { content, active, tlabel, outside };
}

/** 比較4区分（新規/変更/継続/中止）*/
export function comparison(
  model: WorkbenchModel,
  id: string,
  discontinued: DiscontinuedMed[] | undefined,
): ComparisonResult {
  const drugs = drugsOf(model, id);
  const neu = drugs.filter((d) => d.chg === 'new');
  const chg = drugs.filter((d) => d.chg === 'changed');
  const cont = drugs.filter((d) => !d.chg);
  const disc = discontinued ?? [];
  return { neu, chg, cont, disc };
}

/** 訪問持出パケットのチェックキー（cal + 条件付き ton/gai/liq + doc/note）*/
export function packetKeys(model: WorkbenchModel, id: string): string[] {
  const c = calc(model, id);
  const keys = ['cal'];
  if (c.outside.some((o) => o.kind === '頓服')) keys.push('ton');
  if (c.outside.some((o) => o.kind === '外用')) keys.push('gai');
  if (c.outside.some((o) => o.kind === '液剤' || o.kind === '冷所')) keys.push('liq');
  keys.push('doc', 'note');
  return keys;
}

// ============================================================================
// ゲート（calcGate）
// ============================================================================

/** セル状態キー生成 */
export function cellKey(id: string, di: number, tk: string): string {
  return id + ':' + di + ':' + tk;
}

/**
 * 完了ゲート判定。
 * - グリッド工程（dispense/audit）: 全対象行チェック済みで ok
 * - setp: 未セット・外薬未確認・持出未完が全て0で ok
 * - seta: 未監査0・NG0・セット監査チェック6項目完了で ok
 */
export function calcGate(args: {
  phase: Phase;
  model: WorkbenchModel;
  id: string;
  done?: Record<string, boolean>;
  audit?: Record<string, boolean>;
  setCells: Record<string, string>;
  auditCells: Record<string, string>;
  outChk: Record<string, boolean>;
  packet: Record<string, boolean>;
  checks?: Record<string, boolean>;
}): GateResult {
  const {
    phase,
    model,
    id,
    done = {},
    audit = {},
    setCells,
    auditCells,
    outChk,
    packet,
    checks = {},
  } = args;
  if (phase === 'dispense' || phase === 'audit') {
    const drugs = drugsOf(model, id);
    const completed = drugs.filter((drug) =>
      phase === 'dispense' ? done[drug.did] : done[drug.did] && audit[drug.did],
    ).length;
    const remain = drugs.length - completed;
    return {
      ok: drugs.length > 0 && remain === 0,
      text:
        phase === 'dispense'
          ? remain === 0
            ? '✓ 全行調剤済'
            : '未調剤 ' + remain
          : remain === 0
            ? '✓ 全行監査OK'
            : '未監査 ' + remain,
    };
  }
  const cal = calc(model, id);
  const dayCount = calendarDayCountOf(model[id] ?? []);
  const total = cal.active.length * dayCount;
  let dnC = 0;
  let ng = 0;
  for (let di = 0; di < dayCount; di++) {
    cal.active.forEach((tk) => {
      const st = phase === 'seta' ? auditCells[cellKey(id, di, tk)] : setCells[cellKey(id, di, tk)];
      if (phase === 'seta') {
        if (st === 'ok') dnC++;
        if (st === 'ng') ng++;
      } else {
        if (st === 'set' || st === 'hold') dnC++;
      }
    });
  }
  if (phase === 'setp') {
    const outRemain = cal.outside.filter((o) => !outChk[id + ':' + o.name]).length;
    const setRemain = total - dnC;
    const pkRemain = packetKeys(model, id).filter((k) => !packet[id + ':' + k]).length;
    const ok = setRemain === 0 && outRemain === 0 && pkRemain === 0;
    return {
      ok,
      text: ok
        ? '✓ 持出パケット完成（セット完了可）'
        : '未セット ' + setRemain + '・外薬 ' + outRemain + '・持出 ' + pkRemain,
    };
  }
  const remain = total - dnC;
  const completedCheckIndexes = new Set<number>();
  const checkPrefix = `${id}:`;
  for (const [key, checked] of Object.entries(checks)) {
    if (!checked || !key.startsWith(checkPrefix)) continue;
    const index = Number(key.slice(key.lastIndexOf(':') + 1));
    if (Number.isInteger(index) && index >= 0 && index < SET_AUDIT_CHECK_ITEMS.length) {
      completedCheckIndexes.add(index);
    }
  }
  const checkRemain = SET_AUDIT_CHECK_ITEMS.length - completedCheckIndexes.size;
  const ok = remain === 0 && ng === 0 && checkRemain === 0;
  return {
    ok,
    text: ok
      ? '✓ 全セル監査OK（承認可）'
      : '完了条件：未監査 ' + remain + '・NG ' + ng + '・確認 ' + checkRemain,
  };
}

/**
 * 自動ターゲット選定（未確定の先頭セル → なければ active 先頭）。
 * 設計プロト renderVals L906-909 の _autoTarget 相当。
 */
export function autoTarget(args: {
  phase: Phase;
  model: WorkbenchModel;
  id: string;
  setCells: Record<string, string>;
  auditCells: Record<string, string>;
  current: CellTarget | null;
}): CellTarget | null {
  const { phase, model, id, setCells, auditCells, current } = args;
  if (current) return current;
  const cal = calc(model, id);
  const isSeta = phase === 'seta';
  const dayCount = calendarDayCountOf(model[id] ?? []);
  for (let di = 0; di < dayCount; di++) {
    for (const tk of cal.active) {
      const st = isSeta ? auditCells[cellKey(id, di, tk)] : setCells[cellKey(id, di, tk)];
      if (!st) return { di, tk };
    }
  }
  if (cal.active.length) return { di: 0, tk: cal.active[0] };
  return null;
}

/** 工程遷移の次工程（primary 押下時）*/
export const NEXT_PHASE: Record<Phase, Phase> = {
  dispense: 'audit',
  audit: 'setp',
  setp: 'seta',
  seta: 'seta',
};
