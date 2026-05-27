export function isAllowedWebSocketUrl(wsUrl: string) {
  try {
    const parsed = new URL(wsUrl);
    if (parsed.protocol === 'wss:') return true;
    if (parsed.protocol !== 'ws:') return false;
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    return process.env.NODE_ENV !== 'production' && isLocalhost;
  } catch {
    return false;
  }
}

export function isYjsProviderConfigured(): boolean {
  const wsUrl = process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL;
  return Boolean(wsUrl && isAllowedWebSocketUrl(wsUrl));
}
