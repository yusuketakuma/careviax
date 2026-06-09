import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryObservabilitySink } from './observability';
import {
  createLambdaObservabilitySink,
  createXRayTraceAnnotationSink,
} from './lambda-observability';

describe('createLambdaObservabilitySink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the injected observability sink when provided', () => {
    const injected = createInMemoryObservabilitySink();

    expect(createLambdaObservabilitySink({ observability: injected })).toBe(injected);
  });

  it('persists security events through the injected DynamoDB security event client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const send = vi.fn(async (command: PutItemCommand) => {
      expect(command).toBeInstanceOf(PutItemCommand);
      return {};
    });
    const sink = createLambdaObservabilitySink({
      security_event_client: { send },
      security_event_table_name: 'phos_core',
      now: () => new Date('2026-06-09T07:00:00.000Z'),
    });

    sink.recordSecurityEvent({
      event_type: 'AUTHORIZATION_DENIED',
      severity: 'WARNING',
      tenant_id: 'tenant_abc123',
      user_id: 'user_1',
      request_id: 'req_1',
      correlation_id: 'corr_1',
      route_key: 'GET /cards',
      error_code: 'FORBIDDEN',
      details: { missing_scopes: ['phos/cards.read'] },
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  });

  it('writes trace annotations through the injected Lambda trace sink', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const traceSink = { annotateTrace: vi.fn() };
    const sink = createLambdaObservabilitySink({ trace_annotation_sink: traceSink });

    sink.annotateTrace({
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id_hash: 'tenant_hash_1234',
      action_code: 'COMPLETE_VISIT',
    });

    expect(traceSink.annotateTrace).toHaveBeenCalledWith({
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id_hash: 'tenant_hash_1234',
      action_code: 'COMPLETE_VISIT',
    });
  });

  it('adds X-Ray annotations to the current segment when one exists', () => {
    const addAnnotation = vi.fn();
    const sink = createXRayTraceAnnotationSink(() => ({ addAnnotation }));

    sink.annotateTrace({
      route_key: 'POST /cards/{card_id}/actions',
      tenant_id_hash: 'tenant_hash_1234',
      action_code: 'COMPLETE_VISIT',
      error_code: 'ACTION_GUARD_FAILED',
    });

    expect(addAnnotation).toHaveBeenCalledWith('route_key', 'POST /cards/{card_id}/actions');
    expect(addAnnotation).toHaveBeenCalledWith('tenant_id_hash', 'tenant_hash_1234');
    expect(addAnnotation).toHaveBeenCalledWith('action_code', 'COMPLETE_VISIT');
    expect(addAnnotation).toHaveBeenCalledWith('error_code', 'ACTION_GUARD_FAILED');
  });
});
