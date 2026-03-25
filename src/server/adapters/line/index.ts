/**
 * LINE Messaging API アダプタ — placeholder
 */
export class LineNotificationAdapter {
  async sendMessage(userId: string, message: string): Promise<void> {
    console.log(`[LINE] Send to ${userId}: ${message} — not implemented`);
  }
}
