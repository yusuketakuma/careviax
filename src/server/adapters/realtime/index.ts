/**
 * リアルタイムステータス共有アダプタ — placeholder
 * Options: WebSocket (Next.js custom server) or Server-Sent Events
 */
export class RealtimeAdapter {
  async broadcastStatusUpdate(channel: string, data: Record<string, unknown>): Promise<void> {
    console.log(`[Realtime] Broadcast to ${channel}:`, data, '— not implemented');
  }

  async subscribeToChannel(channel: string, callback: (data: unknown) => void): Promise<void> {
    console.log(`[Realtime] Subscribe to ${channel} — not implemented`);
    // Suppress unused parameter warning in placeholder
    void callback;
    // TODO: Implement SSE or WebSocket subscription
  }
}
