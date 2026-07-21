import { expect } from 'vitest';
import { NextRequest } from 'next/server';

export function createJobRequest(headers?: Record<string, string>) {
  return new NextRequest('http://localhost/api/jobs/daily-medication-check', {
    method: 'POST',
    headers,
  });
}

export async function expectJobSuccessData(response: Response, expected: Record<string, unknown>) {
  const body = await response.json();
  expect(body).toMatchObject({ data: expected });
  expect(body).not.toHaveProperty('jobType');
  expect(body).not.toHaveProperty('processedCount');
  return body.data as Record<string, unknown>;
}
