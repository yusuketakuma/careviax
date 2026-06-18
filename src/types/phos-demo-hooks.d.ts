// PH-OS dev/demo seed hooks attached to `window` for screenshot/QA flows.
// Each attach site gates these to non-production runtimes; declaring the names
// here gives the attach/cleanup sites a type-checked surface instead of
// laundering `window` through `as unknown as Record<string, unknown>`.
interface Window {
  __phosSeedPresenceDemo?: () => void;
  __phosSeedEvidenceDemo?: () => void;
  __phosSeedVisitModeDemo?: () => void;
  __phosSeedVoiceMemoDemo?: () => void;
  __phosSeedOfflineSyncDemo?: (mode?: 'queue' | 'conflict') => Promise<void>;
  __phosSeedPeriodReviewDemo?: () => void;
}
