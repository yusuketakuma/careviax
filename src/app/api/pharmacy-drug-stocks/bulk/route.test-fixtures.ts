import { NextRequest } from 'next/server';
import { expect } from 'vitest';

export type BulkPayload = {
  importedCount: number;
  unmatchedRows: Array<Record<string, unknown>>;
  invalidRows: Array<Record<string, unknown>>;
  preview: {
    summary: Record<string, number>;
    rows: Array<Record<string, unknown>>;
  };
};

export function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/bulk', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

export function createMalformedJsonRequest() {
  return new NextRequest('http://localhost/api/pharmacy-drug-stocks/bulk', {
    method: 'POST',
    body: '{"site_id":',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
    },
  });
}

export async function readBulkPayload(response: Response): Promise<BulkPayload> {
  const payload: unknown = await response.json();
  expect(payload).toMatchObject({
    data: {
      importedCount: expect.any(Number),
      unmatchedRows: expect.any(Array),
      invalidRows: expect.any(Array),
      preview: {
        summary: expect.any(Object),
        rows: expect.any(Array),
      },
    },
  });
  return (payload as { data: BulkPayload }).data;
}

export function drugMasterFixture(
  id: string,
  yjCode: string,
  drugName: string,
  genericName: string,
) {
  return { id, yj_code: yjCode, drug_name: drugName, generic_name: genericName };
}
