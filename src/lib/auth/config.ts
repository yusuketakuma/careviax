import NextAuth, { getServerSession, type NextAuthOptions } from 'next-auth';
import CognitoProvider from 'next-auth/providers/cognito';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getAuthBaseUrl, getAuthSecret } from './secret';
import { markLocalUserActive, resolveLocalUserByIdentity } from './user-resolution';
import {
  authenticateWithPassword,
  respondToNewPasswordChallenge,
  respondToSoftwareTokenChallenge,
} from '@/server/services/cognito-auth';

const authBaseUrl = getAuthBaseUrl();

if (authBaseUrl && !process.env.NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = authBaseUrl;
}

export const authOptions: NextAuthOptions = {
  secret: getAuthSecret(),
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'CareViaX Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        mode: { label: 'Mode', type: 'text' },
        challengeSession: { label: 'ChallengeSession', type: 'text' },
        code: { label: 'Code', type: 'text' },
        newPassword: { label: 'NewPassword', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const mode = credentials?.mode ?? 'password';

        if (!email) {
          throw new Error('CredentialsSignin');
        }

        if (mode === 'new_password') {
          const newPassword = credentials?.newPassword;
          const challengeSession = credentials?.challengeSession;
          if (!newPassword || !challengeSession) {
            throw new Error('NewPasswordRequired');
          }

          return respondToNewPasswordChallenge({
            email,
            newPassword,
            session: challengeSession,
          });
        }

        if (mode === 'mfa') {
          const code = credentials?.code;
          const challengeSession = credentials?.challengeSession;
          if (!code || !challengeSession) {
            throw new Error('MFARequired');
          }

          return respondToSoftwareTokenChallenge({
            email,
            code,
            session: challengeSession,
          });
        }

        const password = credentials?.password;
        if (!password) {
          throw new Error('CredentialsSignin');
        }

        return authenticateWithPassword({ email, password });
      },
    }),
    CognitoProvider({
      clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!,
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      issuer: `https://cognito-idp.${process.env.AWS_REGION ?? 'ap-northeast-1'}.amazonaws.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`,
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile, user }) {
      if (account) {
        token.cognitoSub = (profile?.sub as string | undefined) ?? token.cognitoSub;
        token.sub = token.cognitoSub;
        token.cognitoGroups = (profile as Record<string, unknown>)?.['cognito:groups'] ?? [];
      }

      if (account?.provider === 'credentials' && user) {
        const credentialUser = user as typeof user & {
          cognitoSub?: string;
          accessToken?: string;
          refreshToken?: string;
          idToken?: string;
        };
        token.userId = credentialUser.id;
        token.email = credentialUser.email;
        token.name = credentialUser.name;
        token.cognitoSub = credentialUser.cognitoSub ?? token.cognitoSub;
        token.sub = credentialUser.cognitoSub ?? credentialUser.id;
        token.accessToken = credentialUser.accessToken;
        token.refreshToken = credentialUser.refreshToken;
        token.idToken = credentialUser.idToken;
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
        session.accessToken =
          typeof token.accessToken === 'string' ? token.accessToken : undefined;
        session.refreshToken =
          typeof token.refreshToken === 'string' ? token.refreshToken : undefined;
        session.idToken =
          typeof token.idToken === 'string' ? token.idToken : undefined;
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
