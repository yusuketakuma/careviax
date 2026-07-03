import { describe, expect, it, vi } from 'vitest';
import { fetchDrugMasterSuggestions } from './drug-master-suggestions';
import { jsonResponse } from '@/test/fetch-test-utils';

describe('fetchDrugMasterSuggestions', () => {
  it('skips short queries before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      fetchDrugMasterSuggestions({ query: 'ア', orgId: 'org_1', fetchImpl }),
    ).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the lightweight drug master endpoint and validates response rows', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'drug_1',
            yj_code: '123',
            drug_name: 'アムロジピン',
            drug_name_kana: null,
            generic_name: 'アムロジピン',
            drug_price: 10.5,
            unit: '錠',
            dosage_form: '錠剤',
            manufacturer: null,
            is_generic: true,
            is_narcotic: false,
            is_psychotropic: false,
            max_administration_days: null,
          },
        ],
      }),
    );

    const result = await fetchDrugMasterSuggestions({
      query: ' アム ',
      orgId: 'org_1',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    const params = new URLSearchParams(String(url).split('?')[1]);
    expect(params.get('q')).toBe('アム');
    expect(params.get('limit')).toBe('10');
    expect(params.get('includeTotal')).toBe('false');
    expect(init).toMatchObject({ headers: { 'x-org-id': 'org_1' } });
    expect(result).toHaveLength(1);
  });

  it('falls back to empty suggestions for failed or malformed responses', async () => {
    await expect(
      fetchDrugMasterSuggestions({
        query: 'アム',
        orgId: 'org_1',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, { status: 500 })),
      }),
    ).resolves.toEqual([]);

    await expect(
      fetchDrugMasterSuggestions({
        query: 'アム',
        orgId: 'org_1',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [{ id: 123 }] })),
      }),
    ).resolves.toEqual([]);
  });
});
