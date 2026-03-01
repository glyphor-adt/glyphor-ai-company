import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: { uid: string; email: string; tenantId: string };
      tenantId?: string;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  try {
    const token = authHeader.split('Bearer ')[1];
    const user = await verifyToken(token);
    req.user = user;
    req.tenantId = user.tenantId;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export async function founderMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.tenantId !== '00000000-0000-0000-0000-000000000000') {
    return res.status(403).json({ error: 'Founder access only' });
  }
  next();
}
