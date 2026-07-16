import { request } from 'node:https';
import type { LookupAddress } from 'node:dns';
import type { TLSSocket } from 'node:tls';

export class WebhookPeerMismatchError extends Error {
  constructor() {
    super('Webhook peer address did not match the pinned DNS address');
    this.name = 'WebhookPeerMismatchError';
  }
}

export type PinnedWebhookResponse = {
  status: number;
  ok: boolean;
};

function normalizedAddress(address: string) {
  return address.toLowerCase().replace(/^::ffff:/, '');
}

export function isPinnedWebhookPeer(remoteAddress: string | undefined, pinnedAddress: string) {
  return Boolean(
    remoteAddress && normalizedAddress(remoteAddress) === normalizedAddress(pinnedAddress),
  );
}

export function sendPinnedWebhookRequest(
  rawUrl: string,
  args: {
    addresses: LookupAddress[];
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    method: 'POST';
    redirect: 'manual';
  },
): Promise<PinnedWebhookResponse> {
  const target = new URL(rawUrl);
  const pinned = args.addresses[0];
  if (!pinned) return Promise.reject(new WebhookPeerMismatchError());

  return new Promise((resolve, reject) => {
    let settled = false;
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const req = request(
      target,
      {
        method: 'POST',
        // A fresh direct socket per attempt prevents environment proxies from becoming an
        // unverified second resolver or peer. Deployments that require a proxy must add a
        // pinned, peer-verifying proxy transport instead of inheriting HTTPS_PROXY implicitly.
        agent: false,
        servername: target.hostname,
        headers: args.headers,
        signal: args.signal,
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
      },
      (response) => {
        if (settled) {
          response.resume();
          return;
        }
        settled = true;
        response.resume();
        const status = response.statusCode ?? 0;
        resolve({ status, ok: status >= 200 && status < 300 });
      },
    );

    req.once('socket', (socket) => {
      const tlsSocket = socket as TLSSocket;
      tlsSocket.once('secureConnect', () => {
        const remoteAddress = tlsSocket.remoteAddress;
        if (!isPinnedWebhookPeer(remoteAddress, pinned.address)) {
          const error = new WebhookPeerMismatchError();
          tlsSocket.destroy(error);
          finishReject(error);
        }
      });
    });
    req.once('error', finishReject);
    req.end(args.body);
  });
}
