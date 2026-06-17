'use client';

/**
 * 調剤ワークベンチ シェル（入口）— 設計プロト 調剤ワークベンチ.dc.html L21-105 / L457-540 の移植。
 *
 * 役割:
 *  - props { phase }（ルートから注入）。useWorkbenchView(phase) で派生 view を 1 回取得し子へ配分。
 *  - レイアウト: タイトルバー / メニューバー / 患者リボン / BODY(左=PatientListPanel・
 *    中央=PhaseTabs + (isGrid:PrescriptionGrid | isCal:MedicationCalendarGrid)・右=RightPane) /
 *    F1〜F12 バー / ステータスバー。
 *  - F8〜F11・フェーズタブは 4 ルート（/dispense /audit /set /set-audit）へ遷移。
 *    F12「次工程へ」は store.primary(phase) がゲート通過時に返す次 phase のルートへ router.push。
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
  loadPatientsAsync,
  loadWorkbenchAsync,
  loadCalendarWriteContextAsync,
  loadSetCalendarForPatientAsync,
} from './dispensing-workbench.adapter';
import { isCalendarPhase } from './dispensing-workbench.types';
import type { FKeyAction, Phase } from './dispensing-workbench.types';

import { PhaseTabs } from './phase-tabs';
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

/** メニューバー項目（設計 L42-49・固定表示）。 */
const MENU_ITEMS = [
  '患者(P)',
  '調剤(C)',
  '監査(K)',
  'セット(S)',
  'マスタ(M)',
  '印刷(R)',
  '設定',
  'ヘルプ(H)',
] as const;
/** 現 phase に応じてハイライトするメニュー（調剤系=調剤(C) / 監査系=監査(K) / セット系=セット(S)）。 */
function activeMenu(phase: Phase): string {
  if (phase === 'dispense') return '調剤(C)';
  if (phase === 'audit') return '監査(K)';
  return 'セット(S)';
}

/** 時計表記（設計 componentDidMount の setInterval 相当・HH:MM:SS）。 */
function formatClock(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
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

  const navBy = useWorkbenchStore((s) => s.navBy);
  const openHold = useWorkbenchStore((s) => s.openHold);
  const target = useWorkbenchStore((s) => s.target);
  const hydrate = useWorkbenchStore((s) => s.hydrate);
  const setWriteContext = useWorkbenchStore((s) => s.setWriteContext);
  const setCalendarState = useWorkbenchStore((s) => s.setCalendarState);
  const selId = useWorkbenchStore((s) => s.selId);
  const planId = useWorkbenchStore((s) => s.writeContext.planId);

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
    if (phase !== 'dispense' && phase !== 'audit') return; // set/seta は別 effect
    let cancelled = false;
    void (async () => {
      const patients = await loadPatientsAsync();
      if (cancelled) return;
      if (patients.length === 0) {
        hydrate({ patients: [] });
        return;
      }
      const targetId = patients.some((p) => p.id === selId) ? selId : patients[0].id;
      const wb = await loadWorkbenchAsync(phase, targetId);
      if (cancelled) return;
      if (!wb) {
        hydrate({ patients: [] });
        return;
      }
      hydrate({
        patients,
        selId: targetId,
        model: { [wb.patient.id]: wb.groups },
      });
      // 書込結線の id 束を store へ充填（mutations hook が読む）。
      setWriteContext(wb.writeContext);
    })();
    return () => {
      cancelled = true;
    };
    // selId 変更時に選択患者の model を再取得する。phase 変更でも再評価。
  }, [phase, selId, hydrate, setWriteContext]);

  // ---- 実データ結線（カレンダー: set / seta）----
  // 既定（モック）では no-op。opt-in 時は direct /set entry でも cycle_id -> SetPlan -> calendar
  // を解決し、model + set/audit cells + cellMeta を実データ由来に置き換える。
  // 取得失敗時は空状態へ倒し、seed/mock カレンダーを操作可能にしない。
  useEffect(() => {
    if (!isRealDataEnabled()) return;
    if (!isCalendarPhase(phase)) return;
    let cancelled = false;
    void (async () => {
      if (planId) {
        const result = await loadCalendarWriteContextAsync(selId, planId);
        if (cancelled) return;
        if (!result) {
          hydrate({ patients: [] });
          return;
        }
        setCalendarState({ patientId: selId, ...result.calendarState });
        setWriteContext(result.writeContext);
        return;
      }

      const result = await loadSetCalendarForPatientAsync(selId);
      if (cancelled) return;
      if (!result) {
        hydrate({ patients: [] });
        return;
      }
      hydrate({ patients: result.patients, selId: result.selId });
      setCalendarState({ patientId: result.selId, ...result.calendarState });
      setWriteContext(result.writeContext);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, selId, planId, hydrate, setCalendarState, setWriteContext]);

  // ---- ステータスバー時計（1 秒更新）。SSR/CSR の hydration mismatch を避けるためマウント後に開始 ----
  const [clock, setClock] = useState('');
  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
        // help / searchPatient / photo は段階1では未実装（モック）。表示は維持。
        case 'help':
        case 'searchPatient':
        case 'photo':
        default:
          break;
      }
    },
    [navBy, openHold, router, target, writeHandlers],
  );

  // ---- 物理 F1〜F12 キーのバインド（レセコン風キーボード操作・デスクトップ専用）----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 安価な前置ガード（F1〜F12 以外を即除外）してから実在 F-key を検索。
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
  const menuActive = activeMenu(phase);

  return (
    <div className={`${styles.root} ${inShell ? styles.rootInShell : ''}`}>
      {/* ===== TITLE BAR ===== */}
      <div className={styles.titleBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className={styles.titleIcon}>調</div>
          <span style={{ fontWeight: 700, letterSpacing: '.5px' }}>ファーマ在宅 調剤システム</span>
          <span style={{ opacity: 0.7 }}>— 一包化・調剤・お薬カレンダー</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ opacity: 0.78, fontSize: 11 }}>Ver 4.3 / みやま中央薬局</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#f6c453' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#8fd07a' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#e87a6b' }} />
          </div>
        </div>
      </div>

      {/* ===== MENU BAR ===== */}
      <nav className={styles.menuBar} aria-label="メインメニュー">
        {MENU_ITEMS.map((item) => (
          <span
            key={item}
            className={`${styles.menuItem} ${item === menuActive ? styles.menuItemActive : ''}`}
          >
            {item}
          </span>
        ))}
      </nav>

      {/* ===== PATIENT RIBBON ===== */}
      <div className={styles.ribbon}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 12px',
            borderRight: '1px solid #b6cbe5',
          }}
        >
          <div style={{ fontSize: 10.5, color: '#3f5878', lineHeight: 1.2 }}>
            患者番号
            <br />
            <span
              className={styles.mono}
              style={{ fontSize: 15, fontWeight: 700, color: '#15355c', letterSpacing: 1 }}
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
            borderRight: '1px solid #b6cbe5',
            minWidth: 236,
          }}
        >
          {cur.kana && (
            <div style={{ fontSize: 11, color: '#3f5878', letterSpacing: 1 }}>{cur.kana}</div>
          )}
          <div className={styles.ribbonName}>
            {cur.name} <span style={{ fontSize: 12, fontWeight: 400, color: '#43597a' }}>様</span>
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
          <PhaseTabs view={view} phase={phase} />
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

      {/* ===== FUNCTION KEYS ===== */}
      <div className={styles.fkeyBar}>
        {view.fkeys.map((f) => (
          <button
            key={f.key}
            type="button"
            className={styles.fkey}
            onClick={() => runAction(f.action)}
            aria-label={`${f.key} ${f.label}`}
          >
            <span
              className={styles.mono}
              style={{ fontSize: 9.5, fontWeight: 700, color: f.keyColor }}
            >
              {f.key}
            </span>
            <span
              style={{ fontSize: 11, fontWeight: 700, color: f.labelColor, whiteSpace: 'nowrap' }}
            >
              {f.label}
            </span>
          </button>
        ))}
      </div>

      {/* ===== STATUS BAR ===== */}
      <div className={styles.statusBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span>調剤者：山田 花子（薬剤師）</span>
          <span style={{ opacity: 0.55 }}>|</span>
          <span>監査者：佐々木 健（管理薬剤師）</span>
          <span style={{ opacity: 0.55 }}>|</span>
          <span>
            モード：<span style={{ color: '#9fd3ff', fontWeight: 700 }}>{view.phaseLabel}</span>
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span>
            接続：<span style={{ color: '#8fe39a' }}>オンライン</span>
          </span>
          <span className={styles.mono} style={{ letterSpacing: '.5px' }} suppressHydrationWarning>
            {clock}
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
