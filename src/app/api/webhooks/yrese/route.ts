import { unstable_rethrow } from 'next/navigation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { error, registeredError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { readJsonObject } from '@/lib/db/json';
import { logger } from '@/lib/utils/logger';
import { importYreseClinicalWebhook } from '@/server/services/standard-clinical-integration-import';
import { verifyYreseWebhookSignature } from '@/server/services/yrese-webhook-signature';

export const runtime = 'nodejs';

const ROUTE = '/api/webhooks/yrese';
const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;
const MAX_RESOURCE_IMPORTS_PER_WEBHOOK = 20;
const SIGNATURE_HEADERS = ['x-yrese-signature', 'x-ph-os-yrese-signature'] as const;

const yreseWebhookPayloadSchema = z
  .object({
    event_id: z.string().trim().min(1).max(200).optional(),
    event_type: z.string().trim().min(1).max(200),
    occurred_at: z.string().trim().min(1).max(80).optional(),
    tenant_id: z.string().trim().min(1).max(200),
    org_id: z.string().trim().min(1).max(200).optional(),
    pharmacy_id: z.string().trim().min(1).max(200).optional(),
    patient_ref: z.string().trim().min(1).max(300).optional(),
    resource_refs: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
    schema_version: z.string().trim().min(1).max(50).optional(),
    signature: z.string().optional(),
  })
  .passthrough();

function readSignatureHeader(req: NextRequest): string | null {
  for (const header of SIGNATURE_HEADERS) {
    const value = req.headers.get(header);
    if (value) return value;
  }
  return null;
}

function parseWebhookDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid webhook occurred_at');
  }
  return date;
}

function parseBodyTextAsJsonObject(bodyText: string): Record<string, unknown> | null {
  try {
    return readJsonObject(JSON.parse(bodyText));
  } catch {
    return null;
  }
}

function readResourceArray(payload: Record<string, unknown>): unknown[] {
  const directResources = payload.fhir_resources ?? payload.resources;
  if (Array.isArray(directResources)) return directResources;

  const singleResource = readJsonObject(payload.resource);
  if (singleResource) return [singleResource];

  const bundle = readJsonObject(payload.bundle ?? payload.fhir_bundle);
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  return entries.flatMap((entry) => {
    const resource = readJsonObject(readJsonObject(entry)?.resource);
    return resource ? [resource] : [];
  });
}

function normalizeResourceRefs(payload: z.infer<typeof yreseWebhookPayloadSchema>) {
  const refs = new Set<string>();
  for (const ref of payload.resource_refs ?? []) {
    const trimmed = ref.trim();
    if (trimmed) refs.add(trimmed);
  }
  if (payload.patient_ref) refs.add(payload.patient_ref);
  return [...refs];
}

function readFhirResources(payload: Record<string, unknown>) {
  return readResourceArray(payload)
    .slice(0, MAX_RESOURCE_IMPORTS_PER_WEBHOOK)
    .map((resource) => ({ resource }));
}

function noStore(response: NextResponse) {
  return withSensitiveNoStore(response);
}

export async function POST(req: NextRequest) {
  let bodyText = '';
  try {
    bodyText = await req.text();
    if (Buffer.byteLength(bodyText, 'utf8') > MAX_WEBHOOK_BODY_BYTES) {
      return noStore(error('YRESE_WEBHOOK_PAYLOAD_TOO_LARGE', 'Webhook payload is too large', 413));
    }

    const signatureResult = verifyYreseWebhookSignature({
      body: bodyText,
      signatureHeader: readSignatureHeader(req),
    });
    if (!signatureResult.ok) {
      if (signatureResult.reason === 'secret_unconfigured') {
        return noStore(
          error(
            'YRESE_WEBHOOK_SECRET_UNAVAILABLE',
            'yrese webhook signing secret is not configured',
            503,
          ),
        );
      }
      return noStore(error('YRESE_WEBHOOK_SIGNATURE_INVALID', 'Webhook signature is invalid', 401));
    }

    const bodyObject = parseBodyTextAsJsonObject(bodyText);
    if (!bodyObject) {
      return noStore(validationError('Webhook payload must be a JSON object'));
    }

    const parsed = yreseWebhookPayloadSchema.safeParse(bodyObject);
    if (!parsed.success) {
      return noStore(
        validationError('Webhook payload is invalid', parsed.error.flatten().fieldErrors),
      );
    }

    let occurredAt: Date | undefined;
    try {
      occurredAt = parseWebhookDate(parsed.data.occurred_at);
    } catch {
      return noStore(validationError('Webhook occurred_at is invalid'));
    }

    const eventType = parsed.data.event_type;
    const result = await importYreseClinicalWebhook({
      orgId: parsed.data.org_id ?? parsed.data.tenant_id,
      externalSystem: {
        systemKey: 'yrese-webhook',
      },
      webhook: {
        eventId: parsed.data.event_id,
        eventType,
        occurredAt,
        schemaVersion: parsed.data.schema_version,
        resourceRefs: normalizeResourceRefs(parsed.data),
        payload: bodyObject,
        payloadProfile: 'yrese.webhook.v1',
        metadata: {
          tenant_id: parsed.data.tenant_id,
          pharmacy_id: parsed.data.pharmacy_id,
          resource_import_count: readResourceArray(bodyObject).length,
        },
      },
      fhirResources: readFhirResources(bodyObject),
      queue: {
        operation: `yrese.${eventType}.process`,
      },
    });

    return noStore(
      success(
        {
          data: {
            accepted: true,
            event_id: parsed.data.event_id ?? null,
            event_type: eventType,
            imported_resource_count: result.importedResources.length,
          },
        },
        202,
      ),
    );
  } catch (err) {
    unstable_rethrow(err);
    logger.error({
      event: 'yrese.webhook_import_failed',
      route: ROUTE,
      operation: 'receive_yrese_webhook',
      code: 'YRESE_WEBHOOK_IMPORT_FAILED',
      count: Buffer.byteLength(bodyText, 'utf8'),
    });
    return noStore(registeredError('YRESE_WEBHOOK_IMPORT_FAILED', 'Webhook import failed'));
  }
}
