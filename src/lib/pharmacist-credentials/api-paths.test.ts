import { describe, expect, it } from 'vitest';
import { PHARMACIST_CREDENTIALS_API_PATH, buildPharmacistCredentialApiPath } from './api-paths';

describe('pharmacist credential API path helpers', () => {
  it('builds the collection API path', () => {
    expect(PHARMACIST_CREDENTIALS_API_PATH).toBe('/api/admin/pharmacist-credentials');
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildPharmacistCredentialApiPath('credential_1')).toBe(
      '/api/admin/pharmacist-credentials/credential_1',
    );
  });

  it('encodes only the credential id path segment', () => {
    const credentialId = 'credential/1?mode=x#frag';

    expect(buildPharmacistCredentialApiPath(credentialId)).toBe(
      `/api/admin/pharmacist-credentials/${encodeURIComponent(credentialId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment credential id %s', (credentialId) => {
    expect(() => buildPharmacistCredentialApiPath(credentialId)).toThrow(RangeError);
  });
});
