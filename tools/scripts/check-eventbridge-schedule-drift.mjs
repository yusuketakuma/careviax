#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_EXPECTED_PATH = 'tools/infra/eventbridge-schedules.json';
const DEFAULT_GROUP_NAME = 'ph-os-jobs';

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), filePath), 'utf8'));
}

function readArgs(argv) {
  const args = {
    expectedPath: DEFAULT_EXPECTED_PATH,
    actualPath: null,
    useAws: false,
    groupName: DEFAULT_GROUP_NAME,
    region: null,
    compareTarget: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };

    if (arg === '--expected') args.expectedPath = next();
    else if (arg === '--actual') args.actualPath = next();
    else if (arg === '--aws') args.useAws = true;
    else if (arg === '--group-name') args.groupName = next();
    else if (arg === '--region') args.region = next();
    else if (arg === '--skip-target') args.compareTarget = false;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.actualPath && args.useAws) {
    throw new Error('Use either --actual or --aws, not both');
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  node tools/scripts/check-eventbridge-schedule-drift.mjs
  node tools/scripts/check-eventbridge-schedule-drift.mjs --actual exported-schedules.json
  node tools/scripts/check-eventbridge-schedule-drift.mjs --aws --group-name ph-os-jobs [--region ap-northeast-1]

Options:
  --expected <path>   Expected schedule definition JSON. Defaults to ${DEFAULT_EXPECTED_PATH}
  --actual <path>     Actual/exported schedule JSON to compare
  --aws               Fetch actual schedules with read-only AWS CLI scheduler get-schedule calls
  --group-name <name> EventBridge Scheduler group name. Defaults to ${DEFAULT_GROUP_NAME}
  --region <region>   AWS region. Defaults to expected JSON region
  --skip-target       Do not compare target URL/method fields
`);
}

function readScheduleArray(raw, label) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.schedules)) return raw.schedules;
  if (raw && Array.isArray(raw.Schedules)) return raw.Schedules;
  throw new Error(`${label} must be an array or contain schedules/Schedules`);
}

function normalizeExpectedConfig(raw) {
  const schedules = readScheduleArray(raw, 'expected schedule config').map((schedule) => ({
    name: schedule.name,
    state: schedule.state,
    scheduleExpression: schedule.scheduleExpression,
    scheduleExpressionTimezone: schedule.scheduleExpressionTimezone ?? 'UTC',
    targetUrl: schedule.target?.url,
    targetMethod: schedule.target?.method,
    maximumRetryAttempts: schedule.retryPolicy?.maximumRetryAttempts,
    maximumEventAgeInSeconds: schedule.retryPolicy?.maximumEventAgeInSeconds,
  }));
  validateSchedules(schedules, 'expected schedule config');
  return schedules;
}

function parseTargetInput(input) {
  if (typeof input !== 'string' || input.trim() === '') return {};
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeActualSchedules(raw) {
  const schedules = readScheduleArray(raw, 'actual schedule config').map((schedule) => {
    const targetInput = parseTargetInput(schedule.Target?.Input);
    return {
      name: schedule.name ?? schedule.Name,
      state: schedule.state ?? schedule.State,
      scheduleExpression: schedule.scheduleExpression ?? schedule.ScheduleExpression,
      scheduleExpressionTimezone:
        schedule.scheduleExpressionTimezone ?? schedule.ScheduleExpressionTimezone ?? 'UTC',
      targetUrl: schedule.target?.url ?? schedule.Target?.Url ?? targetInput.url,
      targetMethod: schedule.target?.method ?? schedule.Target?.Method ?? targetInput.method,
      maximumRetryAttempts:
        schedule.retryPolicy?.maximumRetryAttempts ??
        schedule.Target?.RetryPolicy?.MaximumRetryAttempts,
      maximumEventAgeInSeconds:
        schedule.retryPolicy?.maximumEventAgeInSeconds ??
        schedule.Target?.RetryPolicy?.MaximumEventAgeInSeconds,
    };
  });
  validateSchedules(schedules, 'actual schedule config');
  return schedules;
}

function validateSchedules(schedules, label) {
  const seen = new Set();
  for (const schedule of schedules) {
    if (!schedule.name || typeof schedule.name !== 'string') {
      throw new Error(`${label} contains a schedule without a name`);
    }
    if (seen.has(schedule.name))
      throw new Error(`${label} contains duplicate schedule: ${schedule.name}`);
    seen.add(schedule.name);
    if (!schedule.scheduleExpression) {
      throw new Error(`${label} schedule ${schedule.name} is missing scheduleExpression`);
    }
    if (!schedule.state) throw new Error(`${label} schedule ${schedule.name} is missing state`);
  }
}

function pushMismatch(drifts, scheduleName, field, expected, actual) {
  if (expected === undefined || actual === undefined) return;
  if (String(expected) === String(actual)) return;
  drifts.push({
    type: 'mismatch',
    scheduleName,
    field,
    expected,
    actual,
  });
}

export function compareSchedules(expectedSchedules, actualSchedules, options = {}) {
  const compareTarget = options.compareTarget ?? true;
  const actualByName = new Map(actualSchedules.map((schedule) => [schedule.name, schedule]));
  const expectedByName = new Map(expectedSchedules.map((schedule) => [schedule.name, schedule]));
  const drifts = [];

  for (const expected of expectedSchedules) {
    const actual = actualByName.get(expected.name);
    if (!actual) {
      drifts.push({ type: 'missing', scheduleName: expected.name });
      continue;
    }

    pushMismatch(drifts, expected.name, 'state', expected.state, actual.state);
    pushMismatch(
      drifts,
      expected.name,
      'scheduleExpression',
      expected.scheduleExpression,
      actual.scheduleExpression,
    );
    pushMismatch(
      drifts,
      expected.name,
      'scheduleExpressionTimezone',
      expected.scheduleExpressionTimezone,
      actual.scheduleExpressionTimezone,
    );
    pushMismatch(
      drifts,
      expected.name,
      'maximumRetryAttempts',
      expected.maximumRetryAttempts,
      actual.maximumRetryAttempts,
    );
    pushMismatch(
      drifts,
      expected.name,
      'maximumEventAgeInSeconds',
      expected.maximumEventAgeInSeconds,
      actual.maximumEventAgeInSeconds,
    );
    if (compareTarget) {
      pushMismatch(drifts, expected.name, 'targetUrl', expected.targetUrl, actual.targetUrl);
      pushMismatch(
        drifts,
        expected.name,
        'targetMethod',
        expected.targetMethod,
        actual.targetMethod,
      );
    }
  }

  for (const actual of actualSchedules) {
    if (!expectedByName.has(actual.name)) drifts.push({ type: 'extra', scheduleName: actual.name });
  }

  return drifts.sort((a, b) =>
    `${a.scheduleName}:${a.type}`.localeCompare(`${b.scheduleName}:${b.type}`),
  );
}

function getAwsSchedule(schedule, args) {
  const output = execFileSync(
    'aws',
    [
      'scheduler',
      'get-schedule',
      '--name',
      schedule.name,
      '--group-name',
      args.groupName,
      '--region',
      args.region,
      '--output',
      'json',
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(output);
}

function printDrifts(drifts) {
  if (drifts.length === 0) {
    console.log('EventBridge schedule drift check passed: no drift detected.');
    return;
  }

  console.error(`EventBridge schedule drift check failed: ${drifts.length} drift item(s).`);
  for (const drift of drifts) {
    if (drift.type === 'missing') {
      console.error(`- missing: ${drift.scheduleName}`);
    } else if (drift.type === 'extra') {
      console.error(`- extra: ${drift.scheduleName}`);
    } else {
      console.error(
        `- mismatch: ${drift.scheduleName}.${drift.field} expected=${JSON.stringify(drift.expected)} actual=${JSON.stringify(drift.actual)}`,
      );
    }
  }
}

export function runScheduleDriftCheck(rawExpected, rawActual, options = {}) {
  const expected = normalizeExpectedConfig(rawExpected);
  const actual = normalizeActualSchedules(rawActual);
  return compareSchedules(expected, actual, options);
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const expectedRaw = readJsonFile(args.expectedPath);
  const expected = normalizeExpectedConfig(expectedRaw);
  const region = args.region ?? expectedRaw.region;
  if (!region) throw new Error('Missing region; pass --region or set region in expected JSON');

  if (!args.actualPath && !args.useAws) {
    console.log(
      `EventBridge schedule definition is internally valid: ${expected.length} expected schedule(s).`,
    );
    console.log('Pass --actual <json> or --aws --group-name <name> to check live/exported drift.');
    return;
  }

  const actualRaw = args.useAws
    ? expected.map((schedule) => getAwsSchedule(schedule, { ...args, region }))
    : readJsonFile(args.actualPath);
  const actual = normalizeActualSchedules(actualRaw);
  const drifts = compareSchedules(expected, actual, {
    compareTarget: args.useAws ? false : args.compareTarget,
  });
  printDrifts(drifts);
  if (drifts.length > 0) process.exit(1);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentPath = fileURLToPath(import.meta.url);
if (invokedPath === currentPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
