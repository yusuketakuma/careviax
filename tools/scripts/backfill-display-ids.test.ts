import { describe, expect, it, vi } from 'vitest';

import {
  formatDisplayId,
  getDisplayIdRegistryEntry,
  type DisplayIdModel,
} from '@/lib/db/display-id';
import {
  parseDisplayIdBackfillArgs,
  runDisplayIdBackfill,
  type DisplayIdBackfillAdapter,
  type DisplayIdBackfillClient,
  type DisplayIdBackfillDeps,
  type DisplayIdBackfillModelConfig,
  type DisplayIdBackfillOptions,
  type DisplayIdBackfillRow,
} from './backfill-display-ids';

type MockRow = DisplayIdBackfillRow & {
  model?: DisplayIdModel;
  displayId: string | null;
};

function defaultOptions(
  overrides: Partial<DisplayIdBackfillOptions> = {},
): DisplayIdBackfillOptions {
  return {
    mode: 'dry-run',
    models: ['Patient'],
    maxRows: 10_000,
    batchSize: 1_000,
    sampleLimit: 20,
    orgId: null,
    includeParentScoped: false,
    jsonOutputPath: null,
    markdownOutputPath: null,
    ...overrides,
  };
}

function parseSequence(model: DisplayIdModel, displayId: string): bigint | null {
  const prefix = getDisplayIdRegistryEntry(model).prefix;
  const match = new RegExp(`^${prefix}([0-9]{10,15})$`).exec(displayId);
  if (!match?.[1]) return null;
  const sequence = BigInt(match[1]);
  return sequence > BigInt(0) ? sequence : null;
}

function makeMockRuntime(rows: MockRow[]) {
  const updates: Array<{
    model: DisplayIdModel;
    rowId: string;
    orgId: string;
    displayId: string;
  }> = [];
  const sequences = new Map<string, bigint>();
  const transactionToken = { tx: true };

  function sequenceKey(orgId: string, prefix: string) {
    return `${orgId}:${prefix}`;
  }

  function rowsFor(config: DisplayIdBackfillModelConfig) {
    return rows.filter((row) => (row.model ?? 'Patient') === config.model);
  }

  const adapter: DisplayIdBackfillAdapter = {
    async countRows(config, orgId) {
      return rowsFor(config).filter((row) => !orgId || row.orgId === orgId).length;
    },
    async countNullRows(config, orgId) {
      return rowsFor(config).filter(
        (row) => (!orgId || row.orgId === orgId) && row.displayId === null,
      ).length;
    },
    async countDuplicateDisplayIds(config, orgId) {
      const counts = new Map<string, number>();
      for (const row of rowsFor(config)) {
        if (orgId && row.orgId !== orgId) continue;
        if (!row.displayId) continue;
        const key = `${row.orgId}:${row.displayId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.values()].filter((count) => count > 1).length;
    },
    async countInvalidDisplayIds(config, orgId) {
      return rowsFor(config).filter((row) => {
        if (orgId && row.orgId !== orgId) return false;
        if (!row.displayId) return false;
        return parseSequence(config.model, row.displayId) === null;
      }).length;
    },
    async listNullRowsByOrg(config, orgId) {
      const counts = new Map<string, number>();
      for (const row of rowsFor(config)) {
        if (orgId && row.orgId !== orgId) continue;
        if (row.displayId !== null) continue;
        counts.set(row.orgId, (counts.get(row.orgId) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([orgIdValue, count]) => ({ orgId: orgIdValue, count }));
    },
    async readMaxDisplaySequenceByOrg(config, orgId) {
      const maxByOrg = new Map<string, bigint>();
      for (const row of rowsFor(config)) {
        if (orgId && row.orgId !== orgId) continue;
        if (!row.displayId) continue;
        const sequence = parseSequence(config.model, row.displayId);
        if (sequence === null) continue;
        const current = maxByOrg.get(row.orgId) ?? BigInt(0);
        if (sequence > current) maxByOrg.set(row.orgId, sequence);
      }
      return [...maxByOrg.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([orgIdValue, maxSequence]) => ({ orgId: orgIdValue, maxSequence }));
    },
    async readSequenceNextValue(orgId, prefix) {
      return sequences.get(sequenceKey(orgId, prefix)) ?? null;
    },
    async ensureSequenceAtLeast(orgId, prefix, nextValue) {
      const key = sequenceKey(orgId, prefix);
      const current = sequences.get(key) ?? BigInt(1);
      if (nextValue > current) sequences.set(key, nextValue);
      if (!sequences.has(key)) sequences.set(key, current);
    },
    async selectNullRowsForOrg(config, orgId, limit) {
      return rowsFor(config)
        .filter((row) => row.orgId === orgId && row.displayId === null)
        .sort((a, b) => {
          const dateDiff = a.createdAt.getTime() - b.createdAt.getTime();
          return dateDiff === 0 ? a.id.localeCompare(b.id) : dateDiff;
        })
        .slice(0, limit)
        .map(({ id, orgId: rowOrgId, createdAt }) => ({ id, orgId: rowOrgId, createdAt }));
    },
    async updateDisplayId(config, row, displayId) {
      const target = rowsFor(config).find(
        (candidate) =>
          candidate.id === row.id && candidate.orgId === row.orgId && candidate.displayId === null,
      );
      if (!target) return 0;
      target.displayId = displayId;
      updates.push({ model: config.model, rowId: row.id, orgId: row.orgId, displayId });
      return 1;
    },
  };

  const client: DisplayIdBackfillClient = {
    $transaction: vi.fn(async (fn) => fn(transactionToken)),
  };

  const allocateRange = vi.fn(async (_tx, model: DisplayIdModel, orgId: string, amount: number) => {
    const prefix = getDisplayIdRegistryEntry(model).prefix;
    const key = sequenceKey(orgId, prefix);
    const firstSequence = sequences.get(key) ?? BigInt(1);
    const ids = Array.from({ length: amount }, (_, index) =>
      formatDisplayId(model, firstSequence + BigInt(index)),
    );
    sequences.set(key, firstSequence + BigInt(amount));
    return ids;
  });

  const deps: DisplayIdBackfillDeps = {
    createAdapter: () => adapter,
    allocateRange,
    now: () => new Date('2026-07-03T15:00:00.000Z'),
  };

  return { client, deps, allocateRange, updates, sequences, rows };
}

describe('backfill-display-ids', () => {
  it('parses bounded dry-run defaults and rejects unsafe apply targets', () => {
    expect(parseDisplayIdBackfillArgs([])).toEqual({
      mode: 'dry-run',
      models: [],
      maxRows: 10_000,
      batchSize: 1_000,
      sampleLimit: 20,
      orgId: null,
      includeParentScoped: false,
      jsonOutputPath: null,
      markdownOutputPath: null,
    });
    expect(
      parseDisplayIdBackfillArgs([
        '--dry-run',
        '--models',
        'Patient,PatientInsurance',
        '--max-rows',
        '25',
        '--batch-size',
        '5',
        '--sample-limit',
        '3',
        '--org-id',
        'org_a',
        '--json-output',
        'tmp/display-id.json',
      ]),
    ).toMatchObject({
      mode: 'dry-run',
      models: ['Patient', 'PatientInsurance'],
      maxRows: 25,
      batchSize: 5,
      sampleLimit: 3,
      orgId: 'org_a',
      jsonOutputPath: 'tmp/display-id.json',
    });
    expect(
      parseDisplayIdBackfillArgs([
        '--dry-run',
        '--models',
        'HandoffItem',
        '--include-parent-scoped',
      ]),
    ).toMatchObject({
      mode: 'dry-run',
      models: ['HandoffItem'],
      includeParentScoped: true,
    });

    expect(() => parseDisplayIdBackfillArgs(['--apply'])).toThrow(/--models/);
    expect(() => parseDisplayIdBackfillArgs(['--apply', '--models', 'Patient'])).toThrow(
      /--max-rows/,
    );
    expect(() => parseDisplayIdBackfillArgs(['--models', 'Setting'])).toThrow(
      /not a display_id model/,
    );
    expect(() => parseDisplayIdBackfillArgs(['--models', 'NotAModel'])).toThrow(
      /Unknown display_id model/,
    );
    expect(() => parseDisplayIdBackfillArgs(['--models', 'Patient,Patient'])).toThrow(/duplicate/i);
    expect(() => parseDisplayIdBackfillArgs(['--models', 'DrugMaster'])).toThrow(
      /not tenant-scoped/,
    );
    expect(() => parseDisplayIdBackfillArgs(['--models', 'HandoffItem'])).toThrow(/parent-scoped/);
    expect(() => parseDisplayIdBackfillArgs(['--models', 'Patient', '--org-id='])).toThrow(
      /non-empty safe orgId/,
    );
    expect(() =>
      parseDisplayIdBackfillArgs(['--models', 'Patient', '--org-id', ' org_a ']),
    ).toThrow(/non-empty safe orgId/);
    expect(() => parseDisplayIdBackfillArgs(['--models', 'Patient', '--org-id', 'org/a'])).toThrow(
      /ASCII/,
    );
  });

  it('keeps dry-run read-only while previewing tenant-local ranges', async () => {
    const runtime = makeMockRuntime([
      {
        id: 'patient_b',
        orgId: 'org_a',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        displayId: null,
      },
      {
        id: 'patient_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
      {
        id: 'patient_c',
        orgId: 'org_b',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
    ]);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'dry-run' }),
      runtime.deps,
    );

    expect(result).toMatchObject({
      ok: true,
      mode: 'dry-run',
      dryRun: true,
      generatedAt: '2026-07-03T15:00:00.000Z',
      models: {
        Patient: {
          totalRows: 3,
          nullDisplayIdRows: 3,
          duplicateDisplayIdGroups: 0,
          invalidFormatRows: 0,
          backfilledRows: 0,
        },
      },
      orgs: [
        {
          model: 'Patient',
          orgId: 'org_a',
          rowsToBackfill: 2,
          firstPreviewDisplayId: 'p0000000001',
          lastPreviewDisplayId: 'p0000000002',
        },
        {
          model: 'Patient',
          orgId: 'org_b',
          rowsToBackfill: 1,
          firstPreviewDisplayId: 'p0000000001',
          lastPreviewDisplayId: 'p0000000001',
        },
      ],
    });
    expect(runtime.allocateRange).not.toHaveBeenCalled();
    expect(runtime.updates).toEqual([]);
    expect(runtime.rows.every((row) => row.displayId === null)).toBe(true);
  });

  it('applies by org in created_at/id order using one range allocation per org', async () => {
    const runtime = makeMockRuntime([
      {
        id: 'patient_b',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
      {
        id: 'patient_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
      {
        id: 'patient_c',
        orgId: 'org_b',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
    ]);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'apply', maxRows: 10 }),
      runtime.deps,
    );

    expect(runtime.allocateRange).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      'Patient',
      'org_a',
      2,
    );
    expect(runtime.allocateRange).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      'Patient',
      'org_b',
      1,
    );
    expect(runtime.updates).toEqual([
      { model: 'Patient', rowId: 'patient_a', orgId: 'org_a', displayId: 'p0000000001' },
      { model: 'Patient', rowId: 'patient_b', orgId: 'org_a', displayId: 'p0000000002' },
      { model: 'Patient', rowId: 'patient_c', orgId: 'org_b', displayId: 'p0000000001' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.models.Patient).toMatchObject({
      nullDisplayIdRows: 0,
      duplicateDisplayIdGroups: 0,
      invalidFormatRows: 0,
      sequenceMismatches: [],
      backfilledRows: 3,
    });
    expect(result.postChecks).toEqual([
      expect.objectContaining({
        model: 'Patient',
        ok: true,
        nullDisplayIdRows: 0,
      }),
    ]);
  });

  it('applies HandoffItem by parent-derived org only when explicitly opted in', async () => {
    const runtime = makeMockRuntime([
      {
        model: 'HandoffItem',
        id: 'handoff_b',
        orgId: 'org_parent',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        displayId: null,
      },
      {
        model: 'HandoffItem',
        id: 'handoff_a',
        orgId: 'org_parent',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
    ]);

    await expect(
      runDisplayIdBackfill(
        runtime.client,
        defaultOptions({ mode: 'apply', models: ['HandoffItem'], maxRows: 10 }),
        runtime.deps,
      ),
    ).rejects.toThrow(/parent-scoped/);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({
        mode: 'apply',
        models: ['HandoffItem'],
        includeParentScoped: true,
        maxRows: 10,
      }),
      runtime.deps,
    );

    expect(runtime.allocateRange).toHaveBeenCalledTimes(1);
    expect(runtime.allocateRange).toHaveBeenCalledWith(
      expect.any(Object),
      'HandoffItem',
      'org_parent',
      2,
    );
    expect(runtime.updates).toEqual([
      { model: 'HandoffItem', rowId: 'handoff_a', orgId: 'org_parent', displayId: 'h0000000001' },
      { model: 'HandoffItem', rowId: 'handoff_b', orgId: 'org_parent', displayId: 'h0000000002' },
    ]);
    expect(result.ok).toBe(true);
    expect(result.models.HandoffItem).toMatchObject({
      nullDisplayIdRows: 0,
      duplicateDisplayIdGroups: 0,
      invalidFormatRows: 0,
      sequenceMismatches: [],
      backfilledRows: 2,
    });
  });

  it('limits apply to the requested org when --org-id is present', async () => {
    const runtime = makeMockRuntime([
      {
        id: 'patient_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
      {
        id: 'patient_b',
        orgId: 'org_b',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
    ]);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'apply', maxRows: 10, orgId: 'org_a' }),
      runtime.deps,
    );

    expect(result.ok).toBe(true);
    expect(runtime.allocateRange).toHaveBeenCalledTimes(1);
    expect(runtime.allocateRange).toHaveBeenCalledWith(expect.any(Object), 'Patient', 'org_a', 1);
    expect(runtime.updates).toEqual([
      { model: 'Patient', rowId: 'patient_a', orgId: 'org_a', displayId: 'p0000000001' },
    ]);
    expect(runtime.rows.find((row) => row.id === 'patient_b')?.displayId).toBeNull();
  });

  it('blocks apply before mutation when pre-checks are unsafe', async () => {
    const runtime = makeMockRuntime([
      {
        id: 'patient_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: 'p0000000001',
      },
      {
        id: 'patient_b',
        orgId: 'org_a',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        displayId: 'p0000000001',
      },
      {
        id: 'patient_c',
        orgId: 'org_a',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        displayId: 'wrong0000000001',
      },
    ]);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'apply', maxRows: 10 }),
      runtime.deps,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'display-id-duplicate', severity: 'error' }),
        expect.objectContaining({ name: 'display-id-format-invalid', severity: 'error' }),
      ]),
    );
    expect(runtime.allocateRange).not.toHaveBeenCalled();
    expect(runtime.updates).toEqual([]);
  });

  it('treats zero and malformed existing display IDs as invalid before mutation', async () => {
    const runtime = makeMockRuntime([
      {
        id: 'patient_zero',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: 'p0000000000',
      },
      {
        id: 'patient_fullwidth',
        orgId: 'org_a',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        displayId: 'p０００００００００１',
      },
      {
        id: 'patient_wrong_prefix',
        orgId: 'org_a',
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        displayId: 'x0000000001',
      },
      {
        id: 'patient_too_long',
        orgId: 'org_a',
        createdAt: new Date('2026-01-04T00:00:00.000Z'),
        displayId: 'p1000000000000000',
      },
      {
        id: 'patient_null',
        orgId: 'org_a',
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
        displayId: null,
      },
    ]);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'apply', maxRows: 10 }),
      runtime.deps,
    );

    expect(result.ok).toBe(false);
    expect(result.models.Patient).toMatchObject({ invalidFormatRows: 4 });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'display-id-format-invalid', severity: 'error' }),
      ]),
    );
    expect(runtime.allocateRange).not.toHaveBeenCalled();
    expect(runtime.updates).toEqual([]);
  });

  it('reports sequence mismatches during dry-run verification', async () => {
    const runtime = makeMockRuntime([
      {
        id: 'patient_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: 'p0000000002',
      },
    ]);
    runtime.sequences.set('org_a:p', BigInt(2));

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'dry-run' }),
      runtime.deps,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'id-sequence-next-value-mismatch',
          severity: 'error',
          orgId: 'org_a',
        }),
      ]),
    );
    expect(result.models.Patient.sequenceMismatches).toEqual([
      {
        orgId: 'org_a',
        expectedAtLeastNextValue: '3',
        actualNextValue: '2',
      },
    ]);
  });

  it('requires explicit maxRows large enough for apply', async () => {
    const runtime = makeMockRuntime([
      {
        id: 'patient_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
      {
        id: 'patient_b',
        orgId: 'org_a',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        displayId: null,
      },
    ]);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'apply', maxRows: 1 }),
      runtime.deps,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'max-rows-too-small', severity: 'error' }),
      ]),
    );
    expect(runtime.allocateRange).not.toHaveBeenCalled();
    expect(runtime.updates).toEqual([]);
  });

  it('enforces maxRows as a run-wide apply cap across models', async () => {
    const runtime = makeMockRuntime([
      {
        model: 'Patient',
        id: 'patient_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        displayId: null,
      },
      {
        model: 'Residence',
        id: 'residence_a',
        orgId: 'org_a',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        displayId: null,
      },
    ]);

    const result = await runDisplayIdBackfill(
      runtime.client,
      defaultOptions({ mode: 'apply', models: ['Patient', 'Residence'], maxRows: 1 }),
      runtime.deps,
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'max-rows-too-small', severity: 'error' }),
      ]),
    );
    expect(runtime.allocateRange).not.toHaveBeenCalled();
    expect(runtime.updates).toEqual([]);
  });
});
