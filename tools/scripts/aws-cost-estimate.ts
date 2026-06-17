import { readFileSync } from 'node:fs';
import path from 'node:path';

type CostItem = {
  name: string;
  monthlyUsd: number;
};

type CostScenario = {
  id: string;
  name: string;
  description: string;
  items: CostItem[];
  notes?: string[];
};

type CostConfig = {
  metadata: {
    currency: string;
    region: string;
    hoursPerMonth: number;
    updatedAt: string;
    sources: string[];
  };
  scenarios: CostScenario[];
};

export type CostEstimate = {
  id: string;
  name: string;
  description: string;
  monthlyUsd: number;
  annualUsd: number;
  items: CostItem[];
  notes: string[];
};

const DEFAULT_CONFIG_PATH = 'tools/aws-cost-minimal-scenarios.json';

function readArgs(argv: string[]) {
  const args = {
    configPath: DEFAULT_CONFIG_PATH,
    scenarioId: null as string | null,
    format: 'table' as 'json' | 'table',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--config') args.configPath = next();
    else if (arg === '--scenario') args.scenarioId = next();
    else if (arg === '--json') args.format = 'json';
    else if (arg === '--') continue;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  pnpm aws:cost:estimate
  pnpm aws:cost:estimate -- --scenario lightsail-pilot-encrypted-db
  pnpm aws:cost:estimate -- --json

Options:
  --config <path>    Cost scenario JSON. Defaults to ${DEFAULT_CONFIG_PATH}
  --scenario <id>    Print only one scenario
  --json             Print machine-readable JSON
`);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

export function parseCostConfig(raw: unknown): CostConfig {
  assertObject(raw, 'cost config');
  assertObject(raw.metadata, 'cost config metadata');

  const sources = raw.metadata.sources;
  if (!Array.isArray(sources)) throw new Error('cost config metadata.sources must be an array');

  const scenarios = raw.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new Error('cost config scenarios must be a non-empty array');
  }

  return {
    metadata: {
      currency: assertString(raw.metadata.currency, 'metadata.currency'),
      region: assertString(raw.metadata.region, 'metadata.region'),
      hoursPerMonth: assertNumber(raw.metadata.hoursPerMonth, 'metadata.hoursPerMonth'),
      updatedAt: assertString(raw.metadata.updatedAt, 'metadata.updatedAt'),
      sources: sources.map((source, index) => assertString(source, `metadata.sources[${index}]`)),
    },
    scenarios: scenarios.map((scenario, scenarioIndex) => {
      assertObject(scenario, `scenarios[${scenarioIndex}]`);
      if (!Array.isArray(scenario.items) || scenario.items.length === 0) {
        throw new Error(`scenarios[${scenarioIndex}].items must be a non-empty array`);
      }

      const notes = scenario.notes;
      if (notes !== undefined && !Array.isArray(notes)) {
        throw new Error(`scenarios[${scenarioIndex}].notes must be an array`);
      }

      return {
        id: assertString(scenario.id, `scenarios[${scenarioIndex}].id`),
        name: assertString(scenario.name, `scenarios[${scenarioIndex}].name`),
        description: assertString(scenario.description, `scenarios[${scenarioIndex}].description`),
        items: scenario.items.map((item, itemIndex) => {
          assertObject(item, `scenarios[${scenarioIndex}].items[${itemIndex}]`);
          return {
            name: assertString(item.name, `scenarios[${scenarioIndex}].items[${itemIndex}].name`),
            monthlyUsd: assertNumber(
              item.monthlyUsd,
              `scenarios[${scenarioIndex}].items[${itemIndex}].monthlyUsd`,
            ),
          };
        }),
        notes: notes?.map((note, noteIndex) =>
          assertString(note, `scenarios[${scenarioIndex}].notes[${noteIndex}]`),
        ),
      };
    }),
  };
}

export function estimateScenarios(config: CostConfig, scenarioId?: string | null): CostEstimate[] {
  const selected = scenarioId
    ? config.scenarios.filter((scenario) => scenario.id === scenarioId)
    : config.scenarios;

  if (scenarioId && selected.length === 0) {
    throw new Error(`Unknown cost scenario: ${scenarioId}`);
  }

  return selected.map((scenario) => {
    const monthlyUsd = roundCurrency(
      scenario.items.reduce((total, item) => total + item.monthlyUsd, 0),
    );
    return {
      id: scenario.id,
      name: scenario.name,
      description: scenario.description,
      monthlyUsd,
      annualUsd: roundCurrency(monthlyUsd * 12),
      items: scenario.items,
      notes: scenario.notes ?? [],
    };
  });
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function loadConfig(configPath: string): CostConfig {
  const raw = JSON.parse(readFileSync(path.resolve(process.cwd(), configPath), 'utf8'));
  return parseCostConfig(raw);
}

function printTable(config: CostConfig, estimates: CostEstimate[]) {
  console.log(
    `AWS cost scenarios (${config.metadata.region}, ${config.metadata.currency}, updated ${config.metadata.updatedAt})`,
  );
  for (const estimate of estimates) {
    console.log(`\n${estimate.id} - ${estimate.name}`);
    console.log(
      `monthly: $${estimate.monthlyUsd.toFixed(2)} / annual: $${estimate.annualUsd.toFixed(2)}`,
    );
    for (const item of estimate.items) {
      console.log(`  - ${item.name}: $${item.monthlyUsd.toFixed(2)}`);
    }
    for (const note of estimate.notes) {
      console.log(`  note: ${note}`);
    }
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const config = loadConfig(args.configPath);
  const estimates = estimateScenarios(config, args.scenarioId);

  if (args.format === 'json') {
    console.log(JSON.stringify({ metadata: config.metadata, estimates }, null, 2));
    return;
  }

  printTable(config, estimates);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
