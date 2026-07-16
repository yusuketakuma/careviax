import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { awsClientConfig, withAwsClientTimeout } from '@/lib/aws/client-timeout';
import { withOrgContext } from '@/lib/db/rls';

const identitySchema = z.object({
  org_id: z.string().trim().min(1),
  file_id: z.string().trim().min(1),
  version_id: z.string().trim().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const manifestSchema = z.object({
  version: z.literal(1),
  entries: z.array(identitySchema).min(1),
});

type ManifestEntry = z.infer<typeof identitySchema>;

type CliOptions = {
  manifestPath: string;
  apply: boolean;
  rollbackPath: string | null;
};

function parseCli(argv: string[]): CliOptions {
  const manifestIndex = argv.indexOf('--manifest');
  const rollbackIndex = argv.indexOf('--rollback-file');
  const manifestPath = manifestIndex >= 0 ? argv[manifestIndex + 1] : undefined;
  const rollbackPath = rollbackIndex >= 0 ? argv[rollbackIndex + 1] : undefined;
  const apply = argv.includes('--apply');

  if (!manifestPath) throw new Error('--manifest is required');
  if (apply && !rollbackPath) throw new Error('--rollback-file is required with --apply');

  return { manifestPath, apply, rollbackPath: rollbackPath ?? null };
}

function loadManifest(path: string) {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const keys = new Set<string>();
  for (const entry of manifest.entries) {
    const key = `${entry.org_id}:${entry.file_id}`;
    if (keys.has(key)) throw new Error(`duplicate manifest identity: ${key}`);
    keys.add(key);
  }
  return manifest;
}

async function hashBody(body: unknown) {
  if (!body || !(Symbol.asyncIterator in Object(body))) {
    throw new Error('S3 object body is not streamable');
  }

  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    hash.update(bytes);
  }
  return { sha256: hash.digest('hex'), size };
}

async function verifyEntry(args: { entry: ManifestEntry; bucketName: string; s3: S3Client }) {
  const row = await withOrgContext(args.entry.org_id, (tx) =>
    tx.fileAsset.findFirst({
      where: { id: args.entry.file_id, org_id: args.entry.org_id },
      select: {
        id: true,
        storage_key: true,
        mime_type: true,
        size_bytes: true,
        status: true,
        sha256: true,
        storage_version_id: true,
      },
    }),
  );
  if (!row) throw new Error(`FileAsset not found: ${args.entry.file_id}`);
  if (row.status !== 'uploaded') throw new Error(`FileAsset is not uploaded: ${row.id}`);
  if (
    (row.sha256 && row.sha256 !== args.entry.sha256) ||
    (row.storage_version_id && row.storage_version_id !== args.entry.version_id)
  ) {
    throw new Error(`FileAsset already has a different identity: ${row.id}`);
  }

  const response = await args.s3.send(
    new GetObjectCommand({
      Bucket: args.bucketName,
      Key: row.storage_key,
      VersionId: args.entry.version_id,
      ChecksumMode: 'ENABLED',
    }),
  );
  if (response.VersionId !== args.entry.version_id) {
    throw new Error(`S3 returned a different VersionId: ${row.id}`);
  }
  if (
    response.ContentType?.split(';', 1)[0]?.trim().toLowerCase() !== row.mime_type.toLowerCase()
  ) {
    throw new Error(`S3 Content-Type mismatch: ${row.id}`);
  }

  const content = await hashBody(response.Body);
  if (content.size !== row.size_bytes) throw new Error(`S3 size mismatch: ${row.id}`);
  if (content.sha256 !== args.entry.sha256) throw new Error(`S3 SHA-256 mismatch: ${row.id}`);

  return row;
}

async function main() {
  const options = parseCli(process.argv.slice(2));
  const manifest = loadManifest(options.manifestPath);
  const bucketName = process.env.S3_BUCKET_NAME?.trim();
  const region = process.env.S3_BUCKET_REGION ?? process.env.AWS_REGION ?? 'ap-northeast-1';
  if (!bucketName) throw new Error('S3_BUCKET_NAME is required');

  const s3 = withAwsClientTimeout(new S3Client({ region, ...awsClientConfig() }));
  const rollback: Array<{
    org_id: string;
    file_id: string;
    sha256: string | null;
    storage_version_id: string | null;
  }> = [];

  for (const entry of manifest.entries) {
    const row = await verifyEntry({ entry, bucketName, s3 });
    rollback.push({
      org_id: entry.org_id,
      file_id: entry.file_id,
      sha256: row.sha256,
      storage_version_id: row.storage_version_id,
    });

    if (options.apply) {
      const updated = await withOrgContext(entry.org_id, (tx) =>
        tx.fileAsset.updateMany({
          where: {
            id: entry.file_id,
            org_id: entry.org_id,
            sha256: row.sha256,
            storage_version_id: row.storage_version_id,
          },
          data: { sha256: entry.sha256, storage_version_id: entry.version_id },
        }),
      );
      if (updated.count !== 1) throw new Error(`FileAsset identity update raced: ${row.id}`);
    }
  }

  if (options.apply && options.rollbackPath) {
    writeFileSync(
      options.rollbackPath,
      `${JSON.stringify({ version: 1, entries: rollback }, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
  }

  process.stdout.write(
    `${JSON.stringify({ mode: options.apply ? 'apply' : 'dry-run', verified: rollback.length })}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { hashBody, loadManifest, parseCli };
