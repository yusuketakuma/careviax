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

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
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
import type {
  AuditNarcoticLine,
  PendingPrimary,
  PendingSetAuditReject,
} from './dispensing-workbench.write-types';
import { useNetworkOnline } from '@/lib/hooks/use-network-online';
import { useOrgId } from '@/lib/hooks/use-org-id';

import { PhaseHeader } from './phase-header';
import { PatientListPanel } from './patient-list-panel';
import { PrescriptionGrid } from './prescription-grid';
import { MedicationCalendarGrid } from './medication-calendar-grid';
import { RightPane } from './right-pane';
import { HoldReasonDialog } from './hold-reason-dialog';
import { PrescriptionCompareDialog } from './prescription-compare-dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

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

/** 麻薬監査承認 confirm の二重計数明細（麻薬 line のみ・非 PHI 表示）。 */
function NarcoticLineList({ lines }: { lines: AuditNarcoticLine[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
      {lines.map((line) => (
        <li key={line.line_id}>
          {line.drug_name}：調剤数量 {line.dispensed_quantity ?? '—'} ／ 1回目{' '}
          {line.first_count ?? '—'} ／ 2回目 {line.second_count ?? '—'}
        </li>
      ))}
    </ul>
  );
}

interface PrimaryConfirmProps {
  title: string;
  description: string;
  confirmLabel: string;
  requiredConfirmText?: string;
  children?: ReactNode;
}

/**
 * pendingPrimary（不可逆 sign-off）から ConfirmDialog の site 別表示 props を導出する。
 * 対象患者名（patientName）を description 先頭に明示し、不可逆性とあわせて誤確定を抑止する（#3）。
 */
function buildPrimaryConfirm(
  pending: PendingPrimary | null,
  patientName?: string,
): PrimaryConfirmProps {
  if (!pending) {
    return { title: '', description: '', confirmLabel: '確認' };
  }
  // 対象患者の前置（取得経路が無い場合は省略）。誤った患者への確定を視覚的に防ぐ。
  const who = patientName ? `${patientName} 様の` : '';
  if (pending.phase === 'dispense') {
    return {
      title: '調剤を完了します',
      description: `${who}調剤内容を確定し、監査工程へ進みます。確定後は取り消せません。`,
      confirmLabel: '調剤完了',
    };
  }
  if (pending.phase === 'audit') {
    if (pending.narcoticLines.length === 0) {
      return {
        title: '監査を承認します',
        description: `${who}監査を承認し確定します。この操作は取り消せません。`,
        confirmLabel: '監査承認',
      };
    }
    return {
      title: '監査を承認します（麻薬を含む）',
      description: `${who}麻薬 ${pending.narcoticLines.length} 件の二重計数を確認のうえ承認します。確定後は取り消せません。`,
      confirmLabel: '監査承認',
      requiredConfirmText: '麻薬',
      children: <NarcoticLineList lines={pending.narcoticLines} />,
    };
  }
  // seta
  return {
    title: 'セット監査を承認します',
    description: `${who}セット監査を承認し確定します。この操作は取り消せません。`,
    confirmLabel: 'セット監査承認',
  };
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
  // セットバッチ force 再生成の確認ダイアログ開閉（破壊的操作のため二重確認）。
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);

  // 不可逆 sign-off（調剤完了 / 監査承認 / セット監査承認）の確認待ち descriptor。
  // real-data のみ非 null になり ConfirmDialog を開く（zustand へは持たない＝揮発 UI 状態）。
  const [pendingPrimary, setPendingPrimary] = useState<PendingPrimary | null>(null);
  // セット監査 reject（per-cell NG）の確認待ち descriptor。承認と同じく不可逆ゲートを通す（#4）。
  const [pendingReject, setPendingReject] = useState<PendingSetAuditReject | null>(null);
  // 二重確定ラッチ。React state 更新前の double Enter/click で commit が二度発火するのを防ぐ（#5）。
  // 新たな confirm 要求（descriptor 設定）ごとに false へリセットする。
  const commitLatchRef = useRef(false);

  // confirm 要求時にラッチを解除してから descriptor を立てる（次の確定を 1 回だけ通す）。
  // React Compiler 採用のため手動 useCallback は付けない（自動メモ化に委ねる / useRef は可）。
  const requestPrimaryConfirm = (descriptor: PendingPrimary) => {
    commitLatchRef.current = false;
    setPendingPrimary(descriptor);
  };
  const requestRejectConfirm = (descriptor: PendingSetAuditReject) => {
    commitLatchRef.current = false;
    setPendingReject(descriptor);
  };

  // ---- 書込結線（計画 §12 / W3b）----
  // mutation 群（実データ時のみ発火・mock は no-op）とフェーズ別ハンドラを生成し、
  // 子コンポーネントへ props で渡す。既定（モック）ではハンドラ内で store アクションのみを呼び、
  // API は一切叩かない（現行 UI 不変）。実データ時のみ store アクション（楽観更新）+ mutation。
  const mutations = useWorkbenchMutations({ patientId: selId, planId, phase });
  const writeHandlers = useWorkbenchWriteHandlers({
    phase,
    mutations,
    onAdvance: (nextPhase) => router.push(PHASE_ROUTE[nextPhase]),
    onRequestConfirm: requestPrimaryConfirm,
    onRequestRejectConfirm: requestRejectConfirm,
  });

  // pendingPrimary（不可逆 sign-off）から ConfirmDialog の site 別表示 props を導出する。
  // 対象患者名を明示して誤確定を抑止する（#3）。
  const primaryConfirm = buildPrimaryConfirm(pendingPrimary, view.cur.name);

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
        setCalendarState({
          patientId: selId,
          planId,
          generation: result.matrix.generation ?? null,
          ...result.calendarState,
        });
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
        generation: result.matrix.generation ?? null,
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
      // 不可逆 sign-off / reject の確認中は全 F-key を無効化し、患者文脈ドリフト
      // （prevPatient/nextPatient/bulk/hold 含む）と F12 churn を抑止する。
      // mutate 二重発火は request/commit 分割 + ラッチで防ぐが、確認中の操作はここで一括停止する。
      if (pendingPrimary !== null || pendingReject !== null) {
        return;
      }
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
    [navBy, openHold, pendingPrimary, pendingReject, router, target, writeHandlers],
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
              onRequestRegenerate={() => setForceConfirmOpen(true)}
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
          <span
            className={styles.mono}
            style={{ letterSpacing: '.5px' }}
            suppressHydrationWarning
            data-testid="wb-status-clock"
          >
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
      <ConfirmDialog
        open={forceConfirmOpen}
        onOpenChange={setForceConfirmOpen}
        variant="destructive"
        title="セットバッチを再生成"
        description="既存のセットを削除して作り直します。確定済みのセット状態・監査状態は失われ、この操作は取り消せません。"
        requiredConfirmText="再生成"
        confirmLabel="再生成する"
        onConfirm={() => writeHandlers.onGenerateBatches(true)}
      />

      {/* 不可逆 sign-off（調剤完了 / 監査承認 / セット監査承認）の確認ゲート。
          real-data の onPrimary が request 段で pendingPrimary を立て、ここで確認後に
          commitPrimary が初めて mutation を発火する（楽観更新の前段に挿入）。 */}
      <ConfirmDialog
        open={pendingPrimary !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPrimary(null);
        }}
        variant="destructive"
        title={primaryConfirm.title}
        description={primaryConfirm.description}
        confirmLabel={primaryConfirm.confirmLabel}
        requiredConfirmText={primaryConfirm.requiredConfirmText}
        autoFocusConfirm
        onConfirm={() => {
          // 二重確定ラッチ: state 反映前の double Enter/click でも mutate を 1 回に固定する（#5）。
          if (commitLatchRef.current) return;
          if (!pendingPrimary) return;
          commitLatchRef.current = true;
          writeHandlers.commitPrimary(pendingPrimary);
        }}
      >
        {primaryConfirm.children}
      </ConfirmDialog>

      {/* セット監査 reject（per-cell NG）の不可逆確認ゲート。承認と同様 request 段で pendingReject を
          立て、確認後に commitSetAuditReject が初めて rejected を post する（#4）。 */}
      <ConfirmDialog
        open={pendingReject !== null}
        onOpenChange={(open) => {
          if (!open) setPendingReject(null);
        }}
        variant="destructive"
        title="セット監査を差戻します（NG）"
        description="このセルをNGとして差戻し、対象計画を保留に遷移します。確定後は取り消せません。"
        confirmLabel="差戻す"
        autoFocusConfirm
        onConfirm={() => {
          // 二重確定ラッチ（#5）。
          if (commitLatchRef.current) return;
          if (!pendingReject) return;
          commitLatchRef.current = true;
          writeHandlers.commitSetAuditReject(pendingReject);
        }}
      />
    </div>
  );
}
