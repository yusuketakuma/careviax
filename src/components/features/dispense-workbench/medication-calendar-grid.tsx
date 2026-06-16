'use client';

/**
 * 中央カレンダー格子（phase = setp | seta）。
 *
 * 設計プロト「調剤ワークベンチ.dc.html」L224-296 の CALENDAR PHASES ブロックを忠実移植する。
 * 上から: 処方差分ファースト帯（今回の処方変更点）→ attention 帯（setChips）→
 * 7日 × 用法時点の格子（セル = 包数 / PTP バッジ / 状態 / 選択枠）→ 凡例 →
 * 作業証跡写真枠 → フッタ（進捗 + 完了ゲート + 一括 + 主操作）。
 *
 * 設計の calendar 部分は専用 CSS クラスを持たず全てインライン style のため、
 * 本コンポーネントも module.css に追加せずインライン style で寸法・配色を再現する
 * （grid 側コンポーネントと同一方針）。状態更新は連携規約どおり store の action を直接呼ぶ。
 */

import type { CSSProperties, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

import { useWorkbenchStore } from './dispensing-workbench.store';
import type { CalendarCell, Phase, WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

interface MedicationCalendarGridProps {
  view: WorkbenchView;
  phase: Phase;
  handlers?: WorkbenchWriteHandlers;
  isPending?: boolean;
}

/**
 * phase → アプリルートパス（シェル dispensing-workbench.tsx の PHASE_ROUTE と同一マップ）。
 * store.primary はゲート通過時に次 phase を返すのみ（ルート遷移は呼び出し側責務）。
 * フッタ主操作ボタンはシェルの F12「次工程へ」ハンドラと同方式でここから遷移を発火する。
 */
const PHASE_ROUTE: Record<Phase, string> = {
  dispense: '/dispense',
  audit: '/audit',
  setp: '/set',
  seta: '/set-audit',
};

/** クリック可能要素を Enter / Space でも発火させる（擬似ボタンの a11y 補助） */
function activateOnKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

export function MedicationCalendarGrid({
  view,
  phase,
  handlers,
  isPending,
}: MedicationCalendarGridProps) {
  const router = useRouter();
  // 書込操作はシェル handlers（store + 実データ mutation）を優先し、未提供時のみ store へフォールバック。
  const storeSelectCell = useWorkbenchStore((s) => s.selectCell);
  const storeBulk = useWorkbenchStore((s) => s.bulk);
  const storePrimary = useWorkbenchStore((s) => s.primary);

  const selectCell = (di: number, tk: string) =>
    handlers ? handlers.onSelectCell(di, tk) : storeSelectCell(di, tk);
  const bulk = () => (handlers ? handlers.onBulk() : storeBulk(phase));

  const { progress, gate, primary: primaryBtn, bulkLabel } = view;
  const gateBlocked = !gate.ok;

  // 主操作（次工程へ）。primary はゲート通過時のみ次 phase を返す（NG 時は null で副作用なし）。
  // handlers 経由なら確定書込（セット監査承認）も発火する。遷移責務は呼び出し側が担うため、
  // 返った次 phase のルートへ遷移する（シェルの F12「次工程へ」ハンドラと同方式）。
  const handlePrimary = () => {
    const next = handlers ? handlers.onPrimary() : storePrimary(phase);
    if (next) router.push(PHASE_ROUTE[next]);
  };

  // 主操作ボタン: gate NG 時は cursor='not-allowed' / opacity='.7' / 灰背景（view 由来）で disable 表現。
  const primaryButtonStyle: CSSProperties = {
    cursor: primaryBtn.cursor,
    fontSize: 12.5,
    fontWeight: 700,
    color: '#fff',
    background: primaryBtn.bg,
    border: `1px solid ${primaryBtn.border}`,
    borderRadius: 5,
    padding: '6px 18px',
    boxShadow: '0 1px 0 rgba(0,0,0,.12)',
    whiteSpace: 'nowrap',
    opacity: primaryBtn.opacity,
    font: 'inherit',
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* ===== 処方差分ファースト（今回の処方変更点）===== */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 10px',
          background: '#fff7ef',
          borderBottom: '1px solid #f0dcc4',
        }}
      >
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: '#9a4a18',
            whiteSpace: 'nowrap',
          }}
        >
          ▍今回の処方変更点
        </span>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            flexWrap: 'wrap',
          }}
        >
          {view.changes.map((ch, i) => (
            <span
              key={`${ch.type}-${ch.text}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                color: '#37475c',
                background: '#fff',
                border: '1px solid #e6d6c2',
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: '#fff',
                  background: ch.color,
                  borderRadius: 3,
                  padding: '1px 6px',
                }}
              >
                {ch.type}
              </span>
              {ch.text}
            </span>
          ))}
          {view.changesEmpty && (
            <span style={{ fontSize: 11, color: '#7a8a9c' }}>今回変更なし（前回と同一処方）</span>
          )}
        </div>
      </div>

      {/* ===== attention 帯（セット注意 / 監査リスク）===== */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 10px',
          background: view.calBarBg,
          borderBottom: '1px solid #d7dde4',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11, color: '#5a6878', fontWeight: 700 }}>{view.calBarTitle}</span>
        {view.setChips.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 700,
              color: c.color,
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: 12,
              padding: '2px 10px',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{ width: 6, height: 6, borderRadius: '50%', background: c.color }}
              aria-hidden="true"
            />
            {c.label}
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#3a5170', fontWeight: 700, whiteSpace: 'nowrap' }}>
          {view.calBarMeta}
        </span>
      </div>

      {/* ===== スクロール領域: 日付ヘッダ + 格子 + 凡例 + 写真枠 ===== */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '10px 10px 4px 10px' }}>
        <div style={{ minWidth: 760 }}>
          {/* 日付ヘッダ行 */}
          <div style={{ display: 'flex', alignItems: 'stretch' }}>
            <div style={{ width: 86, flex: 'none' }} />
            {view.calDays.map((d, i) => (
              <div
                key={`${d.d}-${i}`}
                style={{
                  flex: 1,
                  minWidth: 88,
                  textAlign: 'center',
                  padding: '4px 0',
                  fontSize: 12,
                  fontWeight: 700,
                  color: d.color,
                  background: d.bg,
                  border: '1px solid #cfd7e0',
                  borderBottom: 'none',
                  borderRadius: '5px 5px 0 0',
                  margin: '0 1px',
                }}
              >
                {d.d}
                <span style={{ fontSize: 10.5, marginLeft: 3 }}>（{d.w}）</span>
              </div>
            ))}
          </div>

          {/* 用法時点 × 7日 セル格子 */}
          {view.calRows.map((row, ri) => (
            <div
              key={`${row.label}-${ri}`}
              style={{ display: 'flex', alignItems: 'stretch', marginTop: 2 }}
            >
              <div
                style={{
                  width: 86,
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#274268',
                  background: '#e7edf4',
                  border: '1px solid #cfd7e0',
                  borderRadius: 5,
                  marginRight: 1,
                }}
              >
                {row.label}
              </div>
              {row.cells.map((c) => (
                <CalendarCellView
                  key={`${c.di}-${c.tk}`}
                  cell={c}
                  onSelect={() => selectCell(c.di, c.tk)}
                />
              ))}
            </div>
          ))}

          {/* 凡例 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              marginTop: 10,
              fontSize: 10.5,
              color: '#5a6878',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontWeight: 700 }}>凡例：</span>
            {view.calLegend.map((l, i) => (
              <span
                key={`${l.label}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <span
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 3,
                    background: l.bg,
                    border: `1px solid ${l.bd}`,
                    display: 'inline-block',
                  }}
                  aria-hidden="true"
                />
                {l.label}
              </span>
            ))}
          </div>

          {/* 作業証跡写真枠 */}
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: '#46566a',
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <span
                style={{
                  width: 4,
                  height: 12,
                  background: '#5a7ba6',
                  display: 'inline-block',
                  borderRadius: 1,
                }}
                aria-hidden="true"
              />
              {view.photoTitle}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {view.photos.map((ph, i) => (
                <div
                  key={`${ph}-${i}`}
                  style={{
                    width: 150,
                    height: 96,
                    border: '1.5px dashed #b9c2cc',
                    borderRadius: 6,
                    background:
                      'repeating-linear-gradient(135deg,#f3f5f7,#f3f5f7 7px,#eaedf1 7px,#eaedf1 14px)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    color: '#8895a4',
                  }}
                >
                  <span style={{ fontSize: 18 }} aria-hidden="true">
                    ▣
                  </span>
                  <span style={{ fontSize: 10, fontFamily: 'Consolas, monospace' }}>{ph}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ===== フッタ（進捗 + ゲート + 一括 + 主操作）===== */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 12px',
          background: '#eef1f5',
          borderTop: '1px solid #c6ccd4',
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#243040', whiteSpace: 'nowrap' }}>
          {progress.label}
        </div>
        <div
          style={{
            flex: 'none',
            width: 170,
            height: 11,
            borderRadius: 6,
            background: '#d3dae2',
            overflow: 'hidden',
            border: '1px solid #c0c8d1',
          }}
          role="progressbar"
          aria-valuenow={parseInt(progress.pct, 10)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${progress.label} ${progress.fraction}`}
        >
          <div
            style={{
              height: '100%',
              width: progress.pct,
              background: progress.color,
              borderRadius: 6,
              transition: 'width .25s',
            }}
          />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: progress.color }}>
          {progress.fraction}
        </div>
        {/* 完了ゲート表示（カレンダー工程のみ）。色だけに依存しないテキスト付き */}
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: gate.color,
            background: gate.bg,
            border: `1px solid ${gate.border}`,
            borderRadius: 4,
            padding: '4px 9px',
            whiteSpace: 'nowrap',
          }}
        >
          {gate.text}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={() => bulk()}
          disabled={isPending}
          style={{
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            color: '#2a4a72',
            background: '#fff',
            border: '1px solid #9db4d2',
            borderRadius: 5,
            padding: '6px 14px',
            whiteSpace: 'nowrap',
            font: 'inherit',
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {bulkLabel}
        </button>
        {/* 設計プロト L293 は native disable せず cursor='not-allowed'/opacity='.7' の視覚表現のみ。
            ゲート NG 時は store.primary が null を返し副作用が無いため onClick は無害。
            フォーカス可能性を保つため disabled は付与せず aria-disabled のみ残す。 */}
        <button
          type="button"
          onClick={handlePrimary}
          aria-disabled={gateBlocked}
          style={primaryButtonStyle}
        >
          {primaryBtn.label}
        </button>
      </div>
    </div>
  );
}

interface CalendarCellViewProps {
  cell: CalendarCell;
  onSelect: () => void;
}

/** 単一カレンダーセル（包数 / 状態マーク / 追加PTP バッジ / 状態ラベル）。クリックで選択。 */
function CalendarCellView({ cell, onSelect }: CalendarCellViewProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={cell.selected}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
      title={cell.title}
      style={{
        flex: 1,
        minWidth: 88,
        minHeight: 62,
        margin: 1,
        border: cell.border,
        borderRadius: 5,
        background: cell.bg,
        cursor: 'pointer',
        padding: '5px 6px',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: cell.packetColor }}>
          {cell.packetText}
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: cell.markColor }} aria-hidden="true">
          {cell.mark}
        </span>
      </div>
      {cell.hasPtp && (
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: '#1d6fb8',
            background: '#e6f0fb',
            borderRadius: 3,
            padding: '1px 4px',
            alignSelf: 'flex-start',
          }}
        >
          {cell.ptpText}
        </span>
      )}
      <span style={{ fontSize: 9.5, color: cell.stateColor, fontWeight: 700 }}>
        {cell.stateLabel}
      </span>
    </div>
  );
}

export default MedicationCalendarGrid;
