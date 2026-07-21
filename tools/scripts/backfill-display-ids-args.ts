import {
  DISPLAY_ID_EXCLUDED_MODELS,
  getDisplayIdRegistryEntry,
  isDisplayIdModel,
  type DisplayIdModel,
} from '@/lib/db/display-id';
import type { DisplayIdBackfillOptions } from './backfill-display-ids-contract';

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_BATCH_SIZE = 1_000;
const DEFAULT_SAMPLE_LIMIT = 20;
const DISPLAY_ID_ORG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const USAGE = [
  'Usage: pnpm tsx tools/scripts/backfill-display-ids.ts --models Patient,DrugMaster [--dry-run]',
  '       pnpm tsx tools/scripts/backfill-display-ids.ts --apply --models Patient --max-rows 100000',
  '',
  'Options:',
  '  --models LIST       Comma-separated DisplayId registry models to target; tenant and global models are allowed',
  '  --apply             Mutate rows and id_sequence; requires --models and --max-rows',
  '  --dry-run           Read-only mode (default)',
  '  --max-rows N        Apply fail-fast ceiling; dry-run reports target NULL rows, apply refuses before mutation if rows exceed N',
  '  --batch-size N      Rows per (model, org) transaction batch',
  '  --sample-limit N    Bounded reporting sample size',
  '  --org-id ORG        Optional single tenant/org filter; rejected when any target model is global',
  '  --include-parent-scoped  Opt in to HandoffItem board_id -> HandoffBoard.org_id backfill',
  '  --json-output PATH  Write JSON report',
  '  --markdown-output PATH  Write Markdown report',
].join('\n');

function readValue(argv: string[], name: string): string | null {
  const equalsPrefix = `${name}=`;
  const equalsValue = argv.find((arg) => arg.startsWith(equalsPrefix));
  if (equalsValue) return equalsValue.slice(equalsPrefix.length);

  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePositiveInt(value: string | null, name: string, fallback: number): number {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseOrgId(value: string | null): string | null {
  if (value === null) return null;
  if (value.trim() !== value || value.length === 0) {
    throw new Error('--org-id must be a non-empty safe orgId');
  }
  if (!DISPLAY_ID_ORG_ID_PATTERN.test(value)) {
    throw new Error(
      '--org-id must start with an ASCII letter or digit and contain only ASCII letters, digits, _ or -',
    );
  }
  return value;
}

function parseModels(
  value: string | null,
  options: { includeParentScoped: boolean },
): DisplayIdModel[] {
  if (!value) return [];

  const models = value
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  const seen = new Set<string>();

  return models.map((model) => {
    if (seen.has(model)) {
      throw new Error(`duplicate display_id model in --models: ${model}`);
    }
    seen.add(model);

    if (!isDisplayIdModel(model)) {
      if ((DISPLAY_ID_EXCLUDED_MODELS as readonly string[]).includes(model)) {
        throw new Error(`Model ${model} is not a display_id model`);
      }
      throw new Error(`Unknown display_id model: ${model}`);
    }

    const entry = getDisplayIdRegistryEntry(model);
    const isSupportedParentScoped =
      options.includeParentScoped &&
      model === 'HandoffItem' &&
      entry.scope === 'orgViaParent' &&
      entry.parent === 'HandoffBoard';
    if (model === 'HandoffItem' && entry.scope === 'orgViaParent' && !isSupportedParentScoped) {
      throw new Error(
        `Model ${model} is parent-scoped and requires --include-parent-scoped for backfill`,
      );
    }
    if (entry.scope !== 'org' && entry.scope !== 'global' && !isSupportedParentScoped) {
      throw new Error(`Model ${model} is not tenant-scoped and cannot use this backfill`);
    }
    return model;
  });
}

export function parseDisplayIdBackfillArgs(argv: string[]): DisplayIdBackfillOptions {
  if (argv.includes('--help')) {
    throw new Error(USAGE);
  }

  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run');
  if (apply && dryRun) {
    throw new Error('--apply and --dry-run are mutually exclusive');
  }

  const maxRowsValue = readValue(argv, '--max-rows');
  const includeParentScoped = argv.includes('--include-parent-scoped');
  const models = parseModels(readValue(argv, '--models'), { includeParentScoped });
  const orgId = parseOrgId(readValue(argv, '--org-id'));
  if (orgId !== null) {
    const globalModels = models.filter(
      (model) => getDisplayIdRegistryEntry(model).scope === 'global',
    );
    if (globalModels.length > 0) {
      throw new Error(
        `--org-id cannot be used with global display_id model(s): ${globalModels.join(', ')}`,
      );
    }
  }
  if (apply && models.length === 0) {
    throw new Error('--apply requires --models');
  }
  if (apply && maxRowsValue === null) {
    throw new Error('--apply requires --max-rows');
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    models,
    maxRows: parsePositiveInt(maxRowsValue, '--max-rows', DEFAULT_MAX_ROWS),
    batchSize: parsePositiveInt(
      readValue(argv, '--batch-size'),
      '--batch-size',
      DEFAULT_BATCH_SIZE,
    ),
    sampleLimit: parsePositiveInt(
      readValue(argv, '--sample-limit'),
      '--sample-limit',
      DEFAULT_SAMPLE_LIMIT,
    ),
    orgId,
    includeParentScoped,
    jsonOutputPath: readValue(argv, '--json-output'),
    markdownOutputPath: readValue(argv, '--markdown-output'),
  };
}
