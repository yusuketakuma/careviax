import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

/**
 * Create a Yjs WebSocket provider for collaborative editing.
 *
 * Connects to a y-websocket compatible server. In development, this defaults
 * to `ws://localhost:1234`. In production, set `NEXT_PUBLIC_YJS_WEBSOCKET_URL`
 * to the API Gateway WebSocket endpoint.
 *
 * Room names follow the pattern `entityType:entityId` to scope collaboration
 * to a specific resource (e.g., `dispense_task:abc-123`).
 */
export function createYjsProvider(
  entityType: string,
  entityId: string,
  doc: Y.Doc,
  options?: { token?: string },
): WebsocketProvider | null {
  const wsUrl = process.env.NEXT_PUBLIC_YJS_WEBSOCKET_URL;
  if (!wsUrl) {
    console.warn(
      'NEXT_PUBLIC_YJS_WEBSOCKET_URL is not set — collaborative editing is disabled',
    );
    return null;
  }

  const roomName = `${entityType}:${entityId}`;

  const provider = new WebsocketProvider(wsUrl, roomName, doc, {
    params: options?.token ? { token: options.token } : {},
  });

  return provider;
}
