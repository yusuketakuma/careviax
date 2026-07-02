import { RequestStatus } from '@prisma/client';
import { z } from 'zod';
import { trimStringOrUndefined as sharedTrimStringOrUndefined } from './string';

export const communicationRequestStatusSchema = z.nativeEnum(RequestStatus);
export const COMMUNICATION_RESPONSE_CONTENT_MAX_LENGTH = 4000;

export const trimStringOrUndefined = sharedTrimStringOrUndefined;

export const requiredTrimmedStringSchema = (message: string) => z.string().trim().min(1, message);

export const communicationResponseContentSchema = z
  .string()
  .trim()
  .min(1, '回答内容は必須です')
  .max(
    COMMUNICATION_RESPONSE_CONTENT_MAX_LENGTH,
    `回答内容は${COMMUNICATION_RESPONSE_CONTENT_MAX_LENGTH}文字以内で入力してください`,
  );

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
