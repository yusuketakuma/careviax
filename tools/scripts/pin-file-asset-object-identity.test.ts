import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashBody, loadManifest, parseCli } from './pin-file-asset-object-identity';

describe('pin-file-asset-object-identity', () => {
  it('requires rollback output for apply mode', () => {
    expect(() => parseCli(['--manifest', 'manifest.json', '--apply'])).toThrow(
      '--rollback-file is required with --apply',
    );
  });

  it('rejects duplicate and malformed exact identities', () => {
    const dir = mkdtempSync(join(tmpdir(), 'file-identity-'));
    const manifestPath = join(dir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        entries: [
          { org_id: 'org_1', file_id: 'file_1', version_id: 'v1', sha256: 'ab'.repeat(32) },
          { org_id: 'org_1', file_id: 'file_1', version_id: 'v2', sha256: 'cd'.repeat(32) },
        ],
      }),
    );

    expect(() => loadManifest(manifestPath)).toThrow('duplicate manifest identity');
  });

  it('hashes the exact streamed version body without buffering the full object', async () => {
    const body = (async function* () {
      yield Buffer.from('immutable-');
      yield Buffer.from('object');
    })();

    await expect(hashBody(body)).resolves.toEqual({
      sha256: 'a86f0d000823713b87231f29bd4b2badbc15fab4de3ff6a391fc611271c174af',
      size: 16,
    });
  });
});
