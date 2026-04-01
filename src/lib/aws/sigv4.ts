type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encodeUtf8(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Raw(key: Uint8Array | string, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? toArrayBuffer(encodeUtf8(key)) : toArrayBuffer(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, toArrayBuffer(encodeUtf8(value)))
  );
}

async function hmacSha256Hex(key: Uint8Array | string, value: string) {
  const signature = await hmacSha256Raw(key, value);
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function buildAwsSignatureKey(secretAccessKey: string, dateStamp: string, service: string, region: string) {
  const dateKey = await hmacSha256Raw(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = await hmacSha256Raw(dateKey, region);
  const serviceKey = await hmacSha256Raw(regionKey, service);
  return hmacSha256Raw(serviceKey, 'aws4_request');
}

export async function signAwsJsonRequest(args: {
  service: string;
  region: string;
  body: string;
  target?: string;
  credentials: AwsCredentials;
  host?: string;
}): Promise<{
  host: string;
  headers: Record<string, string>;
}> {
  const host = args.host ?? `${args.service}.${args.region}.amazonaws.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(args.body);
  const canonicalHeaders = [
    `content-type:application/x-amz-json-1.0`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ];

  if (args.target) {
    canonicalHeaders.push(`x-amz-target:${args.target}`);
  }
  if (args.credentials.sessionToken) {
    canonicalHeaders.push(`x-amz-security-token:${args.credentials.sessionToken}`);
  }

  canonicalHeaders.sort();
  const signedHeaders = canonicalHeaders.map((header) => header.split(':', 1)[0]).join(';');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `${canonicalHeaders.join('\n')}\n`,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const credentialScope = `${dateStamp}/${args.region}/${args.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');
  const signingKey = await buildAwsSignatureKey(
    args.credentials.secretAccessKey,
    dateStamp,
    args.service,
    args.region
  );
  const signature = await hmacSha256Hex(signingKey, stringToSign);

  return {
    host,
    headers: {
      Authorization: [
        'AWS4-HMAC-SHA256 Credential=',
        `${args.credentials.accessKeyId}/${credentialScope}, `,
        `SignedHeaders=${signedHeaders}, `,
        `Signature=${signature}`,
      ].join(''),
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
      ...(args.target ? { 'X-Amz-Target': args.target } : {}),
      ...(args.credentials.sessionToken
        ? {
            'X-Amz-Security-Token': args.credentials.sessionToken,
          }
        : {}),
    },
  };
}

export type { AwsCredentials };
