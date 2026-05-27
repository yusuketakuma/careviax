import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { isYjsProviderConfigured } from './yjs-config';

export { isYjsProviderConfigured } from './yjs-config';

/**
 * Create a Yjs WebSocket provider for collaborative editing.
 *
 * Connects to a y-websocket compatible server. In development, this defaults
 * to `ws://localhost:1234`. In production, set `NEXT_PUBLIC_YJS_WEBSOCKET_URL`
 * to the API Gateway WebSocket endpoint.
 *
 * Room names are issued by the server after entity-level authorization.
 */
export function createYjsProvider(
  roomName: string,
  doc: Y.Doc,
  options: { token: string },
): WebsocketProvider | null {
  const wsUrl = process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL;
  if (!wsUrl) {
    console.warn('NEXT_PUBLIC_YJS_WEBSOCKET_URL is not set — collaborative editing is disabled');
    return null;
  }
  if (!isYjsProviderConfigured()) return null;
  if (!roomName || !options.token) return null;

  const provider = new WebsocketProvider(wsUrl, roomName, doc, {
    params: { token: options.token },
  });

  return provider;
}
