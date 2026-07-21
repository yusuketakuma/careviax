import type { Page } from '@playwright/test';

export type DesignScreenEntry = {
  screenId: string;
  /** Path relative to design/images, matching the manifest file field. */
  targetImage: string;
  route: string | null;
  auth?: boolean;
  viewport?: { width: number; height: number };
  setup?: (page: Page) => Promise<void>;
  /** Reason a route is unavailable, included in fidelity reports. */
  note?: string;
};
