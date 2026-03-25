/**
 * SMS通知アダプタ — placeholder (Amazon SNS)
 */
export class SmsNotificationAdapter {
  async sendSms(phoneNumber: string, message: string): Promise<void> {
    console.log(`[SMS] Send to ${phoneNumber}: ${message} — not implemented`);
  }
}
