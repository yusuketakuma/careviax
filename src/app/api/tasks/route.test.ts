import { describe } from 'vitest';
import { registerTasksRouteGetCases } from './fixtures/route-get.cases';
import { registerTasksRoutePostCases } from './fixtures/route-post.cases';
import { registerTasksRouteBeforeEach } from './fixtures/route.test-support';

describe('/api/tasks', () => {
  registerTasksRouteBeforeEach();
  registerTasksRouteGetCases();
  registerTasksRoutePostCases();
});
