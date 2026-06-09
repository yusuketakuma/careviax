import { randomUUID } from 'node:crypto';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ErrorResponse } from '@/phos/contracts/phos_contracts';
import type {
  EvidencePresignUploadResponse,
  EvidenceUploadRequest,
} from '@/phos/contracts/phos_contracts';
import {
  assertTenantS3Key,
  buildEvidenceKey,
  TenantStorageKeyError,
  validateEvidenceUploadRequest,
} from './s3-evidence-key';
import { assertRouteAccess, PhosAuthorizationError } from './authorization';
import { toErrorLambdaResponse } from './error-response';
import type { EvidenceUploadIntentStore } from './evidence-upload-intent-store';
import type { PhosHandler } from './lambda-handler';
import { buildLogEntry, logPhosEvent } from './structured-logger';
import type { TenantContext } from './tenant-context';

export const EVIDENCE_UPLOAD_MAX_SIZE_BYTES = 25 * 1024 * 1024;
export const EVIDENCE_UPLOAD_DEFAULT_EXPIRES_IN_SECONDS = 300;

export type EvidenceUploadPresignInput = {
  key: string;
  mime_type: string;
  sha256: string;
  size_bytes: number;
};

export type EvidenceUploadPresigner = {
  presignPut(input: EvidenceUploadPresignInput): Promise<{
    upload_url: string;
    headers: Record<string, string>;
    expires_in_seconds: number;
  }>;
};

function validationError(ctx: TenantContext, details: Record<string, unknown>) {
  const response: ErrorResponse = {
    request_id: ctx.request_id,
    error_code: 'VALIDATION_ERROR',
    message_key: 'api.error.validation.generic',
    details,
  };
  return toErrorLambdaResponse(400, response);
}

function forbiddenError(ctx: TenantContext, error: PhosAuthorizationError) {
  const response: ErrorResponse = {
    request_id: ctx.request_id,
    error_code: 'FORBIDDEN',
    message_key: 'api.error.forbidden',
    details: error.details,
  };
  return toErrorLambdaResponse(403, response);
}

function assertEvidenceWriteAccess(ctx: TenantContext) {
  assertRouteAccess(ctx, 'POST /evidence/presign-upload');
}

function parseEvidenceUploadRequest(body: unknown): EvidenceUploadRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new TenantStorageKeyError('body is required');
  }
  const input = body as Partial<EvidenceUploadRequest>;
  return {
    card_id: String(input.card_id ?? ''),
    evidence_type: String(input.evidence_type ?? ''),
    file_name: String(input.file_name ?? ''),
    mime_type: String(input.mime_type ?? ''),
    sha256: String(input.sha256 ?? ''),
    size_bytes: Number(input.size_bytes),
    ...(typeof input.s3_key === 'string' ? { s3_key: input.s3_key } : {}),
  };
}

function assertUploadPolicy(input: EvidenceUploadRequest, max_size_bytes: number): void {
  validateEvidenceUploadRequest(input);
  if (input.size_bytes > max_size_bytes) {
    throw new TenantStorageKeyError('size_bytes exceeds max upload size');
  }
}

function logEvidencePresign(input: {
  ctx: TenantContext;
  error_code?: string;
  card_id?: string;
  evidence_id?: string;
}) {
  logPhosEvent(
    buildLogEntry({
      level: input.error_code ? 'ERROR' : 'INFO',
      message: input.error_code
        ? 'PH-OS evidence presign failed'
        : 'PH-OS evidence presign succeeded',
      ctx: input.ctx,
      route_key: 'POST /evidence/presign-upload',
      ...(input.error_code ? { error_code: input.error_code } : {}),
      ...(input.card_id ? { card_id: input.card_id } : {}),
      ...(input.evidence_id ? { evidence_id: input.evidence_id } : {}),
    }),
  );
}

function emitEvidenceUploadFailed(input: {
  ctx: TenantContext;
  error_code: string;
  card_id?: string;
}) {
  input.ctx.observability?.emitMetric({
    name: 'EvidenceUploadFailedCount',
    value: 1,
    unit: 'Count',
    route_key: 'POST /evidence/presign-upload',
    tenant_id: input.ctx.tenant_id,
    user_id: input.ctx.user_id,
    request_id: input.ctx.request_id,
    correlation_id: input.ctx.correlation_id,
    error_code: input.error_code,
  });
  if (input.error_code === 'FORBIDDEN') {
    input.ctx.observability?.recordSecurityEvent({
      event_type: 'EVIDENCE_UPLOAD_REJECTED',
      severity: 'WARNING',
      tenant_id: input.ctx.tenant_id,
      user_id: input.ctx.user_id,
      request_id: input.ctx.request_id,
      correlation_id: input.ctx.correlation_id,
      route_key: 'POST /evidence/presign-upload',
      error_code: input.error_code,
      details: {
        card_id: input.card_id ?? null,
      },
    });
  }
}

export function createEvidencePresignUploadHandler(
  presigner: EvidenceUploadPresigner,
  options: {
    generateEvidenceId?: () => string;
    max_size_bytes?: number;
    upload_intent_store?: EvidenceUploadIntentStore;
  } = {},
): PhosHandler {
  return async ({ ctx, body }) => {
    try {
      assertEvidenceWriteAccess(ctx);
      const request = parseEvidenceUploadRequest(body);
      const max_size_bytes = options.max_size_bytes ?? EVIDENCE_UPLOAD_MAX_SIZE_BYTES;
      assertUploadPolicy(request, max_size_bytes);

      const evidence_id = options.generateEvidenceId?.() ?? randomUUID();
      const s3_key = buildEvidenceKey(ctx, {
        card_id: request.card_id,
        evidence_id,
        file_name_or_ext: request.file_name,
      });
      assertTenantS3Key(ctx, s3_key);

      const presigned = await presigner.presignPut({
        key: s3_key,
        mime_type: request.mime_type,
        sha256: request.sha256,
        size_bytes: request.size_bytes,
      });
      await options.upload_intent_store?.recordUploadIntent(ctx, {
        evidence_id,
        card_id: request.card_id,
        evidence_type: request.evidence_type,
        s3_key,
        mime_type: request.mime_type,
        sha256: request.sha256,
        size_bytes: request.size_bytes,
        expires_in_seconds: presigned.expires_in_seconds,
      });

      logEvidencePresign({ ctx, card_id: request.card_id, evidence_id });
      return {
        request_id: ctx.request_id,
        evidence_id,
        s3_key,
        upload_url: presigned.upload_url,
        method: 'PUT',
        headers: presigned.headers,
        expires_in_seconds: presigned.expires_in_seconds,
        max_size_bytes,
      } satisfies EvidencePresignUploadResponse;
    } catch (error) {
      if (error instanceof PhosAuthorizationError) {
        logEvidencePresign({ ctx, error_code: 'FORBIDDEN' });
        emitEvidenceUploadFailed({ ctx, error_code: 'FORBIDDEN' });
        return forbiddenError(ctx, error);
      }
      if (error instanceof TenantStorageKeyError) {
        logEvidencePresign({ ctx, error_code: 'VALIDATION_ERROR' });
        emitEvidenceUploadFailed({ ctx, error_code: 'VALIDATION_ERROR' });
        return validationError(ctx, { reason: error.message });
      }
      emitEvidenceUploadFailed({ ctx, error_code: 'INTERNAL_ERROR' });
      throw error;
    }
  };
}

export function createS3EvidenceUploadPresigner(input: {
  client: S3Client;
  bucket: string;
  expires_in_seconds?: number;
}): EvidenceUploadPresigner {
  return {
    async presignPut(request: EvidenceUploadPresignInput) {
      const expires_in_seconds =
        input.expires_in_seconds ?? EVIDENCE_UPLOAD_DEFAULT_EXPIRES_IN_SECONDS;
      const command = new PutObjectCommand({
        Bucket: input.bucket,
        Key: request.key,
        ContentType: request.mime_type,
        Metadata: {
          sha256: request.sha256,
          size_bytes: String(request.size_bytes),
        },
      });
      const upload_url = await getSignedUrl(input.client, command, {
        expiresIn: expires_in_seconds,
      });
      return {
        upload_url,
        headers: {
          'Content-Type': request.mime_type,
          'x-amz-meta-sha256': request.sha256,
          'x-amz-meta-size_bytes': String(request.size_bytes),
        },
        expires_in_seconds,
      };
    },
  };
}
