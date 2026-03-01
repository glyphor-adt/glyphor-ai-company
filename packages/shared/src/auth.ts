import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

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
