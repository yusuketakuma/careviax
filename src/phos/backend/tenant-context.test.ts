import { describe, expect, it } from 'vitest';
import { UserRole } from '@/phos/contracts/phos_contracts';
import {
  assertTenantIdNotInExternalInput,
  buildTenantContext,
  TenantContextError,
} from './tenant-context';

describe('buildTenantContext', () => {
  it('builds canonical TenantContext from API Gateway JWT claims', () => {
    expect(
      buildTenantContext({
        claims: {
          token_use: 'access',
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user-uuid',
          scope: 'phos/cards.read phos/cards.write',
        },
        request_id: 'req_1',
      }),
    ).toEqual({
      tenant_id: 'tenant_abc123',
      user_id: 'user-uuid',
      role: UserRole.PHARMACIST,
      request_id: 'req_1',
      correlation_id: 'req_1',
      scopes: ['phos/cards.read', 'phos/cards.write'],
    });
  });

  it('accepts HTTP API JWT scp claims as route scopes', () => {
    expect(
      buildTenantContext({
        claims: {
          token_use: 'access',
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user-uuid',
          scp: ['phos/cards.read', 'phos/cards.write'],
        },
        request_id: 'req_scp',
      }).scopes,
    ).toEqual(['phos/cards.read', 'phos/cards.write']);
  });

  it('combines scope and scp claims without duplicate route scopes', () => {
    expect(
      buildTenantContext({
        claims: {
          token_use: 'access',
          tenant_id: 'tenant_abc123',
          role: 'PHARMACIST',
          sub: 'user-uuid',
          scope: 'phos/cards.read phos/cards.write',
          scp: 'phos/cards.write phos/evidence.write',
        },
        request_id: 'req_scope_scp',
      }).scopes,
    ).toEqual(['phos/cards.read', 'phos/cards.write', 'phos/evidence.write']);
  });

  it('rejects legacy custom Cognito attributes without canonical access-token claims', () => {
    expect(() =>
      buildTenantContext({
        claims: {
          token_use: 'access',
          'custom:tenant_id': 'tenant_legacy',
          'custom:role': 'PHARMACY_CLERK',
          sub: 'user-uuid',
        },
        request_id: 'req_2',
        correlation_id: 'corr_2',
      }),
    ).toThrow(TenantContextError);
  });

  it('rejects missing tenant, user, or role claims', () => {
    expect(() =>
      buildTenantContext({
        claims: { token_use: 'access', tenant_id: 'tenant_1' },
        request_id: 'req_3',
      }),
    ).toThrow(TenantContextError);
  });

  it('rejects ID tokens and unsafe tenant_id claims', () => {
    expect(() =>
      buildTenantContext({
        claims: { token_use: 'id', tenant_id: 'tenant_1', sub: 'user_1', role: 'PHARMACIST' },
        request_id: 'req_4',
      }),
    ).toThrow(TenantContextError);

    expect(() =>
      buildTenantContext({
        claims: {
          token_use: 'access',
          tenant_id: '../tenant_1',
          sub: 'user_1',
          role: 'PHARMACIST',
        },
        request_id: 'req_5',
      }),
    ).toThrow(TenantContextError);
  });
});

describe('assertTenantIdNotInExternalInput', () => {
  it('rejects tenant_id from body, query, or path', () => {
    for (const input of [
      { body: { tenant_id: 'tenant_other' } },
      { query: { tenant_id: 'tenant_other' } },
      { path: { tenant_id: 'tenant_other' } },
    ]) {
      expect(() => assertTenantIdNotInExternalInput({ request_id: 'req_4', ...input })).toThrow(
        TenantContextError,
      );
    }
  });

  it('rejects nested tenant_id from external input', () => {
    expect(() =>
      assertTenantIdNotInExternalInput({
        request_id: 'req_5',
        body: { payload: { tenant_id: 'tenant_other' } },
      }),
    ).toThrow(TenantContextError);
  });
});
