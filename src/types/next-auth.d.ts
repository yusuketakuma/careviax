import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    cognitoGroups?: unknown;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    user: DefaultSession['user'] & {
      id?: string;
      cognitoSub?: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
    cognitoSub?: string;
    cognitoGroups?: unknown;
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
  }
}
