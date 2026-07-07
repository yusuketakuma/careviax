#!/usr/bin/env node
// Route auth wrapper ratchet (CORE-ROUTE-001).
//
// New and modified API route handlers should use withAuthContext unless they
// have a documented exception. This checker freezes the current direct
// requireAuthContext debt so new direct-auth routes fail CI while the allowlist
// burns down route by route.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/route-auth-wrapper-allowlist.json';
const API_ROOT = 'src/app/api';
const ROUTE_FILE = 'route.ts';
const DIRECT_AUTH_PATTERN = /\brequireAuthContext\s*\(/g;
const PERMISSION_PATTERN = /permission:\s*['"]([^'"]+)['"]/g;

function walkRouteFiles(root) {
  const absoluteRoot = path.join(REPO_ROOT, root);
  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const child of readdirSync(current)) {
        if (child === 'node_modules' || child === '.next') continue;
        stack.push(path.join(current, child));
      }
      continue;
    }
    if (!stats.isFile() || path.basename(current) !== ROUTE_FILE) continue;
    files.push(path.relative(REPO_ROOT, current).split(path.sep).join('/'));
  }
  return files.sort();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function countPattern(source, pattern) {
  pattern.lastIndex = 0;
  let count = 0;
  while (pattern.exec(source) !== null) count += 1;
  return count;
}

function detectPermissions(source) {
  PERMISSION_PATTERN.lastIndex = 0;
  const permissions = [];
  let match;
  while ((match = PERMISSION_PATTERN.exec(source)) !== null) permissions.push(match[1]);
  return uniqueSorted(permissions);
}

function detectDirectAuthRoutes() {
  return walkRouteFiles(API_ROOT)
    .map((routePath) => {
      const source = readFileSync(path.join(REPO_ROOT, routePath), 'utf8');
      return {
        path: routePath,
        actualCount: countPattern(source, DIRECT_AUTH_PATTERN),
        permissions: detectPermissions(source),
        sensitiveNoStore: source.includes('withSensitiveNoStore'),
        routePerformance:
          source.includes('withRoutePerformance(') || source.includes('withAuthContext('),
      };
    })
    .filter((entry) => entry.actualCount > 0);
}

function readAllowlist() {
  const raw = readFileSync(path.join(REPO_ROOT, ALLOWLIST_PATH), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`${ALLOWLIST_PATH} must contain an entries array`);
  }

  return parsed.entries.map((entry, index) => {
    const label = `${ALLOWLIST_PATH}:entries[${index}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label} must be an object`);
    if (typeof entry.path !== 'string' || !entry.path) throw new Error(`${label}.path is required`);
    if (
      typeof entry.expectedCount !== 'number' ||
      !Number.isSafeInteger(entry.expectedCount) ||
      entry.expectedCount < 1
    ) {
      throw new Error(`${label}.expectedCount must be a positive integer`);
    }
    if (!Array.isArray(entry.permissions)) throw new Error(`${label}.permissions is required`);
    for (const permission of entry.permissions) {
      if (typeof permission !== 'string' || !permission.trim()) {
        throw new Error(`${label}.permissions must contain non-empty strings`);
      }
    }
    if (typeof entry.sensitiveNoStore !== 'boolean') {
      throw new Error(`${label}.sensitiveNoStore must be boolean`);
    }
    if (typeof entry.routePerformance !== 'boolean') {
      throw new Error(`${label}.routePerformance must be boolean`);
    }
    if (typeof entry.owner !== 'string' || !entry.owner.trim()) {
      throw new Error(`${label}.owner is required`);
    }
    if (typeof entry.debtId !== 'string' || !entry.debtId.trim()) {
      throw new Error(`${label}.debtId is required`);
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`${label}.reason is required`);
    }
    if (typeof entry.plannedAction !== 'string' || !entry.plannedAction.trim()) {
      throw new Error(`${label}.plannedAction is required`);
    }
    return {
      ...entry,
      permissions: uniqueSorted(entry.permissions),
      actualCount: 0,
    };
  });
}

function sameStringArray(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const current = detectDirectAuthRoutes();
const currentByPath = new Map(current.map((entry) => [entry.path, entry]));
const allowlist = readAllowlist();
const allowByPath = new Map(allowlist.map((entry) => [entry.path, entry]));

const newViolations = current.filter((entry) => !allowByPath.has(entry.path));
const staleEntries = [];
const driftEntries = [];

for (const entry of allowlist) {
  const actual = currentByPath.get(entry.path);
  if (!actual) {
    staleEntries.push({ entry, reason: 'no direct requireAuthContext usage remains' });
    continue;
  }
  entry.actualCount = actual.actualCount;
  if (actual.actualCount !== entry.expectedCount) {
    staleEntries.push({
      entry,
      reason: `expected ${entry.expectedCount}, found ${actual.actualCount}`,
    });
    continue;
  }
  if (
    !sameStringArray(actual.permissions, entry.permissions) ||
    actual.sensitiveNoStore !== entry.sensitiveNoStore ||
    actual.routePerformance !== entry.routePerformance
  ) {
    driftEntries.push({ entry, actual });
  }
}

if (newViolations.length > 0 || staleEntries.length > 0 || driftEntries.length > 0) {
  console.error('Route auth wrapper check failed.');
  if (newViolations.length > 0) {
    console.error('\nNew direct requireAuthContext routes:');
    for (const item of newViolations) {
      console.error(
        `- ${item.path}: count=${item.actualCount}, permissions=${item.permissions.join(',') || '-'}, noStore=${item.sensitiveNoStore}, performance=${item.routePerformance}`,
      );
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale route auth allowlist entries:');
    for (const { entry, reason } of staleEntries) {
      console.error(`- ${entry.path}: ${reason}`);
    }
  }
  if (driftEntries.length > 0) {
    console.error('\nRoute auth allowlist metadata drift:');
    for (const { entry, actual } of driftEntries) {
      console.error(
        `- ${entry.path}: expected permissions=${entry.permissions.join(',') || '-'} noStore=${entry.sensitiveNoStore} performance=${entry.routePerformance}; ` +
          `found permissions=${actual.permissions.join(',') || '-'} noStore=${actual.sensitiveNoStore} performance=${actual.routePerformance}`,
      );
    }
  }
  process.exit(1);
}

const totalDirectCalls = current.reduce((sum, entry) => sum + entry.actualCount, 0);
console.log(
  `Route auth wrapper check passed (${current.length} allowlisted routes, ${totalDirectCalls} direct requireAuthContext calls, 0 new routes).`,
);
