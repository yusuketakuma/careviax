import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { importYreseClinicalWebhookMock, loggerErrorMock } = vi.hoisted(() => ({
  importYreseClinicalWebhookMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/server/services/standard-clinical-integration-import', () => ({
  importYreseClinicalWebhook: importYreseClinicalWebhookMock,
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: loggerErrorMock },
}));

import { POST } from './route';

const SECRET = 'yrese-webhook-test-secret';

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function createRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/webhooks/yrese', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body,
  });
}

function signedRequest(payload: unknown, signature = sign(JSON.stringify(payload))) {
  const body = JSON.stringify(payload);
  return createRequest(body, { 'x-yrese-signature': signature });
}

describe('/api/webhooks/yrese POST', () => {
  const originalSecret = process.env.YRESE_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.YRESE_WEBHOOK_SECRET = SECRET;
    importYreseClinicalWebhookMock.mockResolvedValue({
      externalSystemId: 'external_system_1',
      yreseClinicalEventId: 'yrese_event_1',
      queueItemId: 'queue_1',
      importedResources: [{ resourceId: 'medreq_1' }],
    });
  });

  afterAll(() => {
    process.env.YRESE_WEBHOOK_SECRET = originalSecret;
  });

  it('fails closed when the signing secret is not configured', async () => {
    delete process.env.YRESE_WEBHOOK_SECRET;
    const body = JSON.stringify({ event_type: 'dispensing.confirmed', tenant_id: 'org_1' });
    const signature = sign(body);

    const response = await POST(createRequest(body, { 'x-yrese-signature': signature }));

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      code: 'YRESE_WEBHOOK_SECRET_UNAVAILABLE',
      message: 'yrese webhook signing secret is not configured',
    });
    expect(JSON.stringify(responseBody)).not.toContain(signature);
    expect(JSON.stringify(responseBody)).not.toContain(SECRET);
    expect(importYreseClinicalWebhookMock).not.toHaveBeenCalled();
  });

  it('rejects missing and invalid signatures before importing the payload', async () => {
    const body = JSON.stringify({ event_type: 'dispensing.confirmed', tenant_id: 'org_1' });

    const missing = await POST(createRequest(body));
    expect(missing.status).toBe(401);
    expect(missing.headers.get('cache-control')).toContain('no-store');
    await expect(missing.json()).resolves.toEqual({
      code: 'YRESE_WEBHOOK_SIGNATURE_INVALID',
      message: 'Webhook signature is invalid',
    });

    const invalidSignature = 'sha256=bad-secret-token';
    const invalid = await POST(createRequest(body, { 'x-yrese-signature': invalidSignature }));
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get('cache-control')).toContain('no-store');
    const invalidBody = await invalid.json();
    expect(invalidBody).toEqual({
      code: 'YRESE_WEBHOOK_SIGNATURE_INVALID',
      message: 'Webhook signature is invalid',
    });
    expect(JSON.stringify(invalidBody)).not.toContain(invalidSignature);

    expect(importYreseClinicalWebhookMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON after signature verification without importing', async () => {
    const body = '{"event_type":';

    const response = await POST(createRequest(body, { 'x-yrese-signature': sign(body) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(importYreseClinicalWebhookMock).not.toHaveBeenCalled();
  });

  it('accepts a signed yrese event and imports optional FHIR resources without echoing raw payload', async () => {
    const payload = {
      event_id: 'evt_001',
      event_type: 'dispensing.confirmed',
      occurred_at: '2026-07-09T09:00:00+09:00',
      tenant_id: 'org_1',
      pharmacy_id: 'pharmacy_1',
      patient_ref: 'Patient/patient_123',
      resource_refs: ['MedicationRequest/medreq_1'],
      schema_version: '1.0.0',
      raw_patient_name: 'LEAK_PATIENT_NAME',
      resources: [
        {
          resourceType: 'MedicationRequest',
          id: 'medreq_1',
          identifier: [{ system: 'urn:yrese:prescription', value: 'LEAK_IDENTIFIER' }],
        },
      ],
    };

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      data: {
        accepted: true,
        event_id: 'evt_001',
        event_type: 'dispensing.confirmed',
        imported_resource_count: 1,
      },
    });
    expect(importYreseClinicalWebhookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        externalSystem: { systemKey: 'yrese-webhook' },
        webhook: expect.objectContaining({
          eventId: 'evt_001',
          eventType: 'dispensing.confirmed',
          resourceRefs: ['MedicationRequest/medreq_1', 'Patient/patient_123'],
          payload,
          payloadProfile: 'yrese.webhook.v1',
        }),
        fhirResources: [{ resource: payload.resources[0] }],
        queue: { operation: 'yrese.dispensing.confirmed.process' },
      }),
    );

    const responseText = JSON.stringify(responseBody);
    expect(responseText).not.toContain('LEAK_PATIENT_NAME');
    expect(responseText).not.toContain('LEAK_IDENTIFIER');
  });

  it('rejects oversized webhook payloads before import', async () => {
    const body = JSON.stringify({
      event_type: 'dispensing.confirmed',
      tenant_id: 'org_1',
      padding: 'x'.repeat(1024 * 1024),
    });

    const response = await POST(createRequest(body, { 'x-yrese-signature': sign(body) }));

    expect(response.status).toBe(413);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      code: 'YRESE_WEBHOOK_PAYLOAD_TOO_LARGE',
      message: 'Webhook payload is too large',
    });
    expect(JSON.stringify(responseBody)).not.toContain('x'.repeat(32));
    expect(importYreseClinicalWebhookMock).not.toHaveBeenCalled();
  });

  it('returns a fixed failure and logs only coded metadata when import rejects', async () => {
    const payload = {
      event_id: 'evt_failure_001',
      event_type: 'dispensing.confirmed',
      tenant_id: 'org_1',
      patient_ref: 'Patient/patient_secret_123',
    };
    const body = JSON.stringify(payload);
    const rawError = new Error(
      'patient 山田太郎 / bearer secret-yrese-token / MedicationRequest/private_123',
    );
    importYreseClinicalWebhookMock.mockRejectedValueOnce(rawError);

    const response = await POST(signedRequest(payload));

    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const responseBody = await response.json();
    expect(responseBody).toEqual({
      code: 'YRESE_WEBHOOK_IMPORT_FAILED',
      message: 'Webhook import failed',
    });
    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith({
      event: 'yrese.webhook_import_failed',
      route: '/api/webhooks/yrese',
      operation: 'receive_yrese_webhook',
      code: 'YRESE_WEBHOOK_IMPORT_FAILED',
      count: Buffer.byteLength(body, 'utf8'),
    });
    expect(loggerErrorMock.mock.calls[0]).toHaveLength(1);
    expect(loggerErrorMock.mock.calls.flat()).not.toContain(rawError);
    expect(JSON.stringify(responseBody)).not.toContain('山田太郎');
    expect(JSON.stringify(responseBody)).not.toContain('secret-yrese-token');
  });
});
