import NextAuth, { getServerSession, type NextAuthOptions } from 'next-auth';
import CognitoProvider from 'next-auth/providers/cognito';
import { markLocalUserActive, resolveLocalUserByIdentity } from './user-resolution';

export const authOptions: NextAuthOptions = {
  providers: [
    CognitoProvider({
      clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      issuer: `https://cognito-idp.${process.env.AWS_REGION ?? 'ap-northeast-1'}.amazonaws.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.cognitoSub = (profile?.sub as string | undefined) ?? token.cognitoSub;
        token.sub = token.cognitoSub;
        token.cognitoGroups = (profile as Record<string, unknown>)?.['cognito:groups'] ?? [];
      }

      if (!token.userId || account) {
        const localUser = await resolveLocalUserByIdentity({
          cognitoSub: token.cognitoSub,
          email:
            typeof token.email === 'string'
              ? token.email
              : typeof profile?.email === 'string'
                ? profile.email
                : undefined,
        });

        if (localUser) {
          const syncedUser = await markLocalUserActive(localUser);
          token.userId = syncedUser.id;
          token.cognitoSub = syncedUser.cognito_sub;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.cognitoSub =
          typeof token.cognitoSub === 'string' ? token.cognitoSub : undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session as any).cognitoGroups = token.cognitoGroups;
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 60, // 30 minutes
  },
};

export function auth() {
  return getServerSession(authOptions);
}

export const authHandler = NextAuth(authOptions);
