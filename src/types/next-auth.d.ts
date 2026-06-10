import { DefaultSession } from 'next-auth';
import type { UserRole } from '@/phos/contracts/phos_contracts';

declare module 'next-auth' {
  interface Session {
    cognitoGroups?: unknown;
    error?: string;
    phosRole?: UserRole;
    user: DefaultSession['user'] & {
      id?: string;
      cognitoSub?: string;
      orgId?: string;
      sessionVersion?: number;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    cognitoSub?: string;
    orgId?: string;
    cognitoGroups?: unknown;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    accessTokenExpiry?: number;
    sessionVersion?: number;
    phosRole?: UserRole;
    error?: string;
  }
}
