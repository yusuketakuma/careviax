import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

function comparableText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildCommunicationResponseIntentKey(args: {
  requestId: string;
  responderName: string;
  content: string;
  respondedAt: Date | null;
}) {
  const material = [
    'communication-response',
    args.requestId,
    comparableText(args.responderName),
    comparableText(args.content),
    args.respondedAt ? args.respondedAt.toISOString() : 'responded-at-unspecified',
  ].join(':');
  return `communication-response:v1:${createHash('sha256').update(material).digest('hex')}`;
}

export function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
