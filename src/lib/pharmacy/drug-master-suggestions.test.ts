import { describe, expect, it, vi } from 'vitest';
import { fetchDrugMasterSuggestions } from './drug-master-suggestions';
import { jsonResponse } from '@/test/fetch-test-utils';

const validSuggestion = {
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
};

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
        data: [validSuggestion],
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
    const failedBodyText = vi.fn(async () => 'patient:山田太郎 medication:ワルファリン');
    await expect(
      fetchDrugMasterSuggestions({
        query: 'アム',
        orgId: 'org_1',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue({
          ok: false,
          status: 500,
          text: failedBodyText,
        } as unknown as Response),
      }),
    ).resolves.toEqual([]);
    expect(failedBodyText).not.toHaveBeenCalled();

    await expect(
      fetchDrugMasterSuggestions({
        query: 'アム',
        orgId: 'org_1',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json')),
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

  it('keeps suggestion rows all-or-nothing when identity or safety fields are invalid', async () => {
    await expect(
      fetchDrugMasterSuggestions({
        query: 'アム',
        orgId: 'org_1',
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(jsonResponse({ data: [{ ...validSuggestion, yj_code: 123 }] })),
      }),
    ).resolves.toEqual([]);

    await expect(
      fetchDrugMasterSuggestions({
        query: 'アム',
        orgId: 'org_1',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
          jsonResponse({
            data: [
              validSuggestion,
              {
                ...validSuggestion,
                id: 'drug_2',
                is_narcotic: null,
              },
            ],
          }),
        ),
      }),
    ).resolves.toEqual([]);
  });

  it('keeps fetch rejections as query errors for retryable UI handling', async () => {
    const fetchError = new Error('network unavailable');

    await expect(
      fetchDrugMasterSuggestions({
        query: 'アム',
        orgId: 'org_1',
        fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(fetchError),
      }),
    ).rejects.toThrow(fetchError);
  });
});
