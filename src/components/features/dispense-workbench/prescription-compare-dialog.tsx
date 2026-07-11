'use client';

/**
 * 前回処方比較モーダル（設計プロト 調剤ワークベンチ.dc.html L510-538 の忠実移植）
 *
 * 継続 / 新規 / 変更 / 中止 の 4 セクション + ヘッダのカウントを表示する。
 * 背景クリック・「閉じる」で dismiss（store.closeCompare）。
 *
 * 連携規約: props は { view, phase } を受け、状態更新は useWorkbenchStore の
 * action（closeCompare）を直接呼ぶ。view は useWorkbenchView(phase) 由来。
 * 本ダイアログは表示専用で phase 非依存のため phase は受領のみ（出し分けに使わない）。
 *
 * a11y: role="dialog" + aria-modal。Escape で閉じ、開いたら閉じるボタンへフォーカスし、
 * Tab を内部にトラップ、閉じたら起点の比較ボタンへフォーカスを戻す。
 * オーバーレイ素地クリックでのみ dismiss（hold-reason-dialog と同方式に統一）。
 */

import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { Phase, WorkbenchView } from './dispensing-workbench.types';
import styles from './dispensing-workbench.module.css';
import { useWorkbenchStore } from './dispensing-workbench.store';

interface PrescriptionCompareDialogProps {
  view: WorkbenchView;
  /** 受領のみ。本ダイアログは phase 非依存（出し分けなし）*/
  phase: Phase;
}

export function PrescriptionCompareDialog({ view }: PrescriptionCompareDialogProps) {
  const closeCompare = useWorkbenchStore((s) => s.closeCompare);

  const cardRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // 開いたら閉じるボタンへフォーカスし、閉じる際に起点へ戻す。
  // 実ワークベンチでは compareOpen が true の間だけ本コンポーネントをマウントするため、
  // cleanup は Escape / 閉じる / overlay dismiss の全てで実行される。
  useLayoutEffect(() => {
    if (!view.compareOpen) return;

    const activeElement = document.activeElement;
    openerRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : null;
    closeButtonRef.current?.focus();

    return () => {
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [view.compareOpen]);

  useLayoutEffect(() => {
    if (!view.compareOpen) return;

    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeCompare();
    };

    document.addEventListener('keydown', onDocumentKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onDocumentKeyDown, { capture: true });
  }, [closeCompare, view.compareOpen]);

  if (!view.compareOpen) return null;

  const { cur, cmpCount, compareSections } = view;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const card = cardRef.current;
    if (!card) return;
    const focusable = card.querySelectorAll<HTMLElement>(
      '[tabindex]:not([tabindex="-1"]):not([disabled]), input:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.modalOverlay}
      role="presentation"
      onMouseDown={(e) => {
        // オーバーレイ素地クリックでのみ dismiss（カード内ドラッグでの誤閉じを防ぐ）
        if (e.target === e.currentTarget) closeCompare();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`前回処方との比較 — ${cur.name} 様`}
        style={{
          width: 760,
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
        }}
        className={styles.modalCard}
        onKeyDown={onKeyDown}
      >
        {/* ヘッダ（青グラデ・タイトル + カウント） */}
        <div className={styles.modalHeaderCompare}>
          <span>前回処方との比較 — {cur.name} 様</span>
          <span style={{ fontSize: 12, fontWeight: 400, opacity: 0.9 }}>
            継続 {cmpCount.cont} ・ 新規 {cmpCount.neu} ・ 変更 {cmpCount.chg} ・ 中止{' '}
            {cmpCount.disc}
          </span>
        </div>

        {/* 本文（4 セクション・スクロール領域） */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 14px',
            background: 'var(--wb-surface-alt)',
          }}
        >
          {compareSections.map((sec) => (
            <div key={sec.key} style={{ marginBottom: 11 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  marginBottom: 5,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 4,
                    height: 14,
                    background: sec.color,
                    display: 'inline-block',
                    borderRadius: 1,
                  }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: sec.color }}>
                  {sec.title}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {sec.items.map((it, i) => (
                  <div
                    key={`${sec.key}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'var(--wb-surface)',
                      border: '1px solid var(--wb-line)',
                      borderLeft: `3px solid ${sec.color}`,
                      borderRadius: 4,
                      padding: '6px 10px',
                    }}
                  >
                    <span
                      style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--wb-ink)' }}
                    >
                      {it.name}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--wb-ink-muted)' }}>{it.sub}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* フッタ（閉じる） */}
        <div
          style={{
            flex: 'none',
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '10px 14px',
            borderTop: '1px solid var(--wb-line)',
            background: 'var(--wb-surface)',
          }}
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeCompare}
            style={{
              cursor: 'pointer',
              fontSize: 12.5,
              fontWeight: 700,
              color: '#fff',
              background: 'var(--wb-accent)',
              border: '1px solid var(--wb-accent)',
              borderRadius: 6,
              padding: '8px 22px',
              fontFamily: 'inherit',
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
