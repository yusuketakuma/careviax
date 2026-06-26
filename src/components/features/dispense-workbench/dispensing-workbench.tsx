'use client';

/**
 * 調剤ワークベンチ シェル（入口）— 設計プロト 調剤ワークベンチ.dc.html L21-105 / L457-540 の移植。
 *
 * 役割:
 *  - props { phase }（ルートから注入）。useWorkbenchView(phase) で派生 view を 1 回取得し子へ配分。
 *  - レイアウト: 患者リボン / BODY(左=PatientListPanel・
 *    中央=PhaseHeader + (isGrid:PrescriptionGrid | isCal:MedicationCalendarGrid)・右=RightPane) /
 *    ステータスバー。
 *  - 4 工程は分離された独立画面（/dispense /audit /set /set-audit）。工程切替は
 *    アプリ標準の左メニュー（navigation-config.ts）で行い、workbench 内に独自タブを持たない。
 *    PhaseHeader は現工程のみを静的表示する（他工程への遷移リンクなし）。
 *    物理 F12「次工程へ」は store.primary(phase) がゲート通過時に返す next phase を処理する。
 *  - HoldReasonDialog / PrescriptionCompareDialog をマウント（開閉は view.holdOpen / view.compareOpen）。
 *
 * 状態は useWorkbenchStore（zustand+persist）に集約。子は props { view, phase } を受け取り、
 * 更新は store action を直接呼ぶ（ハンドラを引き回さない＝契約ドリフト防止）。
 *
 * デスクトップ専用（min-width:1540px）。AppShell 配下マウント時は .rootInShell で
 * ヘッダ高 3.5rem を控除（計画 §3 単一変更点）。
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import styles from './dispensing-workbench.module.css';
import { useWorkbenchStore } from './dispensing-workbench.store';
import { useWorkbenchView } from './use-workbench-view';
import { useWorkbenchMutations } from './use-workbench-mutations';
import { useWorkbenchWriteHandlers } from './use-workbench-write-handlers';
import {
  isRealDataEnabled,
  loadWorkbenchPatientRowsAsync,
  loadWorkbenchAsync,
  loadCalendarWriteContextAsync,
  loadSetCalendarForPatientAsync,
} from './dispensing-workbench.adapter';
import { isCalendarPhase } from './dispensing-workbench.types';
import type { FKeyAction, Phase } from './dispensing-workbench.types';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { useOrgId } from '@/lib/hooks/use-org-id';

import { PhaseHeader } from './phase-header';
import { PatientListPanel } from './patient-list-panel';
import { PrescriptionGrid } from './prescription-grid';
import { MedicationCalendarGrid } from './medication-calendar-grid';
import { RightPane } from './right-pane';
import { HoldReasonDialog } from './hold-reason-dialog';
import { PrescriptionCompareDialog } from './prescription-compare-dialog';

/** phase → アプリルートパス（計画 §2 ルートマップ）。 */
const PHASE_ROUTE: Record<Phase, string> = {
  dispense: '/dispense',
  audit: '/audit',
  setp: '/set',
  seta: '/set-audit',
};

/** 時計表記（設計 componentDidMount の setInterval 相当・HH:MM:SS）。 */
function formatClock(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function StatusClock() {
  const [clock, setClock] = useState('');
  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return <>{clock}</>;
}

export interface DispensingWorkbenchProps {
  /** ルートから注入される工程。 */
  phase: Phase;
  /** AppShell（共通ヘッダ）配下にマウントするか。true で .rootInShell（高さ 3.5rem 控除）。 */
  inShell?: boolean;
}

export function DispensingWorkbench({ phase, inShell = true }: DispensingWorkbenchProps) {
  const view = useWorkbenchView(phase);
  const router = useRouter();
  const orgId = useOrgId();

  const navBy = useWorkbenchStore((s) => s.navBy);
  const openHold = useWorkbenchStore((s) => s.openHold);
  const target = useWorkbenchStore((s) => s.target);
  const hydrate = useWorkbenchStore((s) => s.hydrate);
  const setWriteContext = useWorkbenchStore((s) => s.setWriteContext);
  const setCalendarState = useWorkbenchStore((s) => s.setCalendarState);
  const setOperators = useWorkbenchStore((s) => s.setOperators);
  const operators = useWorkbenchStore((s) => s.operators);
  const setLoadError = useWorkbenchStore((s) => s.setLoadError);
  const retryNonce = useWorkbenchStore((s) => s.retryNonce);
  const selId = useWorkbenchStore((s) => s.selId);
  const planId = useWorkbenchStore((s) => s.writeContext.planId);
  // 接続状態は HeaderSyncStatus と同一の useNetworkOnline（新規リアルタイム購読を増やさない）。
  const online = useNetworkOnline();

  // ---- 書込結線（計画 §12 / W3b）----
  // mutation 群（実データ時のみ発火・mock は no-op）とフェーズ別ハンドラを生成し、
  // 子コンポーネントへ props で渡す。既定（モック）ではハンドラ内で store アクションのみを呼び、
  // API は一切叩かない（現行 UI 不変）。実データ時のみ store アクション（楽観更新）+ mutation。
  const mutations = useWorkbenchMutations({ patientId: selId, planId, phase });
  const writeHandlers = useWorkbenchWriteHandlers({
    phase,
    mutations,
    onAdvance: (nextPhase) => router.push(PHASE_ROUTE[nextPhase]),
  });

  // ---- 実データ結線（計画 §14 / 段階1b 読取のみ）----
  // 既定（モック）では isRealDataEnabled()=false でこの effect は no-op。
  // opt-in 時のみ患者リスト + 選択患者の model を取得して hydrate（dispense/audit 読取）。
  // 取得した writeContext（task_id / cycle_id / cycle.version / グループ割当）を store へ充填し、
  // 書込 mutation が API 単位を解決できるようにする。
  // fetch 失敗 / 未認証 / 該当無しは空状態へ倒し、seed/mock 患者を操作可能にしない。
  useEffect(() => {
    if (!isRealDataEnabled()) return;
    if (!orgId) return;
    if (phase !== 'dispense' && phase !== 'audit') return; // set/seta は別 effect
    let cancelled = false;
    void (async () => {
      const { patients, rows, ok } = await loadWorkbenchPatientRowsAsync({ phase, orgId });
      if (cancelled) return;
      if (patients.length === 0) {
        // 取得失敗(!ok)はエラー状態、取得成功・0件は空状態として区別する。
        setLoadError(!ok);
        hydrate({ patients: [] });
        return;
      }
      const targetId = patients.some((p) => p.id === selId) ? selId : patients[0].id;
      // The list is the primary queue. Render it as soon as it succeeds so a slow
      // selected-patient projection cannot masquerade as "0 patients".
      setLoadError(false);
      hydrate({
        patients,
        selId: targetId,
        model: { [targetId]: [] },
        done: {},
        audit: {},
        quantityConfirmedByDid: {},
      });
      const wb = await loadWorkbenchAsync(phase, targetId, { patientRows: rows, orgId });
      if (cancelled) return;
      if (!wb) {
        // リストは取得できたが選択患者の詳細取得に失敗＝障害。
        // 成功済みの患者リストは残し、false-zero へ戻さない。
        setLoadError(true);
        return;
      }
      setLoadError(false);
      hydrate({
        patients,
        selId: targetId,
        model: { [wb.patient.id]: wb.groups },
        done: wb.done,
        audit: wb.audit,
        quantityConfirmedByDid: wb.quantityConfirmedByDid,
      });
      // 書込結線の id 束を store へ充填（mutations hook が読む）。
      setWriteContext(wb.writeContext);
      // status bar 用 operator（実 dispenser 名 / 現操作者名。捏造名は出さない）。
      setOperators(wb.operators);
    })();
    return () => {
      cancelled = true;
    };
    // selId / retryNonce 変更時に選択患者の model を再取得する。phase 変更でも再評価。
  }, [phase, orgId, selId, retryNonce, hydrate, setWriteContext, setOperators, setLoadError]);

  // ---- 実データ結線（カレンダー: set / seta）----
  // 既定（モック）では no-op。opt-in 時は direct /set entry でも cycle_id -> SetPlan -> calendar
  // を解決し、model + set/audit cells + cellMeta を実データ由来に置き換える。
  // 取得失敗時は空状態へ倒し、seed/mock カレンダーを操作可能にしない。
  useEffect(() => {
    if (!isRealDataEnabled()) return;
    if (!orgId) return;
    if (!isCalendarPhase(phase)) return;
    // セット / セット監査はカレンダー由来で operator chrome を持たない。前工程の dispenser/操作者を
    // 残さないよう null へ倒す（status bar は '—'）。
    setOperators({ dispenserName: null, operatorName: null });
    // カレンダー工程では前工程のエラー状態を引き継がない（空/未計画は空状態として扱う）。
    setLoadError(false);
    let cancelled = false;
    void (async () => {
      if (planId) {
        const result = await loadCalendarWriteContextAsync(selId, planId, { orgId });
        if (cancelled) return;
        if (!result) {
          hydrate({ patients: [] });
          return;
        }
        setCalendarState({ patientId: selId, planId, ...result.calendarState });
        setWriteContext(result.writeContext);
        return;
      }

      const result = await loadSetCalendarForPatientAsync(selId, phase, { orgId });
      if (cancelled) return;
      if (!result) {
        hydrate({ patients: [] });
        setLoadError(true);
        return;
      }
      if ('empty' in result) {
        hydrate({ patients: [] });
        setLoadError(false);
        return;
      }
      hydrate({ patients: result.patients, selId: result.selId });
      setCalendarState({
        patientId: result.selId,
        planId: result.writeContext.planId,
        ...result.calendarState,
      });
      setWriteContext(result.writeContext);
    })();
    return () => {
      cancelled = true;
    };
  }, [
    phase,
    orgId,
    selId,
    planId,
    retryNonce,
    hydrate,
    setCalendarState,
    setWriteContext,
    setOperators,
    setLoadError,
  ]);

  // ---- F-key / キーボードアクションの写像 ----
  const runAction = useCallback(
    (action: FKeyAction) => {
      switch (action) {
        case 'prevPatient':
          navBy(-1);
          break;
        case 'nextPatient':
          navBy(1);
          break;
        case 'bulk':
          writeHandlers.onBulk();
          break;
        case 'hold':
          openHold(target);
          break;
        case 'phaseDispense':
          router.push(PHASE_ROUTE.dispense);
          break;
        case 'phaseAudit':
          router.push(PHASE_ROUTE.audit);
          break;
        case 'phaseSet':
          router.push(PHASE_ROUTE.setp);
          break;
        case 'phaseSetAudit':
          router.push(PHASE_ROUTE.seta);
          break;
        case 'next': {
          const nextPhase = writeHandlers.onPrimary();
          if (nextPhase) router.push(PHASE_ROUTE[nextPhase]);
          break;
        }
        default:
          break;
      }
    },
    [navBy, openHold, router, target, writeHandlers],
  );

  // ---- 物理 F-key のバインド（レセコン風キーボード操作・デスクトップ専用）----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 安価な前置ガード（F1〜F12 以外を即除外）してから実装済み F-key を検索。
      if (!e.key.startsWith('F')) return;
      const fk = view.fkeys.find((f) => f.key === e.key);
      if (!fk) return;
      e.preventDefault();
      runAction(fk.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.fkeys, runAction]);

  const cur = view.cur;

  return (
    <div className={`${styles.root} ${inShell ? styles.rootInShell : ''}`}>
      {/* ===== PATIENT RIBBON ===== */}
      <div className={styles.ribbon}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 12px',
            borderRight: '1px solid var(--wb-line)',
          }}
        >
          <div style={{ fontSize: 10.5, color: 'var(--wb-ink-muted)', lineHeight: 1.2 }}>
            患者番号
            <br />
            <span
              className={styles.mono}
              style={{ fontSize: 15, fontWeight: 700, color: 'var(--wb-ink)', letterSpacing: 1 }}
            >
              {cur.no}
            </span>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '5px 14px',
            borderRight: '1px solid var(--wb-line)',
            minWidth: 236,
          }}
        >
          {cur.kana && (
            <div style={{ fontSize: 11, color: 'var(--wb-ink-muted)', letterSpacing: 1 }}>
              {cur.kana}
            </div>
          )}
          <div className={styles.ribbonName}>
            {cur.name}{' '}
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--wb-ink-muted)' }}>様</span>
          </div>
        </div>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            padding: '0 6px',
          }}
        >
          {[
            { label: '生年月日', value: cur.dob },
            { label: '年齢 / 性別', value: cur.ageSex },
            { label: '区分', value: cur.kubun },
            { label: '処方登録日', value: cur.regist },
            { label: 'セット対象期間', value: cur.period },
          ].map((f) => (
            <div
              key={f.label}
              style={{ padding: '5px 14px', display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              <span className={styles.ribbonLabel}>{f.label}</span>
              <span className={styles.ribbonValue}>{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ===== BODY（3 ペイン）===== */}
      <div className={styles.body}>
        {/* 左ペイン */}
        <PatientListPanel view={view} phase={phase} />

        {/* 中央ペイン */}
        <div className={styles.centerPane}>
          <PhaseHeader view={view} phase={phase} />
          {view.isGrid ? (
            <PrescriptionGrid
              view={view}
              phase={phase}
              handlers={writeHandlers}
              isPending={mutations.isAnyPending}
            />
          ) : (
            <MedicationCalendarGrid
              view={view}
              phase={phase}
              handlers={writeHandlers}
              isPending={mutations.isAnyPending}
            />
          )}
        </div>

        {/* 右ペイン */}
        <RightPane
          view={view}
          phase={phase}
          handlers={writeHandlers}
          isPending={mutations.isAnyPending}
        />
      </div>

      {/* ===== STATUS BAR ===== */}
      <div className={styles.statusBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* 調剤者=実記録（dispense_results.dispensed_by）。未取得/カレンダー工程は '—'（捏造名を出さない）。 */}
          <span>調剤者：{operators.dispenserName ?? '—'}</span>
          <span style={{ opacity: 0.55 }}>|</span>
          {/* 操作者=現在ログイン中の閲覧者（API auditor）。記録済み監査者ではないので「監査者：」では出さない。 */}
          <span>操作者：{operators.operatorName ?? '—'}</span>
          <span style={{ opacity: 0.55 }}>|</span>
          <span>
            モード：
            <span style={{ color: 'var(--wb-status-info)', fontWeight: 700 }}>
              {view.phaseLabel}
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* 接続=useNetworkOnline（HeaderSyncStatus と同一）。色だけに依存せずテキスト併用 + aria-label。 */}
          <span aria-label={`接続状態: ${online ? 'オンライン' : 'オフライン'}`}>
            接続：
            <span
              style={{
                color: online ? 'var(--wb-status-online)' : 'var(--wb-status-offline)',
                fontWeight: 700,
              }}
            >
              {online ? 'オンライン' : 'オフライン'}
            </span>
          </span>
          <span className={styles.mono} style={{ letterSpacing: '.5px' }} suppressHydrationWarning>
            <StatusClock />
          </span>
        </div>
      </div>

      {/* ===== MODALS ===== */}
      {view.holdOpen && (
        <HoldReasonDialog
          view={view}
          phase={phase}
          handlers={writeHandlers}
          isPending={mutations.isAnyPending}
        />
      )}
      {view.compareOpen && <PrescriptionCompareDialog view={view} phase={phase} />}
    </div>
  );
}
