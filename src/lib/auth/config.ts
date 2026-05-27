import NextAuth, { getServerSession, type NextAuthOptions } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import CognitoProvider from 'next-auth/providers/cognito';
import CredentialsProvider from 'next-auth/providers/credentials';
import type { NextRequest } from 'next/server';
import { getAuthBaseUrl, getAuthSecret } from './secret';
import { markLocalUserActive, resolveLocalUserByIdentity } from './user-resolution';
import {
  authenticateWithPassword,
  refreshCognitoTokens,
  respondToNewPasswordChallenge,
  respondToSoftwareTokenChallenge,
} from '@/server/services/cognito-auth';

// Refresh access token 5 minutes before expiry
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const authBaseUrl = getAuthBaseUrl();

if (authBaseUrl && !process.env.NEXTAUTH_URL) {
  process.env.NEXTAUTH_URL = authBaseUrl;
}

export const authOptions: NextAuthOptions = {
  secret: getAuthSecret(),
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'PH-OS Credentials',
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
        token.accessTokenExpiry = Date.now() + 3600 * 1000;
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
          token.orgId = syncedUser.org_id;
          token.sessionVersion = syncedUser.session_version;
        }
      }

      // Refresh Cognito access token before it expires (credentials flow only)
      if (
        token.refreshToken &&
        token.accessTokenExpiry &&
        Date.now() > (token.accessTokenExpiry as number) - TOKEN_REFRESH_BUFFER_MS
      ) {
        try {
          const refreshed = await refreshCognitoTokens({
            refreshToken: token.refreshToken as string,
            username: typeof token.email === 'string' ? token.email : '',
          });
          token.accessToken = refreshed.accessToken;
          if (refreshed.idToken) token.idToken = refreshed.idToken;
          token.accessTokenExpiry = Date.now() + refreshed.expiresIn * 1000;
          token.error = undefined;
        } catch {
          // Cognito rejected refresh (account disabled / token revoked)
          token.error = 'RefreshAccessTokenError';
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.cognitoSub =
          typeof token.cognitoSub === 'string' ? token.cognitoSub : undefined;
        session.user.orgId = typeof token.orgId === 'string' ? token.orgId : undefined;
        session.user.sessionVersion =
          typeof token.sessionVersion === 'number' ? token.sessionVersion : undefined;
        session.cognitoGroups = token.cognitoGroups;
        session.error = token.error;
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

export async function getAuthAccessToken(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: getAuthSecret(),
  });

  return typeof token?.accessToken === 'string' ? token.accessToken : undefined;
}

export const authHandler = NextAuth(authOptions);
