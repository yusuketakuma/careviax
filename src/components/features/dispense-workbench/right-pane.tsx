'use client';

/**
 * 調剤ワークベンチ 右ペイン（300px・設計プロト L300-453 の忠実移植）
 *
 * 3 バリアント:
 *  - isGrid（調剤 / 調剤監査）: 患者情報（アバター / infoItems / chips / 備考・申し送り）
 *  - isSet（セット）: 次にセットする薬剤 / セット方法 / 4 ステップ / カレンダー外薬同梱 /
 *    訪問持出パケット完成判定
 *  - isSeta（セット監査）: 期待値 / 確認 6 項目 / 監査OK・NG・保留 / NG 分類 select /
 *    差戻し / リスク確認順
 *
 * 連携規約: props は { view, phase } のみ。状態更新は useWorkbenchStore のアクションを直接呼ぶ。
 * 設計プロトはペイン内をすべてインラインスタイルで構成しているため（CSS Module は .rightPane の
 * コンテナのみを保持）、配色・寸法・余白を実値どおりインラインで忠実再現する。
 */

import type { CSSProperties } from 'react';

import styles from './dispensing-workbench.module.css';
import { useWorkbenchStore } from './dispensing-workbench.store';
import type { Phase, WorkbenchView } from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

interface RightPaneProps {
  view: WorkbenchView;
  phase: Phase;
  handlers?: WorkbenchWriteHandlers;
  isPending?: boolean;
}

/** チェックボックスの見た目（checked → 色つき / 未 → 白＋灰枠）*/
interface CheckboxLook {
  bg: string;
  border: string;
  mark: string;
}

/** セクション見出し（左に色付き縦バー）*/
function SectionHeading({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        fontSize: '11.5px',
        fontWeight: 700,
        color: '#46566a',
        marginBottom: '5px',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '4px',
          height: '12px',
          background: color,
          display: 'inline-block',
          borderRadius: '1px',
        }}
      />
      {label}
    </div>
  );
}

/** 角丸チェックボックスの見た目（a11y のためアイコン＋aria で状態を表す）*/
function CheckBox({ look, size = 17 }: { look: CheckboxLook; size?: number }) {
  return (
    <div
      aria-hidden
      style={{
        width: `${size}px`,
        height: `${size}px`,
        flex: 'none',
        borderRadius: '4px',
        border: `1.5px solid ${look.border}`,
        background: look.bg,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size >= 17 ? '12px' : '11px',
        fontWeight: 800,
      }}
    >
      {look.mark}
    </div>
  );
}

function look(checked: boolean, onColor: string): CheckboxLook {
  return checked
    ? { bg: onColor, border: onColor, mark: '✓' }
    : { bg: '#fff', border: '#9aa8b8', mark: '' };
}

export function RightPane({ view, phase, handlers, isPending }: RightPaneProps) {
  return (
    <div className={styles.rightPane}>
      <div
        style={{
          flex: 'none',
          height: '24px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          background: 'linear-gradient(180deg,#3a5e8c,#27466c)',
          color: '#fff',
          fontSize: '12px',
          fontWeight: 700,
          letterSpacing: '.5px',
        }}
      >
        {view.rightTitle}
      </div>

      {view.isGrid && <GridInfo view={view} />}
      {view.isSet && (
        <SetWork view={view} phase={phase} handlers={handlers} isPending={isPending} />
      )}
      {view.isSeta && (
        <SetAudit view={view} phase={phase} handlers={handlers} isPending={isPending} />
      )}
    </div>
  );
}

/* ============================================================================
 * isGrid: 患者情報
 * ========================================================================== */

function GridInfo({ view }: { view: WorkbenchView }) {
  const { cur, infoItems } = view;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* アバター + 氏名 + フリガナ */}
      <div
        style={{
          flex: 'none',
          padding: '9px 11px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          borderBottom: '1px solid #d8dde3',
          background: '#fff',
        }}
      >
        <div
          aria-hidden
          style={{
            width: '42px',
            height: '42px',
            borderRadius: '7px',
            background: cur.avatarBg,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '18px',
            fontWeight: 700,
          }}
        >
          {cur.initial}
        </div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#16263a' }}>{cur.name}</div>
          <div style={{ fontSize: '11px', color: '#69788c' }}>{cur.kana}</div>
        </div>
      </div>

      {/* 患者情報行 */}
      <div style={{ flex: 'none', padding: '6px 11px', borderBottom: '1px solid #d8dde3' }}>
        {infoItems.map((it) => (
          <div
            key={it.label}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '3px 0',
              borderBottom: '1px dotted #e1e5ea',
            }}
          >
            <span style={{ width: '96px', flex: 'none', fontSize: '11px', color: '#69788c' }}>
              {it.label}
            </span>
            <span style={{ flex: 1, fontSize: '12px', fontWeight: 700, color: '#22344a' }}>
              {it.value}
            </span>
          </div>
        ))}
      </div>

      {/* 属性チップ */}
      <div
        style={{
          flex: 'none',
          padding: '8px 11px',
          borderBottom: '1px solid #d8dde3',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '5px',
        }}
      >
        {cur.chips.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            style={{
              fontSize: '10.5px',
              fontWeight: 700,
              color: c.color,
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: '11px',
              padding: '2px 9px',
            }}
          >
            {c.label}
          </span>
        ))}
      </div>

      {/* 備考・申し送り */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 11px',
        }}
      >
        <SectionHeading color="#d99441" label="備考・申し送り" />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            background: '#fffdf6',
            border: '1px solid #e6dcb9',
            borderRadius: '5px',
            padding: '9px 11px',
          }}
        >
          {cur.biko.map((b, i) => (
            <div
              key={`${b}-${i}`}
              style={{
                display: 'flex',
                gap: '6px',
                marginBottom: '5px',
                fontSize: '12px',
                lineHeight: 1.6,
                color: '#5b4a22',
              }}
            >
              <span aria-hidden style={{ color: '#c98f2f', fontWeight: 700 }}>
                ●
              </span>
              <span style={{ flex: 1 }}>{b}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * isSet: セット作業
 * ========================================================================== */

interface SetWorkProps {
  view: WorkbenchView;
  phase: Phase;
  handlers?: WorkbenchWriteHandlers;
  isPending?: boolean;
}

function SetWork({ view, phase, handlers }: SetWorkProps) {
  // 書込操作はシェル handlers（store + 実データ mutation）を優先し、未提供時のみ store へフォールバック。
  // cellTarget はフォールバック時のセル操作系アクションに必要。
  const cellTarget = useWorkbenchStore((s) => s.target);
  const applyCell = useWorkbenchStore((s) => s.applyCell);
  const openHold = useWorkbenchStore((s) => s.openHold);
  const storeToggleOut = useWorkbenchStore((s) => s.toggleOut);
  const storeTogglePacket = useWorkbenchStore((s) => s.togglePacket);
  const onSetCell = () =>
    handlers ? handlers.onSetCell() : applyCell(phase, 'set', cellTarget);
  const onOpenHold = () => (handlers ? handlers.onOpenHold() : openHold(cellTarget));
  const onToggleOut = (name: string) =>
    handlers ? handlers.onToggleOut(name) : storeToggleOut(name);
  const onTogglePacket = (item: string) =>
    handlers ? handlers.onTogglePacket(item) : storeTogglePacket(item);

  const { target, setMethod, setSteps, outsideMeds, outsideEmpty, packetItems } = view;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* 次にセットする薬剤 */}
      <div
        style={{
          flex: 'none',
          margin: '9px',
          border: '1.5px solid #2f6fd6',
          borderRadius: '7px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: '#2f6fd6',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 700,
            padding: '5px 10px',
          }}
        >
          ▶ 次にセットする薬剤
        </div>
        <div style={{ padding: '9px 11px', background: '#fff' }}>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#16345a' }}>
            {target.date} <span style={{ color: '#2f6fd6' }}>{target.timing}</span>
          </div>
          <div style={{ marginTop: '6px', fontSize: '13px', fontWeight: 700, color: '#22344a' }}>
            一包化袋 {target.packetText}
            {target.hasPtp && (
              <span style={{ fontSize: '11px', color: '#1d6fb8', marginLeft: '6px' }}>
                ／ {target.ptpText}
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: '7px',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              maxHeight: '118px',
              overflowY: 'auto',
            }}
          >
            {target.drugs.map((d, i) => (
              <div
                key={`${d}-${i}`}
                style={{ fontSize: '11.5px', color: '#37475c', display: 'flex', gap: '5px' }}
              >
                <span aria-hidden style={{ color: '#9aa6b4' }}>
                  ・
                </span>
                <span style={{ flex: 1 }}>{d}</span>
              </div>
            ))}
          </div>
          {target.hasNote && (
            <div
              style={{
                marginTop: '7px',
                fontSize: '11px',
                color: '#b3402f',
                background: '#fdeeec',
                border: '1px solid #f3cbb3',
                borderRadius: '4px',
                padding: '5px 8px',
              }}
            >
              ⚠ {target.note}
            </div>
          )}
          <div
            style={{
              marginTop: '8px',
              background: '#eaf2fb',
              border: '1px solid #c4d8ef',
              borderRadius: '5px',
              padding: '7px 9px',
            }}
          >
            <div
              style={{ fontSize: '10px', fontWeight: 700, color: '#5a78a8', letterSpacing: '.5px' }}
            >
              セット方法
            </div>
            <div
              style={{ fontSize: '12.5px', fontWeight: 700, color: '#1b3a63', marginTop: '2px' }}
            >
              {setMethod}
            </div>
          </div>
          <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {setSteps.map((st) => (
              <div key={st.n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  aria-hidden
                  style={{
                    flex: 'none',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: '#2f6fd6',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  {st.n}
                </span>
                <span
                  style={{ flex: 'none', fontSize: '11.5px', fontWeight: 700, color: '#22344a' }}
                >
                  {st.label}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: '10.5px',
                    color: '#7a8a9c',
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {st.sub}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={onSetCell}
              style={{
                flex: 1,
                cursor: 'pointer',
                textAlign: 'center',
                fontSize: '12px',
                fontWeight: 700,
                color: '#fff',
                background: '#2f6fd6',
                border: '1px solid #245aad',
                borderRadius: '5px',
                padding: '7px 0',
              }}
            >
              このセルへセット
            </button>
            <button type="button" onClick={onOpenHold} style={holdButtonStyle}>
              保留…
            </button>
          </div>
        </div>
      </div>

      {/* カレンダー外薬（同梱確認）*/}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          margin: '0 9px 9px 9px',
        }}
      >
        <SectionHeading color="#b75a28" label="カレンダー外薬（同梱確認）" />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e6dcc4',
            borderRadius: '5px',
            padding: '7px 9px',
          }}
        >
          {outsideMeds.map((o) => (
            <button
              type="button"
              key={o.name}
              onClick={() => onToggleOut(o.name)}
              aria-pressed={o.checked}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 4px',
                borderBottom: '1px solid #f0ede4',
                cursor: 'pointer',
                width: '100%',
                background: 'transparent',
                textAlign: 'left',
              }}
            >
              <CheckBox look={look(o.checked, '#3a9d4f')} />
              <span
                style={{
                  flex: 'none',
                  fontSize: '9.5px',
                  fontWeight: 700,
                  color: '#fff',
                  background: o.kindColor,
                  borderRadius: '3px',
                  padding: '1px 5px',
                }}
              >
                {o.kind}
              </span>
              <span style={{ flex: 1, fontSize: '11.5px', color: '#37475c', lineHeight: 1.2 }}>
                {o.name}
              </span>
            </button>
          ))}
          {outsideEmpty && (
            <div
              style={{ fontSize: '11px', color: '#9aa6b4', textAlign: 'center', padding: '14px 0' }}
            >
              カレンダー外薬なし
            </div>
          )}
        </div>
      </div>

      {/* 訪問持出パケット 完成判定 */}
      <div style={{ flex: 'none', margin: '0 9px 9px 9px' }}>
        <SectionHeading color="#9558c4" label="訪問持出パケット 完成判定" />
        <div
          style={{
            background: '#faf7fd',
            border: '1px solid #e0d2ee',
            borderRadius: '5px',
            padding: '5px 9px',
          }}
        >
          {packetItems.map((pk) => (
            <button
              type="button"
              key={pk.key}
              onClick={() => onTogglePacket(pk.key)}
              aria-pressed={pk.checked}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 2px',
                borderBottom: '1px solid #efe7f5',
                cursor: 'pointer',
                width: '100%',
                background: 'transparent',
                textAlign: 'left',
              }}
            >
              <CheckBox look={look(pk.checked, '#9558c4')} />
              <span style={{ flex: 1, fontSize: '11.5px', color: '#37475c', fontWeight: 700 }}>
                {pk.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * isSeta: セット監査
 * ========================================================================== */

interface SetAuditProps {
  view: WorkbenchView;
  phase: Phase;
  handlers?: WorkbenchWriteHandlers;
  isPending?: boolean;
}

function SetAudit({ view, phase, handlers }: SetAuditProps) {
  // 書込操作はシェル handlers（store + 実データ mutation）を優先し、未提供時のみ store へフォールバック。
  // cellTarget はフォールバック時のセル操作系アクションに必要。
  const cellTarget = useWorkbenchStore((s) => s.target);
  const applyCell = useWorkbenchStore((s) => s.applyCell);
  const openHold = useWorkbenchStore((s) => s.openHold);
  const storeToggleCheck = useWorkbenchStore((s) => s.toggleCheck);
  const storeSetNg = useWorkbenchStore((s) => s.setNg);
  const storeReturnToSet = useWorkbenchStore((s) => s.returnToSet);
  const onAuditOk = () => (handlers ? handlers.onAuditOk() : applyCell(phase, 'ok', cellTarget));
  const onAuditNg = () => (handlers ? handlers.onAuditNg() : applyCell(phase, 'ng', cellTarget));
  const onOpenHold = () => (handlers ? handlers.onOpenHold() : openHold(cellTarget));
  const onToggleCheck = (i: number) =>
    handlers ? handlers.onToggleCheck(i) : storeToggleCheck(cellTarget, i);
  const onNg = (value: string) => (handlers ? handlers.onSetNg(value) : storeSetNg(cellTarget, value));
  const onReturn = (di: number, tk: string) =>
    handlers ? handlers.onReturnToSet(di, tk) : storeReturnToSet(di, tk);

  const { target, checkItems, ngValue, ngOptions, rejectList, rejectEmpty, riskList } = view;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* 期待値（処方・服薬計画）*/}
      <div
        style={{
          flex: 'none',
          margin: '9px',
          border: '1.5px solid #27ae60',
          borderRadius: '7px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: '#27ae60',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 700,
            padding: '5px 10px',
          }}
        >
          期待値（処方・服薬計画）
        </div>
        <div style={{ padding: '9px 11px', background: '#fff' }}>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#16345a' }}>
            {target.date} <span style={{ color: '#1d8a47' }}>{target.timing}</span>
          </div>
          <div style={{ marginTop: '5px', fontSize: '13px', fontWeight: 700, color: '#22344a' }}>
            一包化袋 {target.packetText}
            {target.hasPtp && (
              <span style={{ fontSize: '11px', color: '#1d6fb8', marginLeft: '6px' }}>
                ／ {target.ptpText}
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              maxHeight: '80px',
              overflowY: 'auto',
            }}
          >
            {target.drugs.map((d, i) => (
              <div
                key={`${d}-${i}`}
                style={{ fontSize: '11px', color: '#37475c', display: 'flex', gap: '5px' }}
              >
                <span aria-hidden style={{ color: '#9aa6b4' }}>
                  ・
                </span>
                <span style={{ flex: 1 }}>{d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 確認項目 */}
      <div style={{ flex: 'none', margin: '0 9px' }}>
        <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#46566a', marginBottom: '4px' }}>
          確認項目
        </div>
        <div
          style={{
            background: '#fff',
            border: '1px solid #dde2e8',
            borderRadius: '5px',
            padding: '4px 8px',
          }}
        >
          {checkItems.map((ci) => (
            <button
              type="button"
              key={ci.index}
              onClick={() => onToggleCheck(ci.index)}
              aria-pressed={ci.checked}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 2px',
                borderBottom: '1px solid #f0f2f4',
                cursor: 'pointer',
                width: '100%',
                background: 'transparent',
                textAlign: 'left',
              }}
            >
              <CheckBox look={look(ci.checked, '#27ae60')} size={16} />
              <span style={{ flex: 1, fontSize: '11.5px', color: '#37475c' }}>{ci.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 監査OK / NG・差戻し / 保留 + NG 分類 */}
      <div style={{ flex: 'none', margin: '9px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            type="button"
            onClick={onAuditOk}
            style={{
              flex: 1,
              cursor: 'pointer',
              textAlign: 'center',
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#fff',
              background: '#27ae60',
              border: '1px solid #1f9150',
              borderRadius: '5px',
              padding: '8px 0',
            }}
          >
            監査OK
          </button>
          <button
            type="button"
            onClick={onAuditNg}
            style={{
              flex: 1,
              cursor: 'pointer',
              textAlign: 'center',
              fontSize: '12.5px',
              fontWeight: 700,
              color: '#fff',
              background: '#d9534f',
              border: '1px solid #b94440',
              borderRadius: '5px',
              padding: '8px 0',
            }}
          >
            NG・差戻し
          </button>
          <button
            type="button"
            onClick={onOpenHold}
            style={{ ...holdButtonStyle, padding: '8px 12px' }}
          >
            保留…
          </button>
        </div>
        <div style={{ marginTop: '7px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <label
            htmlFor="ng-classification"
            style={{ fontSize: '11px', color: '#69788c', fontWeight: 700, flex: 'none' }}
          >
            NG分類
          </label>
          <select
            id="ng-classification"
            value={ngValue}
            onChange={(e) => onNg(e.target.value)}
            style={{
              flex: 1,
              fontSize: '11px',
              color: '#173a63',
              background: '#fff',
              border: '1px solid #c3402f',
              borderRadius: '4px',
              padding: '3px 4px',
            }}
          >
            <option value="">（選択）</option>
            {ngOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 差戻し（セットへ戻す）*/}
      <div style={{ flex: 'none', margin: '0 9px 9px 9px' }}>
        <SectionHeading color="#d9534f" label="差戻し（セットへ戻す）" />
        <div
          style={{
            background: '#fff',
            border: '1px solid #ecccc9',
            borderRadius: '5px',
            padding: '5px 8px',
          }}
        >
          {rejectList.map((rj) => (
            <div
              key={`${rj.di}:${rj.tk}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 2px',
                borderBottom: '1px solid #f3eaea',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#22344a' }}>
                  {rj.label}
                </div>
                <div style={{ fontSize: '10px', color: '#c0392b' }}>NG：{rj.ng}</div>
              </div>
              <button
                type="button"
                onClick={() => onReturn(rj.di, rj.tk)}
                style={{
                  flex: 'none',
                  cursor: 'pointer',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  color: '#fff',
                  background: '#9558c4',
                  border: '1px solid #7c43ab',
                  borderRadius: '4px',
                  padding: '4px 8px',
                }}
              >
                セットへ戻す
              </button>
            </div>
          ))}
          {rejectEmpty && (
            <div
              style={{ fontSize: '11px', color: '#9aa6b4', textAlign: 'center', padding: '8px 0' }}
            >
              差戻しなし
            </div>
          )}
        </div>
      </div>

      {/* リスク確認順（上位を先に）*/}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          margin: '0 9px 9px 9px',
        }}
      >
        <SectionHeading color="#c0392b" label="リスク確認順（上位を先に）" />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e3d3d0',
            borderRadius: '5px',
            padding: '6px 9px',
          }}
        >
          {riskList.map((rk) => (
            <div
              key={rk.rank}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 2px',
                borderBottom: '1px solid #f3eeed',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: '18px',
                  height: '18px',
                  flex: 'none',
                  borderRadius: '50%',
                  background: rk.color,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                }}
              >
                {rk.rank}
              </span>
              <span style={{ flex: 1, fontSize: '11.5px', color: '#37475c', fontWeight: 700 }}>
                {rk.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 保留ボタン共通スタイル（セット・セット監査で共有）*/
const holdButtonStyle: CSSProperties = {
  flex: 'none',
  cursor: 'pointer',
  textAlign: 'center',
  fontSize: '12px',
  fontWeight: 700,
  color: '#9a6a18',
  background: '#fff6e6',
  border: '1px solid #e8c884',
  borderRadius: '5px',
  padding: '7px 12px',
};

export default RightPane;
