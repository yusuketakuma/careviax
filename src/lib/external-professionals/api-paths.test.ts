import { describe, expect, it } from 'vitest';
import {
  ADMIN_EXTERNAL_PROFESSIONALS_API_PATH,
  buildAdminExternalProfessionalApiPath,
  buildAdminExternalProfessionalPatientsApiPath,
  buildAdminExternalProfessionalsApiPath,
} from './api-paths';

describe('external professional admin API path helpers', () => {
  it('builds the collection API path', () => {
    expect(ADMIN_EXTERNAL_PROFESSIONALS_API_PATH).toBe('/api/admin/external-professionals');
  });

  it('preserves the empty-list query path shape', () => {
    expect(buildAdminExternalProfessionalsApiPath(new URLSearchParams())).toBe(
      '/api/admin/external-professionals?',
    );
  });

  it('builds list query paths with encoded search params', () => {
    const params = new URLSearchParams({ q: '訪看/北?x=y#z' });

    expect(buildAdminExternalProfessionalsApiPath(params)).toBe(
      `/api/admin/external-professionals?${params.toString()}`,
    );
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildAdminExternalProfessionalApiPath('external_1')).toBe(
      '/api/admin/external-professionals/external_1',
    );
  });

  it('encodes only the external professional id path segment', () => {
    const id = 'external/1?mode=x#frag';

    expect(buildAdminExternalProfessionalApiPath(id)).toBe(
      `/api/admin/external-professionals/${encodeURIComponent(id)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment external professional id %s', (id) => {
    expect(() => buildAdminExternalProfessionalApiPath(id)).toThrow(RangeError);
  });

  it('builds linked patient paths with an independently encoded external professional id', () => {
    const id = 'external/1?mode=x#frag';
    const params = new URLSearchParams({ limit: '20', archive_status: 'active' });

    expect(buildAdminExternalProfessionalPatientsApiPath(id, params)).toBe(
      `/api/admin/external-professionals/${encodeURIComponent(id)}/patients?${params.toString()}`,
    );
  });

  it('preserves the empty linked-patient query path shape', () => {
    expect(buildAdminExternalProfessionalPatientsApiPath('external_1', new URLSearchParams())).toBe(
      '/api/admin/external-professionals/external_1/patients?',
    );
  });

  it.each(['.', '..'])(
    'rejects exact dot-segment external professional id for linked-patient path %s',
    (id) => {
      expect(() =>
        buildAdminExternalProfessionalPatientsApiPath(id, new URLSearchParams()),
      ).toThrow(RangeError);
    },
  );
});
