import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareNextStandaloneRuntime, waitForStandaloneChild } from './start-next-standalone';

const tempRoots: string[] = [];

function createTempRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'phos-standalone-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('prepareNextStandaloneRuntime', () => {
  it('copies public and static assets beside the generated standalone server', () => {
    const root = createTempRoot();
    mkdirSync(path.join(root, '.next/standalone'), { recursive: true });
    mkdirSync(path.join(root, '.next/static/chunks'), { recursive: true });
    mkdirSync(path.join(root, 'public/icons'), { recursive: true });
    writeFileSync(path.join(root, '.next/standalone/server.js'), 'server');
    writeFileSync(path.join(root, '.next/static/chunks/app.js'), 'static');
    writeFileSync(path.join(root, 'public/icons/app.svg'), 'public');

    expect(prepareNextStandaloneRuntime(root)).toBe(path.join(root, '.next/standalone/server.js'));
    expect(
      readFileSync(path.join(root, '.next/standalone/.next/static/chunks/app.js'), 'utf8'),
    ).toBe('static');
    expect(readFileSync(path.join(root, '.next/standalone/public/icons/app.svg'), 'utf8')).toBe(
      'public',
    );
  });

  it('fails closed when the standalone server or required assets are missing', () => {
    const root = createTempRoot();
    expect(() => prepareNextStandaloneRuntime(root)).toThrow(/standalone server is missing/);

    mkdirSync(path.join(root, '.next/standalone'), { recursive: true });
    writeFileSync(path.join(root, '.next/standalone/server.js'), 'server');
    expect(() => prepareNextStandaloneRuntime(root)).toThrow(/asset source is missing: public/);
  });
});

describe('waitForStandaloneChild', () => {
  it('forwards repeated wrapper-only signals and removes listeners after child exit', async () => {
    const signalSource = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      kill: (signal: NodeJS.Signals) => boolean;
    };
    child.kill = vi.fn(() => true);

    const completion = waitForStandaloneChild(child, signalSource);
    signalSource.emit('SIGTERM');
    signalSource.emit('SIGINT');
    child.emit('exit', null, 'SIGTERM');
    await completion;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledWith('SIGINT');
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
  });
});
