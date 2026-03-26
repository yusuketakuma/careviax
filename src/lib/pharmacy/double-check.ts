/**
 * Double-check validation for dispense audit.
 * Per pharmacy regulations, the dispenser and auditor must be different pharmacists.
 * Emergency approval is an exception — allowed with a warning.
 */
export function validateDoubleCheck(
  dispensedBy: string,
  auditedBy: string,
  isEmergency: boolean
): { valid: boolean; warning?: string } {
  if (dispensedBy === auditedBy) {
    if (isEmergency) {
      return { valid: true, warning: '緊急承認: 調剤者と鑑査者が同一です' };
    }
    return { valid: false, warning: '調剤者と鑑査者は異なる薬剤師でなければなりません' };
  }
  return { valid: true };
}
