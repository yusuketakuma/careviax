import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('browser notification service worker static boundary', () => {
  it('does not trust notification data URLs for OS notification clicks', () => {
    const source = readFileSync('public/browser-notifications-sw.js', 'utf8');

    expect(source).toContain("'/notifications'");
    expect(source).not.toMatch(
      /data\?\.\s*url|data\.url|openWindow\(url\)|location\.assign\(url\)/,
    );
  });
});
