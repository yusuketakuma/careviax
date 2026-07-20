export type FileSizeBaselineEntry = {
  path: string;
  max_lines: number;
  task_id: string;
};

export type FileSizeExclusion = {
  path: string;
  kind: string;
  reason: string;
  source_or_generator: string;
};

export class FileSizeGateError extends Error {
  readonly details: string[];
  constructor(message: string, details?: string[]);
}

export function scanHumanMaintainedFiles(repoRoot: string): Array<{
  path: string;
  lines: number;
  tracked: boolean;
}>;

export function checkHumanMaintainedFileSize(options?: {
  repoRoot?: string;
  baselinePath?: string;
  exclusionsPath?: string;
  approvedBootstrapCommit?: string;
  approvedExclusions?: FileSizeExclusion[];
}): {
  files: number;
  baseline: number;
  exclusions: number;
};

export function legacyBaselineCandidates(
  repoRoot?: string,
  approvedExclusions?: FileSizeExclusion[],
): FileSizeBaselineEntry[];
