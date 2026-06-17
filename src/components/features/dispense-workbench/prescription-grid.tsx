'use client';

/**
 * 調剤ワークベンチ 中央グリッド（phase=dispense | audit）
 *
 * 設計プロト（調剤ワークベンチ.dc.html L120-221）の GRID PHASES ブロックを忠実移植する。
 * 上部ツールバー（調剤区分チップ / 前回比較 / ＋新規グループ / D&Dヒント / 賦形ルール）、
 * ヘッダ行、ボディ（セクション行 + 薬剤行 + 合計行）、フッタ（進捗バー + 一括 + 主操作）。
 *
 * 表示は use-workbench-view.ts の WorkbenchView から、状態更新は
 * dispensing-workbench.store.ts のアクションを直接呼ぶ（連携規約）。
 * HTML5 D&D で行を別グループへ移動（store.dragStart / dropTo）。
 *
 * 寸法・配色・フォントは module.css クラス + 設計プロト実値の inline style で再現する。
 * 書込を伴う操作は handlers へ委譲する。実データ時は handlers が mutation と競合時 rollback を担い、
 * 比較モーダルは読み込み済み比較データを表示する。
 */

import type { CSSProperties, DragEvent } from 'react';

import styles from './dispensing-workbench.module.css';
import { useWorkbenchStore } from './dispensing-workbench.store';
import type {
  GridDrugRow,
  GridSectionRow,
  Phase,
  WorkbenchView,
} from './dispensing-workbench.types';
import type { WorkbenchWriteHandlers } from './use-workbench-write-handlers';

interface PrescriptionGridProps {
  view: WorkbenchView;
  phase: Phase;
  handlers?: WorkbenchWriteHandlers;
  isPending?: boolean;
}

/** ヘッダ / 合計行で共有するセル幅・区切り（設計プロト実値） */
const COL = {
  drag: 16,
  check: 44,
  no: 30,
  yoho: 108,
  asa: 36,
  hiru: 36,
  yu: 36,
  nemae: 42,
  other: 60,
  daily: 64,
  days: 58,
  funsai: 44,
  note: 220,
} as const;

const HEADER_BORDER = '1px solid #b6c5d8';
const CELL_BORDER = '1px solid #e6eaef';
const TOTAL_BORDER = '1px solid #dde3ea';
const auditCountInputStyle: CSSProperties = {
  width: 40,
  flex: 'none',
  fontSize: 10.5,
  color: '#173a63',
  background: '#fff',
  border: '1px solid #ebcf96',
  borderRadius: 4,
  padding: '2px 3px',
  textAlign: 'right',
  font: 'inherit',
};

export function PrescriptionGrid({ view, phase, handlers, isPending }: PrescriptionGridProps) {
  // 書込操作はシェルから渡される handlers（store アクション + 実データ mutation 結線）を優先し、
  // handlers 未提供時（単体レンダリング・既存テスト）は従来どおり store アクションへフォールバック。
  // dragStart / openCompare は読取・UI 内状態のみで API 書込を伴わないため store 直結のまま。
  const storeToggleRow = useWorkbenchStore((s) => s.toggleRow);
  const storeToggleQuantityConfirm = useWorkbenchStore((s) => s.toggleQuantityConfirm);
  const storeSetActualQuantityInput = useWorkbenchStore((s) => s.setActualQuantityInput);
  const storeSetDiscrepancyReason = useWorkbenchStore((s) => s.setDiscrepancyReason);
  const storeSetAuditDoubleCount = useWorkbenchStore((s) => s.setAuditDoubleCount);
  const storeSetGMethod = useWorkbenchStore((s) => s.setGMethod);
  const storeSetGStart = useWorkbenchStore((s) => s.setGStart);
  const storeSetGDays = useWorkbenchStore((s) => s.setGDays);
  const dragStart = useWorkbenchStore((s) => s.dragStart);
  const storeDropTo = useWorkbenchStore((s) => s.dropTo);
  const storeBulk = useWorkbenchStore((s) => s.bulk);
  const storePrimary = useWorkbenchStore((s) => s.primary);
  const openCompare = useWorkbenchStore((s) => s.openCompare);
  const storeAddGroup = useWorkbenchStore((s) => s.addGroup);

  const toggleRow = (did: string) =>
    handlers ? handlers.onToggleRow(did) : storeToggleRow(phase, did);
  const toggleQuantityConfirm = (did: string) =>
    handlers ? handlers.onToggleQuantityConfirm(did) : storeToggleQuantityConfirm(did);
  const setActualQuantityInput = (did: string, value: string) =>
    handlers ? handlers.onActualQuantityInput(did, value) : storeSetActualQuantityInput(did, value);
  const setDiscrepancyReason = (did: string, value: string) =>
    handlers ? handlers.onDiscrepancyReason(did, value) : storeSetDiscrepancyReason(did, value);
  const setAuditDoubleCount = (did: string, field: 'first' | 'second', value: string) =>
    handlers
      ? handlers.onAuditDoubleCount(did, field, value)
      : storeSetAuditDoubleCount(did, field, value);
  const setGMethod = (gid: string, value: string) =>
    handlers ? handlers.onGroupMethod(gid, value) : storeSetGMethod(gid, value);
  const setGStart = (gid: string, value: string) =>
    handlers ? handlers.onGroupStart(gid, value) : storeSetGStart(gid, value);
  const setGDays = (gid: string, value: string) =>
    handlers ? handlers.onGroupDays(gid, value) : storeSetGDays(gid, value);
  const dropTo = (gid: string) => (handlers ? handlers.onDropTo(gid) : storeDropTo(gid));
  const bulk = () => (handlers ? handlers.onBulk() : storeBulk(phase));
  const primary = () => (handlers ? handlers.onPrimary() : storePrimary(phase));
  const addGroup = () => (handlers ? handlers.onAddGroup() : storeAddGroup());

  return (
    <div
      data-testid="dispense-checklist"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      {/* ===== 上部ツールバー（調剤区分・比較・新規グループ・D&Dヒント・賦形ルール）===== */}
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          background: '#f4f6f9',
          borderBottom: '1px solid #d7dde4',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 11, color: '#5a6878', fontWeight: 700 }}>調剤区分</span>
        {view.cur.chips.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            style={{
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
            {c.label}
          </span>
        ))}
        <button
          type="button"
          onClick={openCompare}
          style={{
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 700,
            color: '#7c43ab',
            background: '#f3ecf8',
            border: '1px solid #ddc8ec',
            borderRadius: 4,
            padding: '3px 10px',
            whiteSpace: 'nowrap',
            font: 'inherit',
          }}
        >
          🕘 前回処方と比較
        </button>
        <button
          type="button"
          onClick={addGroup}
          disabled={isPending}
          aria-disabled={isPending}
          style={{
            cursor: isPending ? 'not-allowed' : 'pointer',
            fontSize: 11,
            fontWeight: 700,
            color: '#1f6f3d',
            background: '#eaf6ec',
            border: '1px solid #bfe0c4',
            borderRadius: 4,
            padding: '3px 10px',
            whiteSpace: 'nowrap',
            font: 'inherit',
            opacity: isPending ? 0.6 : 1,
          }}
        >
          ＋ 新規グループ
        </button>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 10.5,
            color: '#2a6b8a',
            background: '#e6f2f6',
            border: '1px solid #bcdce6',
            borderRadius: 4,
            padding: '3px 9px',
            whiteSpace: 'nowrap',
          }}
        >
          ↕ 行をドラッグして調剤グループを変更
        </span>
        <span
          style={{
            fontSize: 11,
            color: '#8a5a1a',
            background: '#fdf3df',
            border: '1px solid #ecd9a8',
            borderRadius: 4,
            padding: '3px 9px',
            whiteSpace: 'nowrap',
          }}
        >
          {view.cur.rule}
        </span>
      </div>

      {/* ===== ヘッダ行 ===== */}
      <div className={styles.gridHeader}>
        <div style={{ width: COL.drag, flex: 'none', borderRight: HEADER_BORDER }} />
        <div style={headCell(COL.check)}>{view.checkHead}</div>
        <div style={headCell(COL.no)}>No</div>
        <div
          style={{
            flex: 1,
            minWidth: 230,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            borderRight: HEADER_BORDER,
          }}
        >
          薬品名
        </div>
        <div style={{ ...headCell(COL.yoho), justifyContent: 'flex-start', padding: '0 8px' }}>
          用法
        </div>
        <div style={headCell(COL.asa)}>朝</div>
        <div style={headCell(COL.hiru)}>昼</div>
        <div style={headCell(COL.yu)}>夕</div>
        <div style={headCell(COL.nemae)}>眠前</div>
        <div style={{ ...headCell(COL.other), textAlign: 'center', lineHeight: 1.1 }}>頓・外他</div>
        <div style={headCell(COL.daily)}>1日量</div>
        <div style={headCell(COL.days)}>処方日数</div>
        <div style={headCell(COL.funsai)}>粉砕</div>
        <div
          style={{
            width: COL.note,
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
          }}
        >
          賦形・備考
        </div>
      </div>

      {/* ===== ボディ ===== */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {view.rows.map((r) =>
          r.kind === 'sec' ? (
            <SectionRow
              key={r.gid}
              row={r}
              methodOptions={view.methodOptions}
              onMethod={(v) => setGMethod(r.gid, v)}
              onStart={(v) => setGStart(r.gid, v)}
              onDays={(v) => setGDays(r.gid, v)}
              onDrop={() => dropTo(r.gid)}
            />
          ) : (
            <DrugRow
              key={r.did}
              row={r}
              onCheck={() => toggleRow(r.did)}
              onQuantityConfirm={() => toggleQuantityConfirm(r.did)}
              onActualQuantityInput={(value) => setActualQuantityInput(r.did, value)}
              onDiscrepancyReason={(value) => setDiscrepancyReason(r.did, value)}
              onAuditDoubleCount={(field, value) => setAuditDoubleCount(r.did, field, value)}
              onDragStart={() => dragStart(r.did)}
              onDrop={() => dropTo(r.gid)}
            />
          ),
        )}

        {/* 合計行 */}
        <div className={styles.gridTotalRow}>
          <div
            style={{
              width: COL.drag + COL.check + COL.no,
              flex: 'none',
              borderRight: TOTAL_BORDER,
            }}
          />
          <div
            style={{
              flex: 1,
              minWidth: 230,
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              borderRight: TOTAL_BORDER,
              color: '#5a6878',
              fontWeight: 400,
              fontSize: 11,
            }}
          >
            計 ／ {view.totals.summary}
          </div>
          <div
            style={{
              width: COL.yoho,
              flex: 'none',
              borderRight: TOTAL_BORDER,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingRight: 8,
            }}
          >
            計
          </div>
          <div style={totalCell(COL.asa)}>{view.totals.asa}</div>
          <div style={totalCell(COL.hiru)}>{view.totals.hiru}</div>
          <div style={totalCell(COL.yu)}>{view.totals.yu}</div>
          <div style={totalCell(COL.nemae)}>{view.totals.nemae}</div>
          <div style={{ width: COL.other, flex: 'none', borderRight: TOTAL_BORDER }} />
          <div style={{ width: COL.daily, flex: 'none', borderRight: TOTAL_BORDER }} />
          <div style={{ width: COL.days, flex: 'none', borderRight: TOTAL_BORDER }} />
          <div style={{ width: COL.funsai, flex: 'none', borderRight: TOTAL_BORDER }} />
          <div style={{ width: COL.note, flex: 'none' }} />
        </div>
      </div>

      {/* ===== フッタ（進捗バー + 一括 + 主操作）===== */}
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
          {view.progress.label}
        </div>
        <div
          style={{
            flex: 'none',
            width: 200,
            height: 11,
            borderRadius: 6,
            background: '#d3dae2',
            overflow: 'hidden',
            border: '1px solid #c0c8d1',
          }}
        >
          <div
            style={{
              height: '100%',
              width: view.progress.pct,
              background: view.progress.color,
              borderRadius: 6,
              transition: 'width .25s',
            }}
          />
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: view.progress.color }}>
          {view.progress.fraction}
        </div>
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
          {view.bulkLabel}
        </button>
        <button
          type="button"
          onClick={() => primary()}
          disabled={view.primary.cursor === 'not-allowed' || isPending}
          style={{
            cursor: view.primary.cursor as CSSProperties['cursor'],
            opacity: Number(view.primary.opacity),
            fontSize: 12.5,
            fontWeight: 700,
            color: '#fff',
            background: view.primary.bg,
            border: `1px solid ${view.primary.border}`,
            borderRadius: 5,
            padding: '6px 18px',
            boxShadow: '0 1px 0 rgba(0,0,0,.12)',
            whiteSpace: 'nowrap',
            font: 'inherit',
          }}
        >
          {view.primary.label}
        </button>
      </div>
    </div>
  );
}

/** ヘッダセル共通スタイル（中央寄せ・右区切り） */
function headCell(width: number): CSSProperties {
  return {
    width,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRight: HEADER_BORDER,
    padding: '5px 0',
  };
}

/** 合計行セル共通スタイル */
function totalCell(width: number): CSSProperties {
  return {
    width,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRight: TOTAL_BORDER,
  };
}

interface SectionRowProps {
  row: GridSectionRow;
  methodOptions: WorkbenchView['methodOptions'];
  onMethod: (value: string) => void;
  onStart: (value: string) => void;
  onDays: (value: string) => void;
  onDrop: () => void;
}

/** セクション見出し行（調剤方法 select + 服用開始日 date + 処方日数 number + 服用終了日 自動） */
function SectionRow({ row, methodOptions, onMethod, onStart, onDays, onDrop }: SectionRowProps) {
  const allowDrop = (e: DragEvent) => e.preventDefault();
  return (
    <div
      className={styles.gridSection}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragOver={allowDrop}
    >
      <span
        style={{
          width: 4,
          height: 14,
          background: '#3a5e8c',
          display: 'inline-block',
          borderRadius: 1,
          flex: 'none',
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 700, color: '#244268', whiteSpace: 'nowrap' }}>
        {row.secLabel}
      </span>
      {row.periodWarning && (
        <span
          aria-label={`${row.secLabel} ${row.periodWarning.label}: ${row.periodWarning.detail}`}
          title={row.periodWarning.detail}
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: '#7b4a14',
            background: '#fff7e8',
            border: '1px solid #ebcf96',
            borderRadius: 4,
            padding: '2px 6px',
            whiteSpace: 'nowrap',
          }}
        >
          {row.periodWarning.label}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10.5, color: '#3a5170', fontWeight: 700 }}>調剤方法</span>
        <select
          value={row.method}
          onChange={(e) => onMethod(e.target.value)}
          aria-label={`${row.secLabel} 調剤方法`}
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#173a63',
            background: '#fff',
            border: '1px solid #9db4d2',
            borderRadius: 4,
            padding: '2px 4px',
          }}
        >
          {methodOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10.5, color: '#3a5170', fontWeight: 700 }}>服用開始日</span>
        <input
          type="date"
          value={row.start}
          onChange={(e) => onStart(e.target.value)}
          aria-label={`${row.secLabel} 服用開始日`}
          style={{
            fontSize: 11,
            color: '#173a63',
            background: '#fff',
            border: '1px solid #9db4d2',
            borderRadius: 4,
            padding: '1px 4px',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 10.5, color: '#3a5170', fontWeight: 700 }}>処方日数</span>
        <input
          type="number"
          value={row.days}
          onChange={(e) => onDays(e.target.value)}
          aria-label={`${row.secLabel} 処方日数`}
          style={{
            width: 48,
            fontSize: 11,
            color: '#173a63',
            background: '#fff',
            border: '1px solid #9db4d2',
            borderRadius: 4,
            padding: '1px 4px',
            textAlign: 'right',
          }}
        />
        <span style={{ fontSize: 10.5, color: '#3a5170' }}>日</span>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: '#eaf2fb',
          border: '1px solid #c4d8ef',
          borderRadius: 4,
          padding: '2px 8px',
        }}
      >
        <span style={{ fontSize: 10.5, color: '#3a5170', fontWeight: 700 }}>服用終了日(自動)</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#16345a' }}>{row.endDate}</span>
      </div>
    </div>
  );
}

interface DrugRowProps {
  row: GridDrugRow;
  onCheck: () => void;
  onQuantityConfirm: () => void;
  onActualQuantityInput: (value: string) => void;
  onDiscrepancyReason: (value: string) => void;
  onAuditDoubleCount: (field: 'first' | 'second', value: string) => void;
  onDragStart: () => void;
  onDrop: () => void;
}

/** 薬剤行（ドラッグ把手 + チェック + 剤形 + 変更/タグバッジ + 薬品名 + 用法 + 朝昼夕眠前 + 頓外他 + 1日量 + 処方日数 + 粉砕 + 賦形備考） */
function DrugRow({
  row,
  onCheck,
  onQuantityConfirm,
  onActualQuantityInput,
  onDiscrepancyReason,
  onAuditDoubleCount,
  onDragStart,
  onDrop,
}: DrugRowProps) {
  const allowDrop = (e: DragEvent) => e.preventDefault();
  return (
    <div
      className={styles.gridDrugRow}
      draggable
      onDragStart={onDragStart}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragOver={allowDrop}
      style={{ background: row.bg }}
    >
      <div
        style={{
          width: COL.drag,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: '1px solid #eef1f4',
          color: '#9aa6b4',
          cursor: 'grab',
          fontSize: 11,
        }}
        aria-hidden="true"
      >
        ⋮⋮
      </div>
      <div
        style={{
          width: COL.check,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: CELL_BORDER,
          padding: 0,
        }}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={!!row.checkMark}
          aria-label={`${row.name} ${row.checkMark ? '済' : '未'}`}
          onClick={onCheck}
          style={{
            width: 19,
            height: 19,
            borderRadius: 4,
            border: `1.5px solid ${row.checkBorder}`,
            background: row.checkBg,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {row.checkMark}
        </button>
      </div>
      <div
        className={styles.mono}
        style={{
          width: COL.no,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: CELL_BORDER,
          color: '#7a8696',
          fontSize: 11,
        }}
      >
        {row.no}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 230,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 8px',
          borderRight: CELL_BORDER,
          lineHeight: 1.25,
        }}
      >
        <span
          style={{
            flex: 'none',
            width: 18,
            height: 18,
            borderRadius: 4,
            background: row.formBg,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {row.formL}
        </span>
        {row.hasChg && (
          <span
            style={{
              flex: 'none',
              fontSize: 9.5,
              fontWeight: 700,
              color: '#fff',
              background: row.chgColor,
              borderRadius: 3,
              padding: '1px 5px',
            }}
          >
            {row.chgText}
          </span>
        )}
        {row.hasTag && (
          <span
            style={{
              flex: 'none',
              fontSize: 9.5,
              fontWeight: 700,
              color: '#fff',
              background: row.tagColor,
              borderRadius: 3,
              padding: '1px 5px',
            }}
          >
            {row.tag}
          </span>
        )}
        <span style={{ fontWeight: 700, color: '#16263a' }}>{row.name}</span>
      </div>
      <div
        style={{
          width: COL.yoho,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          padding: '3px 8px',
          borderRight: CELL_BORDER,
          fontSize: 11.5,
          color: '#37475c',
          lineHeight: 1.2,
        }}
      >
        {row.yoho}
      </div>
      <div style={timingCell(COL.asa)}>{row.asa}</div>
      <div style={timingCell(COL.hiru)}>{row.hiru}</div>
      <div style={timingCell(COL.yu)}>{row.yu}</div>
      <div style={timingCell(COL.nemae)}>{row.nemae}</div>
      <div
        style={{
          width: COL.other,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: CELL_BORDER,
          fontSize: 10,
          fontWeight: 700,
          color: '#7b5a2a',
          textAlign: 'center',
          lineHeight: 1.1,
        }}
      >
        {row.other}
      </div>
      <div
        style={{
          width: COL.daily,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: CELL_BORDER,
          fontWeight: 700,
          fontSize: 11.5,
          color: '#234',
        }}
      >
        {row.daily}
      </div>
      <div
        style={{
          width: COL.days,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: CELL_BORDER,
          fontWeight: 700,
          fontSize: 11.5,
          color: '#2a4060',
        }}
      >
        {row.daysLabel}
      </div>
      <div
        style={{
          width: COL.funsai,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: CELL_BORDER,
        }}
      >
        {row.funsai && (
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              color: '#fff',
              background: '#c0392b',
              borderRadius: 3,
              padding: '1px 5px',
            }}
          >
            粉砕
          </span>
        )}
      </div>
      <div
        style={{
          width: COL.note,
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 8px',
          fontSize: 11,
          color: row.noteColor,
          lineHeight: 1.2,
        }}
      >
        {row.showQuantityConfirm && (
          <>
            <input
              type="number"
              min="0"
              step={row.actualQuantityStep}
              inputMode={row.actualQuantityInputMode}
              value={row.actualQuantityInput}
              onChange={(event) => onActualQuantityInput(event.target.value)}
              disabled={row.actualQuantityDisabled}
              aria-label={`${row.name} 実数量`}
              style={{
                width: 48,
                flex: 'none',
                fontSize: 10.5,
                color: '#173a63',
                background: row.actualQuantityDisabled ? '#eef1f5' : '#fff',
                border: '1px solid #9db4d2',
                borderRadius: 4,
                padding: '2px 3px',
                textAlign: 'right',
                font: 'inherit',
              }}
            />
            <button
              type="button"
              onClick={row.quantityConfirmLocked ? undefined : onQuantityConfirm}
              disabled={row.quantityConfirmLocked}
              aria-pressed={row.quantityConfirmed}
              aria-label={`${row.name} ${row.quantityLabel} ${row.quantityConfirmLabel}`}
              style={{
                flex: 'none',
                cursor: row.quantityConfirmLocked ? 'default' : 'pointer',
                fontSize: 10,
                fontWeight: 700,
                color: row.quantityConfirmed ? '#1f6f3d' : '#7b4a14',
                background: row.quantityConfirmed ? '#eaf6ec' : '#fff7e8',
                border: `1px solid ${row.quantityConfirmed ? '#bfe0c4' : '#ebcf96'}`,
                borderRadius: 4,
                padding: '2px 5px',
                whiteSpace: 'nowrap',
                font: 'inherit',
              }}
            >
              {row.quantityConfirmLabel}
            </button>
            {row.requiresDiscrepancyReason && (
              <input
                type="text"
                value={row.discrepancyReasonValue}
                onChange={(event) => onDiscrepancyReason(event.target.value)}
                aria-label={`${row.name} 数量差異理由`}
                placeholder="差異理由"
                style={{
                  width: 42,
                  flex: 'none',
                  fontSize: 10,
                  color: '#7b4a14',
                  background: '#fff7e8',
                  border: '1px solid #ebcf96',
                  borderRadius: 4,
                  padding: '2px 3px',
                  font: 'inherit',
                }}
              />
            )}
          </>
        )}
        {row.showAuditDoubleCount && (
          <>
            <span
              style={{
                flex: 'none',
                fontSize: 10,
                fontWeight: 700,
                color: '#7b4a14',
                background: '#fff7e8',
                border: '1px solid #ebcf96',
                borderRadius: 4,
                padding: '2px 4px',
                whiteSpace: 'nowrap',
              }}
              title={`${row.name} 実数量 ${row.auditCountExpectedLabel}`}
            >
              麻薬計数
            </span>
            <input
              type="number"
              min="0"
              step={row.actualQuantityStep}
              inputMode={row.actualQuantityInputMode}
              value={row.auditFirstCountInput}
              onChange={(event) => onAuditDoubleCount('first', event.target.value)}
              aria-label={`${row.name} ダブルカウント1回目`}
              style={auditCountInputStyle}
            />
            <input
              type="number"
              min="0"
              step={row.actualQuantityStep}
              inputMode={row.actualQuantityInputMode}
              value={row.auditSecondCountInput}
              onChange={(event) => onAuditDoubleCount('second', event.target.value)}
              aria-label={`${row.name} ダブルカウント2回目`}
              style={auditCountInputStyle}
            />
          </>
        )}
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={[row.quantityLabel, row.note].filter(Boolean).join(' / ')}
        >
          {row.showQuantityConfirm ? row.quantityLabel : row.note}
        </span>
      </div>
    </div>
  );
}

/** 朝昼夕眠前 セル共通スタイル */
function timingCell(width: number): CSSProperties {
  return {
    width,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRight: CELL_BORDER,
    fontWeight: 700,
    color: '#1f3350',
  };
}
