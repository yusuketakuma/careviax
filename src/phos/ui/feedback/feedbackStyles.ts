import type { CSSProperties } from 'react';
import { BlockerSeverity } from '@/phos/contracts/phos_contracts';
import { SeverityToken } from '@/phos/contracts/phos_design_tokens';

function severityFeedbackStyle(severity: BlockerSeverity): CSSProperties {
  const token = SeverityToken[severity];
  return {
    color: token.fg,
    backgroundColor: token.bg,
    borderColor: token.border,
  };
}

export const warningFeedbackStyle = severityFeedbackStyle(BlockerSeverity.WARNING);
