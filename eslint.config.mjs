import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import security from 'eslint-plugin-security';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    name: 'security/blocking-high-signal',
    plugins: { security },
    rules: {
      'security/detect-bidi-characters': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-non-literal-require': 'error',
      'security/detect-pseudoRandomBytes': 'error',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'playwright-report/**',
    'test-results/**',
    'coverage/**',
    'artifacts/**',
    'agmsg/**',
    '.harness-worktrees/**',
    '.claude/**',
    'tools/tests/.artifacts/**',
    '.ds-sync/**',
    '.design-sync/.cache/**',
    '.design-sync/learnings/**',
    '.design-sync/node_modules/**',
    'ds-bundle/**',
    'next-env.d.ts',
    'public/sw.js',
    'public/swe-worker-*.js',
  ]),
]);

export default eslintConfig;
