import type { CSSProperties } from 'react';

/** Shared column widths and separators from the dispensing workbench design contract. */
export const COL = {
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

export const HEADER_BORDER = '1px solid var(--wb-line)';
export const CELL_BORDER = '1px solid var(--wb-line)';
export const TOTAL_BORDER = '1px solid var(--wb-line)';

export const auditCountInputStyle: CSSProperties = {
  width: 40,
  flex: 'none',
  fontSize: 12,
  color: 'var(--wb-ink)',
  background: 'var(--wb-surface)',
  border: '1px solid var(--wb-confirm-border)',
  borderRadius: 4,
  padding: '2px 3px',
  textAlign: 'right',
  font: 'inherit',
};

export function headCell(width: number): CSSProperties {
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

export function totalCell(width: number): CSSProperties {
  return {
    width,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRight: TOTAL_BORDER,
  };
}

export function timingCell(width: number): CSSProperties {
  return {
    width,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRight: CELL_BORDER,
    fontWeight: 700,
    color: 'var(--wb-ink)',
  };
}
