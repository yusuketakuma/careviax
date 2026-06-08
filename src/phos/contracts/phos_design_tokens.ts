import { BlockerSeverity, Tag } from './phos_contracts';

export const SeverityToken = {
  [BlockerSeverity.INFO]: {
    icon: 'info',
    label: '情報',
    fg: '#1f3a5f',
    bg: '#e7f0fb',
    border: '#9cc0ea',
  },
  [BlockerSeverity.WARNING]: {
    icon: 'alert-triangle',
    label: '注意',
    fg: '#7a4d00',
    bg: '#fff3da',
    border: '#e3a93b',
  },
  [BlockerSeverity.ERROR]: {
    icon: 'circle-alert',
    label: '不足',
    fg: '#7a2618',
    bg: '#fdeae6',
    border: '#e0846f',
  },
  [BlockerSeverity.CRITICAL]: {
    icon: 'shield-alert',
    label: '重要',
    fg: '#5b1023',
    bg: '#fbe3ea',
    border: '#cf5d77',
  },
} as const satisfies Record<
  BlockerSeverity,
  { icon: string; label: string; fg: string; bg: string; border: string }
>;

export const TagToken = {
  [Tag.NARCOTIC]: { icon: 'shield-alert', severity: BlockerSeverity.CRITICAL },
  [Tag.OPIOID]: { icon: 'shield-alert', severity: BlockerSeverity.CRITICAL },
  [Tag.HIGH_RISK]: { icon: 'circle-alert', severity: BlockerSeverity.ERROR },
  [Tag.COLD_CHAIN]: { icon: 'thermometer-snowflake', severity: BlockerSeverity.ERROR },
  [Tag.INSULIN]: { icon: 'syringe', severity: BlockerSeverity.ERROR },
  [Tag.ANTICOAGULANT]: { icon: 'droplet', severity: BlockerSeverity.ERROR },
  [Tag.MULTI_PERSON_VISIT]: { icon: 'users', severity: BlockerSeverity.WARNING },
  [Tag.DOCTOR_SIMULTANEOUS]: { icon: 'stethoscope', severity: BlockerSeverity.WARNING },
  [Tag.PRESCRIPTION_DIFF]: { icon: 'diff', severity: BlockerSeverity.WARNING },
  [Tag.SET_DIFF]: { icon: 'package-check', severity: BlockerSeverity.WARNING },
  [Tag.RESIDUAL]: { icon: 'pill', severity: BlockerSeverity.WARNING },
  [Tag.FALL_RISK]: { icon: 'person-standing', severity: BlockerSeverity.WARNING },
  [Tag.HYPOGLYCEMIA_RISK]: { icon: 'activity', severity: BlockerSeverity.WARNING },
  [Tag.REPORT_REQUIRED]: { icon: 'file-text', severity: BlockerSeverity.INFO },
  [Tag.CLAIM_CANDIDATE]: { icon: 'receipt', severity: BlockerSeverity.INFO },
  [Tag.CLERK_CAN_RESOLVE]: { icon: 'clipboard-check', severity: BlockerSeverity.INFO },
  [Tag.WAITING_REPLY]: { icon: 'mail-question', severity: BlockerSeverity.INFO },
} as const satisfies Record<Tag, { icon: string; severity: BlockerSeverity }>;

export const TypeScale = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, h2: 24, h1: 30 } as const;
export const Space = { x1: 4, x2: 8, x3: 12, x4: 16, x5: 24, x6: 32 } as const;
export const Radius = { sm: 6, md: 10, lg: 14 } as const;
export const TapTarget = { min: 24, recommended: 44 } as const;
export const CardTileDims = { minHeight: 120, gap: 8, primaryButtonHeight: 44 } as const;
