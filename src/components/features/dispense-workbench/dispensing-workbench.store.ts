/**
 * 調剤ワークベンチ Zustand ストア（設計プロト state + actions L546-825 の移植）
 *
 * persist（name='chouzai-workbench', storage=localStorage）でリロード越え・4ルート間で
 * 作業状態を保持する。phase は保持しない（ルートから props 注入されるため）。
 * phase 依存の action（navBy/primary/bulk/toggleRow/applyCell/saveHold 等）は phase を
 * 引数で受ける。
 *
 * 段階1はモックのため平文 localStorage で可。実データ結線フェーズでは storage を
 * AES-GCM + IndexedDB（Dexie）へ差し替える（計画 §3 / CLAUDE.md PHI 暗号化準拠）。
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { isRealDataEnabled } from './dispensing-workbench.adapter';
import { buildPatients } from './dispensing-workbench.seed';
import {
  NEXT_PHASE,
  buildModel,
  calc,
  calendarDayCountOf,
  calcGate,
  cellKey,
  drugsOf,
  nextGroupNo,
  sortedIds,
} from './dispensing-workbench.logic';
import type {
  CellTarget,
  HoldDraft,
  HoldInfo,
  Phase,
  SeedPatient,
  SortMode,
  WorkbenchModel,
} from './dispensing-workbench.types';
import {
  emptyWriteContext,
  type SetBatchGenerationMetadata,
  type WorkbenchWriteContext,
} from './dispensing-workbench.write-types';

const SEED_PATIENTS = buildPatients();
const REAL_DATA_ENABLED = isRealDataEnabled();
const INITIAL_PATIENTS = REAL_DATA_ENABLED ? [] : SEED_PATIENTS;
const INITIAL_MODEL = REAL_DATA_ENABLED ? {} : buildModel(SEED_PATIENTS);
const INITIAL_SEL_ID = REAL_DATA_ENABLED ? '' : '0001';

export interface WorkbenchState {
  // ---- state（設計プロト L546-548）----
  /** 選択中患者 id */
  selId: string;
  /** 並び替えモード */
  sortMode: SortMode;
  /** 調剤チェック（did → bool）*/
  done: Record<string, boolean>;
  /** 調剤監査チェック（did → bool）*/
  audit: Record<string, boolean>;
  /** 実数量確認（did → bool）。行チェックとは分離する。 */
  quantityConfirmedByDid: Record<string, boolean>;
  /** 実数量入力（did → input string）。空なら処方数量を確認対象にする。 */
  actualQuantityInputByDid: Record<string, string>;
  /** 実数量が処方数量と異なる場合の理由（did → reason）。 */
  discrepancyReasonByDid: Record<string, string>;
  /** 麻薬ダブルカウント入力（did → 1回目/2回目）。監査工程の揮発 state。 */
  auditDoubleCountByDid: Record<string, { first: string; second: string }>;
  /** セットセル状態（'{id}:{di}:{tk}' → ''/'set'/'hold'）*/
  setCells: Record<string, string>;
  /** セット監査セル状態（'{id}:{di}:{tk}' → ''/'ok'/'ng'/'hold'）*/
  auditCells: Record<string, string>;
  /** カレンダー外薬 同梱チェック（'{id}:{name}' → bool）*/
  outChk: Record<string, boolean>;
  /** セット監査 確認項目チェック（'{id}:{di}:{tk}:{i}' → bool）*/
  checks: Record<string, boolean>;
  /** NG 分類（'{id}:{di}:{tk}' → code）*/
  ng: Record<string, string>;
  /** 選択中セル（手動選択時）*/
  target: CellTarget | null;
  /** 保留モーダルの編集ドラフト（null=非表示）*/
  holdModal: HoldDraft | null;
  /** 保留確定情報（'{id}:{di}:{tk}' → HoldInfo）*/
  holdInfo: Record<string, HoldInfo>;
  /** 訪問持出パケットチェック（'{id}:{key}' → bool）*/
  packet: Record<string, boolean>;
  /** 前回処方比較モーダル開閉 */
  compareOpen: boolean;
  /** グループ編成 model（patientId → groups）*/
  model: WorkbenchModel;
  /** 患者リスト（左ペイン / ソート / リボン素材）。既定は seed。実データは hydrate で差替え */
  patients: SeedPatient[];
  /** 実データで初期化済みか（true の間は seed 由来の再 hydrate を抑止しない素朴フラグ）*/
  hydrated: boolean;
  /**
   * 書込結線の実データ識別子（task_id / plan_id / cycle.version / cellMeta 等）。
   * 既定（モック）は空。実データ時のみ hydrate / カレンダー取得時に充填する（非永続）。
   * mutations hook はこの値を読んで API 単位（batch_id / expected_version 等）を解決する。
   */
  writeContext: WorkbenchWriteContext;
  /**
   * セット工程のセットバッチ生成メタ（非永続）。実データ calendar 取得時のみ充填する。
   * 既定（モック）/ 患者切替直後 / 空・失敗 hydrate は null（生成 CTA を出さない fail-closed）。
   * force 再生成の OCC アンカー（expected_updated_at）も含むため、書込ハンドラはここから読む。
   */
  calendarGeneration: SetBatchGenerationMetadata | null;
  /**
   * status bar 表示用の operator 情報（非永続）。dispenserName=実記録された調剤者、
   * operatorName=現在の操作者（API auditor=ログイン中の閲覧者。記録済み監査者ではない）。
   * 既定（モック）/ 実データ取得失敗 / カレンダー工程 / 患者切替直後は null（status bar は '—' へ fail-closed）。
   */
  operators: { dispenserName: string | null; operatorName: string | null };
  /** 実データ取得が失敗したか（true=障害でエラー状態を表示。0件の空状態とは区別する）。非永続。 */
  loadError: boolean;
  /** 手動再読み込みトリガ。bump すると実データ hydrate effect が再走する。非永続。 */
  retryNonce: number;

  // ---- actions ----
  setPatient: (id: string) => void;
  /**
   * 実データ初期化（計画 §14 読取結線）。患者リスト + 選択患者の model を流し込む。
   * 既定パス（モック）では呼ばれない。selId が新リストに無ければ先頭へ寄せる。
   */
  hydrate: (args: {
    patients: SeedPatient[];
    selId?: string;
    model?: WorkbenchModel;
    done?: Record<string, boolean>;
    audit?: Record<string, boolean>;
    quantityConfirmedByDid?: Record<string, boolean>;
  }) => void;
  /**
   * 書込結線の実データ識別子を部分マージする（実データ時のみ呼ばれる）。
   * 既定（モック）では未使用。selId 切替やカレンダー取得時に充填する。
   */
  setWriteContext: (patch: Partial<WorkbenchWriteContext>) => void;
  /**
   * status bar 表示用の operator 情報を差し替える（実データ dispense/audit 取得時）。
   * 取得失敗 / カレンダー工程は null へ倒し、捏造名 / 前患者の残値を出さない。
   */
  setOperators: (value: { dispenserName: string | null; operatorName: string | null }) => void;
  /** 実データ取得の失敗フラグを設定する（成功・0件=false / 障害=true）。 */
  setLoadError: (value: boolean) => void;
  /** 手動再読み込み。loadError を消し retryNonce を bump して effect を再走させる。 */
  retryLoad: () => void;
  /**
   * 実データ calendar から復元した set/set-audit state を反映する。
   * 同じ患者の古い persisted セル状態を残さないよう patient prefix で置換する。
   */
  setCalendarState: (args: {
    patientId: string;
    planId?: string | null;
    model: WorkbenchModel;
    setCells: Record<string, string>;
    auditCells: Record<string, string>;
    ng?: Record<string, string>;
    holdInfo?: Record<string, HoldInfo>;
    /** セットバッチ生成メタ（calendar レスポンス由来）。省略時は null（生成 CTA を出さない）。 */
    generation?: SetBatchGenerationMetadata | null;
  }) => void;
  navBy: (delta: number) => void;
  setSort: (mode: SortMode) => void;
  toggleRow: (phase: Phase, did: string) => void;
  toggleQuantityConfirm: (did: string) => void;
  setActualQuantityInput: (did: string, value: string) => void;
  setDiscrepancyReason: (did: string, value: string) => void;
  setAuditDoubleCount: (did: string, field: 'first' | 'second', value: string) => void;
  setGMethod: (gid: string, value: string) => void;
  setGStart: (gid: string, value: string) => void;
  setGDays: (gid: string, value: string) => void;
  dragStart: (did: string) => void;
  dropTo: (gid: string) => void;
  selectCell: (di: number, tk: string) => void;
  applyCell: (phase: Phase, val: string, target: CellTarget | null) => void;
  restoreCell: (
    phase: Phase,
    patientId: string,
    target: CellTarget,
    value: string | undefined,
  ) => void;
  restoreCells: (phase: Phase, values: Record<string, string>) => void;
  restoreHoldInfo: (patientId: string, target: CellTarget, value: HoldInfo | undefined) => void;
  toggleOut: (name: string) => void;
  toggleCheck: (target: CellTarget | null, i: number) => void;
  setNg: (target: CellTarget | null, value: string) => void;
  openHold: (target: CellTarget | null) => void;
  setHoldField: (key: keyof Omit<HoldDraft, 'di' | 'tk'>, value: string) => void;
  cancelHold: () => void;
  saveHold: (phase: Phase) => void;
  bulk: (phase: Phase) => void;
  openCompare: () => void;
  closeCompare: () => void;
  addGroup: () => string | null;
  togglePacket: (item: string) => void;
  returnToSet: (di: number, tk: string) => void;
  /** primary（次工程へ）押下。ゲート通過時のみ次 phase を返す（ルート遷移は呼び出し側）*/
  primary: (phase: Phase) => Phase | null;
}

/** D&D 中の did（永続化対象外・揮発）*/
let dragId: string | null = null;

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      selId: INITIAL_SEL_ID,
      sortMode: 'start',
      done: {},
      audit: {},
      quantityConfirmedByDid: {},
      actualQuantityInputByDid: {},
      discrepancyReasonByDid: {},
      auditDoubleCountByDid: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: INITIAL_MODEL,
      patients: INITIAL_PATIENTS,
      hydrated: false,
      writeContext: emptyWriteContext(),
      calendarGeneration: null,
      operators: { dispenserName: null, operatorName: null },
      loadError: false,
      retryNonce: 0,

      setPatient: (id) =>
        set({
          selId: id,
          target: null,
          holdModal: null,
          writeContext: emptyWriteContext(),
          // 患者切替直後は前患者の生成メタ / operator / エラー状態を残さない（effect が再取得して再評価する）。
          calendarGeneration: null,
          operators: { dispenserName: null, operatorName: null },
          loadError: false,
        }),

      setWriteContext: (patch) => set((s) => ({ writeContext: { ...s.writeContext, ...patch } })),

      setOperators: (value) => set({ operators: value }),

      setLoadError: (value) => set({ loadError: value }),

      retryLoad: () => set((s) => ({ loadError: false, retryNonce: s.retryNonce + 1 })),

      setCalendarState: ({
        patientId,
        planId,
        model,
        setCells,
        auditCells,
        ng = {},
        holdInfo = {},
        generation = null,
      }) =>
        set((s) => {
          const preserveCarryEvidence = !!planId && s.writeContext.planId === planId;
          return {
            model: { ...s.model, ...model },
            calendarGeneration: generation,
            setCells: replacePatientPrefixedState(s.setCells, patientId, setCells),
            auditCells: replacePatientPrefixedState(s.auditCells, patientId, auditCells),
            outChk: preserveCarryEvidence
              ? s.outChk
              : removePatientPrefixedState(s.outChk, patientId),
            checks: removePatientPrefixedState(s.checks, patientId),
            ng: replacePatientPrefixedState(s.ng, patientId, ng),
            holdInfo: replacePatientPrefixedState(s.holdInfo, patientId, holdInfo),
            packet: preserveCarryEvidence
              ? s.packet
              : removePatientPrefixedState(s.packet, patientId),
            target: null,
            holdModal: null,
          };
        }),

      hydrate: ({ patients, selId, model, done, audit, quantityConfirmedByDid }) =>
        set((s) => {
          if (patients.length === 0) {
            return {
              patients: [],
              selId: '',
              hydrated: true,
              target: null,
              holdModal: null,
              done: {},
              audit: {},
              quantityConfirmedByDid: {},
              actualQuantityInputByDid: {},
              discrepancyReasonByDid: {},
              auditDoubleCountByDid: {},
              model: {},
              writeContext: emptyWriteContext(),
              // 空/失敗 hydrate では生成メタ・operator も null（捏造値を残さない）。
              calendarGeneration: null,
              operators: { dispenserName: null, operatorName: null },
            };
          }
          const nextSelId =
            selId ?? (patients.some((p) => p.id === s.selId) ? s.selId : patients[0].id);
          return {
            patients,
            selId: nextSelId,
            hydrated: true,
            target: null,
            holdModal: null,
            ...(model
              ? {
                  done: done ?? {},
                  audit: audit ?? {},
                  quantityConfirmedByDid: quantityConfirmedByDid ?? {},
                  actualQuantityInputByDid: {},
                  discrepancyReasonByDid: {},
                  auditDoubleCountByDid: {},
                }
              : {}),
            ...(nextSelId !== s.selId ? { writeContext: emptyWriteContext() } : {}),
            ...(model ? { model: { ...s.model, ...model } } : {}),
          };
        }),

      navBy: (delta) => {
        const { model, sortMode, selId, patients } = get();
        const sorted = sortedIds(patients, model, sortMode);
        if (sorted.length === 0) return;
        const i = sorted.indexOf(selId);
        const ni = (i + delta + sorted.length) % sorted.length;
        set({ selId: sorted[ni], target: null, holdModal: null });
      },

      setSort: (mode) => set({ sortMode: mode }),

      toggleRow: (phase, did) =>
        set((s) =>
          phase === 'dispense'
            ? { done: { ...s.done, [did]: !s.done[did] } }
            : { audit: { ...s.audit, [did]: !s.audit[did] } },
        ),

      toggleQuantityConfirm: (did) =>
        set((s) => ({
          quantityConfirmedByDid: {
            ...s.quantityConfirmedByDid,
            [did]: !s.quantityConfirmedByDid[did],
          },
        })),

      setActualQuantityInput: (did, value) =>
        set((s) => {
          const quantityConfirmedByDid = { ...s.quantityConfirmedByDid };
          delete quantityConfirmedByDid[did];
          return {
            actualQuantityInputByDid: {
              ...s.actualQuantityInputByDid,
              [did]: value,
            },
            quantityConfirmedByDid,
          };
        }),

      setDiscrepancyReason: (did, value) =>
        set((s) => ({
          discrepancyReasonByDid: {
            ...s.discrepancyReasonByDid,
            [did]: value,
          },
        })),

      setAuditDoubleCount: (did, field, value) =>
        set((s) => {
          const current = s.auditDoubleCountByDid[did] ?? { first: '', second: '' };
          return {
            auditDoubleCountByDid: {
              ...s.auditDoubleCountByDid,
              [did]: { ...current, [field]: value },
            },
          };
        }),

      setGMethod: (gid, value) =>
        set((s) => updateGroups(s, (gs) => gs.forEach((g) => g.gid === gid && (g.method = value)))),

      setGStart: (gid, value) =>
        set((s) =>
          updateGroups(s, (gs) =>
            gs.forEach((g) => {
              if (g.gid !== gid) return;
              g.start = value;
              delete g.periodWarning;
            }),
          ),
        ),

      setGDays: (gid, value) => {
        const n = parseInt(value, 10);
        set((s) =>
          updateGroups(s, (gs) =>
            gs.forEach((g) => {
              if (g.gid !== gid) return;
              g.days = isNaN(n) ? 0 : n;
              delete g.periodWarning;
            }),
          ),
        );
      },

      dragStart: (did) => {
        dragId = did;
      },

      dropTo: (gid) => {
        const did = dragId;
        if (!did) return;
        set((s) =>
          updateGroups(s, (gs) => {
            let moved = null;
            let sourceGid: string | null = null;
            gs.forEach((g) => {
              const i = g.drugs.findIndex((x) => x.did === did);
              if (i >= 0) {
                moved = g.drugs.splice(i, 1)[0];
                sourceGid = g.gid;
                delete g.periodWarning;
              }
            });
            if (moved) {
              const t = gs.find((g) => g.gid === gid);
              if (t) {
                t.drugs.push(moved);
                if (sourceGid !== gid) delete t.periodWarning;
              }
            }
          }),
        );
        dragId = null;
      },

      selectCell: (di, tk) => set({ target: { di, tk } }),

      applyCell: (phase, val, target) => {
        if (!target) return;
        const k = cellKey(get().selId, target.di, target.tk);
        if (phase === 'setp') set((s) => ({ setCells: { ...s.setCells, [k]: val }, target: null }));
        else set((s) => ({ auditCells: { ...s.auditCells, [k]: val }, target: null }));
      },

      restoreCell: (phase, patientId, target, value) => {
        const k = cellKey(patientId, target.di, target.tk);
        const stateKey = phase === 'setp' ? 'setCells' : 'auditCells';
        set((s) => {
          const next = { ...s[stateKey] };
          if (value) next[k] = value;
          else delete next[k];
          return { [stateKey]: next };
        });
      },

      restoreCells: (phase, values) => {
        const stateKey = phase === 'setp' ? 'setCells' : 'auditCells';
        set({ [stateKey]: { ...values } });
      },

      restoreHoldInfo: (patientId, target, value) => {
        const k = cellKey(patientId, target.di, target.tk);
        set((s) => {
          const next = { ...s.holdInfo };
          if (value) next[k] = value;
          else delete next[k];
          return { holdInfo: next };
        });
      },

      toggleOut: (name) => {
        const k = get().selId + ':' + name;
        set((s) => ({ outChk: { ...s.outChk, [k]: !s.outChk[k] } }));
      },

      toggleCheck: (target, i) => {
        if (!target) return;
        const k = cellKey(get().selId, target.di, target.tk) + ':' + i;
        set((s) => ({ checks: { ...s.checks, [k]: !s.checks[k] } }));
      },

      setNg: (target, value) => {
        if (!target) return;
        const k = cellKey(get().selId, target.di, target.tk);
        set((s) => ({ ng: { ...s.ng, [k]: value } }));
      },

      openHold: (target) => {
        if (!target) return;
        set({
          holdModal: { di: target.di, tk: target.tk, reason: '', due: '', owner: '', memo: '' },
        });
      },

      setHoldField: (key, value) =>
        set((s) => (s.holdModal ? { holdModal: { ...s.holdModal, [key]: value } } : {})),

      cancelHold: () => set({ holdModal: null }),

      saveHold: (phase) => {
        const h = get().holdModal;
        if (!h || !h.reason) return;
        const k = cellKey(get().selId, h.di, h.tk);
        const phaseSet = phase === 'seta' ? 'auditCells' : 'setCells';
        set((s) => ({
          [phaseSet]: { ...s[phaseSet], [k]: 'hold' },
          holdInfo: {
            ...s.holdInfo,
            [k]: { reason: h.reason, due: h.due, owner: h.owner, memo: h.memo },
          },
          holdModal: null,
          target: null,
        }));
      },

      bulk: (phase) => {
        const { selId, model, done } = get();
        if (phase === 'dispense' || phase === 'audit') {
          const upd: Record<string, boolean> = {};
          drugsOf(model, selId).forEach((dr) => {
            if (phase === 'audit' && !done[dr.did]) return;
            upd[dr.did] = true;
          });
          if (phase === 'dispense') set((s) => ({ done: { ...s.done, ...upd } }));
          else set((s) => ({ audit: { ...s.audit, ...upd } }));
          return;
        }
        // calc は logic 経由（calcGate と同じ active 算出）
        const cal = calc(model, selId);
        const dayCount = calendarDayCountOf(model[selId] ?? []);
        const upd: Record<string, string> = {};
        for (let di = 0; di < dayCount; di++)
          cal.active.forEach((tk) => {
            upd[cellKey(selId, di, tk)] = phase === 'setp' ? 'set' : 'ok';
          });
        if (phase === 'setp') set((s) => ({ setCells: { ...s.setCells, ...upd } }));
        else set((s) => ({ auditCells: { ...s.auditCells, ...upd } }));
      },

      openCompare: () => set({ compareOpen: true }),
      closeCompare: () => set({ compareOpen: false }),

      addGroup: () => {
        const { selId, model, patients } = get();
        const p = patients.find((x) => x.id === selId);
        if (!p) return null;
        const no = nextGroupNo(model[selId] ?? []);
        const gid = selId + '-gx' + Date.now();
        set((s) =>
          updateGroups(s, (gs) => {
            gs.push({
              gid,
              label: '追加グループ' + no,
              method: '一包化',
              start: p.seedStart,
              days: p.seedDays,
              drugs: [],
            });
          }),
        );
        return gid;
      },

      togglePacket: (item) => {
        const k = get().selId + ':' + item;
        set((s) => ({ packet: { ...s.packet, [k]: !s.packet[k] } }));
      },

      returnToSet: (di, tk) => {
        const k = cellKey(get().selId, di, tk);
        set((s) => ({
          auditCells: { ...s.auditCells, [k]: '' },
          setCells: { ...s.setCells, [k]: '' },
          target: { di, tk },
        }));
      },

      primary: (phase) => {
        const s = get();
        const gate = calcGate({
          phase,
          model: s.model,
          id: s.selId,
          done: s.done,
          audit: s.audit,
          setCells: s.setCells,
          auditCells: s.auditCells,
          outChk: s.outChk,
          packet: s.packet,
          checks: s.checks,
        });
        if (!gate.ok) return null;
        set({ target: null });
        return NEXT_PHASE[phase];
      },
    }),
    {
      name: 'chouzai-workbench',
      storage: createJSONStorage(() => localStorage),
      // phase は保持しない。target/holdModal/compareOpen は揮発 UI 状態のため除外。
      // 実データ時は clinical state を plaintext localStorage に残さない。
      partialize: (state) => ({
        ...(REAL_DATA_ENABLED
          ? {}
          : {
              selId: state.selId,
              sortMode: state.sortMode,
              done: state.done,
              audit: state.audit,
              quantityConfirmedByDid: state.quantityConfirmedByDid,
              actualQuantityInputByDid: state.actualQuantityInputByDid,
              discrepancyReasonByDid: state.discrepancyReasonByDid,
              auditDoubleCountByDid: state.auditDoubleCountByDid,
              setCells: state.setCells,
              auditCells: state.auditCells,
              outChk: state.outChk,
              checks: state.checks,
              ng: state.ng,
              holdInfo: state.holdInfo,
              packet: state.packet,
              model: state.model,
            }),
      }),
      merge: (persisted, current) => {
        if (REAL_DATA_ENABLED) return current;
        return {
          ...current,
          ...(persisted && typeof persisted === 'object' ? persisted : {}),
        };
      },
    },
  ),
);

/**
 * 選択患者のグループ配列をミューテートして新 model を返すヘルパー。
 * 設計プロト updateGroups（L698）相当。グループ/薬剤配列をコピーしてから fn を適用。
 */
function updateGroups(
  state: WorkbenchState,
  fn: (groups: WorkbenchState['model'][string]) => void,
): Partial<WorkbenchState> {
  const id = state.selId;
  const gs = (state.model[id] ?? []).map((g) => ({ ...g, drugs: [...g.drugs] }));
  fn(gs);
  return { model: { ...state.model, [id]: gs } };
}

function replacePatientPrefixedState<T>(
  existing: Record<string, T>,
  patientId: string,
  replacement: Record<string, T>,
): Record<string, T> {
  const prefix = `${patientId}:`;
  const retained = Object.fromEntries(
    Object.entries(existing).filter(([key]) => !key.startsWith(prefix)),
  );
  return { ...retained, ...replacement };
}

function removePatientPrefixedState<T>(
  existing: Record<string, T>,
  patientId: string,
): Record<string, T> {
  const prefix = `${patientId}:`;
  return Object.fromEntries(Object.entries(existing).filter(([key]) => !key.startsWith(prefix)));
}
