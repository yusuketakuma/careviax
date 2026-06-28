import { describe, expect, it } from 'vitest';
import {
  PRESCRIBER_INSTITUTIONS_API_PATH,
  buildPrescriberInstitutionApiPath,
  buildPrescriberInstitutionsApiPath,
} from './api-paths';

describe('prescriber institution API path helpers', () => {
  it('builds the collection API path', () => {
    expect(PRESCRIBER_INSTITUTIONS_API_PATH).toBe('/api/prescriber-institutions');
  });

  it('preserves the list query path shape for empty params', () => {
    expect(buildPrescriberInstitutionsApiPath(new URLSearchParams())).toBe(
      '/api/prescriber-institutions?',
    );
  });

  it('builds list query paths with encoded search params', () => {
    const params = new URLSearchParams({ q: '在宅/内科?x=y#z' });

    expect(buildPrescriberInstitutionsApiPath(params)).toBe(
      `/api/prescriber-institutions?${params.toString()}`,
    );
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildPrescriberInstitutionApiPath('institution_1')).toBe(
      '/api/prescriber-institutions/institution_1',
    );
  });

  it('encodes only the institution id path segment', () => {
    const institutionId = 'institution/1?mode=x#frag';

    expect(buildPrescriberInstitutionApiPath(institutionId)).toBe(
      `/api/prescriber-institutions/${encodeURIComponent(institutionId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment institution id %s', (institutionId) => {
    expect(() => buildPrescriberInstitutionApiPath(institutionId)).toThrow(RangeError);
  });
});
