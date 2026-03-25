/**
 * 電子処方箋管理サービスアダプタ — placeholder
 * MHLW's e-Prescription Management Service integration
 */
export class EPrescriptionAdapter {
  async fetchPrescription(prescriptionId: string): Promise<unknown> {
    // TODO: Connect to e-Prescription Management Service API
    console.log(`[ePrescription] Fetch ${prescriptionId} — not implemented`);
    return null;
  }

  async confirmDispense(prescriptionId: string, dispenseData: Record<string, unknown>): Promise<void> {
    // TODO: Report dispense completion to e-Prescription service
    console.log(`[ePrescription] Confirm dispense ${prescriptionId} — not implemented`, dispenseData);
  }
}
