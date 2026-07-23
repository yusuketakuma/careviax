import { describe } from 'vitest';
import {
  registerQrScanDraftGetBeforeEach,
  registerQrScanDraftGlobalHooks,
  registerQrScanDraftPostBeforeEach,
} from './fixtures/route.test-support';
import { registerQrScanDraftGetCases } from './fixtures/route-get.cases';
import { registerQrScanDraftPostDedupeCases } from './fixtures/route-post-dedupe.cases';
import { registerQrScanDraftPostIdentitySplitCases } from './fixtures/route-post-identity-split.cases';
import { registerQrScanDraftPostTransportCases } from './fixtures/route-post-transport.cases';

registerQrScanDraftGlobalHooks();

describe('/api/qr-scan-drafts GET', () => {
  registerQrScanDraftGetBeforeEach();
  registerQrScanDraftGetCases();
});

describe('/api/qr-scan-drafts POST', () => {
  registerQrScanDraftPostBeforeEach();
  registerQrScanDraftPostTransportCases();
  registerQrScanDraftPostIdentitySplitCases();
  registerQrScanDraftPostDedupeCases();
});
