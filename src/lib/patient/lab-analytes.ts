import type { LabAnalyteCode } from '@prisma/client';

export const LAB_ANALYTE_CODES = [
  'wbc',
  'neut',
  'hb',
  'plt',
  'pt_inr',
  'ast',
  'alt',
  't_bil',
  'scr',
  'egfr',
  'ck',
  'crp',
  'k',
  'hba1c',
  'tp',
  'alb',
  'na',
  'cl',
  'bun',
  'bnp',
  'nt_pro_bnp',
  'blood_glucose',
] as const satisfies readonly [LabAnalyteCode, ...LabAnalyteCode[]];

export const KEY_LAB_ANALYTE_CODES = [
  'egfr',
  'scr',
  'k',
  'crp',
  'hba1c',
  'pt_inr',
  'alb',
] as const satisfies readonly LabAnalyteCode[];

export const LAB_ANALYTE_LABELS = {
  wbc: 'WBC',
  neut: '好中球',
  hb: 'Hb',
  plt: 'PLT',
  pt_inr: 'PT-INR',
  ast: 'AST',
  alt: 'ALT',
  t_bil: 'T-Bil',
  scr: 'Scr',
  egfr: 'eGFR',
  ck: 'CK',
  crp: 'CRP',
  k: 'K',
  hba1c: 'HbA1c',
  tp: 'TP',
  alb: 'Alb',
  na: 'Na',
  cl: 'Cl',
  bun: 'BUN',
  bnp: 'BNP',
  nt_pro_bnp: 'NT-proBNP',
  blood_glucose: '血糖',
} as const satisfies Record<LabAnalyteCode, string>;

export function formatLabAnalyteLabel(code: string) {
  return LAB_ANALYTE_LABELS[code as LabAnalyteCode] ?? code;
}
