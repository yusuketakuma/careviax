/**
 * オンライン資格確認アダプタ — placeholder
 * Connects to Japan's Online Qualification Confirmation System
 */
export class QualificationCheckAdapter {
  async checkInsurance(insuranceNumber: string): Promise<{
    valid: boolean;
    expiryDate?: string;
    copayRatio?: number;
  } | null> {
    // TODO: Implement online qualification check
    console.log(`[QualCheck] Check ${insuranceNumber} — not implemented`);
    return null;
  }
}
