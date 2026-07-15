#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERIFIED_ACTION_PINS = new Map([
  ['actions/checkout', { sha: '34e114876b0b11c390a56381ad16ebd13914f8d5', version: 'v4.3.1' }],
  ['actions/setup-node', { sha: '49933ea5288caeca8642d1e84afbd3f7d6820020', version: 'v4.4.0' }],
  ['actions/github-script', { sha: 'f28e40c7f34bde8b3046d885e986cb6290c5673b', version: 'v7.1.0' }],
  ['pnpm/action-setup', { sha: 'b906affcce14559ad1aafd4ab0e942779e9f58b1', version: 'v4.3.0' }],
  [
    'aws-actions/configure-aws-credentials',
    { sha: '7474bc4690e29a8392af63c5b98e7449536d5c3a', version: 'v4.3.1' },
  ],
  [
    'aws-actions/amazon-ecr-login',
    { sha: 'd539f0932e70871a027e9d5a9d8fc38589180a64', version: 'v2.1.6' },
  ],
  [
    'docker/setup-buildx-action',
    { sha: '8d2750c68a42422c14e847fe6c8ac0403b4cbd6f', version: 'v3.12.0' },
  ],
  [
    'docker/build-push-action',
    { sha: '10e90e3645eae34f1e60eeb005ba3a3d33f178e8', version: 'v6.19.2' },
  ],
]);

const VERIFIED_DOCKER_PINS = new Map([
  ['node:24.16.0-slim', 'sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203'],
]);

const REQUIRED_DEPENDABOT_ECOSYSTEMS = ['github-actions', 'docker', 'npm'];
const SUPPLY_CHAIN_SCRIPT = 'node tools/scripts/check-supply-chain-pins.mjs';

function fail(source, message) {
  throw new Error(`supply-chain pin drift in ${source}: ${message}`);
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function mappingKeyPattern(key) {
  return `(?:${key}|"${key}"|'${key}')`;
}

function directKeyCount(source, key, indent) {
  const keyPattern = new RegExp(`^ {${indent}}${mappingKeyPattern(key)}\\s*:`);
  return source.split('\n').filter((line) => keyPattern.test(line)).length;
}

function extractSingleMappingBlock(source, key, indent, sourceName) {
  const lines = source.split('\n');
  const keyPattern = new RegExp(`^ {${indent}}${mappingKeyPattern(key)}\\s*:\\s*(?:#.*)?$`);
  const matchingIndexes = lines.flatMap((line, index) => (keyPattern.test(line) ? [index] : []));
  const keyCount = directKeyCount(source, key, indent);
  if (keyCount === 0) fail(sourceName, `missing ${key} mapping`);
  if (keyCount > 1) fail(sourceName, `duplicate ${key} mapping`);
  if (matchingIndexes.length !== 1) fail(sourceName, `${key} must be a block mapping`);

  const start = matchingIndexes[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const leadingSpaces = line.length - line.trimStart().length;
    if (leadingSpaces <= indent) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function directScalarValues(source, key, indent) {
  const scalarPattern = new RegExp(
    `^ {${indent}}${mappingKeyPattern(key)}\\s*:\\s*([^#]+?)\\s*(?:#.*)?$`,
  );
  return source.split('\n').flatMap((line) => {
    const match = line.match(scalarPattern);
    return match ? [unquote(match[1].trim())] : [];
  });
}

export function validateWorkflowSource(workflow, source = 'workflow') {
  let blockScalarIndent = null;

  workflow.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    const leadingSpaces = line.length - line.trimStart().length;
    if (blockScalarIndent != null) {
      if (trimmed === '' || leadingSpaces > blockScalarIndent) return;
      blockScalarIndent = null;
    }

    if (
      /^\s*(?:-\s*)?(?:[A-Za-z_][\w.-]*|"[^"]+"|'[^']+')\s*:\s*[|>](?:[1-9][+-]?|[+-][1-9]?)?\s*(?:#.*)?$/.test(
        line,
      )
    ) {
      blockScalarIndent = leadingSpaces;
      return;
    }

    const startsFlowMapping =
      /^\s*-\s*\{/.test(line) || /^\s*(?:[A-Za-z_][\w.-]*|"[^"]+"|'[^']+')\s*:\s*\{/.test(line);
    if (startsFlowMapping && /(?:\{|,)\s*(?:uses|"uses"|'uses')\s*:/.test(line)) {
      fail(source, `line ${index + 1} flow-style uses mappings are unsupported`);
    }
    if (/^\s*(?:-\s*)?\?\s*(?:uses|"uses"|'uses')\s*$/.test(line)) {
      fail(source, `line ${index + 1} explicit-key uses syntax is unsupported`);
    }
    if (!/^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:/.test(line)) return;

    const match = line.match(
      /^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:\s*([^#]+?)(?:\s+#\s*(\S+))?\s*$/,
    );
    if (!match) fail(source, `line ${index + 1} has an unreadable uses reference`);

    const reference = unquote(match[1].trim());
    const versionComment = match[2];
    if (reference.startsWith('./')) return;
    if (reference.startsWith('docker://')) {
      fail(source, `line ${index + 1} uses an unsupported container action reference`);
    }

    const actionMatch = reference.match(/^([^@\s]+)@([0-9a-f]{40})$/);
    if (!actionMatch) {
      fail(source, `line ${index + 1} external action must use a full 40-character commit SHA`);
    }

    const [, action, sha] = actionMatch;
    const verified = VERIFIED_ACTION_PINS.get(action);
    if (!verified) fail(source, `line ${index + 1} action ${action} has no verified pin`);
    if (sha !== verified.sha) {
      fail(source, `line ${index + 1} action ${action} does not use its verified commit`);
    }
    if (versionComment !== verified.version) {
      fail(
        source,
        `line ${index + 1} action ${action} must keep version comment ${verified.version}`,
      );
    }
  });
}

export function validateCiGateSource(workflow, source = '.github/workflows/ci.yml') {
  const installMarker = `      - name: Install dependencies
        run: pnpm install --frozen-lockfile`;
  const gateMarker = `      - name: Supply-chain pin check
        run: pnpm supply-chain-pins:check`;
  const globalGateCount = workflow.split(gateMarker).length - 1;
  const jobsBlock = extractSingleMappingBlock(workflow, 'jobs', 0, source);
  const ciJobBlock = extractSingleMappingBlock(jobsBlock, 'ci', 2, source);
  const ciStepsBlock = extractSingleMappingBlock(ciJobBlock, 'steps', 4, source);
  const installCount = ciStepsBlock.split(installMarker).length - 1;
  const gateCount = ciStepsBlock.split(gateMarker).length - 1;

  if (installCount !== 1) {
    fail(source, 'missing dependency install marker before supply-chain gate');
  }
  if (globalGateCount === 0 || gateCount === 0) fail(source, 'missing supply-chain pin check step');
  if (globalGateCount > 1 || gateCount > 1) fail(source, 'duplicate supply-chain pin check step');
  if (!ciStepsBlock.includes(`${installMarker}\n\n${gateMarker}`)) {
    fail(
      source,
      'supply-chain pin check must immediately follow dependency install in the same job',
    );
  }
}

export function validateDockerfileSource(dockerfile, source = 'Dockerfile') {
  const stageAliases = new Set();

  dockerfile.split('\n').forEach((rawLine, index) => {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!/^FROM\s+/i.test(line)) return;

    const tokens = line.split(/\s+/);
    let imageIndex = 1;
    while (tokens[imageIndex]?.startsWith('--')) imageIndex += 1;
    const image = tokens[imageIndex];
    if (!image) fail(source, `line ${index + 1} has no base image`);

    const asIndex = tokens.findIndex(
      (token, tokenIndex) => tokenIndex > imageIndex && token.toUpperCase() === 'AS',
    );
    const alias = asIndex >= 0 ? tokens[asIndex + 1] : undefined;

    if (image !== 'scratch' && !stageAliases.has(image)) {
      const match = image.match(/^(.+?)@(sha256:[0-9a-f]{64})$/);
      if (!match) {
        fail(source, `line ${index + 1} external base image must use a sha256 digest`);
      }

      const [, taggedImage, digest] = match;
      const verifiedDigest = VERIFIED_DOCKER_PINS.get(taggedImage);
      if (!verifiedDigest) {
        fail(source, `line ${index + 1} base image ${taggedImage} has no verified digest`);
      }
      if (digest !== verifiedDigest) {
        fail(source, `line ${index + 1} base image ${taggedImage} has an unverified digest`);
      }
    }

    if (alias) stageAliases.add(alias);
  });
}

function dependabotEntries(updatesBlock) {
  const matches = [
    ...updatesBlock.matchAll(
      /^ {2}-\s+package-ecosystem\s*:\s*["']?([^\s"'#]+)["']?\s*(?:#.*)?$/gm,
    ),
  ];

  return matches.map((match, index) => ({
    ecosystem: match[1],
    block: updatesBlock.slice(match.index, matches[index + 1]?.index ?? updatesBlock.length),
  }));
}

export function validateDependabotSource(source, sourceName = '.github/dependabot.yml') {
  const versions = directScalarValues(source, 'version', 0);
  if (directKeyCount(source, 'version', 0) !== 1 || versions.length !== 1) {
    fail(sourceName, 'top-level version must appear exactly once');
  }
  if (versions[0] !== '2') fail(sourceName, 'top-level version must be 2');

  const updatesBlock = extractSingleMappingBlock(source, 'updates', 0, sourceName);
  const entries = dependabotEntries(updatesBlock);
  for (const ecosystem of REQUIRED_DEPENDABOT_ECOSYSTEMS) {
    const matchingEntries = entries.filter((entry) => entry.ecosystem === ecosystem);
    if (matchingEntries.length === 0) fail(sourceName, `missing ${ecosystem} updater`);
    if (matchingEntries.length > 1) fail(sourceName, `duplicate ${ecosystem} updater`);

    const [{ block }] = matchingEntries;
    if (directKeyCount(block, 'package-ecosystem', 4) > 0) {
      fail(sourceName, `${ecosystem} updater contains a duplicate package-ecosystem key`);
    }
    const directories = directScalarValues(block, 'directory', 4);
    if (directKeyCount(block, 'directory', 4) !== 1 || directories.length !== 1) {
      fail(sourceName, `${ecosystem} updater must contain exactly one direct directory`);
    }
    if (directories[0] !== '/') {
      fail(sourceName, `${ecosystem} updater must target directory /`);
    }

    const scheduleBlock = extractSingleMappingBlock(block, 'schedule', 4, sourceName);
    const intervals = directScalarValues(scheduleBlock, 'interval', 6);
    if (directKeyCount(scheduleBlock, 'interval', 6) !== 1 || intervals.length !== 1) {
      fail(sourceName, `${ecosystem} updater must contain exactly one direct schedule interval`);
    }
    if (intervals[0] !== 'weekly') {
      fail(sourceName, `${ecosystem} updater must run weekly`);
    }

    const strategies = directScalarValues(block, 'versioning-strategy', 4);
    if (ecosystem === 'npm') {
      if (directKeyCount(block, 'versioning-strategy', 4) !== 1 || strategies.length !== 1) {
        fail(sourceName, 'npm updater must contain exactly one direct versioning-strategy');
      }
      if (strategies[0] !== 'lockfile-only') {
        fail(sourceName, 'npm updater must use versioning-strategy lockfile-only');
      }
    } else if (directKeyCount(block, 'versioning-strategy', 4) > 0) {
      fail(sourceName, `${ecosystem} updater must not define versioning-strategy`);
    }
  }

  const unexpected = entries.find(
    (entry) => !REQUIRED_DEPENDABOT_ECOSYSTEMS.includes(entry.ecosystem),
  );
  if (unexpected) fail(sourceName, `unexpected ${unexpected.ecosystem} updater`);
  if (entries.length !== REQUIRED_DEPENDABOT_ECOSYSTEMS.length) {
    fail(sourceName, 'updates must contain exactly github-actions, docker, and npm entries');
  }
}

export function validatePackageSource(source, sourceName = 'package.json') {
  let packageJson;
  try {
    packageJson = JSON.parse(source);
  } catch {
    fail(sourceName, 'invalid JSON');
  }

  if (packageJson?.scripts?.['supply-chain-pins:check'] !== SUPPLY_CHAIN_SCRIPT) {
    fail(sourceName, `supply-chain-pins:check must be ${SUPPLY_CHAIN_SCRIPT}`);
  }
}

export function checkSupplyChainPins(root = process.cwd()) {
  const workflowDirectory = path.join(root, '.github/workflows');
  const workflowNames = readdirSync(workflowDirectory)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();
  if (workflowNames.length === 0) fail('.github/workflows', 'no workflow files found');

  for (const workflowName of workflowNames) {
    const workflowSource = readFileSync(path.join(workflowDirectory, workflowName), 'utf8');
    const workflowPath = `.github/workflows/${workflowName}`;
    validateWorkflowSource(workflowSource, workflowPath);
    if (workflowName === 'ci.yml') validateCiGateSource(workflowSource, workflowPath);
  }

  validateDockerfileSource(readFileSync(path.join(root, 'Dockerfile'), 'utf8'));
  validateDependabotSource(readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'));
  validatePackageSource(readFileSync(path.join(root, 'package.json'), 'utf8'));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  checkSupplyChainPins();
  console.log('Supply-chain pin check passed.');
}
