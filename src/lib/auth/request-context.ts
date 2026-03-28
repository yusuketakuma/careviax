import { AsyncLocalStorage } from 'node:async_hooks';
import { type MemberRole } from '@prisma/client';

export type RequestAuthContext = {
  userId: string;
  orgId: string;
  role: MemberRole;
  ipAddress?: string;
  userAgent?: string;
};

const requestAuthContextStorage = new AsyncLocalStorage<RequestAuthContext | undefined>();

export function runWithRequestAuthContext<T>(ctx: RequestAuthContext, fn: () => T): T {
  return requestAuthContextStorage.run(ctx, fn);
}

export function setRequestAuthContext(ctx: RequestAuthContext) {
  requestAuthContextStorage.enterWith(ctx);
}

export function clearRequestAuthContext() {
  requestAuthContextStorage.enterWith(undefined);
}

export function getRequestAuthContext() {
  return requestAuthContextStorage.getStore();
}
