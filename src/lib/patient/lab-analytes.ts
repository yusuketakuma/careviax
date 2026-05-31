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

