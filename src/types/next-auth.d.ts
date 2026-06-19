import { DefaultSession } from 'next-auth';
import type { MemberRole } from '@prisma/client';
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
      defaultSiteId?: string | null;
      role: MemberRole | null;
      sessionVersion?: number;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    cognitoSub?: string;
    orgId?: string;
    defaultSiteId?: string | null;
    cognitoGroups?: unknown;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    accessTokenExpiry?: number;
    sessionVersion?: number;
    memberRole?: MemberRole | null;
    phosRole?: UserRole;
    error?: string;
  }
}
