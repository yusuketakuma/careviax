'use client';

/**
 * 保留理由モーダル（設計プロト 調剤ワークベンチ.dc.html L480-508 の忠実移植）
 *
 * セル保留時に開く。保留理由7種ラジオ（必須）／期限 date／担当 text／メモ textarea を編集し、
 * 「保留登録」で確定する。理由未選択時は登録ボタンを無効化する（view.holdReady / view.holdSave）。
 *
 * 連携規約に従い props は { view, phase } のみ。状態更新は useWorkbenchStore の
 * setHoldField / cancelHold / saveHold を直接呼ぶ。配色・寸法・余白は設計プロトの実値を厳守し、
 * CSS Module クラス（.modalOverlay / .modalCard / .modalHeaderHold）＋ inline style で再現する。
 *
 * a11y: role="dialog" + aria-modal、ラジオは role="radiogroup"/role="radio" でキーボード可、
 * Escape でキャンセル、開いたら最初の理由へフォーカス、Tab を内部にトラップ。
 */

import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';

import { useWorkbenchStore } from './dispensing-workbench.store';
import styles from './dispensing-workbench.module.css';
import type { Phase, WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

interface HoldReasonDialogProps {
  view: WorkbenchView;
  phase: Phase;
  handlers?: WorkbenchWriteHandlers;
  isPending?: boolean;
}

/** モーダル本体カードの寸法（設計 L482: width:420px）*/
const CARD_STYLE: CSSProperties = { width: 420 };

/** 入力欄共通スタイル（設計 L497-500）*/
const FIELD_INPUT_STYLE: CSSProperties = {
  width: '100%',
  fontSize: 12,
  border: '1px solid var(--wb-line)',
  borderRadius: 5,
  padding: '5px 7px',
  color: 'var(--wb-ink)',
};

const FIELD_LABEL_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--wb-ink-muted)',
  fontWeight: 700,
  marginBottom: 3,
};

export function HoldReasonDialog({ view, phase, handlers }: HoldReasonDialogProps) {
  // setHoldField / cancelHold は UI 内ドラフト操作（書込なし）のため store 直結のまま。
  // 確定（保存）はシェル handlers（store.saveHold + 実データ createHold mutation）を優先し、
  // 未提供時のみ store へフォールバック。
  const setHoldField = useWorkbenchStore((s) => s.setHoldField);
  const cancelHold = useWorkbenchStore((s) => s.cancelHold);
  const storeSaveHold = useWorkbenchStore((s) => s.saveHold);

  const cardRef = useRef<HTMLDivElement>(null);
  const firstReasonRef = useRef<HTMLDivElement>(null);

  const onCancel = useCallback(() => cancelHold(), [cancelHold]);
  const onSave = useCallback(() => {
    if (!view.holdReady) return;
    if (handlers) handlers.onSaveHold();
    else storeSaveHold(phase);
  }, [view.holdReady, handlers, storeSaveHold, phase]);

  // 開いたら最初の保留理由へフォーカス（キーボード操作の起点を明示）
  useEffect(() => {
    if (view.holdOpen) firstReasonRef.current?.focus();
  }, [view.holdOpen]);

  // Escape でキャンセル + Tab を内部にトラップ（aria-modal の挙動を補完）
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      const focusable = card.querySelectorAll<HTMLElement>(
        '[tabindex]:not([tabindex="-1"]):not([disabled]), input:not([disabled]), textarea:not([disabled]), button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onCancel],
  );

  if (!view.holdOpen) return null;

  // 設計プロト L481 のホールドモーダルはオーバーレイ素地クリックで閉じない
  // （onClick が付くのは compare モーダル L512 のみ）。保留理由は必須入力のため、
  // 編集中の素地クリックでドラフトを破棄しない（CLAUDE.md「入力中の離脱防止」）。
  // クローズは Escape とキャンセルボタンに限定する。
  return (
    <div className={styles.modalOverlay}>
      <div
        ref={cardRef}
        className={styles.modalCard}
        style={CARD_STYLE}
        role="dialog"
        aria-modal="true"
        aria-label={`保留理由の登録${view.holdCellLabel ? ` ${view.holdCellLabel}` : ''}`}
        onKeyDown={onKeyDown}
      >
        {/* ヘッダ（橙グラデ・設計 L483-485）*/}
        <div className={styles.modalHeaderHold}>
          <span>保留理由の登録</span>
          <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.9 }}>{view.holdCellLabel}</span>
        </div>

        {/* 本体（設計 L486-505: padding:13px 15px）*/}
        <div style={{ padding: '13px 15px' }}>
          {/* 保留理由（必須）ラジオ群 */}
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: 'var(--wb-ink-muted)',
              marginBottom: 6,
            }}
            id="hold-reason-legend"
          >
            保留理由（必須）
          </div>
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
            role="radiogroup"
            aria-labelledby="hold-reason-legend"
            aria-required="true"
          >
            {view.holdReasons.map((hr, i) => {
              // 設計 L1058 と同値の選択色を selected から導出
              const border = hr.selected ? 'var(--wb-state-confirm)' : 'var(--wb-line)';
              const bg = hr.selected ? 'var(--wb-confirm-bg-pale)' : 'var(--wb-surface)';
              const dotBorder = hr.selected ? 'var(--wb-state-confirm)' : 'var(--wb-line)';
              const dotBg = hr.selected ? 'var(--wb-state-confirm)' : 'var(--wb-surface)';
              const selectReason = () => setHoldField('reason', hr.label);
              return (
                <div
                  key={hr.label}
                  ref={i === 0 ? firstReasonRef : undefined}
                  role="radio"
                  aria-checked={hr.selected}
                  tabIndex={0}
                  onClick={selectReason}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      selectReason();
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 10px',
                    border: `1.5px solid ${border}`,
                    background: bg,
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 15,
                      height: 15,
                      flex: 'none',
                      borderRadius: '50%',
                      border: `1.5px solid ${dotBorder}`,
                      background: dotBg,
                    }}
                  />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--wb-ink)' }}>
                    {hr.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* 期限 / 担当（設計 L496-499）*/}
          <div style={{ display: 'flex', gap: 10, marginTop: 11 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="hold-due" style={FIELD_LABEL_STYLE}>
                期限
              </label>
              <input
                id="hold-due"
                type="date"
                value={view.holdDue}
                onChange={(e) => setHoldField('due', e.target.value)}
                style={FIELD_INPUT_STYLE}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label htmlFor="hold-owner" style={FIELD_LABEL_STYLE}>
                担当
              </label>
              <input
                id="hold-owner"
                type="text"
                value={view.holdOwner}
                onChange={(e) => setHoldField('owner', e.target.value)}
                placeholder="担当者名"
                style={FIELD_INPUT_STYLE}
              />
            </div>
          </div>

          {/* メモ（設計 L500）*/}
          <div style={{ marginTop: 9 }}>
            <label htmlFor="hold-memo" style={FIELD_LABEL_STYLE}>
              メモ
            </label>
            <textarea
              id="hold-memo"
              value={view.holdMemo}
              onChange={(e) => setHoldField('memo', e.target.value)}
              placeholder="補足・連絡事項"
              style={{ ...FIELD_INPUT_STYLE, height: 54, padding: '6px 8px', resize: 'none' }}
            />
          </div>

          {/* アクション（設計 L501-504）*/}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 13 }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                cursor: 'pointer',
                fontSize: 12.5,
                fontWeight: 700,
                color: 'var(--wb-ink-muted)',
                background: 'var(--wb-surface-muted)',
                border: '1px solid var(--wb-line)',
                borderRadius: 6,
                padding: '8px 18px',
                fontFamily: 'inherit',
              }}
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!view.holdReady}
              aria-disabled={!view.holdReady}
              style={{
                cursor: view.holdSave.cursor,
                fontSize: 12.5,
                fontWeight: 700,
                color: '#fff',
                background: view.holdSave.bg,
                border: `1px solid ${view.holdSave.border}`,
                borderRadius: 6,
                padding: '8px 20px',
                opacity: Number(view.holdSave.opacity),
                fontFamily: 'inherit',
              }}
            >
              保留登録
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
