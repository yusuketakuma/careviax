import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    cognitoGroups?: unknown;
    error?: string;
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
    error?: string;
  }
}
