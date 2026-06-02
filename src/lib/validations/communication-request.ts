import { RequestStatus } from '@prisma/client';
import { z } from 'zod';

export const communicationRequestStatusSchema = z.nativeEnum(RequestStatus);

export function trimStringOrUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

export const optionalTrimmedStringSchema = z.preprocess(
  trimStringOrUndefined,
  z.string().min(1).optional(),
);

export const optionalCommunicationRequestStatusSchema = z.preprocess(
  trimStringOrUndefined,
  communicationRequestStatusSchema.optional(),
);

export function optionalTrimmedSearchParam(value: string | null) {
  return value?.trim() || undefined;
}
