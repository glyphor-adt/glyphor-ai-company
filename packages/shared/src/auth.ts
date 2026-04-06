import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { OAuth2Client } from 'google-auth-library';

const DEFAULT_GOOGLE_DASHBOARD_CLIENT_ID = '610179349713-hsb5cloabe445k72uk4nv79d8jcaag67.apps.googleusercontent.com';
const googleAuthClient = new OAuth2Client();

function getFirebaseAuth() {
  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: 'ai-glyphor-company',
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getAuth();
}

export async function verifyToken(idToken: string): Promise<{
  uid: string;
  email: string;
  tenantId: string;
}> {
  const auth = getFirebaseAuth();
  const decoded = await auth.verifyIdToken(idToken);
  return {
    uid: decoded.uid,
    email: decoded.email || '',
    tenantId: (decoded as any).tenantId || '',
  };
}

export interface VerifiedUserAccessToken {
  uid: string;
  email: string;
  tenantId: string;
  provider: 'firebase' | 'google';
}

function getGoogleAudienceCandidates(): string[] {
  return Array.from(new Set([
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
    process.env.GOOGLE_CLIENT_ID?.trim(),
    process.env.VITE_GOOGLE_CLIENT_ID?.trim(),
    DEFAULT_GOOGLE_DASHBOARD_CLIENT_ID,
  ].filter((value): value is string => Boolean(value && value.trim()))));
}

async function verifyGoogleToken(idToken: string): Promise<VerifiedUserAccessToken> {
  const audience = getGoogleAudienceCandidates();
  let lastError: unknown = new Error('No Google OAuth client ID configured');

  for (const candidate of audience) {
    try {
      const ticket = await googleAuthClient.verifyIdToken({
        idToken,
        audience: candidate,
      });
      const payload = ticket.getPayload();
      const email = typeof payload?.email === 'string' ? payload.email : '';
      if (!email) {
        throw new Error('Google token is missing email claim');
      }
      return {
        uid: typeof payload?.sub === 'string' ? payload.sub : email,
        email,
        tenantId: '',
        provider: 'google',
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function verifyUserAccessToken(idToken: string): Promise<VerifiedUserAccessToken> {
  try {
    const verified = await verifyToken(idToken);
    return { ...verified, provider: 'firebase' };
  } catch {
    return verifyGoogleToken(idToken);
  }
}

export async function createCustomerUser(
  email: string,
  password: string,
  tenantId: string
): Promise<string> {
  const auth = getFirebaseAuth();
  const user = await auth.createUser({ email, password, emailVerified: false });
  await auth.setCustomUserClaims(user.uid, { tenantId, role: 'owner' });
  return user.uid;
}

export async function createSlackSession(
  slackUserId: string,
  email: string,
  tenantId: string
): Promise<string> {
  const auth = getFirebaseAuth();
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, { tenantId, slackUserId, role: 'owner' });
  return auth.createCustomToken(user.uid);
}
