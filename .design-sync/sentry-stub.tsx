// design-sync stub for `@sentry/nextjs`. The real package is a Next.js
// integration that drags Next internals (next/router, next/constants →
// gzip-size → fs/stream/zlib) into the browser bundle. In a Claude Design
// preview there is no Sentry transport and no Next runtime, so observability
// is a faithful no-op. Covers both `import * as Sentry` and named imports.
type AnyFn = (...args: unknown[]) => unknown;

export const captureException: AnyFn = () => undefined;
export const captureMessage: AnyFn = () => undefined;
export const addBreadcrumb: AnyFn = () => undefined;
export const setTag: AnyFn = () => undefined;
export const setTags: AnyFn = () => undefined;
export const setContext: AnyFn = () => undefined;
export const setExtra: AnyFn = () => undefined;
export const setUser: AnyFn = () => undefined;
export const init: AnyFn = () => undefined;
export const withScope = (cb?: (scope: Record<string, AnyFn>) => unknown) =>
  cb?.({ setTag, setTags, setContext, setExtra, setLevel: () => undefined, setUser });

const Sentry = {
  captureException,
  captureMessage,
  addBreadcrumb,
  setTag,
  setTags,
  setContext,
  setExtra,
  setUser,
  init,
  withScope,
};

export default Sentry;
