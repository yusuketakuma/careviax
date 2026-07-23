import { describe } from 'vitest';
import { registerPatientBoardRouteCoreCases } from './fixtures/route-core.cases';
import { registerPatientBoardRouteCursorValidationCases } from './fixtures/route-cursor-validation.cases';
import { registerPatientBoardRouteFoundationCases } from './fixtures/route-foundation.cases';
import { registerPatientBoardRouteHooks } from './fixtures/route.test-support';

describe('/api/patients/board', () => {
  registerPatientBoardRouteHooks();
  registerPatientBoardRouteCoreCases();
  registerPatientBoardRouteFoundationCases();
  registerPatientBoardRouteCursorValidationCases();
});
