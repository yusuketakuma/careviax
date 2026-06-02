import { describe, expect, it } from 'vitest';
import { parseArgs } from './perf-smoke';

describe('perf-smoke parseArgs', () => {
  it('uses bounded defaults for malformed numeric environment values', () => {
    const args = parseArgs([], {
      PERF_REQUESTS: 'NaN',
      PERF_CONCURRENCY: 'Infinity',
      PERF_TARGET_MS: '0',
    });

    expect(args.requests).toBe(40);
    expect(args.concurrency).toBe(4);
    expect(args.targetMs).toBe(500);
  });

  it('normalizes numeric CLI overrides before running workers', () => {
    const args = parseArgs(
      [
        '--requests',
        '1000000',
        '--concurrency',
        '12.8',
        '--target-ms',
        '250.9',
        '--method',
        'post',
        '--path',
        '/api/patients',
        '--path',
        '/api/patients',
        '--header',
        'Authorization: Bearer test-token',
      ],
      {},
    );

    expect(args).toMatchObject({
      requests: 10_000,
      concurrency: 12,
      targetMs: 250,
      method: 'POST',
      paths: ['/api/patients'],
      headers: {
        Authorization: 'Bearer test-token',
      },
    });
  });

  it('falls back per CLI option when a numeric override is invalid', () => {
    const args = parseArgs(
      ['--requests', '-1', '--concurrency', 'abc', '--target-ms', 'Infinity'],
      {
        PERF_REQUESTS: '5',
        PERF_CONCURRENCY: '6',
        PERF_TARGET_MS: '700',
      },
    );

    expect(args.requests).toBe(40);
    expect(args.concurrency).toBe(4);
    expect(args.targetMs).toBe(500);
  });
});
