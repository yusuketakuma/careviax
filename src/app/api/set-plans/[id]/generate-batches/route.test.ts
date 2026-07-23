import { describe } from 'vitest';
import { registerGenerateBatchesConcurrencyCases } from './fixtures/route-concurrency.cases';
import { registerGenerateBatchesGenerationCases } from './fixtures/route-generation.cases';
import { registerGenerateBatchesGuardReuseCases } from './fixtures/route-guard-reuse.cases';
import { registerGenerateBatchesBeforeEach } from './fixtures/route.test-support';

describe('set-plans/[id]/generate-batches POST', () => {
  registerGenerateBatchesBeforeEach();
  registerGenerateBatchesGuardReuseCases();
  registerGenerateBatchesGenerationCases();
  registerGenerateBatchesConcurrencyCases();
});
