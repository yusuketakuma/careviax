// @vitest-environment jsdom

import { describe } from 'vitest';
import { registerInboundDetailCases } from './fixtures/inbound-content-detail.cases';
import { registerInboundReviewCases } from './fixtures/inbound-content-review.cases';

describe('InboundCommunicationsContent', () => {
  registerInboundDetailCases();
  registerInboundReviewCases();
});
