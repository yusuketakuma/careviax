import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SHARED_SURFACE_FILES = [
  'src/components/layout/app-header.tsx',
  'src/components/layout/sidebar.tsx',
  'src/components/layout/mobile-nav.tsx',
  'src/components/features/notifications/notification-bell.tsx',
  'src/components/features/offline/offline-draft-indicator.tsx',
  'src/components/features/search/command-palette.tsx',
  'src/components/features/collaboration/presence-avatars.tsx',
  'src/components/features/collaboration/field-lock-indicator.tsx',
  'src/components/features/workflow/workflow-page-header.tsx',
  'src/components/features/workflow/page-shortcut-links.tsx',
  'src/components/features/workflow/collaboration-workflow-panel.tsx',
  'src/components/features/workflow/main-workflow-route.tsx',
  'src/components/features/workspace/action-rail.tsx',
  'src/components/ui/help-popover.tsx',
] as const;

const SUB_TWELVE_PIXEL_CLASS = /text-\[(?:[0-9]|1[01])px\]/g;

describe('shared shell typography contract', () => {
  it.each(SHARED_SURFACE_FILES)('%s keeps auxiliary text at 12px or larger', (filePath) => {
    const source = readFileSync(filePath, 'utf8');

    expect(source.match(SUB_TWELVE_PIXEL_CLASS), filePath).toBeNull();
  });
});
