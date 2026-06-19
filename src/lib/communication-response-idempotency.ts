import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getAuthSecret } from '@/lib/auth/secret';

function comparableText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

type CommunicationResponseIntentInput = {
  requestId: string;
  responderName: string;
  content: string;
  respondedAt: Date | null;
};

function buildCommunicationResponseIntentMaterial(args: CommunicationResponseIntentInput) {
  return [
    'communication-response',
    args.requestId,
    comparableText(args.responderName),
    comparableText(args.content),
    args.respondedAt ? args.respondedAt.toISOString() : 'responded-at-unspecified',
  ].join(':');
}

function resolveCommunicationResponseHashSecret() {
  const configuredSecret = process.env.COMMUNICATION_RESPONSE_HASH_SECRET?.trim();
  if (configuredSecret) return configuredSecret;
  const authSecret = getAuthSecret();
  if (authSecret) return authSecret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('communication response hash secret is not configured');
  }
  return 'ph-os-local-communication-response-secret';
}

function keyedHash(value: string) {
  return createHmac('sha256', resolveCommunicationResponseHashSecret()).update(value).digest('hex');
}

export function buildLegacyCommunicationResponseIntentKey(args: CommunicationResponseIntentInput) {
  return `communication-response:v1:${createHash('sha256')
    .update(buildCommunicationResponseIntentMaterial(args))
    .digest('hex')}`;
}

export function buildCommunicationResponseIntentKey(args: CommunicationResponseIntentInput) {
  return `communication-response:v2:${keyedHash(buildCommunicationResponseIntentMaterial(args))}`;
}

export function buildCommunicationResponseContentDigest(args: {
  requestId: string;
  responseId: string;
  content: string;
}) {
  const material = [
    'communication-response-content',
    args.requestId,
    comparableText(args.content),
    args.responseId,
  ].join(':');
  return `communication-response-content:v1:${keyedHash(material)}`;
}

export function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
