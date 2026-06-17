/**
 * 調剤ワークベンチ 型 SSOT
 *
 * 設計プロト（調剤ワークベンチ.dc.html）の state / renderVals が生成する
 * 各ブロックを React/TS の契約として型化する。後続のコンポーネント実装者は
 * use-workbench-view.ts が返す view model（{@link WorkbenchView}）と
 * dispensing-workbench.store.ts の actions のみを消費する。
 *
 * 段階1（モック）ではアダプタが seed をこの型へ整形して返す。実 API 結線フェーズでは
 * アダプタ内部のみ差し替える（型は安定契約として保持する）。
 */

// ============================================================================
// 工程（phase）— ルートから props 注入される（store には保持しない）
// ============================================================================

/** 4工程。/dispense=dispense /audit=audit /set=setp /set-audit=seta */
export type Phase = 'dispense' | 'audit' | 'setp' | 'seta';

/** グリッド系工程（調剤・調剤監査）か */
export function isGridPhase(phase: Phase): boolean {
  return phase === 'dispense' || phase === 'audit';
}

/** カレンダー系工程（セット・セット監査）か */
export function isCalendarPhase(phase: Phase): boolean {
  return phase === 'setp' || phase === 'seta';
}

// ============================================================================
// seed（buildPatients 相当）の生データ型
// ============================================================================

/** セット方法（調剤方法 select の選択肢）*/
export type DispenseMethod =
  | '一包化'
  | '錠剤分包機'
  | '散剤分包機'
  | '自動分包機'
  | 'PTP（手撒き）'
  | '別包'
  | '頓用';

/** 処方変化区分（前回比較 / 行バッジ）。'new'=新規追加, 'changed'=変更。未指定=継続 */
export type ChangeKind = 'new' | 'changed';

/** seed のセクション見出し行（sec() ファクトリ生成）*/
export interface SeedSectionRow {
  t: 'sec';
  label: string;
  /** 既定 '一包化' */
  method: DispenseMethod;
}

/** seed の薬剤行（d() ファクトリ生成）。a/h/y/n は朝昼夕眠前の数量文字列 */
export interface SeedDrugRow {
  t: 'drug';
  name: string;
  /** 用法（mapTiming/otherTiming の入力）*/
  yoho: string;
  /** 朝 */
  a: string;
  /** 昼 */
  h: string;
  /** 夕 */
  y: string;
  /** 眠前 */
  n: string;
  /** 行タグ（'頓用' 等）。既定 '' */
  tag: string;
  /** 粉砕フラグ。既定 false */
  funsai: boolean;
  /** 賦形・備考。既定 '' */
  note: string;
  /** 処方変化区分（任意）*/
  chg?: ChangeKind;
  /** 変更前の用法テキスト（chg==='changed' のとき比較表示に使用）*/
  prevText?: string;
}

/** seed の行（見出し or 薬剤）*/
export type SeedRow = SeedSectionRow | SeedDrugRow;

/** 中止薬（前回まで処方され今回中止）*/
export interface DiscontinuedMed {
  name: string;
  yoho: string;
}

/** 処方変更点（カレンダー上部の差分ファースト表示の元データ）*/
export interface SeedChange {
  /** '追加' | '変更' | '中止' 等 */
  type: string;
  text: string;
}

/** seed の患者1名分 */
export interface SeedPatient {
  id: string;
  name: string;
  kana: string;
  dob: string;
  age: number;
  sex: string;
  /** リスト下の補助テキスト */
  sub: string;
  /** アバター頭文字 */
  short: string;
  /** 患者属性チップ */
  chips: string[];
  /** 処方登録日（'YYYY/MM/DD'）*/
  regist: string;
  /** 服用開始日 seed（ISO 'YYYY-MM-DD'）*/
  seedStart: string;
  /** 処方日数 seed */
  seedDays: number;
  /** 予製可否（'可' | '否'）*/
  yosei: string;
  /** 処方変更点 */
  changes: SeedChange[];
  /** 備考・申し送り */
  biko: string[];
  /** 中止薬（任意）*/
  discontinued?: DiscontinuedMed[];
  /** 行データ（見出し + 薬剤）*/
  rows: SeedRow[];
}

// ============================================================================
// model（buildModel 相当）— グループ編成された薬剤
// ============================================================================

/** model 内の薬剤（seed の SeedDrugRow に did を付与し t を除いたもの）*/
export interface Drug {
  /** 行一意 id（'{patientId}-d{n}'）*/
  did: string;
  name: string;
  yoho: string;
  a: string;
  h: string;
  y: string;
  n: string;
  tag: string;
  funsai: boolean;
  note: string;
  /** API-backed prescribed total quantity. Used as the initial dispense result quantity. */
  prescribedQuantity?: number | null;
  chg?: ChangeKind;
  prevText?: string;
}

/** 調剤グループ（見出し単位）。D&D 移動・方法/開始日/日数編集の対象 */
export interface Group {
  /** グループ一意 id */
  gid: string;
  label: string;
  method: DispenseMethod | string;
  /** 服用開始日（ISO 'YYYY-MM-DD'）*/
  start: string;
  /** 処方日数 */
  days: number;
  /** Calendar UI period start. API-backed set plans can differ from prescription start. */
  calendarStart?: string;
  /** Calendar UI day count. Defaults to the legacy 7-day workbench window. */
  calendarDayCount?: number;
  drugs: Drug[];
}

/** patientId → グループ配列 */
export type WorkbenchModel = Record<string, Group[]>;

// ============================================================================
// calc（calc 相当）— カレンダー導出
// ============================================================================

/** 用法時点キー */
export type TimingKey = '朝' | '昼' | '夕' | '眠前';

/** カレンダー外薬の種別 */
export type OutsideKind = '頓服' | '外用' | '冷所' | '注射' | '液剤';

/** カレンダー外薬（同梱確認の対象）*/
export interface OutsideMed {
  name: string;
  kind: OutsideKind | string;
}

/** ある時点（朝/昼/夕/眠前）のセル内容（全日共通の処方内容）*/
export interface TimingContent {
  /** その時点に薬があるか */
  active: boolean;
  /** 一包化袋の包数 */
  packets: number;
  /** 表示用包数テキスト（'2包' or '—'）*/
  packetText: string;
  /** 追加PTPテキスト（'追加PTP 1錠' or ''）*/
  ptpText: string;
  /** 含まれる薬剤名（別包・PTPサフィックス付き）*/
  drugs: string[];
  /** 注意メモ（要/変更/残薬/平日/別包 を含むもの）*/
  note: string;
}

/** calc() の戻り値 */
export interface CalcResult {
  content: Record<string, TimingContent>;
  /** active な時点キー（行の元）*/
  active: TimingKey[];
  /** 時点キー → 表示ラベル（'朝'→'朝食後' 等）*/
  tlabel: Record<string, string>;
  outside: OutsideMed[];
}

// ============================================================================
// セル状態（setCells / auditCells）
// ============================================================================

/** セット工程のセル状態（''=未セット）*/
export type SetCellState = '' | 'set' | 'hold';
/** セット監査工程のセル状態（''=未監査）*/
export type AuditCellState = '' | 'ok' | 'ng' | 'hold';
/** セル状態（共用）*/
export type CellState = SetCellState | AuditCellState;

/** セル位置（曜日 index 0..6 × 時点キー）*/
export interface CellTarget {
  di: number;
  tk: string;
}

// ============================================================================
// 保留（hold）
// ============================================================================

/** 保留理由 */
export type HoldReason =
  | '処方変更待ち'
  | '医師確認待ち'
  | '残薬確認待ち'
  | '在庫不足'
  | '家族・施設確認待ち'
  | '訪問時に現地でセット'
  | 'その他';

/** 保留モーダルの編集ドラフト */
export interface HoldDraft {
  di: number;
  tk: string;
  reason: string;
  due: string;
  owner: string;
  memo: string;
}

/** 保留登録後の確定情報（セルに紐付く）*/
export interface HoldInfo {
  reason: string;
  due: string;
  owner: string;
  memo: string;
}

// ============================================================================
// NG 分類（セット監査）
// ============================================================================

/** NG 分類（14種）*/
export type NgCode =
  | '患者違い'
  | 'セット期間違い'
  | '日付違い'
  | '用法違い'
  | '薬剤違い'
  | '数量不足'
  | '数量超過'
  | '中止薬混入'
  | '休薬反映漏れ'
  | '変更前薬剤混入'
  | 'カレンダー外薬未同梱'
  | '残薬指示反映漏れ'
  | '写真不鮮明'
  | '判断不能';

// ============================================================================
// 比較（comparison）4区分
// ============================================================================

/** 前回処方比較の結果 */
export interface ComparisonResult {
  /** 新規 */
  neu: Drug[];
  /** 変更 */
  chg: Drug[];
  /** 継続 */
  cont: Drug[];
  /** 中止 */
  disc: DiscontinuedMed[];
}

/** 比較モーダルのセクション */
export interface CompareSection {
  key: 'cont' | 'neu' | 'chg' | 'disc';
  title: string;
  color: string;
  items: { name: string; sub: string }[];
}

// ============================================================================
// 剤形
// ============================================================================

/** formOf() の戻り値（剤形アイコン）*/
export interface FormInfo {
  /** 1文字ラベル（錠/散/カ/液/外/頓/薬）*/
  l: string;
  /** 背景色 */
  bg: string;
  /** 剤形名 */
  label: string;
}

// ============================================================================
// 進捗・ゲート
// ============================================================================

/** patientProgress() の戻り値 */
export interface PatientProgress {
  total: number;
  done: number;
  audit: number;
}

/** calcGate() の戻り値 */
export interface GateResult {
  ok: boolean;
  text: string;
}

// ============================================================================
// view model（renderVals 相当）— コンポーネントが消費する派生ブロック
// ============================================================================

/** チップ（色付き）*/
export interface ChipView {
  label: string;
  color: string;
  bg: string;
  border: string;
}

/** 左ペイン 患者リスト行 */
export interface PatientListItem {
  id: string;
  name: string;
  startLabel: string;
  registLabel: string;
  age: string;
  initial: string;
  avatarBg: string;
  bg: string;
  barColor: string;
  /** 状態ラベル（監査済/作業中/未着手）*/
  statusLabel: string;
  statusColor: string;
  /** ソート時の選択ハイライト用 */
  selected: boolean;
}

/** 並び替えボタン */
export interface SortButtonView {
  key: SortMode;
  label: string;
  color: string;
  bg: string;
  border: string;
  active: boolean;
}

/** 並び替えモード */
export type SortMode = 'start' | 'regist';

/** 工程タブ */
export interface PhaseTabView {
  id: Phase;
  label: string;
  bg: string;
  color: string;
  dot: string;
  active: boolean;
}

/** 患者リボン（上部）*/
export interface RibbonView {
  no: string;
  kana: string;
  name: string;
  dob: string;
  ageSex: string;
  kubun: string;
  regist: string;
  period: string;
  avatarBg: string;
  initial: string;
  chips: ChipView[];
  /** グリッド上部の賦形ルール表記 */
  rule: string;
  biko: string[];
}

/** グリッド行（セクション見出し）*/
export interface GridSectionRow {
  kind: 'sec';
  gid: string;
  secLabel: string;
  method: DispenseMethod | string;
  start: string;
  days: number;
  endDate: string;
}

/** グリッド行（薬剤）*/
export interface GridDrugRow {
  kind: 'drug';
  did: string;
  gid: string;
  no: number;
  name: string;
  yoho: string;
  formL: string;
  formBg: string;
  /** 頓・外他 列 */
  other: string;
  hasChg: boolean;
  chgText: string;
  chgColor: string;
  asa: string;
  hiru: string;
  yu: string;
  nemae: string;
  /** 1日量 */
  daily: string;
  daysLabel: string;
  funsai: boolean;
  hasTag: boolean;
  tag: string;
  tagColor: string;
  note: string;
  noteColor: string;
  /** zebra 背景・状態背景 */
  bg: string;
  /** チェックボックス見た目 */
  checkBg: string;
  checkBorder: string;
  checkMark: string;
}

/** グリッド行（見出し or 薬剤）*/
export type GridRow = GridSectionRow | GridDrugRow;

/** グリッド合計行 */
export interface GridTotals {
  asa: string;
  hiru: string;
  yu: string;
  nemae: string;
  /** '11剤' 等 */
  summary: string;
}

/** 右ペイン 患者情報行 */
export interface InfoItem {
  label: string;
  value: string;
}

/** カレンダー日付ヘッダ */
export interface CalendarDay {
  /** 'M/D' */
  d: string;
  /** 曜日（日月火…）*/
  w: string;
  color: string;
  bg: string;
}

/** カレンダーセル */
export interface CalendarCell {
  packetText: string;
  packetColor: string;
  ptpText: string;
  hasPtp: boolean;
  bg: string;
  border: string;
  mark: string;
  markColor: string;
  stateLabel: string;
  stateColor: string;
  /** hover タイトル（保留理由詳細）*/
  title: string;
  /** セル位置 */
  di: number;
  tk: string;
  /** 選択中（target）か */
  selected: boolean;
}

/** カレンダー行（時点単位）*/
export interface CalendarRow {
  /** 時点ラベル（朝食後 等）*/
  label: string;
  cells: CalendarCell[];
}

/** カレンダー凡例 */
export interface CalendarLegendItem {
  label: string;
  bg: string;
  bd: string;
}

/** カレンダー上部の処方変更点チップ */
export interface ChangeChip {
  type: string;
  text: string;
  color: string;
}

/** セット注意 / 監査リスク チップ */
export interface SetChip {
  label: string;
  color: string;
  bg: string;
  border: string;
}

/** 「次にセットする薬剤」/「期待値」ターゲット表示 */
export interface TargetView {
  date: string;
  timing: string;
  packetText: string;
  ptpText: string;
  hasPtp: boolean;
  drugs: string[];
  note: string;
  hasNote: boolean;
}

/** セット手順ステップ */
export interface SetStep {
  n: string;
  label: string;
  sub: string;
}

/** カレンダー外薬 同梱チェック項目 */
export interface OutsideMedItem {
  name: string;
  kind: string;
  kindColor: string;
  checked: boolean;
}

/** 訪問持出パケット 完成判定項目 */
export interface PacketItem {
  /** チェックキー（cal/ton/gai/liq/doc/note）*/
  key: string;
  label: string;
  checked: boolean;
}

/** セット監査 確認項目チェック */
export interface CheckItem {
  /** index */
  index: number;
  label: string;
  checked: boolean;
}

/** セット監査 リスク確認順 */
export interface RiskItem {
  rank: number;
  label: string;
  color: string;
}

/** セット監査 差戻しリスト */
export interface RejectItem {
  /** セル位置（セットへ戻す対象）*/
  di: number;
  tk: string;
  label: string;
  ng: string;
}

/** 進捗バー */
export interface ProgressView {
  label: string;
  /** '75%' */
  pct: string;
  color: string;
  /** '3 / 4' */
  fraction: string;
}

/** ゲート表示（カレンダー工程のみ）*/
export interface GateView {
  ok: boolean;
  text: string;
  color: string;
  bg: string;
  border: string;
}

/** 実装済み物理 F-key shortcut */
export interface FKeyView {
  key: string;
  label: string;
  keyColor: string;
  labelColor: string;
  /** F-key 種別（ハンドラ配線用）*/
  action: FKeyAction;
}

/** F-key の意味（コンポーネント側でハンドラに割当）*/
export type FKeyAction =
  | 'prevPatient'
  | 'nextPatient'
  | 'bulk'
  | 'hold'
  | 'phaseDispense'
  | 'phaseAudit'
  | 'phaseSet'
  | 'phaseSetAudit'
  | 'next';

/** 保留理由ラジオ */
export interface HoldReasonView {
  label: string;
  selected: boolean;
}

/** 主操作ボタンの見た目 */
export interface PrimaryButtonView {
  label: string;
  bg: string;
  border: string;
  cursor: string;
  opacity: string;
}

/**
 * use-workbench-view.ts が返す完全 view model。
 * 設計プロト renderVals（L1062-1086）の網羅。コンポーネントはこれと store の actions
 * のみを消費する（renderVals の onClick 等の生ハンドラは store action へ写像）。
 */
export interface WorkbenchView {
  // phase 派生
  phase: Phase;
  isGrid: boolean;
  isCal: boolean;
  isSet: boolean;
  isSeta: boolean;
  phaseLabel: string;

  // 左ペイン
  patients: PatientListItem[];
  patientCount: string;
  sortButtons: SortButtonView[];

  // 工程タブ
  phases: PhaseTabView[];
  flowHint: string;

  // 患者リボン + 右ペイン共通
  cur: RibbonView;
  chips: ChipView[];

  // グリッド
  checkHead: string;
  rows: GridRow[];
  methodOptions: DispenseMethod[];
  totals: GridTotals;
  infoItems: InfoItem[];

  // カレンダー
  calDays: CalendarDay[];
  calRows: CalendarRow[];
  calLegend: CalendarLegendItem[];
  calBarTitle: string;
  calBarBg: string;
  calBarMeta: string;
  setChips: SetChip[];
  changes: ChangeChip[];
  changesEmpty: boolean;
  photoTitle: string;
  photos: string[];

  // セット作業 / セット監査 右ペイン
  rightTitle: string;
  target: TargetView;
  setMethod: string;
  setSteps: SetStep[];
  outsideMeds: OutsideMedItem[];
  outsideEmpty: boolean;
  packetItems: PacketItem[];
  packetDone: boolean;
  checkItems: CheckItem[];
  riskList: RiskItem[];
  rejectList: RejectItem[];
  rejectEmpty: boolean;
  ngValue: string;
  ngOptions: NgCode[];

  // 進捗・ゲート・主操作
  progress: ProgressView;
  gate: GateView;
  primary: PrimaryButtonView;
  bulkLabel: string;

  // F-key
  fkeys: FKeyView[];

  // 保留モーダル
  holdOpen: boolean;
  holdReasons: HoldReasonView[];
  holdCellLabel: string;
  holdDue: string;
  holdOwner: string;
  holdMemo: string;
  holdReady: boolean;
  holdSave: PrimaryButtonView;

  // 比較モーダル
  compareOpen: boolean;
  compareSections: CompareSection[];
  cmpCount: { neu: number; chg: number; disc: number; cont: number };
}
