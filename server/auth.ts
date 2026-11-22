import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';

export type UserRole =
  | 'Super Admin'
  | 'Admin'
  | 'Manager'
  | 'Cashier'
  | 'Sales Staff'
  | 'Stock Manager';

export type Permission =
  | 'create_sales'
  | 'view_sales'
  | 'edit_products'
  | 'delete_products'
  | 'manage_stock'
  | 'manage_customers'
  | 'collect_dues'
  | 'manage_purchases'
  | 'view_profit_reports'
  | 'manage_settings'
  | 'manage_users'
  | 'manage_ecommerce'
  | 'send_messages';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  'Super Admin': [
    'create_sales', 'view_sales', 'edit_products', 'delete_products',
    'manage_stock', 'manage_customers', 'collect_dues', 'manage_purchases',
    'view_profit_reports', 'manage_settings', 'manage_users', 'manage_ecommerce', 'send_messages',
  ],
  Admin: [
    'create_sales', 'view_sales', 'edit_products', 'delete_products',
    'manage_stock', 'manage_customers', 'collect_dues', 'manage_purchases',
    'view_profit_reports', 'manage_settings', 'manage_users', 'manage_ecommerce', 'send_messages',
  ],
  Manager: [
    'create_sales', 'view_sales', 'edit_products', 'manage_stock',
    'manage_customers', 'collect_dues', 'manage_purchases',
    'view_profit_reports', 'manage_ecommerce', 'send_messages',
  ],
  Cashier: ['create_sales', 'view_sales', 'manage_customers', 'collect_dues', 'send_messages'],
  'Sales Staff': ['create_sales', 'view_sales', 'manage_customers'],
  'Stock Manager': ['edit_products', 'manage_stock', 'manage_purchases'],
};

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}

export function hashPassword(password: string, existingSalt?: string): { hash: string; salt: string } {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = crypto.scryptSync(password, salt, 64);
  const hashBuf = Buffer.from(hash, 'hex');
  if (derived.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(derived, hashBuf);
}

export const SESSION_COOKIE_NAME = 'amarpos_session';
const SHORT_SESSION_MS = 24 * 60 * 60 * 1000;
const PERSISTENT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function createSession(userId: number, rememberMe = true): string {
  const token = crypto.randomBytes(32).toString('hex');
  const ttlMs = rememberMe ? PERSISTENT_SESSION_MS : SHORT_SESSION_MS;
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  return token;
}

export function isHttpsRequest(req: Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  const referer = String(req.headers.referer || '').toLowerCase();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').toLowerCase();
  return (
    req.secure ||
    forwardedProto === 'https' ||
    origin.startsWith('https://') ||
    referer.startsWith('https://') ||
    forwardedHost.includes('.run.app')
  );
}

export function setSessionCookie(req: Request, res: Response, token: string, rememberMe = true) {
  const isHttps = isHttpsRequest(req);
  const parts = [`${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly'];
  if (rememberMe) {
    parts.push(`Max-Age=${Math.floor(PERSISTENT_SESSION_MS / 1000)}`);
  }
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: Request, res: Response) {
  const isHttps = isHttpsRequest(req);
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'Max-Age=0'];
  if (isHttps) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function parseCookieValue(cookieHeader: string | undefined, name: string): string {
  if (!cookieHeader) return '';
  const segments = cookieHeader.split(';');
  for (const segment of segments) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = segment.slice(0, eqIdx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(segment.slice(eqIdx + 1).trim());
      } catch {
        return segment.slice(eqIdx + 1).trim();
      }
    }
  }
  return '';
}

export function extractSessionAuth(req: Request): { token: string; viaCookie: boolean } {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return { token: bearer, viaCookie: false };
  }
  const cookieToken = parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  if (cookieToken) return { token: cookieToken, viaCookie: true };
  return { token: '', viaCookie: false };
}

export function getUserByToken(token: string): AuthUser | null {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as { id: number; name: string; email: string; role: UserRole; active: number; expires_at: string } | undefined;

  if (!row || !row.active) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    permissions: ROLE_PERMISSIONS[row.role] || [],
  };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const { token, viaCookie } = extractSessionAuth(req);
  if (viaCookie && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
    const customHeader = String(req.headers['x-requested-with'] || '');
    const origin = String(req.headers.origin || '');
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    let sameOrigin = false;
    if (origin && expectedHost) {
      try {
        sameOrigin = new URL(origin).host === expectedHost;
      } catch {
        sameOrigin = false;
      }
    }
    if (customHeader !== 'AmarPOS' && !sameOrigin) {
      res.status(403).json({ error: 'Cross-site state-changing request blocked.' });
      return;
    }
  }

  const user = getUserByToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.user = user;
  next();
}

export function requirePermission(permission: Permission) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!req.user.permissions.includes(permission)) {
      res.status(403).json({ error: `Permission denied: requires ${permission}` });
      return;
    }
    next();
  };
}

export function logAudit(
  user: AuthUser | undefined,
  action: string,
  entityType: string,
  entityId: string | number,
  details: Record<string, unknown> = {}
) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    user?.id ?? null,
    user?.name ?? 'System',
    action,
    entityType,
    String(entityId),
    JSON.stringify(details)
  );
}
