import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    cognitoGroups?: unknown;
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
  }
}
