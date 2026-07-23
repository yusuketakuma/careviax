import { describe } from 'vitest';
import { registerInquiryRecordPatchCoreCases } from './fixtures/route-patch-core.cases';
import { registerInquiryRecordPatchLinkedLineCases } from './fixtures/route-patch-linked-line.cases';
import { registerInquiryRecordPatchValidationOccCases } from './fixtures/route-patch-validation-occ.cases';
import { registerInquiryRecordPatchBeforeEach } from './route.test-support';

describe('/api/inquiry-records/[id] PATCH', () => {
  registerInquiryRecordPatchBeforeEach();
  registerInquiryRecordPatchCoreCases();
  registerInquiryRecordPatchLinkedLineCases();
  registerInquiryRecordPatchValidationOccCases();
});
