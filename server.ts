import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { cleanupBrokenLocalImagePaths, closeDatabase, db, defaultDbDir, initDatabase } from './server/db.ts';
import {
  type AuthedRequest,
  ROLE_PERMISSIONS,
  type UserRole,
  clearSessionCookie,
  createSession,
  extractSessionAuth,
  getUserByToken,
  hashPassword,
  logAudit,
  parseClientDeviceInfo,
  requireAuth,
  requirePermission,
  setSessionCookie,
  verifyPassword,
} from './server/auth.ts';
import { recognizeProductFromImage, getAvailableGeminiModels, getGeminiApiKey, saveGeminiKeyPermanently } from './server/ai.ts';
import {
  SMS_PROVIDER_PRESETS,
  type SmsGatewayRow,
  type SmsProviderType,
  assertSafeGatewayUrl,
  calculateSmsParts,
  checkGatewayBalance,
  dispatchSmsViaGateway,
  encryptSecret,
  maskSecretHint,
  normalizePhoneNumber,
  renderSmsTemplate,
  initPermanentSmsGateways,
  saveSmsGatewaysBackup,
} from './server/sms.ts';
import {
  type GoogleSheetsConfigRow,
  SHEET_TABS,
  buildDatasetTablesFromDb,
  createAmarPosSpreadsheet,
  extractSpreadsheetId,
  getSpreadsheetMetadata,
  readSheetTabPreview,
  rowsToCsvString,
  validateGoogleAccessToken,
  writeCloudBackupToSheet,
  writeTabsToGoogleSheet,
} from './server/googleSheets.ts';

initDatabase();
cleanupBrokenLocalImagePaths();
initPermanentSmsGateways();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));

// Helper: execute inside SQLite transaction
function withTransaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Helper: FEFO stock deduction
function deductStockFEFO(
  productId: number,
  unitsToDeduct: number,
  type: string,
  referenceId: string,
  note: string,
  userId?: number
): { firstBatchId: number | null; conflict: string | null } {
  const batches = db
    .prepare(
      `SELECT id, batch_number, expiry_date, quantity
       FROM product_batches
       WHERE product_id = ? AND quantity > 0
       ORDER BY
         CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END ASC,
         expiry_date ASC,
         id ASC`
    )
    .all(productId) as Array<{ id: number; batch_number: string; expiry_date: string; quantity: number }>;

  const totalBefore = (
    db.prepare(`SELECT COALESCE(SUM(quantity), 0) as qty FROM product_batches WHERE product_id = ?`).get(productId) as {
      qty: number;
    }
  ).qty;

  let remaining = unitsToDeduct;
  let firstBatchId: number | null = batches[0]?.id ?? null;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    db.prepare(`UPDATE product_batches SET quantity = quantity - ? WHERE id = ?`).run(take, batch.id);
    remaining -= take;
  }

  let conflict: string | null = null;
  if (remaining > 0) {
    // Offline sync or concurrent sale exceeded local available batches: record negative delta in default batch so sale is never lost, and flag conflict
    conflict = `Stock shortage of ${remaining} base units during ${type} (${referenceId})`;
    const fallbackBatch = db
      .prepare(`SELECT id FROM product_batches WHERE product_id = ? ORDER BY id DESC LIMIT 1`)
      .get(productId) as { id: number } | undefined;
    if (fallbackBatch) {
      db.prepare(`UPDATE product_batches SET quantity = quantity - ? WHERE id = ?`).run(remaining, fallbackBatch.id);
      firstBatchId = firstBatchId ?? fallbackBatch.id;
    } else {
      const created = db
        .prepare(`INSERT INTO product_batches (product_id, batch_number, quantity, purchase_price) VALUES (?, 'SYNC-ADJ', ?, 0)`)
        .run(productId, -remaining);
      firstBatchId = Number(created.lastInsertRowid);
    }
  }

  const totalAfter = totalBefore - unitsToDeduct;
  db.prepare(
    `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, reference_id, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(productId, firstBatchId, type, -unitsToDeduct, totalBefore, totalAfter, referenceId, note, userId ?? null);

  return { firstBatchId, conflict };
}

function nextInvoiceNo(prefix: string, table: 'sales' | 'purchases' | 'due_payments', col: string): string {
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
  const num = String(row.c + 1).padStart(4, '0');
  const yr = new Date().getFullYear();
  const rnd = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${yr}-${num}-${rnd}`;
}

// ==========================================
// AUTHENTICATION & BOOTSTRAP
// ==========================================

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/api/auth/status', (_req: Request, res: Response) => {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
  const envPasscodeSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
  res.json({ needsBootstrap: count === 0 && !envPasscodeSet, userCount: count, envPasscodeMode: envPasscodeSet });
});

app.get('/api/auth/session', (req: Request, res: Response) => {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
  const envPasscodeSet = Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
  const { token } = extractSessionAuth(req);
  const user = token ? getUserByToken(token) : null;
  res.json({
    authenticated: Boolean(user),
    user,
    needsBootstrap: count === 0 && !envPasscodeSet,
    userCount: count,
    envPasscodeMode: envPasscodeSet,
  });
});

app.post('/api/auth/signup', (req: Request, res: Response) => {
  try {
    const { name, email, password, confirmPassword, acceptedPolicy, rememberMe } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
      acceptedPolicy?: boolean;
      rememberMe?: boolean;
    };

    if (acceptedPolicy !== true) {
      res.status(400).json({ error: 'Please check the mandatory Policy Agreement checkbox before signing up.' });
      return;
    }
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();
    if (cleanName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: 'Valid full name (min 2 chars) and email address are required.' });
      return;
    }
    if (!cleanPassword || cleanPassword.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      return;
    }
    if (confirmPassword !== undefined && cleanPassword !== String(confirmPassword).trim()) {
      res.status(400).json({ error: 'Password and confirm password do not match.' });
      return;
    }

    const persistSession = rememberMe !== false;
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const clientDevice = parseClientDeviceInfo(userAgent, clientIp);

    const result = withTransaction(() => {
      const existing = db.prepare(`SELECT id FROM users WHERE LOWER(TRIM(email)) = ?`).get(cleanEmail) as { id: number } | undefined;
      if (existing) {
        return { error: 'এই ইমেইল দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট তৈরি করা হয়েছে। অনুগ্রহ করে লগইন করুন।', status: 409 as const };
      }

      const count = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
      const isBootstrap = count === 0;
      const assignedRole: UserRole = isBootstrap ? 'Super Admin' : 'Cashier';
      const isActive = isBootstrap ? 1 : 0; // If first user, bootstrap is active; others require admin approval from Users & Permissions
      const { hash, salt } = hashPassword(cleanPassword);
      const info = db
        .prepare(`INSERT INTO users (name, email, role, password_hash, password_salt, active) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(cleanName, cleanEmail, assignedRole, hash, salt, isActive);

      const userId = Number(info.lastInsertRowid);
      const user = {
        id: userId,
        name: cleanName,
        email: cleanEmail,
        role: assignedRole,
        permissions: ROLE_PERMISSIONS[assignedRole],
      };

      logAudit(
        user,
        isBootstrap ? 'BOOTSTRAP_ADMIN' : 'SIGNUP_USER',
        'users',
        userId,
        {
          email: user.email,
          role: assignedRole,
          active: isActive,
          requiresApproval: !isBootstrap,
          os: clientDevice.os,
          deviceType: clientDevice.deviceType,
          browser: clientDevice.browser,
          ip: clientDevice.ip,
        },
        clientDevice.ip,
        `${clientDevice.deviceType} (${clientDevice.os})`,
        clientDevice.browser
      );

      if (!isBootstrap) {
        return {
          requiresApproval: true,
          message: 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে! সিস্টেমে প্রবেশের জন্য অ্যাডমিন কর্তৃক অনুমোদনের প্রয়োজন। "ইউজার ও পারমিশন" মেনু থেকে অনুমতি পাওয়ার পর লগইন করতে পারবেন।',
          status: 201 as const
        };
      }

      const token = createSession(userId, persistSession);
      return { token, user, status: 201 as const, requiresApproval: false };
    });

    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    if (result.requiresApproval) {
      res.status(201).json({ requiresApproval: true, message: result.message });
      return;
    }

    setSessionCookie(req, res, result.token!, persistSession);
    res.status(201).json({ token: result.token, user: result.user });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/auth/bootstrap', (req: Request, res: Response) => {
  try {
    const { name, email, password, acceptedPolicy, rememberMe } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      acceptedPolicy?: boolean;
      rememberMe?: boolean;
    };
    if (acceptedPolicy === false) {
      res.status(400).json({ error: 'Please accept the mandatory Policy Agreement checkbox to proceed.' });
      return;
    }
    if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
      res.status(400).json({ error: 'Name, valid email, and password (min 6 chars) are required.' });
      return;
    }

    const persistSession = rememberMe !== false;

    const result = withTransaction(() => {
      const count = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
      if (count > 0) {
        return { error: 'Admin account has already been claimed. Please sign in.' };
      }
      const { hash, salt } = hashPassword(password);
      const info = db
        .prepare(`INSERT INTO users (name, email, role, password_hash, password_salt) VALUES (?, ?, 'Super Admin', ?, ?)`)
        .run(name.trim(), email.trim().toLowerCase(), hash, salt);
      const userId = Number(info.lastInsertRowid);
      const token = createSession(userId, persistSession);
      const user = {
        id: userId,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        role: 'Super Admin' as UserRole,
        permissions: ROLE_PERMISSIONS['Super Admin'],
      };
      logAudit(user, 'BOOTSTRAP_ADMIN', 'users', userId, { email: user.email, acceptedPolicy: true });
      return { token, user };
    });

    if ('error' in result) {
      res.status(403).json({ error: result.error });
      return;
    }
    setSessionCookie(req, res, result.token, persistSession);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  try {
    const { email, password, rememberMe } = req.body as {
      email?: string;
      password?: string;
      rememberMe?: boolean;
    };
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '').trim();

    if (!cleanEmail || !cleanPassword) {
      res.status(400).json({ error: 'ইমেইল এবং পাসওয়ার্ড উভয়ই আবশ্যক (Email and password are required).' });
      return;
    }

    const persistSession = rememberMe !== false;
    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';
    const clientDevice = parseClientDeviceInfo(userAgent, clientIp);

    // Check if users table is empty; if so, create the default admin account
    const userCount = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
    if (userCount === 0) {
      const { hash, salt } = hashPassword('admin123');
      db.prepare(`
        INSERT INTO users (name, email, role, password_hash, password_salt, active)
        VALUES (?, ?, 'Super Admin', ?, ?, 1)
      `).run('Super Admin', 'admin@amarpos.com', hash, salt);
    }

    // Support ADMIN_PASSCODE override if configured in environment
    const envPasscode = process.env.ADMIN_PASSCODE?.trim();
    const row = db
      .prepare(`SELECT id, name, email, role, password_hash, password_salt, active FROM users WHERE LOWER(TRIM(email)) = ?`)
      .get(cleanEmail) as
      | { id: number; name: string; email: string; role: UserRole; password_hash: string; password_salt: string; active: number }
      | undefined;

    if (!row && envPasscode && cleanPassword === envPasscode) {
      const { hash, salt } = hashPassword(cleanPassword);
      const info = db
        .prepare(`INSERT INTO users (name, email, role, password_hash, password_salt, active) VALUES (?, ?, 'Super Admin', ?, ?, 1)`)
        .run('Store Admin', cleanEmail, hash, salt);
      const userId = Number(info.lastInsertRowid);
      const token = createSession(userId, persistSession);
      const user = {
        id: userId,
        name: 'Store Admin',
        email: cleanEmail,
        role: 'Super Admin' as UserRole,
        permissions: ROLE_PERMISSIONS['Super Admin'],
      };
      logAudit(
        user,
        'LOGIN',
        'users',
        userId,
        {
          envPasscode: true,
          rememberMe: persistSession,
          os: clientDevice.os,
          deviceType: clientDevice.deviceType,
          browser: clientDevice.browser,
          ip: clientDevice.ip,
        },
        clientDevice.ip,
        `${clientDevice.deviceType} (${clientDevice.os})`,
        clientDevice.browser
      );
      setSessionCookie(req, res, token, persistSession);
      res.json({ token, user });
      return;
    }

    if (!row) {
      res.status(401).json({ error: 'এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি। সঠিক ইমেইল দিন অথবা নিচে সাইন আপ করুন।' });
      return;
    }

    // Strict Permission Gate: Only active / permitted users can access the system
    if (!row.active) {
      logAudit(
        { id: row.id, name: row.name, email: row.email, role: row.role, permissions: [] },
        'LOGIN_BLOCKED',
        'users',
        row.id,
        {
          reason: 'User account deactivated / no login permission granted',
          email: row.email,
          role: row.role,
          os: clientDevice.os,
          deviceType: clientDevice.deviceType,
          browser: clientDevice.browser,
          ip: clientDevice.ip,
        },
        clientDevice.ip,
        `${clientDevice.deviceType} (${clientDevice.os})`,
        clientDevice.browser
      );
      res.status(403).json({
        error: 'আপনার অ্যাকাউন্টে সিস্টেমে প্রবেশের অনুমতি নেই। অ্যাডমিনের সাথে যোগাযোগ করে "ইউজার ও পারমিশন" মেনু থেকে অনুমতি চালু করুন।'
      });
      return;
    }

    const valid =
      (row.role === 'Super Admin' && envPasscode && cleanPassword === envPasscode) ||
      verifyPassword(cleanPassword, row.password_hash, row.password_salt);

    if (!valid) {
      res.status(401).json({ error: 'ভুল পাসওয়ার্ড! অনুগ্রহ করে সঠিক পাসওয়ার্ড দিন।' });
      return;
    }

    const token = createSession(row.id, persistSession);
    const user = {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      permissions: ROLE_PERMISSIONS[row.role] || [],
    };
    logAudit(
      user,
      'LOGIN',
      'users',
      row.id,
      {
        rememberMe: persistSession,
        os: clientDevice.os,
        deviceType: clientDevice.deviceType,
        browser: clientDevice.browser,
        ip: clientDevice.ip,
      },
      clientDevice.ip,
      `${clientDevice.deviceType} (${clientDevice.os})`,
      clientDevice.browser
    );
    setSessionCookie(req, res, token, persistSession);
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
  const { token } = extractSessionAuth(req);
  if (token) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
  }
  clearSessionCookie(req, res);
  logAudit(req.user, 'LOGOUT', 'users', req.user?.id ?? '', {});
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

// ==========================================
// DASHBOARD & ANALYTICS
// ==========================================

app.get('/api/dashboard', requireAuth, (req: AuthedRequest, res: Response) => {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const fromDate = String(req.query.from || todayStr);
    const toDate = String(req.query.to || todayStr);
    const period = String(req.query.period || 'daily');

    const salesToday = db
      .prepare(
        `SELECT COALESCE(SUM(total), 0) as total_sales,
                COUNT(*) as tx_count,
                COALESCE(SUM(CASE WHEN sale_type = 'ONLINE' THEN 1 ELSE 0 END), 0) as online_count
         FROM sales
         WHERE status NOT IN ('HELD', 'CANCELLED')
           AND date(created_at) BETWEEN date(?) AND date(?)`
      )
      .get(fromDate, toDate) as { total_sales: number; tx_count: number; online_count: number };

    const cogsRow = db
      .prepare(
        `SELECT COALESCE(SUM((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price), 0) as cogs,
                COALESCE(SUM((si.quantity - si.returned_qty) * si.unit_price), 0) as item_net_sales
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.status NOT IN ('HELD', 'CANCELLED')
           AND date(s.created_at) BETWEEN date(?) AND date(?)`
      )
      .get(fromDate, toDate) as { cogs: number; item_net_sales: number };

    const purchasesToday = (
      db
        .prepare(
          `SELECT COALESCE(SUM(total), 0) as total_purchases
           FROM purchases
           WHERE date(created_at) BETWEEN date(?) AND date(?)`
        )
        .get(fromDate, toDate) as { total_purchases: number }
    ).total_purchases;

    const expensesToday = (
      db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) as total_expenses
           FROM expenses
           WHERE date(created_at) BETWEEN date(?) AND date(?)`
        )
        .get(fromDate, toDate) as { total_expenses: number }
    ).total_expenses;

    const grossProfit = Number((salesToday.total_sales - cogsRow.cogs).toFixed(2));
    const estimatedNetProfit = Number((grossProfit - expensesToday).toFixed(2));

    const totalCustomerDue = (
      db.prepare(`SELECT COALESCE(SUM(current_due), 0) as due FROM customers`).get() as { due: number }
    ).due;
    const totalSupplierDue = (
      db.prepare(`SELECT COALESCE(SUM(total_due), 0) as due FROM suppliers`).get() as { due: number }
    ).due;
    const totalCustomers = (db.prepare(`SELECT COUNT(*) as c FROM customers`).get() as { c: number }).c;

    const products = db
      .prepare(
        `SELECT p.id, p.min_stock_alert,
                COALESCE((SELECT SUM(quantity) FROM product_batches WHERE product_id = p.id), 0) as stock,
                COALESCE((SELECT SUM(quantity * purchase_price) FROM product_batches WHERE product_id = p.id AND quantity > 0), 0) as stock_val
         FROM products p WHERE p.active = 1`
      )
      .all() as Array<{ id: number; min_stock_alert: number; stock: number; stock_val: number }>;

    const totalProducts = products.length;
    const totalStockValue = products.reduce((s, p) => s + p.stock_val, 0);
    const lowStockCount = products.filter((p) => p.stock > 0 && p.stock <= p.min_stock_alert).length;
    const outOfStockCount = products.filter((p) => p.stock <= 0).length;

    const expiredProducts = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT product_id) as c FROM product_batches
           WHERE quantity > 0 AND expiry_date != '' AND date(expiry_date) < date('now')`
        )
        .get() as { c: number }
    ).c;

    const nearExpiryProducts = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT product_id) as c FROM product_batches
           WHERE quantity > 0 AND expiry_date != '' AND date(expiry_date) >= date('now') AND date(expiry_date) <= date('now', '+60 days')`
        )
        .get() as { c: number }
    ).c;

    const onlineStats = db
      .prepare(
        `SELECT COUNT(*) as total_online,
                COALESCE(SUM(CASE WHEN status IN ('PENDING', 'PROCESSING') THEN 1 ELSE 0 END), 0) as pending_online
         FROM sales WHERE sale_type = 'ONLINE'`
      )
      .get() as { total_online: number; pending_online: number };

    // Time-series chart grouping
    let groupExpr = `strftime('%Y-%m-%d', s.created_at)`;
    let expGroupExpr = `strftime('%Y-%m-%d', created_at)`;
    if (period === 'weekly') {
      groupExpr = `strftime('%Y-W%W', s.created_at)`;
      expGroupExpr = `strftime('%Y-W%W', created_at)`;
    } else if (period === 'monthly') {
      groupExpr = `strftime('%Y-%m', s.created_at)`;
      expGroupExpr = `strftime('%Y-%m', created_at)`;
    } else if (period === 'yearly') {
      groupExpr = `strftime('%Y', s.created_at)`;
      expGroupExpr = `strftime('%Y', created_at)`;
    }

    const salesSeries = db
      .prepare(
        `SELECT ${groupExpr} as bucket,
                COALESCE(SUM(s.total), 0) as sales,
                COALESCE(SUM((SELECT SUM((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price) FROM sale_items si WHERE si.sale_id = s.id)), 0) as cogs
         FROM sales s
         WHERE s.status NOT IN ('HELD', 'CANCELLED')
         GROUP BY bucket
         ORDER BY bucket DESC
         LIMIT 12`
      )
      .all() as Array<{ bucket: string; sales: number; cogs: number }>;

    const expenseSeries = db
      .prepare(
        `SELECT ${expGroupExpr} as bucket, COALESCE(SUM(amount), 0) as expense
         FROM expenses
         GROUP BY bucket`
      )
      .all() as Array<{ bucket: string; expense: number }>;

    const expMap = new Map(expenseSeries.map((e) => [e.bucket, e.expense]));
    const chartTrends = salesSeries
      .slice()
      .reverse()
      .map((row) => {
        const exp = expMap.get(row.bucket) || 0;
        const gp = row.sales - row.cogs;
        return {
          label: row.bucket,
          sales: Number(row.sales.toFixed(2)),
          profit: Number((gp - exp).toFixed(2)),
          expenses: Number(exp.toFixed(2)),
        };
      });

    const topProducts = db
      .prepare(
        `SELECT si.product_name as name, SUM(si.quantity - si.returned_qty) as qty, SUM(si.line_total) as revenue
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE s.status NOT IN ('HELD', 'CANCELLED')
         GROUP BY si.product_id, si.product_name
         ORDER BY revenue DESC
         LIMIT 6`
      )
      .all();

    const paymentStats = db
      .prepare(
        `SELECT payment_method as method, COUNT(*) as count, COALESCE(SUM(total), 0) as amount
         FROM sales
         WHERE status NOT IN ('HELD', 'CANCELLED')
         GROUP BY payment_method`
      )
      .all();

    const canViewProfit = req.user?.permissions.includes('view_profit_reports') ?? false;

    res.json({
      kpis: {
        todaySales: Number(salesToday.total_sales.toFixed(2)),
        todayPurchases: Number(purchasesToday.toFixed(2)),
        todayGrossProfit: canViewProfit ? grossProfit : null,
        todayNetProfit: canViewProfit ? estimatedNetProfit : null,
        todayExpenses: Number(expensesToday.toFixed(2)),
        totalCustomerDue: Number(totalCustomerDue.toFixed(2)),
        totalSupplierDue: Number(totalSupplierDue.toFixed(2)),
        totalProducts,
        totalStockValue: Number(totalStockValue.toFixed(2)),
        lowStockCount,
        outOfStockCount,
        expiredProducts,
        nearExpiryProducts,
        totalCustomers,
        todayTransactions: salesToday.tx_count,
        onlineOrders: onlineStats.total_online,
        pendingOrders: onlineStats.pending_online,
      },
      chartTrends,
      topProducts,
      paymentStats,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ==========================================
// CATEGORIES & PRODUCTS & STOCK
// ==========================================

app.get('/api/categories', requireAuth, (_req: Request, res: Response) => {
  const rows = db.prepare(`SELECT * FROM categories ORDER BY name ASC`).all();
  res.json(rows);
});

app.post('/api/categories', requireAuth, requirePermission('edit_products'), (req: AuthedRequest, res: Response) => {
  try {
    const { name, name_bn, description } = req.body as { name: string; name_bn?: string; description?: string };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Category name is required' });
      return;
    }
    const info = db
      .prepare(`INSERT INTO categories (name, name_bn, description) VALUES (?, ?, ?)`)
      .run(name.trim(), (name_bn || name).trim(), description || '');
    logAudit(req.user, 'CREATE_CATEGORY', 'categories', Number(info.lastInsertRowid), { name });
    res.status(201).json({ id: Number(info.lastInsertRowid), name: name.trim(), name_bn: (name_bn || name).trim() });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/products', requireAuth, (_req: Request, res: Response) => {
  const products = db
    .prepare(
      `SELECT p.*, c.name as category_name, c.name_bn as category_name_bn
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1
       ORDER BY p.id DESC`
    )
    .all() as Array<Record<string, unknown>>;

  const batches = db
    .prepare(
      `SELECT * FROM product_batches
       ORDER BY
         CASE WHEN expiry_date IS NULL OR expiry_date = '' THEN 1 ELSE 0 END ASC,
         expiry_date ASC,
         id ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const batchByProd = new Map<number, Array<Record<string, unknown>>>();
  for (const b of batches) {
    const pid = Number(b.product_id);
    if (!batchByProd.has(pid)) batchByProd.set(pid, []);
    batchByProd.get(pid)!.push(b);
  }

  const enriched = products.map((p) => {
    const prodBatches = batchByProd.get(Number(p.id)) || [];
    const current_stock = prodBatches.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
    return {
      ...p,
      current_stock,
      batches: prodBatches,
    };
  });

  res.json(enriched);
});

app.post('/api/products', requireAuth, requirePermission('edit_products'), (req: AuthedRequest, res: Response) => {
  try {
    const b = req.body;
    if (!b.name?.trim() || !b.sku?.trim()) {
      res.status(400).json({ error: 'Product name and SKU are required.' });
      return;
    }

    const result = withTransaction(() => {
      const info = db
        .prepare(
          `INSERT INTO products (
            name, name_bn, sku, barcode, qr_code, category_id, subcategory, brand, manufacturer,
            generic_name, strength, dosage_form, package_size, unit, units_per_strip, strips_per_box,
            purchase_price, wholesale_price, retail_price, min_selling_price, vat_percent,
            image_url, show_online, online_price, description, min_stock_alert
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          b.name.trim(),
          b.name_bn || '',
          b.sku.trim(),
          b.barcode || '',
          b.qr_code || b.sku.trim(),
          b.category_id || null,
          b.subcategory || '',
          b.brand || '',
          b.manufacturer || '',
          b.generic_name || '',
          b.strength || '',
          b.dosage_form || '',
          b.package_size || '',
          b.unit || 'Piece',
          Number(b.units_per_strip || 1),
          Number(b.strips_per_box || 1),
          Number(b.purchase_price || 0),
          Number(b.wholesale_price || 0),
          Number(b.retail_price || 0),
          Number(b.min_selling_price || 0),
          Number(b.vat_percent || 0),
          b.image_url || '',
          b.show_online ? 1 : 0,
          Number(b.online_price || b.retail_price || 0),
          b.description || '',
          Number(b.min_stock_alert ?? 10)
        );

      const productId = Number(info.lastInsertRowid);
      const openQty = Number(b.opening_stock || 0);
      if (openQty > 0) {
        const batchNo = b.batch_number?.trim() || `OPN-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;
        const batchRes = db
          .prepare(
            `INSERT INTO product_batches (product_id, batch_number, mfg_date, expiry_date, quantity, purchase_price)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(productId, batchNo, b.mfg_date || '', b.expiry_date || '', openQty, Number(b.purchase_price || 0));

        db.prepare(
          `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, unit_cost, note, user_id)
           VALUES (?, ?, 'OPENING', ?, 0, ?, ?, 'Opening stock on product creation', ?)`
        ).run(productId, Number(batchRes.lastInsertRowid), openQty, openQty, Number(b.purchase_price || 0), req.user?.id ?? null);
      }

      logAudit(req.user, 'CREATE_PRODUCT', 'products', productId, { sku: b.sku, opening_stock: openQty });
      return { id: productId };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/api/products/:id', requireAuth, requirePermission('edit_products'), (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const b = req.body;
    db.prepare(
      `UPDATE products SET
        name = ?, name_bn = ?, sku = ?, barcode = ?, category_id = ?, subcategory = ?, brand = ?,
        manufacturer = ?, generic_name = ?, strength = ?, dosage_form = ?, package_size = ?,
        unit = ?, units_per_strip = ?, strips_per_box = ?, purchase_price = ?, wholesale_price = ?,
        retail_price = ?, min_selling_price = ?, vat_percent = ?, image_url = ?, show_online = ?,
        online_price = ?, description = ?, min_stock_alert = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.name, b.name_bn || '', b.sku, b.barcode || '', b.category_id || null, b.subcategory || '',
      b.brand || '', b.manufacturer || '', b.generic_name || '', b.strength || '', b.dosage_form || '',
      b.package_size || '', b.unit || 'Piece', Number(b.units_per_strip || 1), Number(b.strips_per_box || 1),
      Number(b.purchase_price || 0), Number(b.wholesale_price || 0), Number(b.retail_price || 0),
      Number(b.min_selling_price || 0), Number(b.vat_percent || 0), b.image_url || '',
      b.show_online ? 1 : 0, Number(b.online_price || b.retail_price || 0), b.description || '',
      Number(b.min_stock_alert ?? 10), id
    );
    logAudit(req.user, 'UPDATE_PRODUCT', 'products', id, { name: b.name });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/products/:id', requireAuth, requirePermission('delete_products'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  logAudit(req.user, 'DELETE_PRODUCT', 'products', id, {});
  res.json({ ok: true });
});

app.post('/api/products/:id/stock-adjustment', requireAuth, requirePermission('manage_stock'), (req: AuthedRequest, res: Response) => {
  try {
    const productId = Number(req.params.id);
    const { type, quantity, batch_number, expiry_date, note } = req.body as {
      type: 'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT' | 'DAMAGED';
      quantity: number;
      batch_number?: string;
      expiry_date?: string;
      note?: string;
    };
    const qty = Math.abs(Number(quantity || 0));
    if (!qty) {
      res.status(400).json({ error: 'Quantity must be greater than 0.' });
      return;
    }

    const result = withTransaction(() => {
      const prod = db.prepare(`SELECT purchase_price FROM products WHERE id = ?`).get(productId) as
        | { purchase_price: number }
        | undefined;
      if (!prod) throw new Error('Product not found');

      const prevTotal = (
        db.prepare(`SELECT COALESCE(SUM(quantity), 0) as qty FROM product_batches WHERE product_id = ?`).get(productId) as {
          qty: number;
        }
      ).qty;

      if (type === 'STOCK_IN') {
        const bNo = batch_number?.trim() || `IN-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;
        const existing = db
          .prepare(`SELECT id FROM product_batches WHERE product_id = ? AND batch_number = ?`)
          .get(productId, bNo) as { id: number } | undefined;

        let batchId: number;
        if (existing) {
          db.prepare(`UPDATE product_batches SET quantity = quantity + ? WHERE id = ?`).run(qty, existing.id);
          batchId = existing.id;
        } else {
          const ins = db
            .prepare(
              `INSERT INTO product_batches (product_id, batch_number, expiry_date, quantity, purchase_price)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(productId, bNo, expiry_date || '', qty, prod.purchase_price);
          batchId = Number(ins.lastInsertRowid);
        }

        db.prepare(
          `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, unit_cost, note, user_id)
           VALUES (?, ?, 'STOCK_IN', ?, ?, ?, ?, ?, ?)`
        ).run(productId, batchId, qty, prevTotal, prevTotal + qty, prod.purchase_price, note || 'Manual stock-in', req.user?.id ?? null);
      } else {
        deductStockFEFO(productId, qty, type, 'MANUAL', note || `Manual ${type}`, req.user?.id);
      }

      logAudit(req.user, `STOCK_${type}`, 'products', productId, { qty, note });
      return { ok: true };
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/stock-movements', requireAuth, (_req: Request, res: Response) => {
  const rows = db
    .prepare(
      `SELECT sm.*, p.name as product_name, p.sku, pb.batch_number, u.name as user_name
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       LEFT JOIN product_batches pb ON pb.id = sm.batch_id
       LEFT JOIN users u ON u.id = sm.user_id
       ORDER BY sm.id DESC
       LIMIT 150`
    )
    .all();
  res.json(rows);
});

// ==========================================
// SALES, POS CHECKOUT, HOLD/RESUME, RETURNS
// ==========================================

app.get('/api/sales', requireAuth, (_req: Request, res: Response) => {
  const sales = db
    .prepare(
      `SELECT s.*, u.name as cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.id DESC
       LIMIT 200`
    )
    .all() as Array<Record<string, unknown>>;

  const items = db.prepare(`SELECT * FROM sale_items`).all() as Array<Record<string, unknown>>;
  const bySale = new Map<number, Array<Record<string, unknown>>>();
  for (const it of items) {
    const sid = Number(it.sale_id);
    if (!bySale.has(sid)) bySale.set(sid, []);
    bySale.get(sid)!.push(it);
  }

  res.json(
    sales.map((s) => ({
      ...s,
      items: bySale.get(Number(s.id)) || [],
    }))
  );
});

function createSaleInternal(payload: Record<string, unknown>, userId?: number, isOfflineSync = false) {
  const clientTxId = (payload.client_tx_id as string) || `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Idempotent duplicate check
  const existing = db.prepare(`SELECT id, invoice_no FROM sales WHERE client_tx_id = ?`).get(clientTxId) as
    | { id: number; invoice_no: string }
    | undefined;
  if (existing) {
    return { duplicate: true, saleId: existing.id, invoice_no: existing.invoice_no, conflicts: [] as string[] };
  }

  const items = (payload.items as Array<Record<string, unknown>>) || [];
  if (items.length === 0) throw new Error('Sale must contain at least one item.');

  const status = String(payload.status || 'COMPLETED');
  const invoiceNo = (payload.invoice_no as string) || nextInvoiceNo('INV', 'sales', 'invoice_no');
  const customerId = payload.customer_id ? Number(payload.customer_id) : null;

  let customerName = String(payload.customer_name || 'Walk-in Customer');
  let customerPhone = String(payload.customer_phone || '');
  if (customerId) {
    const cust = db.prepare(`SELECT name, phone FROM customers WHERE id = ?`).get(customerId) as
      | { name: string; phone: string }
      | undefined;
    if (cust) {
      customerName = cust.name;
      customerPhone = cust.phone;
    }
  }

  const subtotal = Number(payload.subtotal || 0);
  const discountType = String(payload.discount_type || 'FIXED');
  const discountValue = Number(payload.discount_value || 0);
  const discountAmount = Number(payload.discount_amount || 0);
  const vatAmount = Number(payload.vat_amount || 0);
  const total = Number(payload.total || 0);
  const tenderedAmount = Number(payload.tendered_amount ?? payload.paid_amount ?? total);
  const changeAmount = Math.max(0, Number((tenderedAmount - total).toFixed(2)));
  const paidAmount = Math.min(total, tenderedAmount);
  const dueAmount = Math.max(0, Number((total - paidAmount).toFixed(2)));
  const paymentMethod = String(payload.payment_method || (dueAmount > 0 && paidAmount === 0 ? 'CREDIT' : 'CASH'));

  const saleRes = db
    .prepare(
      `INSERT INTO sales (
        client_tx_id, invoice_no, customer_id, customer_name, customer_phone, sale_type, status,
        subtotal, discount_type, discount_value, discount_amount, vat_amount, total,
        tendered_amount, paid_amount, due_amount, change_amount, payment_method, payment_breakdown_json,
        coupon_code, notes, synced_from_offline, user_id, created_at
      ) VALUES (?, ?, ?, ?, ?, 'POS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )
    .run(
      clientTxId,
      invoiceNo,
      customerId,
      customerName,
      customerPhone,
      status,
      subtotal,
      discountType,
      discountValue,
      discountAmount,
      vatAmount,
      total,
      tenderedAmount,
      paidAmount,
      dueAmount,
      changeAmount,
      paymentMethod,
      JSON.stringify(payload.payment_breakdown || {}),
      String(payload.coupon_code || ''),
      String(payload.notes || ''),
      isOfflineSync ? 1 : 0,
      userId ?? null,
      payload.created_at ? String(payload.created_at) : null
    );

  const saleId = Number(saleRes.lastInsertRowid);
  const conflicts: string[] = [];

  for (const it of items) {
    const productId = Number(it.product_id);
    const prod = db.prepare(`SELECT id, name, purchase_price FROM products WHERE id = ?`).get(productId) as
      | { id: number; name: string; purchase_price: number }
      | undefined;
    if (!prod) continue;

    const unitMultiplier = Math.max(1, Number(it.unit_multiplier || 1));
    const quantity = Number(it.quantity || 1);
    const baseUnits = quantity * unitMultiplier;

    let batchId: number | null = null;
    if (status === 'COMPLETED') {
      const ded = deductStockFEFO(productId, baseUnits, 'SALE', invoiceNo, `POS Sale ${invoiceNo}`, userId);
      batchId = ded.firstBatchId;
      if (ded.conflict) conflicts.push(`${prod.name}: ${ded.conflict}`);
    }

    db.prepare(
      `INSERT INTO sale_items (
        sale_id, product_id, batch_id, product_name, unit, unit_multiplier,
        quantity, unit_price, cost_price, discount, tax, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      saleId,
      productId,
      batchId,
      String(it.product_name || prod.name),
      String(it.unit || 'Piece'),
      unitMultiplier,
      quantity,
      Number(it.unit_price || 0),
      prod.purchase_price,
      Number(it.discount || 0),
      Number(it.tax || 0),
      Number(it.line_total || 0)
    );
  }

  if (status === 'COMPLETED' && customerId) {
    const appliedPaid = Math.min(total, paidAmount);
    db.prepare(
      `UPDATE customers
       SET total_purchases = total_purchases + ?,
           total_payments = total_payments + ?,
           current_due = current_due + ?
       WHERE id = ?`
    ).run(total, appliedPaid, dueAmount, customerId);
  }

  return { duplicate: false, saleId, invoice_no: invoiceNo, conflicts };
}

app.post('/api/sales', requireAuth, requirePermission('create_sales'), (req: AuthedRequest, res: Response) => {
  try {
    const result = withTransaction(() => createSaleInternal(req.body, req.user?.id, false));
    logAudit(req.user, 'CREATE_SALE', 'sales', result.saleId, { invoice_no: result.invoice_no });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sales/:id/resume', requireAuth, requirePermission('create_sales'), (req: AuthedRequest, res: Response) => {
  try {
    const saleId = Number(req.params.id);
    const result = withTransaction(() => {
      const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId) as Record<string, unknown> | undefined;
      if (!sale || sale.status !== 'HELD') throw new Error('Only HELD sales can be resumed.');

      const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(saleId) as Array<Record<string, unknown>>;
      for (const it of items) {
        const baseUnits = Number(it.quantity) * Number(it.unit_multiplier || 1);
        deductStockFEFO(Number(it.product_id), baseUnits, 'SALE', String(sale.invoice_no), 'Resumed held sale', req.user?.id);
      }

      const paidAmount = Number(req.body?.paid_amount ?? sale.total);
      const total = Number(sale.total);
      const dueAmount = Math.max(0, Number((total - paidAmount).toFixed(2)));
      const paymentMethod = String(req.body?.payment_method || sale.payment_method || 'CASH');

      db.prepare(`UPDATE sales SET status = 'COMPLETED', paid_amount = ?, due_amount = ?, payment_method = ? WHERE id = ?`).run(
        paidAmount,
        dueAmount,
        paymentMethod,
        saleId
      );

      if (sale.customer_id) {
        db.prepare(
          `UPDATE customers SET total_purchases = total_purchases + ?, total_payments = total_payments + ?, current_due = current_due + ? WHERE id = ?`
        ).run(total, Math.min(total, paidAmount), dueAmount, Number(sale.customer_id));
      }

      logAudit(req.user, 'RESUME_SALE', 'sales', saleId, {});
      return { ok: true };
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sales/:id/cancel', requireAuth, requirePermission('create_sales'), (req: AuthedRequest, res: Response) => {
  try {
    const saleId = Number(req.params.id);
    withTransaction(() => {
      const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId) as Record<string, unknown> | undefined;
      if (!sale || sale.status === 'CANCELLED') throw new Error('Sale cannot be cancelled.');

      if (sale.status === 'COMPLETED') {
        const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(saleId) as Array<Record<string, unknown>>;
        for (const it of items) {
          const restoreUnits = (Number(it.quantity) - Number(it.returned_qty || 0)) * Number(it.unit_multiplier || 1);
          if (restoreUnits > 0) {
            const prev = (
              db.prepare(`SELECT COALESCE(SUM(quantity), 0) as q FROM product_batches WHERE product_id = ?`).get(Number(it.product_id)) as {
                q: number;
              }
            ).q;
            if (it.batch_id) {
              db.prepare(`UPDATE product_batches SET quantity = quantity + ? WHERE id = ?`).run(restoreUnits, Number(it.batch_id));
            }
            db.prepare(
              `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, reference_id, note, user_id)
               VALUES (?, ?, 'RETURN', ?, ?, ?, ?, 'Cancelled invoice stock restore', ?)`
            ).run(Number(it.product_id), it.batch_id ? Number(it.batch_id) : null, restoreUnits, prev, prev + restoreUnits, String(sale.invoice_no), req.user?.id ?? null);
          }
        }
        if (sale.customer_id) {
          db.prepare(
            `UPDATE customers SET current_due = MAX(0, current_due - ?) WHERE id = ?`
          ).run(Number(sale.due_amount || 0), Number(sale.customer_id));
        }
      }

      db.prepare(`UPDATE sales SET status = 'CANCELLED' WHERE id = ?`).run(saleId);
      logAudit(req.user, 'CANCEL_SALE', 'sales', saleId, {});
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sales/:id/return', requireAuth, requirePermission('create_sales'), (req: AuthedRequest, res: Response) => {
  try {
    const saleId = Number(req.params.id);
    const { items } = req.body as { items: Array<{ sale_item_id: number; return_qty: number }> };
    if (!items?.length) {
      res.status(400).json({ error: 'Specify items to return.' });
      return;
    }

    const refundTotal = withTransaction(() => {
      const sale = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(saleId) as Record<string, unknown> | undefined;
      if (!sale) throw new Error('Sale not found.');

      let refund = 0;
      for (const reqItem of items) {
        const sItem = db.prepare(`SELECT * FROM sale_items WHERE id = ? AND sale_id = ?`).get(reqItem.sale_item_id, saleId) as
          | Record<string, unknown>
          | undefined;
        if (!sItem) continue;
        const maxReturn = Number(sItem.quantity) - Number(sItem.returned_qty || 0);
        const qtyToReturn = Math.min(maxReturn, Math.max(0, Number(reqItem.return_qty)));
        if (qtyToReturn <= 0) continue;

        const baseUnits = qtyToReturn * Number(sItem.unit_multiplier || 1);
        const prev = (
          db.prepare(`SELECT COALESCE(SUM(quantity), 0) as q FROM product_batches WHERE product_id = ?`).get(Number(sItem.product_id)) as {
            q: number;
          }
        ).q;

        if (sItem.batch_id) {
          db.prepare(`UPDATE product_batches SET quantity = quantity + ? WHERE id = ?`).run(baseUnits, Number(sItem.batch_id));
        } else {
          db.prepare(
            `INSERT INTO product_batches (product_id, batch_number, quantity, purchase_price) VALUES (?, 'RET-BATCH', ?, ?)`
          ).run(Number(sItem.product_id), baseUnits, Number(sItem.cost_price || 0));
        }

        db.prepare(
          `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, reference_id, note, user_id)
           VALUES (?, ?, 'RETURN', ?, ?, ?, ?, 'Customer sales return', ?)`
        ).run(Number(sItem.product_id), sItem.batch_id ? Number(sItem.batch_id) : null, baseUnits, prev, prev + baseUnits, String(sale.invoice_no), req.user?.id ?? null);

        db.prepare(`UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?`).run(qtyToReturn, Number(sItem.id));
        refund += qtyToReturn * Number(sItem.unit_price);
      }

      if (refund > 0) {
        const newDue = Math.max(0, Number(sale.due_amount) - refund);
        const dueReduced = Number(sale.due_amount) - newDue;
        db.prepare(`UPDATE sales SET total = MAX(0, total - ?), due_amount = ?, status = 'RETURNED' WHERE id = ?`).run(
          refund,
          newDue,
          saleId
        );
        if (sale.customer_id && dueReduced > 0) {
          db.prepare(`UPDATE customers SET current_due = MAX(0, current_due - ?) WHERE id = ?`).run(
            dueReduced,
            Number(sale.customer_id)
          );
        }
      }

      logAudit(req.user, 'SALES_RETURN', 'sales', saleId, { refund });
      return refund;
    });

    res.json({ ok: true, refundTotal });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ==========================================
// SUPPLIERS & PURCHASES
// ==========================================

app.get('/api/suppliers', requireAuth, (_req: Request, res: Response) => {
  res.json(db.prepare(`SELECT * FROM suppliers ORDER BY id DESC`).all());
});

app.post('/api/suppliers', requireAuth, requirePermission('manage_purchases'), (req: AuthedRequest, res: Response) => {
  try {
    const { name, phone, company, address } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: 'Supplier name is required.' });
      return;
    }
    const info = db
      .prepare(`INSERT INTO suppliers (name, phone, company, address) VALUES (?, ?, ?, ?)`)
      .run(name.trim(), phone || '', company || '', address || '');
    logAudit(req.user, 'CREATE_SUPPLIER', 'suppliers', Number(info.lastInsertRowid), { name });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/suppliers/:id/pay', requireAuth, requirePermission('manage_purchases'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  const amount = Number(req.body.amount || 0);
  if (amount <= 0) {
    res.status(400).json({ error: 'Amount must be positive.' });
    return;
  }
  db.prepare(`UPDATE suppliers SET total_due = MAX(0, total_due - ?) WHERE id = ?`).run(amount, id);
  logAudit(req.user, 'PAY_SUPPLIER_DUE', 'suppliers', id, { amount });
  res.json({ ok: true });
});

app.get('/api/purchases', requireAuth, (_req: Request, res: Response) => {
  const purchases = db
    .prepare(
      `SELECT p.*, s.name as supplier_name, s.company as supplier_company
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ORDER BY p.id DESC LIMIT 100`
    )
    .all() as Array<Record<string, unknown>>;

  const items = db
    .prepare(
      `SELECT pi.*, pr.name as product_name, pr.sku
       FROM purchase_items pi
       JOIN products pr ON pr.id = pi.product_id`
    )
    .all() as Array<Record<string, unknown>>;

  const byPur = new Map<number, Array<Record<string, unknown>>>();
  for (const it of items) {
    const pid = Number(it.purchase_id);
    if (!byPur.has(pid)) byPur.set(pid, []);
    byPur.get(pid)!.push(it);
  }

  res.json(purchases.map((p) => ({ ...p, items: byPur.get(Number(p.id)) || [] })));
});

app.post('/api/purchases', requireAuth, requirePermission('manage_purchases'), (req: AuthedRequest, res: Response) => {
  try {
    const { supplier_id, additional_charges, paid_amount, note, items } = req.body as {
      supplier_id: number | null;
      additional_charges?: number;
      paid_amount?: number;
      note?: string;
      items: Array<{ product_id: number; batch_number?: string; expiry_date?: string; quantity: number; unit_cost: number }>;
    };

    if (!items?.length) {
      res.status(400).json({ error: 'Purchase must include at least one item.' });
      return;
    }

    const result = withTransaction(() => {
      const subtotal = items.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_cost), 0);
      const charges = Number(additional_charges || 0);
      const total = Number((subtotal + charges).toFixed(2));
      const paid = Number(paid_amount ?? total);
      const due = Math.max(0, Number((total - paid).toFixed(2)));
      const invoiceNo = nextInvoiceNo('PUR', 'purchases', 'invoice_no');

      const pRes = db
        .prepare(
          `INSERT INTO purchases (invoice_no, supplier_id, subtotal, additional_charges, total, paid_amount, due_amount, note, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(invoiceNo, supplier_id || null, subtotal, charges, total, paid, due, note || '', req.user?.id ?? null);

      const purchaseId = Number(pRes.lastInsertRowid);

      for (const it of items) {
        const qty = Number(it.quantity);
        const cost = Number(it.unit_cost);
        const lineTotal = Number((qty * cost).toFixed(2));
        const bNo = it.batch_number?.trim() || `PUR-${purchaseId}-${it.product_id}`;

        db.prepare(
          `INSERT INTO purchase_items (purchase_id, product_id, batch_number, expiry_date, quantity, unit_cost, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(purchaseId, it.product_id, bNo, it.expiry_date || '', qty, cost, lineTotal);

        const prevQty = (
          db.prepare(`SELECT COALESCE(SUM(quantity), 0) as q FROM product_batches WHERE product_id = ?`).get(it.product_id) as {
            q: number;
          }
        ).q;

        const batchRes = db
          .prepare(
            `INSERT INTO product_batches (product_id, batch_number, expiry_date, quantity, purchase_price)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(it.product_id, bNo, it.expiry_date || '', qty, cost);

        db.prepare(`UPDATE products SET purchase_price = ?, updated_at = datetime('now') WHERE id = ?`).run(cost, it.product_id);

        db.prepare(
          `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, unit_cost, reference_id, note, user_id)
           VALUES (?, ?, 'PURCHASE', ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          it.product_id,
          Number(batchRes.lastInsertRowid),
          qty,
          prevQty,
          prevQty + qty,
          cost,
          invoiceNo,
          `Purchase from supplier`,
          req.user?.id ?? null
        );
      }

      if (supplier_id && due > 0) {
        db.prepare(`UPDATE suppliers SET total_due = total_due + ? WHERE id = ?`).run(due, supplier_id);
      }

      logAudit(req.user, 'CREATE_PURCHASE', 'purchases', purchaseId, { invoiceNo, total, due });
      return { id: purchaseId, invoice_no: invoiceNo };
    });

    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/purchases/:id/return', requireAuth, requirePermission('manage_purchases'), (req: AuthedRequest, res: Response) => {
  try {
    const purchaseId = Number(req.params.id);
    const { purchase_item_id, return_qty } = req.body as { purchase_item_id: number; return_qty: number };

    withTransaction(() => {
      const pi = db
        .prepare(`SELECT * FROM purchase_items WHERE id = ? AND purchase_id = ?`)
        .get(purchase_item_id, purchaseId) as Record<string, unknown> | undefined;
      if (!pi) throw new Error('Purchase item not found.');

      const qty = Math.min(Number(pi.quantity) - Number(pi.returned_qty), Math.max(0, Number(return_qty)));
      if (qty <= 0) throw new Error('Invalid return quantity.');

      const purchase = db.prepare(`SELECT * FROM purchases WHERE id = ?`).get(purchaseId) as Record<string, unknown>;
      deductStockFEFO(Number(pi.product_id), qty, 'PURCHASE_RETURN', String(purchase.invoice_no), 'Returned to supplier', req.user?.id);
      db.prepare(`UPDATE purchase_items SET returned_qty = returned_qty + ? WHERE id = ?`).run(qty, purchase_item_id);

      const credit = qty * Number(pi.unit_cost);
      if (purchase.supplier_id) {
        db.prepare(`UPDATE suppliers SET total_due = MAX(0, total_due - ?) WHERE id = ?`).run(credit, Number(purchase.supplier_id));
      }
      logAudit(req.user, 'PURCHASE_RETURN', 'purchases', purchaseId, { qty, credit });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ==========================================
// CUSTOMERS, DUE MANAGEMENT & MESSAGING
// ==========================================

app.get('/api/customers', requireAuth, (_req: Request, res: Response) => {
  res.json(db.prepare(`SELECT id, code, name, phone, email, address, opt_out_marketing, consent_sms, consent_whatsapp, total_purchases, total_payments, current_due, created_at FROM customers ORDER BY id DESC`).all());
});

app.post('/api/customers', requireAuth, requirePermission('manage_customers'), (req: AuthedRequest, res: Response) => {
  try {
    const { name, phone, email, address, consent_sms, consent_whatsapp } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      res.status(400).json({ error: 'Customer name and mobile number are required.' });
      return;
    }
    const count = (db.prepare(`SELECT COUNT(*) as c FROM customers`).get() as { c: number }).c;
    const code = `CUST-${1001 + count + Math.floor(Math.random() * 90)}`;
    const info = db
      .prepare(
        `INSERT INTO customers (code, name, phone, email, address, consent_sms, consent_whatsapp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        code,
        name.trim(),
        phone.trim(),
        email || '',
        address || '',
        consent_sms === false ? 0 : 1,
        consent_whatsapp === false ? 0 : 1
      );

    logAudit(req.user, 'CREATE_CUSTOMER', 'customers', Number(info.lastInsertRowid), { name, phone });
    res.status(201).json({ id: Number(info.lastInsertRowid), code });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/api/customers/:id', requireAuth, requirePermission('manage_customers'), (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { name, phone, email, address, opt_out_marketing, consent_sms, consent_whatsapp } = req.body;
    db.prepare(
      `UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, opt_out_marketing = ?, consent_sms = ?, consent_whatsapp = ? WHERE id = ?`
    ).run(
      name,
      phone,
      email || '',
      address || '',
      opt_out_marketing ? 1 : 0,
      consent_sms ? 1 : 0,
      consent_whatsapp ? 1 : 0,
      id
    );
    logAudit(req.user, 'UPDATE_CUSTOMER', 'customers', id, { opt_out_marketing });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/customers/:id', requireAuth, requirePermission('manage_customers'), (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!customer) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    const salesCount = (db.prepare(`SELECT COUNT(*) as c FROM sales WHERE customer_id = ?`).get(id) as { c: number }).c;
    const currentDue = Number(customer.current_due || 0);

    if (salesCount > 0 || currentDue > 0) {
      res.status(400).json({
        error: `এই কাস্টমারের পূর্বের ${salesCount}টি বিক্রয় বা বকেয়া রেকর্ড রয়েছে। সরাসরি মুছে ফেলা সম্ভব নয়; ভুল তথ্য থাকলে এডিট/সংশোধন করুন।`
      });
      return;
    }

    db.prepare(`DELETE FROM customers WHERE id = ?`).run(id);
    logAudit(req.user, 'DELETE_CUSTOMER', 'customers', id, { name: customer.name, phone: customer.phone });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/customers/:id/ledger', requireAuth, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const customer = db
    .prepare(`SELECT id, code, name, phone, email, address, opt_out_marketing, consent_sms, consent_whatsapp, total_purchases, total_payments, current_due, created_at FROM customers WHERE id = ?`)
    .get(id);
  const sales = db
    .prepare(`SELECT id, invoice_no, total, paid_amount, due_amount, payment_method, status, created_at FROM sales WHERE customer_id = ? ORDER BY id DESC`)
    .all(id);
  const payments = db
    .prepare(`SELECT * FROM due_payments WHERE customer_id = ? ORDER BY id DESC`)
    .all(id);
  res.json({ customer, sales, payments });
});

app.get('/api/dues/payments', requireAuth, (_req: Request, res: Response) => {
  const rows = db
    .prepare(
      `SELECT dp.*, c.name as customer_name, c.phone as customer_phone, c.code as customer_code
       FROM due_payments dp
       JOIN customers c ON c.id = dp.customer_id
       ORDER BY dp.id DESC LIMIT 150`
    )
    .all();
  res.json(rows);
});

function recordDuePaymentInternal(payload: Record<string, unknown>, userId?: number) {
  const clientTxId = (payload.client_tx_id as string) || `due-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const existing = db.prepare(`SELECT id, receipt_no FROM due_payments WHERE client_tx_id = ?`).get(clientTxId) as
    | { id: number; receipt_no: string }
    | undefined;
  if (existing) return { duplicate: true, id: existing.id, receipt_no: existing.receipt_no };

  const customerId = Number(payload.customer_id);
  const amount = Number(payload.amount || 0);
  if (amount <= 0) throw new Error('Payment amount must be positive.');

  const receiptNo = nextInvoiceNo('RCP', 'due_payments', 'receipt_no');
  const info = db
    .prepare(
      `INSERT INTO due_payments (client_tx_id, customer_id, sale_id, amount, payment_method, note, receipt_no, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
    )
    .run(
      clientTxId,
      customerId,
      payload.sale_id ? Number(payload.sale_id) : null,
      amount,
      String(payload.payment_method || 'CASH'),
      String(payload.note || ''),
      receiptNo,
      userId ?? null,
      payload.created_at ? String(payload.created_at) : null
    );

  db.prepare(
    `UPDATE customers
     SET total_payments = total_payments + ?,
         current_due = MAX(0, current_due - ?)
     WHERE id = ?`
  ).run(amount, amount, customerId);

  return { duplicate: false, id: Number(info.lastInsertRowid), receipt_no: receiptNo };
}

app.post('/api/dues/collect', requireAuth, requirePermission('collect_dues'), (req: AuthedRequest, res: Response) => {
  try {
    const result = withTransaction(() => recordDuePaymentInternal(req.body, req.user?.id));
    logAudit(req.user, 'COLLECT_DUE', 'due_payments', result.id, { amount: req.body.amount });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ==========================================
// BULK SMS GATEWAY SERVICE & MESSAGING
// ==========================================

function sanitizeGatewayForClient(g: SmsGatewayRow) {
  return {
    id: g.id,
    name: g.name,
    provider: g.provider,
    base_url: g.base_url,
    balance_url: g.balance_url,
    http_method: g.http_method,
    payload_format: g.payload_format,
    sender_id: g.sender_id,
    has_api_key: Boolean(g.api_key_enc || process.env.SMS_GATEWAY_API_KEY?.trim()),
    has_api_secret: Boolean(g.api_secret_enc),
    key_hint: g.key_hint || (process.env.SMS_GATEWAY_API_KEY?.trim() ? 'ENV-KEY' : ''),
    to_param: g.to_param,
    message_param: g.message_param,
    sender_param: g.sender_param,
    api_key_param: g.api_key_param,
    extra_params_json: g.extra_params_json,
    custom_headers_json: g.custom_headers_json,
    batch_delay_ms: g.batch_delay_ms,
    is_default: g.is_default,
    active: g.active,
    last_tested_at: g.last_tested_at,
    last_test_status: g.last_test_status,
    created_at: g.created_at,
  };
}

function getActiveDefaultGateway(preferredId?: number | null): SmsGatewayRow | undefined {
  if (preferredId) {
    const specific = db
      .prepare(`SELECT * FROM sms_gateways WHERE id = ? AND active = 1`)
      .get(preferredId) as unknown as SmsGatewayRow | undefined;
    if (specific) return specific;
  }
  const def = db
    .prepare(`SELECT * FROM sms_gateways WHERE active = 1 AND is_default = 1 ORDER BY id DESC LIMIT 1`)
    .get() as unknown as SmsGatewayRow | undefined;
  if (def) return def;

  const anyActive = db
    .prepare(`SELECT * FROM sms_gateways WHERE active = 1 ORDER BY id DESC LIMIT 1`)
    .get() as unknown as SmsGatewayRow | undefined;
  if (anyActive) return anyActive;

  // Auto-heal: If any gateway exists, activate it
  const anyRow = db.prepare(`SELECT * FROM sms_gateways ORDER BY id DESC LIMIT 1`).get() as unknown as SmsGatewayRow | undefined;
  if (anyRow) {
    db.prepare(`UPDATE sms_gateways SET active = 1, is_default = 1 WHERE id = ?`).run(anyRow.id);
    return { ...anyRow, active: 1, is_default: 1 };
  }

  // Auto-heal 2: Re-run permanent initialization and return default
  initPermanentSmsGateways();
  return db.prepare(`SELECT * FROM sms_gateways WHERE active = 1 ORDER BY id DESC LIMIT 1`).get() as unknown as SmsGatewayRow | undefined;
}

interface ResolvedRecipient {
  customer_id: number | null;
  name: string;
  phone: string;
  due: number;
  status: 'READY' | 'OPTED_OUT' | 'INVALID';
}

function resolveCampaignAudience(input: {
  audience_type: 'ALL_CONSENTED' | 'DUE_CUSTOMERS' | 'SELECTED_CUSTOMERS' | 'CUSTOM_NUMBERS';
  min_due?: number;
  customer_ids?: number[];
  raw_numbers?: string;
  is_promotional?: boolean;
}): ResolvedRecipient[] {
  const seenDigits = new Set<string>();
  const list: ResolvedRecipient[] = [];

  if (input.audience_type === 'CUSTOM_NUMBERS') {
    const tokens = String(input.raw_numbers || '')
      .split(/[\n,;|\t]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    for (const token of tokens) {
      // Support "Name, 017..." or pure "017..."
      const parts = token.split(/\s+/).filter(Boolean);
      const rawPhone = parts.length > 1 && /\d{7,}/.test(parts[parts.length - 1]) ? parts[parts.length - 1] : token;
      const label = parts.length > 1 && /\d{7,}/.test(parts[parts.length - 1]) ? parts.slice(0, -1).join(' ') : 'Valued Customer';
      const norm = normalizePhoneNumber(rawPhone);
      if (!norm.valid) {
        list.push({ customer_id: null, name: label, phone: rawPhone, due: 0, status: 'INVALID' });
        continue;
      }
      if (seenDigits.has(norm.digits)) continue;
      seenDigits.add(norm.digits);
      list.push({ customer_id: null, name: label, phone: norm.e164, due: 0, status: 'READY' });
    }
    return list;
  }

  let rows: Array<{
    id: number;
    name: string;
    phone: string;
    current_due: number;
    consent_sms: number;
    opt_out_marketing: number;
  }> = [];

  if (input.audience_type === 'DUE_CUSTOMERS') {
    const minDue = Math.max(0.01, Number(input.min_due || 0.01));
    rows = db
      .prepare(
        `SELECT id, name, phone, current_due, consent_sms, opt_out_marketing
         FROM customers WHERE current_due >= ? ORDER BY current_due DESC`
      )
      .all(minDue) as typeof rows;
  } else if (input.audience_type === 'SELECTED_CUSTOMERS') {
    const ids = (input.customer_ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ');
      rows = db
        .prepare(
          `SELECT id, name, phone, current_due, consent_sms, opt_out_marketing
           FROM customers WHERE id IN (${placeholders}) ORDER BY name ASC`
        )
        .all(...ids) as typeof rows;
    }
  } else {
    rows = db
      .prepare(`SELECT id, name, phone, current_due, consent_sms, opt_out_marketing FROM customers ORDER BY id DESC`)
      .all() as typeof rows;
  }

  for (const c of rows) {
    const norm = normalizePhoneNumber(c.phone);
    if (!norm.valid) {
      list.push({ customer_id: c.id, name: c.name, phone: c.phone || '', due: Number(c.current_due || 0), status: 'INVALID' });
      continue;
    }
    if (seenDigits.has(norm.digits)) continue;
    seenDigits.add(norm.digits);

    const blocked = Number(c.consent_sms) === 0 || (Boolean(input.is_promotional) && Number(c.opt_out_marketing) === 1);
    list.push({
      customer_id: c.id,
      name: c.name,
      phone: norm.e164,
      due: Number(c.current_due || 0),
      status: blocked ? 'OPTED_OUT' : 'READY',
    });
  }

  return list;
}

app.get('/api/sms/presets', requireAuth, (_req: Request, res: Response) => {
  res.json(SMS_PROVIDER_PRESETS);
});

app.get('/api/sms/gateways', requireAuth, (_req: Request, res: Response) => {
  const rows = db
    .prepare(`SELECT * FROM sms_gateways ORDER BY is_default DESC, id DESC`)
    .all() as unknown as SmsGatewayRow[];
  res.json(rows.map(sanitizeGatewayForClient));
});

app.post('/api/sms/gateways', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const b = req.body as Record<string, unknown>;
    const name = String(b.name || '').trim();
    const provider = String(b.provider || 'CUSTOM').toUpperCase() as SmsProviderType;
    const base_url = String(b.base_url || '').trim();
    const balance_url = String(b.balance_url || '').trim();
    const api_key = String(b.api_key || '').trim();
    const api_secret = String(b.api_secret || '').trim();

    if (!name || !base_url) {
      res.status(400).json({ error: 'Gateway name and HTTPS endpoint URL are required.' });
      return;
    }
    await assertSafeGatewayUrl(base_url);
    if (balance_url) await assertSafeGatewayUrl(balance_url);

    const isDefault = b.is_default ? 1 : 0;
    const active = b.active === false || b.active === 0 ? 0 : 1;

    const id = withTransaction(() => {
      const existingCount = (db.prepare(`SELECT COUNT(*) as c FROM sms_gateways`).get() as { c: number }).c;
      const shouldBeDefault = isDefault || existingCount === 0 ? 1 : 0;
      if (shouldBeDefault) {
        db.exec(`UPDATE sms_gateways SET is_default = 0`);
      }
      const info = db
        .prepare(
          `INSERT INTO sms_gateways (
            name, provider, base_url, balance_url, http_method, payload_format,
            sender_id, api_key_enc, api_secret_enc, key_hint,
            to_param, message_param, sender_param, api_key_param,
            extra_params_json, custom_headers_json, batch_delay_ms, is_default, active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          name,
          provider,
          base_url,
          balance_url,
          String(b.http_method || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST',
          ['JSON', 'FORM', 'QUERY'].includes(String(b.payload_format || '').toUpperCase())
            ? String(b.payload_format).toUpperCase()
            : 'JSON',
          String(b.sender_id || '').trim(),
          encryptSecret(api_key),
          encryptSecret(api_secret),
          maskSecretHint(api_key),
          String(b.to_param || 'to').trim(),
          String(b.message_param || 'message').trim(),
          String(b.sender_param || '').trim(),
          String(b.api_key_param || 'api_key').trim(),
          String(b.extra_params_json || '{}'),
          String(b.custom_headers_json || '{}'),
          Math.max(50, Math.min(5000, Number(b.batch_delay_ms || 150))),
          shouldBeDefault,
          active
        );
      const newId = Number(info.lastInsertRowid);
      logAudit(req.user, 'CREATE_SMS_GATEWAY', 'sms_gateways', newId, { name, provider });
      return newId;
    });

    const created = db.prepare(`SELECT * FROM sms_gateways WHERE id = ?`).get(id) as unknown as SmsGatewayRow;
    saveSmsGatewaysBackup();
    res.status(201).json(sanitizeGatewayForClient(created));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.put('/api/sms/gateways/:id', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare(`SELECT * FROM sms_gateways WHERE id = ?`).get(id) as unknown as SmsGatewayRow | undefined;
    if (!existing) {
      res.status(404).json({ error: 'SMS gateway not found.' });
      return;
    }

    const b = req.body as Record<string, unknown>;
    const name = String(b.name ?? existing.name).trim();
    const provider = String(b.provider ?? existing.provider).toUpperCase() as SmsProviderType;
    const base_url = String(b.base_url ?? existing.base_url).trim();
    const balance_url = String(b.balance_url ?? existing.balance_url).trim();
    const newApiKey = String(b.api_key || '').trim();
    const newApiSecret = String(b.api_secret || '').trim();

    await assertSafeGatewayUrl(base_url);
    if (balance_url) await assertSafeGatewayUrl(balance_url);

    const apiKeyEnc = newApiKey ? encryptSecret(newApiKey) : existing.api_key_enc;
    const apiSecretEnc = newApiSecret ? encryptSecret(newApiSecret) : existing.api_secret_enc;
    const keyHint = newApiKey ? maskSecretHint(newApiKey) : existing.key_hint;
    const isDefault = b.is_default !== undefined ? (b.is_default ? 1 : 0) : existing.is_default;
    const active = b.active !== undefined ? (b.active ? 1 : 0) : existing.active;

    withTransaction(() => {
      if (isDefault) {
        db.exec(`UPDATE sms_gateways SET is_default = 0`);
      }
      db.prepare(
        `UPDATE sms_gateways SET
          name = ?, provider = ?, base_url = ?, balance_url = ?, http_method = ?, payload_format = ?,
          sender_id = ?, api_key_enc = ?, api_secret_enc = ?, key_hint = ?,
          to_param = ?, message_param = ?, sender_param = ?, api_key_param = ?,
          extra_params_json = ?, custom_headers_json = ?, batch_delay_ms = ?, is_default = ?, active = ?
         WHERE id = ?`
      ).run(
        name,
        provider,
        base_url,
        balance_url,
        String(b.http_method ?? existing.http_method).toUpperCase() === 'GET' ? 'GET' : 'POST',
        ['JSON', 'FORM', 'QUERY'].includes(String(b.payload_format ?? existing.payload_format).toUpperCase())
          ? String(b.payload_format ?? existing.payload_format).toUpperCase()
          : 'JSON',
        String(b.sender_id ?? existing.sender_id).trim(),
        apiKeyEnc,
        apiSecretEnc,
        keyHint,
        String(b.to_param ?? existing.to_param).trim(),
        String(b.message_param ?? existing.message_param).trim(),
        String(b.sender_param ?? existing.sender_param).trim(),
        String(b.api_key_param ?? existing.api_key_param).trim(),
        String(b.extra_params_json ?? existing.extra_params_json),
        String(b.custom_headers_json ?? existing.custom_headers_json),
        Math.max(50, Math.min(5000, Number(b.batch_delay_ms ?? existing.batch_delay_ms))),
        isDefault,
        active,
        id
      );
      logAudit(req.user, 'UPDATE_SMS_GATEWAY', 'sms_gateways', id, { name, provider, isDefault, active });
    });

    const updated = db.prepare(`SELECT * FROM sms_gateways WHERE id = ?`).get(id) as unknown as SmsGatewayRow;
    saveSmsGatewaysBackup();
    res.json(sanitizeGatewayForClient(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/sms/gateways/:id', requireAuth, requirePermission('manage_settings'), (req: AuthedRequest, res: Response) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM sms_gateways WHERE id = ?`).run(id);
  saveSmsGatewaysBackup();
  logAudit(req.user, 'DELETE_SMS_GATEWAY', 'sms_gateways', id, {});
  res.json({ ok: true });
});

app.post('/api/sms/gateways/:id/test', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const gw = db.prepare(`SELECT * FROM sms_gateways WHERE id = ?`).get(id) as unknown as SmsGatewayRow | undefined;
    if (!gw) {
      res.status(404).json({ error: 'SMS gateway not found.' });
      return;
    }
    const { test_phone, test_message } = req.body as { test_phone?: string; test_message?: string };
    const norm = normalizePhoneNumber(test_phone || '');
    if (!norm.valid) {
      res.status(400).json({ error: 'Enter a valid mobile number (e.g. 017XXXXXXXX) to run a gateway test.' });
      return;
    }

    const bodyText =
      (test_message || '').trim() ||
      `AmarPOS Smart AI Bulk SMS test successful via ${gw.name} (${new Date().toLocaleTimeString()}).`;

    const result = await dispatchSmsViaGateway(gw, norm.e164, bodyText);
    const statusLabel = result.ok ? `OK: ${result.providerRef}` : `ERR: ${result.error || 'Failed'}`;

    db.prepare(`UPDATE sms_gateways SET last_tested_at = datetime('now'), last_test_status = ? WHERE id = ?`).run(
      statusLabel.slice(0, 180),
      id
    );
    const parts = calculateSmsParts(bodyText).parts;
    db.prepare(
      `INSERT INTO message_logs (customer_id, gateway_id, recipient_phone, channel, template_key, message_body, status, provider_ref, error_detail, sms_parts)
       VALUES (NULL, ?, ?, 'SMS', 'GATEWAY_TEST', ?, ?, ?, ?, ?)`
    ).run(id, norm.e164, bodyText, result.ok ? 'SENT' : 'FAILED', result.providerRef, result.error || '', parts);

    logAudit(req.user, 'TEST_SMS_GATEWAY', 'sms_gateways', id, { ok: result.ok });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sms/gateways/:id/balance', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const gw = db.prepare(`SELECT * FROM sms_gateways WHERE id = ?`).get(id) as unknown as SmsGatewayRow | undefined;
    if (!gw) {
      res.status(404).json({ error: 'SMS gateway not found.' });
      return;
    }
    const result = await checkGatewayBalance(gw);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sms/campaigns/preview', requireAuth, requirePermission('send_messages'), (req: Request, res: Response) => {
  try {
    const { audience_type, min_due, customer_ids, raw_numbers, message_template, is_promotional } = req.body as {
      audience_type: 'ALL_CONSENTED' | 'DUE_CUSTOMERS' | 'SELECTED_CUSTOMERS' | 'CUSTOM_NUMBERS';
      min_due?: number;
      customer_ids?: number[];
      raw_numbers?: string;
      message_template: string;
      is_promotional?: boolean;
    };

    const shop = (db.prepare(`SELECT shop_name FROM shop_settings WHERE id = 1`).get() as { shop_name?: string } | undefined)
      ?.shop_name;

    const audience = resolveCampaignAudience({
      audience_type: audience_type || 'ALL_CONSENTED',
      min_due,
      customer_ids,
      raw_numbers,
      is_promotional,
    });

    const ready = audience.filter((r) => r.status === 'READY');
    const optedOut = audience.filter((r) => r.status === 'OPTED_OUT');
    const invalid = audience.filter((r) => r.status === 'INVALID');

    let totalParts = 0;
    let isUnicode = false;
    for (const r of ready) {
      const rendered = renderSmsTemplate(message_template || '', {
        name: r.name,
        due: r.due,
        phone: r.phone,
        shop,
      });
      const stats = calculateSmsParts(rendered);
      totalParts += stats.parts;
      if (stats.isUnicode) isUnicode = true;
    }

    const firstSample = ready[0] || audience[0] || { name: 'Rafiqul Islam', phone: '+8801711223344', due: 650 };
    const sampleMessage = renderSmsTemplate(message_template || '', {
      name: firstSample.name,
      due: firstSample.due,
      phone: firstSample.phone,
      shop,
    });
    const sampleStats = calculateSmsParts(sampleMessage);

    res.json({
      eligibleCount: ready.length,
      optedOutCount: optedOut.length,
      invalidCount: invalid.length,
      totalParts,
      partsPerSample: sampleStats.parts,
      isUnicode: isUnicode || sampleStats.isUnicode,
      sampleMessage,
      samplePhone: firstSample.phone,
      recipientsPreview: audience.slice(0, 60),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sms/campaigns/send', requireAuth, requirePermission('send_messages'), async (req: AuthedRequest, res: Response) => {
  try {
    const {
      title,
      gateway_id,
      audience_type,
      min_due,
      customer_ids,
      raw_numbers,
      template_key,
      message_template,
      is_promotional,
    } = req.body as {
      title?: string;
      gateway_id?: number;
      audience_type: 'ALL_CONSENTED' | 'DUE_CUSTOMERS' | 'SELECTED_CUSTOMERS' | 'CUSTOM_NUMBERS';
      min_due?: number;
      customer_ids?: number[];
      raw_numbers?: string;
      template_key?: string;
      message_template: string;
      is_promotional?: boolean;
    };

    if (!message_template?.trim()) {
      res.status(400).json({ error: 'SMS message text is required.' });
      return;
    }

    const gw = getActiveDefaultGateway(gateway_id);
    if (!gw) {
      res.status(400).json({
        error: 'No active SMS Gateway configured. Please add and activate an SMS gateway in the Gateway Setup tab first.',
      });
      return;
    }

    const shop = (db.prepare(`SELECT shop_name FROM shop_settings WHERE id = 1`).get() as { shop_name?: string } | undefined)
      ?.shop_name;

    const audience = resolveCampaignAudience({
      audience_type: audience_type || 'ALL_CONSENTED',
      min_due,
      customer_ids,
      raw_numbers,
      is_promotional,
    });

    if (audience.length === 0) {
      res.status(400).json({ error: 'No recipients matched the selected audience filter.' });
      return;
    }

    const campTitle = (title || '').trim() || `Bulk SMS (${audience_type}) · ${new Date().toLocaleDateString()}`;
    const cInfo = db
      .prepare(
        `INSERT INTO sms_campaigns (
          title, gateway_id, gateway_name, audience_type, template_key, message_template,
          is_promotional, total_recipients, status, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?)`
      )
      .run(
        campTitle,
        gw.id,
        gw.name,
        audience_type,
        template_key || 'CUSTOM',
        message_template.trim(),
        is_promotional ? 1 : 0,
        audience.length,
        req.user?.id ?? null
      );

    const campaignId = Number(cInfo.lastInsertRowid);
    let sentCount = 0;
    let failedCount = 0;
    let blockedCount = 0;
    let totalParts = 0;

    const insertLog = db.prepare(
      `INSERT INTO message_logs (
        customer_id, campaign_id, gateway_id, recipient_phone, channel, template_key,
        message_body, status, provider_ref, error_detail, sms_parts
      ) VALUES (?, ?, ?, ?, 'SMS', ?, ?, ?, ?, ?, ?)`
    );

    const delayMs = Math.max(50, Math.min(2000, Number(gw.batch_delay_ms || 150)));

    for (let i = 0; i < audience.length; i++) {
      const r = audience[i];
      const rendered = renderSmsTemplate(message_template.trim(), {
        name: r.name,
        due: r.due,
        phone: r.phone,
        shop,
      });
      const parts = Math.max(1, calculateSmsParts(rendered).parts);

      if (r.status === 'OPTED_OUT') {
        blockedCount += 1;
        insertLog.run(r.customer_id, campaignId, gw.id, r.phone, template_key || 'BULK', rendered, 'OPTED_OUT_BLOCKED', '', 'Customer opted out', 0);
        continue;
      }
      if (r.status === 'INVALID') {
        failedCount += 1;
        insertLog.run(r.customer_id, campaignId, gw.id, r.phone, template_key || 'BULK', rendered, 'FAILED', '', 'Invalid mobile number format', 0);
        continue;
      }

      const dispatchRes = await dispatchSmsViaGateway(gw, r.phone, rendered);
      if (dispatchRes.ok) {
        sentCount += 1;
        totalParts += parts;
        insertLog.run(r.customer_id, campaignId, gw.id, r.phone, template_key || 'BULK', rendered, 'SENT', dispatchRes.providerRef, '', parts);
      } else {
        failedCount += 1;
        insertLog.run(
          r.customer_id,
          campaignId,
          gw.id,
          r.phone,
          template_key || 'BULK',
          rendered,
          'FAILED',
          '',
          dispatchRes.error || 'Gateway dispatch error',
          parts
        );
      }

      if (i < audience.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const finalStatus =
      sentCount > 0 && failedCount === 0
        ? 'COMPLETED'
        : sentCount > 0 && failedCount > 0
          ? 'PARTIAL'
          : blockedCount > 0 && failedCount === 0
            ? 'COMPLETED'
            : 'FAILED';

    db.prepare(
      `UPDATE sms_campaigns
       SET sent_count = ?, failed_count = ?, blocked_count = ?, total_sms_parts = ?, status = ?
       WHERE id = ?`
    ).run(sentCount, failedCount, blockedCount, totalParts, finalStatus, campaignId);

    logAudit(req.user, 'SEND_BULK_SMS', 'sms_campaigns', campaignId, {
      gateway: gw.name,
      total: audience.length,
      sentCount,
      failedCount,
      blockedCount,
      totalParts,
    });

    const campaign = db.prepare(`SELECT * FROM sms_campaigns WHERE id = ?`).get(campaignId);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sms/campaigns', requireAuth, requirePermission('send_messages'), (_req: Request, res: Response) => {
  res.json(db.prepare(`SELECT * FROM sms_campaigns ORDER BY id DESC LIMIT 100`).all());
});

app.get('/api/sms/campaigns/:id/logs', requireAuth, requirePermission('send_messages'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const rows = db
    .prepare(
      `SELECT ml.*, c.name as customer_name
       FROM message_logs ml
       LEFT JOIN customers c ON c.id = ml.customer_id
       WHERE ml.campaign_id = ?
       ORDER BY ml.id ASC`
    )
    .all(id);
  res.json(rows);
});

app.post('/api/sms/campaigns/:id/retry', requireAuth, requirePermission('send_messages'), async (req: AuthedRequest, res: Response) => {
  try {
    const campaignId = Number(req.params.id);
    const campaign = db.prepare(`SELECT * FROM sms_campaigns WHERE id = ?`).get(campaignId) as
      | { id: number; gateway_id: number | null; sent_count: number; failed_count: number; total_sms_parts: number }
      | undefined;
    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found.' });
      return;
    }
    const gw = getActiveDefaultGateway(campaign.gateway_id);
    if (!gw) {
      res.status(400).json({ error: 'No active SMS gateway found to retry failed messages.' });
      return;
    }

    const failedLogs = db
      .prepare(`SELECT * FROM message_logs WHERE campaign_id = ? AND status = 'FAILED'`)
      .all(campaignId) as Array<{ id: number; recipient_phone: string; message_body: string; sms_parts: number }>;

    let retriedSent = 0;
    let stillFailed = 0;
    let addedParts = 0;

    for (const log of failedLogs) {
      const resDispatch = await dispatchSmsViaGateway(gw, log.recipient_phone, log.message_body);
      if (resDispatch.ok) {
        retriedSent += 1;
        const p = Math.max(1, Number(log.sms_parts || calculateSmsParts(log.message_body).parts));
        addedParts += p;
        db.prepare(`UPDATE message_logs SET status = 'SENT', provider_ref = ?, error_detail = '', gateway_id = ? WHERE id = ?`).run(
          resDispatch.providerRef,
          gw.id,
          log.id
        );
      } else {
        stillFailed += 1;
        db.prepare(`UPDATE message_logs SET error_detail = ?, gateway_id = ? WHERE id = ?`).run(
          resDispatch.error || 'Retry failed',
          gw.id,
          log.id
        );
      }
    }

    const newSent = campaign.sent_count + retriedSent;
    const newFailed = Math.max(0, campaign.failed_count - retriedSent);
    const newStatus = newFailed === 0 ? 'COMPLETED' : newSent > 0 ? 'PARTIAL' : 'FAILED';

    db.prepare(
      `UPDATE sms_campaigns SET sent_count = ?, failed_count = ?, total_sms_parts = total_sms_parts + ?, status = ? WHERE id = ?`
    ).run(newSent, newFailed, addedParts, newStatus, campaignId);

    logAudit(req.user, 'RETRY_BULK_SMS', 'sms_campaigns', campaignId, { retriedSent, stillFailed });
    res.json({ retriedSent, stillFailed, status: newStatus });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/messages/logs', requireAuth, (_req: Request, res: Response) => {
  const rows = db
    .prepare(
      `SELECT ml.*, c.name as customer_name, gw.name as gateway_name
       FROM message_logs ml
       LEFT JOIN customers c ON c.id = ml.customer_id
       LEFT JOIN sms_gateways gw ON gw.id = ml.gateway_id
       ORDER BY ml.id DESC LIMIT 150`
    )
    .all();
  res.json(rows);
});

app.post('/api/messages/send', requireAuth, requirePermission('send_messages'), async (req: AuthedRequest, res: Response) => {
  try {
    const { customer_id, channel, template_key, message_body, is_promotional, gateway_id } = req.body as {
      customer_id: number;
      channel: 'SMS' | 'WHATSAPP' | 'EMAIL';
      template_key?: string;
      message_body: string;
      is_promotional?: boolean;
      gateway_id?: number;
    };

    const cust = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(customer_id) as Record<string, unknown> | undefined;
    if (!cust) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    let status = 'SENT';
    let providerRef = '';
    let errorDetail = '';
    let usedGatewayId: number | null = null;
    const smsParts = channel === 'SMS' ? Math.max(1, calculateSmsParts(message_body).parts) : 1;

    if (is_promotional && Number(cust.opt_out_marketing) === 1) {
      status = 'OPTED_OUT_BLOCKED';
    } else if (channel === 'SMS' && Number(cust.consent_sms) === 0) {
      status = 'OPTED_OUT_BLOCKED';
    } else if (channel === 'WHATSAPP' && Number(cust.consent_whatsapp) === 0) {
      status = 'OPTED_OUT_BLOCKED';
    } else if (channel === 'SMS') {
      const gw = getActiveDefaultGateway(gateway_id);
      if (gw) {
        usedGatewayId = gw.id;
        const dispatchRes = await dispatchSmsViaGateway(gw, String(cust.phone || ''), message_body);
        if (dispatchRes.ok) {
          status = 'SENT';
          providerRef = dispatchRes.providerRef;
        } else {
          status = 'FAILED';
          errorDetail = dispatchRes.error || 'SMS gateway failed';
        }
      } else {
        status = 'LOGGED_NO_GATEWAY';
      }
    }

    const info = db
      .prepare(
        `INSERT INTO message_logs (
          customer_id, gateway_id, recipient_phone, channel, template_key,
          message_body, status, provider_ref, error_detail, sms_parts
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customer_id,
        usedGatewayId,
        String(cust.phone || ''),
        channel,
        template_key || 'CUSTOM',
        message_body,
        status,
        providerRef,
        errorDetail,
        smsParts
      );

    logAudit(req.user, 'SEND_MESSAGE', 'message_logs', Number(info.lastInsertRowid), { channel, status, usedGatewayId });
    res.status(201).json({ id: Number(info.lastInsertRowid), status, providerRef, errorDetail });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ==========================================
// EXPENSES & FINANCIAL REPORTS
// ==========================================

app.get('/api/expenses', requireAuth, (_req: Request, res: Response) => {
  res.json(db.prepare(`SELECT * FROM expenses ORDER BY id DESC LIMIT 150`).all());
});

app.post('/api/expenses', requireAuth, (req: AuthedRequest, res: Response) => {
  try {
    const { client_tx_id, title, category, amount, payment_method, note } = req.body;
    if (!title?.trim() || Number(amount) <= 0) {
      res.status(400).json({ error: 'Title and positive amount are required.' });
      return;
    }
    const txId = client_tx_id || `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const existing = db.prepare(`SELECT id FROM expenses WHERE client_tx_id = ?`).get(txId) as { id: number } | undefined;
    if (existing) {
      res.json({ duplicate: true, id: existing.id });
      return;
    }
    const info = db
      .prepare(
        `INSERT INTO expenses (client_tx_id, title, category, amount, payment_method, note, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(txId, title.trim(), category || 'General', Number(amount), payment_method || 'CASH', note || '', req.user?.id ?? null);
    logAudit(req.user, 'CREATE_EXPENSE', 'expenses', Number(info.lastInsertRowid), { title, amount });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/reports/financial', requireAuth, requirePermission('view_profit_reports'), (req: AuthedRequest, res: Response) => {
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));

  const salesAgg = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) as net_sales,
              COALESCE(SUM(paid_amount), 0) as collected_at_sale,
              COALESCE(SUM(due_amount), 0) as credit_sales_due,
              COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN paid_amount ELSE 0 END), 0) as cash_sales,
              COALESCE(SUM(CASE WHEN payment_method IN ('CARD', 'MOBILE_BANKING', 'SPLIT') THEN paid_amount ELSE 0 END), 0) as digital_sales
       FROM sales
       WHERE status NOT IN ('HELD', 'CANCELLED')
         AND date(created_at) BETWEEN date(?) AND date(?)`
    )
    .get(from, to) as Record<string, number>;

  const cogsAgg = db
    .prepare(
      `SELECT COALESCE(SUM((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price), 0) as cogs
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.status NOT IN ('HELD', 'CANCELLED')
         AND date(s.created_at) BETWEEN date(?) AND date(?)`
    )
    .get(from, to) as { cogs: number };

  const purchaseTotal = (
    db
      .prepare(`SELECT COALESCE(SUM(total), 0) as total FROM purchases WHERE date(created_at) BETWEEN date(?) AND date(?)`)
      .get(from, to) as { total: number }
  ).total;

  const expenseTotal = (
    db
      .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE date(created_at) BETWEEN date(?) AND date(?)`)
      .get(from, to) as { total: number }
  ).total;

  const dueCollected = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total,
              COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN amount ELSE 0 END), 0) as cash_due,
              COALESCE(SUM(CASE WHEN payment_method != 'CASH' THEN amount ELSE 0 END), 0) as digital_due
       FROM due_payments
       WHERE date(created_at) BETWEEN date(?) AND date(?)`
    )
    .get(from, to) as { total: number; cash_due: number; digital_due: number };

  const returnsTotal = (
    db
      .prepare(
        `SELECT COALESCE(SUM(si.returned_qty * si.unit_price), 0) as total
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         WHERE date(s.created_at) BETWEEN date(?) AND date(?)`
      )
      .get(from, to) as { total: number }
  ).total;

  const productProfit = db
    .prepare(
      `SELECT si.product_id, si.product_name,
              SUM(si.quantity - si.returned_qty) as units_sold,
              SUM(si.line_total) as net_sales,
              SUM((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price) as cogs,
              SUM(si.line_total - ((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price)) as gross_profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       WHERE s.status NOT IN ('HELD', 'CANCELLED')
         AND date(s.created_at) BETWEEN date(?) AND date(?)
       GROUP BY si.product_id, si.product_name
       ORDER BY gross_profit DESC`
    )
    .all(from, to);

  const categoryProfit = db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') as category_name,
              SUM(si.line_total) as net_sales,
              SUM((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price) as cogs,
              SUM(si.line_total - ((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price)) as gross_profit
       FROM sale_items si
       JOIN sales s ON s.id = si.sale_id
       JOIN products p ON p.id = si.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE s.status NOT IN ('HELD', 'CANCELLED')
         AND date(s.created_at) BETWEEN date(?) AND date(?)
       GROUP BY c.id, c.name
       ORDER BY gross_profit DESC`
    )
    .all(from, to);

  const paymentMethods = db
    .prepare(
      `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(total), 0) as total
       FROM sales
       WHERE status NOT IN ('HELD', 'CANCELLED')
         AND date(created_at) BETWEEN date(?) AND date(?)
       GROUP BY payment_method`
    )
    .all(from, to);

  const customerDueTotal = (db.prepare(`SELECT COALESCE(SUM(current_due), 0) as d FROM customers`).get() as { d: number }).d;
  const supplierDueTotal = (db.prepare(`SELECT COALESCE(SUM(total_due), 0) as d FROM suppliers`).get() as { d: number }).d;

  const grossProfit = Number((salesAgg.net_sales - cogsAgg.cogs).toFixed(2));
  const netProfit = Number((grossProfit - expenseTotal).toFixed(2));

  res.json({
    range: { from, to },
    summary: {
      netSales: Number(salesAgg.net_sales.toFixed(2)),
      cogs: Number(cogsAgg.cogs.toFixed(2)),
      grossProfit,
      expenses: Number(expenseTotal.toFixed(2)),
      estimatedNetProfit: netProfit,
      purchases: Number(purchaseTotal.toFixed(2)),
      creditSalesInPeriod: Number(salesAgg.credit_sales_due.toFixed(2)),
      collectedPayments: Number((salesAgg.collected_at_sale + dueCollected.total).toFixed(2)),
      cashReceived: Number((salesAgg.cash_sales + dueCollected.cash_due).toFixed(2)),
      digitalReceived: Number((salesAgg.digital_sales + dueCollected.digital_due).toFixed(2)),
      totalCustomerReceivables: Number(customerDueTotal.toFixed(2)),
      totalSupplierPayables: Number(supplierDueTotal.toFixed(2)),
      salesReturns: Number(returnsTotal.toFixed(2)),
    },
    productProfit,
    categoryProfit,
    paymentMethods,
  });
});

// ==========================================
// OFFLINE-FIRST SYNCHRONIZATION
// ==========================================

app.post('/api/sync/batch', requireAuth, (req: AuthedRequest, res: Response) => {
  try {
    const queue = (req.body.operations as Array<{ id: string; type: string; payload: Record<string, unknown> }>) || [];
    const results: Array<{ id: string; status: string; conflict?: string }> = [];

    withTransaction(() => {
      for (const op of queue) {
        try {
          if (op.type === 'SALE') {
            const out = createSaleInternal({ ...op.payload, client_tx_id: op.id }, req.user?.id, true);
            const status = out.duplicate ? 'ALREADY_SYNCED' : out.conflicts.length ? 'CONFLICT' : 'SUCCESS';
            const conflictDetail = out.conflicts.join('; ');
            db.prepare(
              `INSERT INTO sync_logs (client_tx_id, entity_type, status, conflict_detail) VALUES (?, 'SALE', ?, ?)`
            ).run(op.id, status, conflictDetail);
            results.push({ id: op.id, status, conflict: conflictDetail || undefined });
          } else if (op.type === 'DUE_PAYMENT') {
            const out = recordDuePaymentInternal({ ...op.payload, client_tx_id: op.id }, req.user?.id);
            const status = out.duplicate ? 'ALREADY_SYNCED' : 'SUCCESS';
            db.prepare(`INSERT INTO sync_logs (client_tx_id, entity_type, status) VALUES (?, 'DUE_PAYMENT', ?)`).run(
              op.id,
              status
            );
            results.push({ id: op.id, status });
          } else if (op.type === 'EXPENSE') {
            const existing = db.prepare(`SELECT id FROM expenses WHERE client_tx_id = ?`).get(op.id);
            if (!existing) {
              db.prepare(
                `INSERT INTO expenses (client_tx_id, title, category, amount, payment_method, note, user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
              ).run(
                op.id,
                String(op.payload.title || 'Offline Expense'),
                String(op.payload.category || 'General'),
                Number(op.payload.amount || 0),
                String(op.payload.payment_method || 'CASH'),
                String(op.payload.note || ''),
                req.user?.id ?? null
              );
            }
            const status = existing ? 'ALREADY_SYNCED' : 'SUCCESS';
            db.prepare(`INSERT INTO sync_logs (client_tx_id, entity_type, status) VALUES (?, 'EXPENSE', ?)`).run(op.id, status);
            results.push({ id: op.id, status });
          } else if (op.type === 'CUSTOMER') {
            const p = op.payload;
            const exists = db.prepare(`SELECT id FROM customers WHERE phone = ?`).get(String(p.phone || ''));
            if (!exists && p.name && p.phone) {
              const code = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
              db.prepare(`INSERT INTO customers (code, name, phone, address) VALUES (?, ?, ?, ?)`).run(
                code,
                String(p.name),
                String(p.phone),
                String(p.address || '')
              );
            }
            db.prepare(`INSERT INTO sync_logs (client_tx_id, entity_type, status) VALUES (?, 'CUSTOMER', 'SUCCESS')`).run(op.id);
            results.push({ id: op.id, status: 'SUCCESS' });
          }
        } catch (opErr) {
          db.prepare(
            `INSERT INTO sync_logs (client_tx_id, entity_type, status, conflict_detail) VALUES (?, ?, 'FAILED', ?)`
          ).run(op.id, op.type, (opErr as Error).message);
          results.push({ id: op.id, status: 'FAILED', conflict: (opErr as Error).message });
        }
      }
    });

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sync/logs', requireAuth, (_req: Request, res: Response) => {
  res.json(db.prepare(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 100`).all());
});

// ==========================================
// AI PRODUCT & MEDICINE RECOGNITION
// ==========================================

app.post('/api/ai/recognize', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const { imageBase64, mimeType, languagePreference } = req.body as {
      imageBase64?: string;
      mimeType?: string;
      languagePreference?: 'en' | 'bn';
    };
    if (!imageBase64) {
      res.status(400).json({ error: 'Image data is required.' });
      return;
    }

    const result = await recognizeProductFromImage(imageBase64, mimeType || 'image/jpeg', languagePreference || 'en');
    logAudit(req.user, 'AI_RECOGNIZE', 'products', result.extraction.productName || 'scan', {
      confidence: result.extraction.confidence,
      matches: result.matches.length,
    });
    res.json(result);
  } catch (err) {
    const rawMsg = (err as Error).message || '';
    let friendly = rawMsg;
    try {
      const parsed = JSON.parse(rawMsg);
      if (parsed?.error?.message) {
        friendly = parsed.error.message;
      }
    } catch {
      // ignore
    }
    res.status(500).json({ error: friendly });
  }
});

// ==========================================
// CONNECTED E-COMMERCE STOREFRONT (PUBLIC + ADMIN)
// ==========================================

app.get('/api/store/catalog', (_req: Request, res: Response) => {
  const settings = db.prepare(`SELECT shop_name, shop_name_bn, logo_url, address, phone, promo_banner_text, promo_banner_active, default_vat_percent FROM shop_settings WHERE id = 1`).get();
  const categories = db.prepare(`SELECT * FROM categories ORDER BY name ASC`).all();
  const products = db
    .prepare(
      `SELECT p.*, c.name as category_name, c.name_bn as category_name_bn,
              COALESCE((SELECT SUM(quantity) FROM product_batches WHERE product_id = p.id), 0) as current_stock,
              COALESCE((SELECT AVG(rating) FROM product_reviews WHERE product_id = p.id), 5) as avg_rating,
              COALESCE((SELECT COUNT(*) FROM product_reviews WHERE product_id = p.id), 0) as review_count
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1 AND p.show_online = 1
       ORDER BY p.id DESC`
    )
    .all();

  const reviews = db.prepare(`SELECT * FROM product_reviews ORDER BY id DESC LIMIT 100`).all();
  res.json({ settings, categories, products, reviews });
});

app.post('/api/store/register', (req: Request, res: Response) => {
  try {
    const { name, phone, email, address, password } = req.body as {
      name: string;
      phone: string;
      email?: string;
      address?: string;
      password: string;
    };
    if (!name?.trim() || !phone?.trim() || !password || password.length < 4) {
      res.status(400).json({ error: 'Name, phone, and password (min 4 chars) are required.' });
      return;
    }
    const { hash, salt } = hashPassword(password);
    const existing = db.prepare(`SELECT id, code FROM customers WHERE phone = ?`).get(phone.trim()) as
      | { id: number; code: string }
      | undefined;

    if (existing) {
      db.prepare(`UPDATE customers SET name = ?, email = ?, address = ?, password_hash = ?, password_salt = ? WHERE id = ?`).run(
        name.trim(),
        email || '',
        address || '',
        hash,
        salt,
        existing.id
      );
      res.json({ id: existing.id, code: existing.code, name: name.trim(), phone: phone.trim(), address: address || '' });
      return;
    }

    const code = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
    const info = db
      .prepare(
        `INSERT INTO customers (code, name, phone, email, address, password_hash, password_salt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(code, name.trim(), phone.trim(), email || '', address || '', hash, salt);

    res.status(201).json({ id: Number(info.lastInsertRowid), code, name: name.trim(), phone: phone.trim(), address: address || '' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/store/login', (req: Request, res: Response) => {
  const { phone, password } = req.body as { phone: string; password: string };
  const cust = db
    .prepare(`SELECT id, code, name, phone, email, address, password_hash, password_salt FROM customers WHERE phone = ?`)
    .get(String(phone || '').trim()) as Record<string, unknown> | undefined;

  if (!cust || !cust.password_hash || !verifyPassword(password, String(cust.password_hash), String(cust.password_salt))) {
    res.status(401).json({ error: 'Invalid phone number or password.' });
    return;
  }
  res.json({ id: cust.id, code: cust.code, name: cust.name, phone: cust.phone, email: cust.email, address: cust.address });
});

app.post('/api/store/coupons/validate', (req: Request, res: Response) => {
  const { code, subtotal } = req.body as { code: string; subtotal: number };
  const c = db
    .prepare(`SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) AND active = 1`)
    .get(String(code || '').trim()) as Record<string, unknown> | undefined;

  if (!c) {
    res.status(404).json({ error: 'Invalid or inactive coupon code.' });
    return;
  }
  if (c.expires_at && new Date(String(c.expires_at)).getTime() < Date.now()) {
    res.status(400).json({ error: 'Coupon has expired.' });
    return;
  }
  if (Number(subtotal) < Number(c.min_order)) {
    res.status(400).json({ error: `Minimum order of ৳${c.min_order} required.` });
    return;
  }
  const discount =
    c.discount_type === 'PERCENT'
      ? Number(((Number(subtotal) * Number(c.value)) / 100).toFixed(2))
      : Math.min(Number(subtotal), Number(c.value));
  res.json({ valid: true, discount, coupon: c });
});

app.post('/api/store/orders', (req: Request, res: Response) => {
  try {
    const { customer_name, customer_phone, delivery_address, payment_method, coupon_code, items } = req.body as {
      customer_name: string;
      customer_phone: string;
      delivery_address: string;
      payment_method: 'COD' | 'ONLINE_GATEWAY';
      coupon_code?: string;
      items: Array<{ product_id: number; quantity: number }>;
    };

    if (!customer_name?.trim() || !customer_phone?.trim() || !delivery_address?.trim() || !items?.length) {
      res.status(400).json({ error: 'Customer name, phone, delivery address, and cart items are required.' });
      return;
    }

    const orderResult = withTransaction(() => {
      let subtotal = 0;
      const lineItems: Array<{ prod: Record<string, unknown>; quantity: number; unitPrice: number; lineTotal: number }> = [];

      // Transaction-safe stock reservation check to prevent overselling
      for (const it of items) {
        const prod = db
          .prepare(
            `SELECT p.*, COALESCE((SELECT SUM(quantity) FROM product_batches WHERE product_id = p.id), 0) as current_stock
             FROM products p WHERE p.id = ? AND p.active = 1 AND p.show_online = 1`
          )
          .get(it.product_id) as Record<string, unknown> | undefined;

        if (!prod) throw new Error('One or more items are unavailable.');
        const qty = Math.max(1, Number(it.quantity));
        if (Number(prod.current_stock) < qty) {
          throw new Error(`Insufficient stock for ${prod.name}. Available: ${prod.current_stock}`);
        }
        const unitPrice = Number(prod.online_price || prod.retail_price);
        const lineTotal = Number((unitPrice * qty).toFixed(2));
        subtotal += lineTotal;
        lineItems.push({ prod, quantity: qty, unitPrice, lineTotal });
      }

      let discountAmount = 0;
      if (coupon_code?.trim()) {
        const c = db
          .prepare(`SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) AND active = 1`)
          .get(coupon_code.trim()) as Record<string, unknown> | undefined;
        if (c && subtotal >= Number(c.min_order)) {
          discountAmount =
            c.discount_type === 'PERCENT'
              ? Number(((subtotal * Number(c.value)) / 100).toFixed(2))
              : Math.min(subtotal, Number(c.value));
        }
      }

      const total = Math.max(0, Number((subtotal - discountAmount).toFixed(2)));
      const paidAmount = payment_method === 'ONLINE_GATEWAY' ? total : 0;
      const dueAmount = Number((total - paidAmount).toFixed(2));

      // Upsert customer record
      let cust = db.prepare(`SELECT id FROM customers WHERE phone = ?`).get(customer_phone.trim()) as
        | { id: number }
        | undefined;
      if (!cust) {
        const code = `WEB-${Math.floor(1000 + Math.random() * 9000)}`;
        const cIns = db
          .prepare(`INSERT INTO customers (code, name, phone, address) VALUES (?, ?, ?, ?)`)
          .run(code, customer_name.trim(), customer_phone.trim(), delivery_address.trim());
        cust = { id: Number(cIns.lastInsertRowid) };
      }

      const invoiceNo = nextInvoiceNo('WEB', 'sales', 'invoice_no');
      const saleRes = db
        .prepare(
          `INSERT INTO sales (
            client_tx_id, invoice_no, customer_id, customer_name, customer_phone, delivery_address,
            sale_type, status, subtotal, discount_type, discount_value, discount_amount,
            vat_amount, total, paid_amount, due_amount, payment_method, coupon_code, notes
          ) VALUES (?, ?, ?, ?, ?, ?, 'ONLINE', 'PENDING', ?, 'FIXED', ?, ?, 0, ?, ?, ?, ?, ?, 'Online storefront order')`
        )
        .run(
          `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          invoiceNo,
          cust.id,
          customer_name.trim(),
          customer_phone.trim(),
          delivery_address.trim(),
          subtotal,
          discountAmount,
          discountAmount,
          total,
          paidAmount,
          dueAmount,
          payment_method === 'ONLINE_GATEWAY' ? 'MOBILE_BANKING' : 'COD',
          coupon_code || ''
        );

      const saleId = Number(saleRes.lastInsertRowid);
      for (const li of lineItems) {
        const ded = deductStockFEFO(
          Number(li.prod.id),
          li.quantity,
          'ONLINE_RESERVE',
          invoiceNo,
          `Online order ${invoiceNo}`
        );
        db.prepare(
          `INSERT INTO sale_items (sale_id, product_id, batch_id, product_name, unit, unit_multiplier, quantity, unit_price, cost_price, line_total)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
        ).run(
          saleId,
          Number(li.prod.id),
          ded.firstBatchId,
          String(li.prod.name),
          String(li.prod.unit || 'Piece'),
          li.quantity,
          li.unitPrice,
          Number(li.prod.purchase_price || 0),
          li.lineTotal
        );
      }

      db.prepare(`UPDATE customers SET total_purchases = total_purchases + ?, total_payments = total_payments + ? WHERE id = ?`).run(
        total,
        paidAmount,
        cust.id
      );

      return { id: saleId, invoice_no: invoiceNo, total, status: 'PENDING' };
    });

    res.status(201).json(orderResult);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/store/orders/track', (req: Request, res: Response) => {
  const invoiceNo = String(req.query.invoice_no || '').trim();
  const phone = String(req.query.phone || '').trim();
  if (!invoiceNo && !phone) {
    res.status(400).json({ error: 'Provide an invoice number or mobile number.' });
    return;
  }

  let orders: Array<Record<string, unknown>>;
  if (invoiceNo) {
    orders = db
      .prepare(`SELECT * FROM sales WHERE sale_type = 'ONLINE' AND UPPER(invoice_no) = UPPER(?) ORDER BY id DESC`)
      .all(invoiceNo) as Array<Record<string, unknown>>;
  } else {
    orders = db
      .prepare(`SELECT * FROM sales WHERE sale_type = 'ONLINE' AND customer_phone = ? ORDER BY id DESC LIMIT 20`)
      .all(phone) as Array<Record<string, unknown>>;
  }

  const enriched = orders.map((o) => ({
    ...o,
    items: db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(Number(o.id)),
  }));
  res.json(enriched);
});

app.post('/api/store/reviews', (req: Request, res: Response) => {
  try {
    const { product_id, customer_name, rating, comment } = req.body;
    if (!product_id || !customer_name?.trim() || !comment?.trim()) {
      res.status(400).json({ error: 'Name and review comment are required.' });
      return;
    }
    const r = Math.min(5, Math.max(1, Number(rating || 5)));
    db.prepare(`INSERT INTO product_reviews (product_id, customer_name, rating, comment) VALUES (?, ?, ?, ?)`).run(
      Number(product_id),
      customer_name.trim(),
      r,
      comment.trim()
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// Admin E-Commerce management
app.patch('/api/ecommerce/orders/:id/status', requireAuth, requirePermission('manage_ecommerce'), (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    const allowed = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED'];
    if (!allowed.includes(status)) {
      res.status(400).json({ error: 'Invalid status.' });
      return;
    }

    withTransaction(() => {
      const order = db.prepare(`SELECT * FROM sales WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      if (!order) throw new Error('Order not found.');

      if ((status === 'CANCELLED' || status === 'RETURNED') && order.status !== 'CANCELLED' && order.status !== 'RETURNED') {
        const items = db.prepare(`SELECT * FROM sale_items WHERE sale_id = ?`).all(id) as Array<Record<string, unknown>>;
        for (const it of items) {
          const prev = (
            db.prepare(`SELECT COALESCE(SUM(quantity), 0) as q FROM product_batches WHERE product_id = ?`).get(Number(it.product_id)) as {
              q: number;
            }
          ).q;
          if (it.batch_id) {
            db.prepare(`UPDATE product_batches SET quantity = quantity + ? WHERE id = ?`).run(Number(it.quantity), Number(it.batch_id));
          }
          db.prepare(
            `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, reference_id, note, user_id)
             VALUES (?, ?, 'ONLINE_RELEASE', ?, ?, ?, ?, ?, ?)`
          ).run(Number(it.product_id), it.batch_id ? Number(it.batch_id) : null, Number(it.quantity), prev, prev + Number(it.quantity), String(order.invoice_no), `Online order ${status}`, req.user?.id ?? null);
        }
      }

      if (status === 'DELIVERED' && order.payment_method === 'COD') {
        db.prepare(`UPDATE sales SET status = ?, paid_amount = total, due_amount = 0 WHERE id = ?`).run(status, id);
      } else {
        db.prepare(`UPDATE sales SET status = ? WHERE id = ?`).run(status, id);
      }

      logAudit(req.user, 'UPDATE_ONLINE_ORDER', 'sales', id, { status });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get('/api/ecommerce/coupons', requireAuth, (_req: Request, res: Response) => {
  res.json(db.prepare(`SELECT * FROM coupons ORDER BY id DESC`).all());
});

app.post('/api/ecommerce/coupons', requireAuth, requirePermission('manage_ecommerce'), (req: AuthedRequest, res: Response) => {
  try {
    const { code, discount_type, value, min_order, expires_at } = req.body;
    const info = db
      .prepare(`INSERT INTO coupons (code, discount_type, value, min_order, expires_at) VALUES (UPPER(?), ?, ?, ?, ?)`)
      .run(String(code).trim(), discount_type || 'PERCENT', Number(value || 0), Number(min_order || 0), expires_at || '');
    logAudit(req.user, 'CREATE_COUPON', 'coupons', Number(info.lastInsertRowid), { code });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/ecommerce/coupons/:id', requireAuth, requirePermission('manage_ecommerce'), (req: AuthedRequest, res: Response) => {
  db.prepare(`DELETE FROM coupons WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

// ==========================================
// USERS, RBAC, AUDIT, SETTINGS & BACKUP
// ==========================================

app.get('/api/users', requireAuth, requirePermission('manage_users'), (_req: Request, res: Response) => {
  const rows = db.prepare(`SELECT id, name, email, role, active, created_at FROM users ORDER BY id ASC`).all();
  res.json({ users: rows, rolePermissions: ROLE_PERMISSIONS });
});

app.post('/api/users', requireAuth, requirePermission('manage_users'), (req: AuthedRequest, res: Response) => {
  try {
    const { name, email, role, password, active } = req.body as {
      name: string;
      email: string;
      role: UserRole;
      password: string;
      active?: boolean;
    };
    if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
      res.status(400).json({ error: 'Name, email, and password (min 6 chars) are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const existing = db.prepare(`SELECT id FROM users WHERE LOWER(TRIM(email)) = ?`).get(cleanEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    const isActive = active !== false ? 1 : 0;
    const { hash, salt } = hashPassword(password);
    const info = db
      .prepare(`INSERT INTO users (name, email, role, password_hash, password_salt, active) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(name.trim(), cleanEmail, role || 'Cashier', hash, salt, isActive);
    logAudit(req.user, 'CREATE_USER', 'users', Number(info.lastInsertRowid), { email: cleanEmail, role, active: isActive });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch('/api/users/:id', requireAuth, requirePermission('manage_users'), (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { role, active } = req.body as { role?: UserRole; active?: boolean };

    // Prevent deactivating own currently logged in account
    if (req.user?.id === id && active === false) {
      res.status(400).json({ error: 'আপনি নিজের অ্যাকাউন্ট নিষ্ক্রিয় করতে পারবেন না।' });
      return;
    }

    if (role) {
      db.prepare(`UPDATE users SET role = ? WHERE id = ?`).run(role, id);
    }
    if (typeof active === 'boolean') {
      db.prepare(`UPDATE users SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
      if (!active) {
        // Immediately revoke all active sessions for this user so they are instantly kicked out
        db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
      }
    }
    logAudit(req.user, 'UPDATE_USER', 'users', id, { role, active });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/users/:id', requireAuth, requirePermission('manage_users'), (req: AuthedRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (req.user?.id === id) {
      res.status(400).json({ error: 'আপনি নিজের লগইন থাকা অ্যাকাউন্ট মুছে ফেলতে পারবেন না।' });
      return;
    }
    const target = db.prepare(`SELECT id, email, role FROM users WHERE id = ?`).get(id) as { id: number; email: string; role: string } | undefined;
    if (!target) {
      res.status(404).json({ error: 'ইউজার পাওয়া যায়নি।' });
      return;
    }
    if (target.role === 'Super Admin') {
      const superAdminCount = (db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'Super Admin'`).get() as { c: number }).c;
      if (superAdminCount <= 1) {
        res.status(400).json({ error: 'সর্বশেষ Super Admin অ্যাকাউন্ট মুছে ফেলা যাবে না।' });
        return;
      }
    }
    db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(id);
    db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    logAudit(req.user, 'DELETE_USER', 'users', id, { email: target.email, role: target.role });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/users/login-history', requireAuth, requirePermission('manage_users'), (_req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT a.id, a.user_id, a.user_name, a.action, a.entity_id, a.details_json,
             a.ip_address, a.device_info, a.browser_info, a.created_at,
             u.email, u.role
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.action IN ('LOGIN', 'LOGIN_BLOCKED', 'SIGNUP_USER', 'BOOTSTRAP_ADMIN')
      ORDER BY a.id DESC LIMIT 100
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/audit-logs', requireAuth, requirePermission('manage_users'), (_req: Request, res: Response) => {
  res.json(db.prepare(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200`).all());
});

// Publicly readable so login page, storefront, and invoice modals have store branding even before login
app.get('/api/settings', (_req: Request, res: Response) => {
  const row = db.prepare(`SELECT * FROM shop_settings WHERE id = 1`).get();
  res.json(row || {
    id: 1,
    shop_name: 'AmarPOS Smart AI',
    shop_name_bn: 'আমার পিওএস স্মার্ট এআই',
    logo_url: '',
    address: 'Dhaka, Bangladesh',
    phone: '',
    email: '',
    vat_reg_no: '',
    default_vat_percent: 0,
    currency: 'BDT',
    receipt_footer: 'ধন্যবাদ! আবার আসবেন / Thank you for shopping with us!',
    thermal_width: '80mm',
    promo_banner_text: '',
    promo_banner_active: 0,
  });
});

app.put('/api/settings', requireAuth, requirePermission('manage_settings'), (req: AuthedRequest, res: Response) => {
  try {
    const s = req.body as Record<string, unknown>;
    const shop_name = String(s.shop_name || 'AmarPOS Smart AI').trim();
    const shop_name_bn = String(s.shop_name_bn || '').trim();
    const logo_url = String(s.logo_url || '').trim();
    const address = String(s.address || '').trim();
    const phone = String(s.phone || '').trim();
    const email = String(s.email || '').trim();
    const vat_reg_no = String(s.vat_reg_no || '').trim();
    const default_vat_percent = Number(s.default_vat_percent || 0);
    const receipt_footer = String(s.receipt_footer || '').trim();
    const thermal_width = s.thermal_width === '58mm' ? '58mm' : '80mm';
    const sms_gateway_url = String(s.sms_gateway_url || '').trim();
    const whatsapp_phone_id = String(s.whatsapp_phone_id || '').trim();
    const promo_banner_text = String(s.promo_banner_text || '').trim();
    const promo_banner_active = s.promo_banner_active ? 1 : 0;

    db.prepare(`
      INSERT INTO shop_settings (
        id, shop_name, shop_name_bn, logo_url, address, phone, email, vat_reg_no,
        default_vat_percent, receipt_footer, thermal_width, sms_gateway_url,
        whatsapp_phone_id, promo_banner_text, promo_banner_active
      ) VALUES (
        1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        shop_name = excluded.shop_name,
        shop_name_bn = excluded.shop_name_bn,
        logo_url = excluded.logo_url,
        address = excluded.address,
        phone = excluded.phone,
        email = excluded.email,
        vat_reg_no = excluded.vat_reg_no,
        default_vat_percent = excluded.default_vat_percent,
        receipt_footer = excluded.receipt_footer,
        thermal_width = excluded.thermal_width,
        sms_gateway_url = excluded.sms_gateway_url,
        whatsapp_phone_id = excluded.whatsapp_phone_id,
        promo_banner_text = excluded.promo_banner_text,
        promo_banner_active = excluded.promo_banner_active
    `).run(
      shop_name,
      shop_name_bn,
      logo_url,
      address,
      phone,
      email,
      vat_reg_no,
      default_vat_percent,
      receipt_footer,
      thermal_width,
      sms_gateway_url,
      whatsapp_phone_id,
      promo_banner_text,
      promo_banner_active
    );

    // Persist backup into internal_keys so it survives restarts
    const backupJson = JSON.stringify({
      shop_name, shop_name_bn, logo_url, address, phone, email, vat_reg_no,
      default_vat_percent, receipt_footer, thermal_width, sms_gateway_url,
      whatsapp_phone_id, promo_banner_text, promo_banner_active
    });
    db.prepare(`
      INSERT INTO internal_keys (key_name, key_value) VALUES ('saved_shop_settings', ?)
      ON CONFLICT(key_name) DO UPDATE SET key_value = excluded.key_value, created_at = datetime('now')
    `).run(backupJson);

    // Also persist backup to disk file if possible
    try {
      const backupFilePath = path.resolve(defaultDbDir, 'saved_shop_settings.json');
      fs.writeFileSync(backupFilePath, backupJson, 'utf-8');
    } catch {
      // ignore
    }

    logAudit(req.user, 'UPDATE_SETTINGS', 'shop_settings', 1, { shop_name });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/settings/gemini-key', requireAuth, (_req: Request, res: Response) => {
  let activeKey = '';
  try {
    activeKey = getGeminiApiKey();
  } catch {
    // ignore
  }

  const isConfigured = Boolean(activeKey && activeKey !== 'MY_GEMINI_API_KEY');
  const maskedKey = isConfigured ? (activeKey.length > 8 ? `${activeKey.slice(0, 4)}••••••••${activeKey.slice(-4)}` : '••••••••') : '';

  res.json({
    configured: isConfigured,
    source: process.env.GEMINI_API_KEY ? 'env' : isConfigured ? 'database' : 'none',
    maskedKey,
  });
});

app.post('/api/settings/gemini-key', requireAuth, (req: AuthedRequest, res: Response) => {
  try {
    const { apiKey } = req.body as { apiKey?: string };
    const cleanKey = String(apiKey || '').trim();
    saveGeminiKeyPermanently(cleanKey);
    logAudit(req.user, 'UPDATE_GEMINI_KEY', 'internal_keys', 0, { length: cleanKey.length });
    res.json({ success: true, configured: Boolean(cleanKey) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/settings/gemini-test', requireAuth, async (_req: Request, res: Response) => {
  try {
    const apiKey = getGeminiApiKey();
    const result = await getAvailableGeminiModels(apiKey);
    if (result.error) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    res.json({
      ok: true,
      apiVersion: result.apiVersion,
      modelsCount: result.models.length,
      availableModels: result.models.slice(0, 10),
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

app.get('/api/backup/export', requireAuth, requirePermission('manage_settings'), (req: AuthedRequest, res: Response) => {
  const tables = [
    'categories', 'products', 'product_batches', 'stock_movements',
    'suppliers', 'purchases', 'purchase_items', 'customers',
    'sales', 'sale_items', 'due_payments', 'expenses',
    'coupons', 'product_reviews', 'message_logs', 'shop_settings',
  ];
  const dump: Record<string, unknown> = { exportedAt: new Date().toISOString(), version: '1.0' };
  for (const t of tables) {
    dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  }
  logAudit(req.user, 'EXPORT_BACKUP', 'system', 'db', {});
  res.json(dump);
});

app.post('/api/backup/restore', requireAuth, requirePermission('manage_settings'), (req: AuthedRequest, res: Response) => {
  try {
    if (req.user?.role !== 'Super Admin') {
      res.status(403).json({ error: 'Only Super Admin can restore database backups.' });
      return;
    }
    const dump = req.body as Record<string, Array<Record<string, unknown>>>;
    if (!dump || !Array.isArray(dump.products)) {
      res.status(400).json({ error: 'Invalid backup snapshot format.' });
      return;
    }

    withTransaction(() => {
      const clearOrder = [
        'sale_items', 'sales', 'due_payments', 'purchase_items', 'purchases',
        'stock_movements', 'product_batches', 'product_reviews', 'products',
        'categories', 'suppliers', 'customers', 'expenses', 'coupons', 'message_logs',
      ];
      for (const t of clearOrder) {
        db.exec(`DELETE FROM ${t}`);
      }

      const restoreTable = (tableName: string, rows: Array<Record<string, unknown>>) => {
        if (!rows?.length) return;
        const cols = Object.keys(rows[0]);
        const placeholders = cols.map(() => '?').join(', ');
        const stmt = db.prepare(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`);
        for (const r of rows) {
          stmt.run(...cols.map((c) => (r[c] === undefined ? null : (r[c] as string | number | null))));
        }
      };

      const insertOrder = [
        'categories', 'products', 'product_batches', 'suppliers', 'purchases', 'purchase_items',
        'customers', 'sales', 'sale_items', 'due_payments', 'expenses', 'coupons',
        'product_reviews', 'message_logs', 'stock_movements',
      ];
      for (const t of insertOrder) {
        restoreTable(t, dump[t] || []);
      }
      logAudit(req.user, 'RESTORE_BACKUP', 'system', 'db', { restoredAt: new Date().toISOString() });
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ==========================================
// COMPUTER CSV EXPORT & GOOGLE SHEETS SYNC
// ==========================================

app.get('/api/backup/csv', requireAuth, (req: AuthedRequest, res: Response) => {
  const dataset = String(req.query.dataset || 'pnl').toLowerCase();
  const tables = buildDatasetTablesFromDb();
  const mapping: Record<string, { tab: keyof typeof tables; filename: string }> = {
    pnl: { tab: SHEET_TABS.PNL, filename: 'AmarPOS-Daily-PnL' },
    sales: { tab: SHEET_TABS.SALES, filename: 'AmarPOS-Sales' },
    purchases: { tab: SHEET_TABS.PURCHASES, filename: 'AmarPOS-Purchases' },
    expenses: { tab: SHEET_TABS.EXPENSES, filename: 'AmarPOS-Expenses' },
    products: { tab: SHEET_TABS.PRODUCTS, filename: 'AmarPOS-Products-Stock' },
    customers: { tab: SHEET_TABS.CUSTOMERS, filename: 'AmarPOS-Customer-Dues' },
  };
  const chosen = mapping[dataset] || mapping.pnl;
  const rows = tables[chosen.tab] || [];
  const csv = rowsToCsvString(rows);
  logAudit(req.user, 'EXPORT_CSV', 'backup', dataset, { rows: Math.max(0, rows.length - 1) });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${chosen.filename}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

app.get('/api/sheets/config', requireAuth, (_req: Request, res: Response) => {
  const config = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;
  const logs = db.prepare(`SELECT * FROM google_sheets_sync_logs ORDER BY id DESC LIMIT 25`).all();
  res.json({ config, logs });
});

app.put('/api/sheets/config', requireAuth, requirePermission('manage_settings'), (req: AuthedRequest, res: Response) => {
  try {
    const b = req.body as Record<string, unknown>;
    const existing = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;

    let spreadsheetId = existing.spreadsheet_id;
    let spreadsheetUrl = existing.spreadsheet_url;
    if (typeof b.spreadsheet_id === 'string') {
      if (b.spreadsheet_id.trim() === '') {
        spreadsheetId = '';
        spreadsheetUrl = '';
      } else {
        spreadsheetId = extractSpreadsheetId(b.spreadsheet_id);
        spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
      }
    }

    db.prepare(
      `UPDATE google_sheets_config SET
        spreadsheet_id = ?,
        spreadsheet_title = ?,
        spreadsheet_url = ?,
        auto_sync_enabled = ?,
        sync_sales = ?,
        sync_purchases = ?,
        sync_expenses = ?,
        sync_products = ?,
        sync_customers = ?,
        sync_pnl = ?
       WHERE id = 1`
    ).run(
      spreadsheetId,
      String(b.spreadsheet_title ?? existing.spreadsheet_title).trim(),
      String(b.spreadsheet_url ?? spreadsheetUrl).trim(),
      b.auto_sync_enabled !== undefined ? (b.auto_sync_enabled ? 1 : 0) : existing.auto_sync_enabled,
      b.sync_sales !== undefined ? (b.sync_sales ? 1 : 0) : existing.sync_sales,
      b.sync_purchases !== undefined ? (b.sync_purchases ? 1 : 0) : existing.sync_purchases,
      b.sync_expenses !== undefined ? (b.sync_expenses ? 1 : 0) : existing.sync_expenses,
      b.sync_products !== undefined ? (b.sync_products ? 1 : 0) : existing.sync_products,
      b.sync_customers !== undefined ? (b.sync_customers ? 1 : 0) : existing.sync_customers,
      b.sync_pnl !== undefined ? (b.sync_pnl ? 1 : 0) : existing.sync_pnl
    );

    const updated = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;
    logAudit(req.user, 'UPDATE_GOOGLE_SHEETS_CONFIG', 'google_sheets_config', 1, {
      spreadsheetId: updated.spreadsheet_id,
      autoSync: updated.auto_sync_enabled,
    });
    res.json({ config: updated });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sheets/auth-token', requireAuth, (req: AuthedRequest, res: Response) => {
  try {
    const { email, accessToken } = req.body as { email?: string; accessToken?: string };
    const cleanEmail = String(email || '').trim();
    const cleanToken = String(accessToken || '').trim();
    db.prepare(`UPDATE google_sheets_config SET connected_email = ?, access_token = ? WHERE id = 1`).run(
      cleanEmail,
      cleanToken
    );
    res.json({ ok: true, email: cleanEmail });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/sheets/create', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const token = validateGoogleAccessToken(req.headers['x-google-access-token'] as string | undefined);
    const { title, syncNow } = (req.body || {}) as { title?: string; syncNow?: boolean };
    const shop = db.prepare(`SELECT shop_name FROM shop_settings WHERE id = 1`).get() as { shop_name?: string } | undefined;
    const desiredTitle = (title || '').trim() || `${shop?.shop_name || 'AmarPOS Smart AI'} · Cloud Ledger & Backup`;

    const created = await createAmarPosSpreadsheet(desiredTitle, token);
    db.prepare(
      `UPDATE google_sheets_config
       SET spreadsheet_id = ?, spreadsheet_title = ?, spreadsheet_url = ?, last_sync_status = 'CONNECTED', last_sync_detail = 'Created new AmarPOS workbook'
       WHERE id = 1`
    ).run(created.spreadsheetId, created.title, created.spreadsheetUrl);

    let rowsWritten = 0;
    if (syncNow !== false) {
      const cfg = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;
      const allTables = buildDatasetTablesFromDb();
      const targetTabs: Record<string, Array<Array<unknown>>> = {};
      if (cfg.sync_pnl) targetTabs[SHEET_TABS.PNL] = allTables[SHEET_TABS.PNL];
      if (cfg.sync_sales) targetTabs[SHEET_TABS.SALES] = allTables[SHEET_TABS.SALES];
      if (cfg.sync_purchases) targetTabs[SHEET_TABS.PURCHASES] = allTables[SHEET_TABS.PURCHASES];
      if (cfg.sync_expenses) targetTabs[SHEET_TABS.EXPENSES] = allTables[SHEET_TABS.EXPENSES];
      if (cfg.sync_products) targetTabs[SHEET_TABS.PRODUCTS] = allTables[SHEET_TABS.PRODUCTS];
      if (cfg.sync_customers) targetTabs[SHEET_TABS.CUSTOMERS] = allTables[SHEET_TABS.CUSTOMERS];
      const syncRes = await writeTabsToGoogleSheet(created.spreadsheetId, targetTabs, token);
      rowsWritten = syncRes.rowsWritten;
      db.prepare(
        `UPDATE google_sheets_config SET last_sync_at = datetime('now'), last_sync_status = 'SUCCESS', last_sync_detail = ? WHERE id = 1`
      ).run(`Initial sync (${syncRes.tabsUpdated.length} tabs, ${rowsWritten} rows)`);
    }

    db.prepare(
      `INSERT INTO google_sheets_sync_logs (action, spreadsheet_id, status, rows_written, detail, user_id)
       VALUES ('CREATE_WORKBOOK', ?, 'SUCCESS', ?, ?, ?)`
    ).run(created.spreadsheetId, rowsWritten, `Created "${created.title}"`, req.user?.id ?? null);

    logAudit(req.user, 'CREATE_GOOGLE_SHEET', 'google_sheets', created.spreadsheetId, { title: created.title });
    const config = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get();
    res.status(201).json({ config, created });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 400).json({ error: e.message });
  }
});

app.post('/api/sheets/connect', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const token = validateGoogleAccessToken(req.headers['x-google-access-token'] as string | undefined);
    const { spreadsheetInput } = (req.body || {}) as { spreadsheetInput?: string };
    const meta = await getSpreadsheetMetadata(String(spreadsheetInput || ''), token);

    db.prepare(
      `UPDATE google_sheets_config
       SET spreadsheet_id = ?, spreadsheet_title = ?, spreadsheet_url = ?, last_sync_status = 'CONNECTED', last_sync_detail = ?
       WHERE id = 1`
    ).run(meta.spreadsheetId, meta.title, meta.spreadsheetUrl, `Connected (${meta.sheetTitles.length} existing tabs)`);

    db.prepare(
      `INSERT INTO google_sheets_sync_logs (action, spreadsheet_id, status, rows_written, detail, user_id)
       VALUES ('CONNECT_SHEET', ?, 'SUCCESS', 0, ?, ?)`
    ).run(meta.spreadsheetId, `Connected "${meta.title}"`, req.user?.id ?? null);

    logAudit(req.user, 'CONNECT_GOOGLE_SHEET', 'google_sheets', meta.spreadsheetId, { title: meta.title });
    const config = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get();
    res.json({ config, metadata: meta });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 400).json({ error: e.message });
  }
});

app.post('/api/sheets/sync', requireAuth, async (req: AuthedRequest, res: Response) => {
  let activeSpreadsheetId = '';
  try {
    const token = validateGoogleAccessToken(req.headers['x-google-access-token'] as string | undefined);
    const cfg = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;
    if (!cfg?.spreadsheet_id) {
      res.status(400).json({ error: 'No Google Spreadsheet connected yet. Create or connect a sheet in Settings/Sync first.' });
      return;
    }
    activeSpreadsheetId = cfg.spreadsheet_id;

    const { reason, datasets } = (req.body || {}) as { reason?: string; datasets?: string[] };
    const isAuto = reason && reason !== 'manual';
    if (isAuto && !cfg.auto_sync_enabled) {
      res.json({ skipped: true, reason: 'Auto-sync disabled' });
      return;
    }

    const allTables = buildDatasetTablesFromDb();
    const wantAll = !Array.isArray(datasets) || datasets.length === 0;
    const want = new Set(datasets || []);
    const tabMap: Record<string, Array<Array<unknown>>> = {};

    if ((wantAll && cfg.sync_pnl) || want.has('pnl')) tabMap[SHEET_TABS.PNL] = allTables[SHEET_TABS.PNL];
    if ((wantAll && cfg.sync_sales) || want.has('sales')) tabMap[SHEET_TABS.SALES] = allTables[SHEET_TABS.SALES];
    if ((wantAll && cfg.sync_purchases) || want.has('purchases')) tabMap[SHEET_TABS.PURCHASES] = allTables[SHEET_TABS.PURCHASES];
    if ((wantAll && cfg.sync_expenses) || want.has('expenses')) tabMap[SHEET_TABS.EXPENSES] = allTables[SHEET_TABS.EXPENSES];
    if ((wantAll && cfg.sync_products) || want.has('products')) tabMap[SHEET_TABS.PRODUCTS] = allTables[SHEET_TABS.PRODUCTS];
    if ((wantAll && cfg.sync_customers) || want.has('customers')) tabMap[SHEET_TABS.CUSTOMERS] = allTables[SHEET_TABS.CUSTOMERS];

    const result = await writeTabsToGoogleSheet(cfg.spreadsheet_id, tabMap, token);
    const detail = `${isAuto ? 'Auto-sync' : 'Manual sync'} (${result.tabsUpdated.length} tabs, ${result.rowsWritten} rows)${reason ? ` · ${reason}` : ''}`;

    db.prepare(
      `UPDATE google_sheets_config
       SET spreadsheet_title = ?, spreadsheet_url = ?, last_sync_at = datetime('now'), last_sync_status = 'SUCCESS', last_sync_detail = ?
       WHERE id = 1`
    ).run(result.title, result.spreadsheetUrl, detail);

    db.prepare(
      `INSERT INTO google_sheets_sync_logs (action, spreadsheet_id, status, rows_written, detail, user_id)
       VALUES (?, ?, 'SUCCESS', ?, ?, ?)`
    ).run(isAuto ? 'AUTO_SYNC' : 'MANUAL_SYNC', cfg.spreadsheet_id, result.rowsWritten, detail, req.user?.id ?? null);

    const config = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get();
    res.json({ ok: true, result, config });
  } catch (err) {
    const e = err as Error & { status?: number };
    if (activeSpreadsheetId) {
      db.prepare(`UPDATE google_sheets_config SET last_sync_status = 'FAILED', last_sync_detail = ? WHERE id = 1`).run(
        e.message.slice(0, 200)
      );
      db.prepare(
        `INSERT INTO google_sheets_sync_logs (action, spreadsheet_id, status, rows_written, detail, user_id)
         VALUES ('SYNC', ?, 'FAILED', 0, ?, ?)`
      ).run(activeSpreadsheetId, e.message.slice(0, 200), req.user?.id ?? null);
    }
    res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 400).json({ error: e.message });
  }
});

app.post('/api/sheets/backup', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const token = validateGoogleAccessToken(req.headers['x-google-access-token'] as string | undefined);
    const cfg = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;
    if (!cfg?.spreadsheet_id) {
      res.status(400).json({ error: 'Connect or create a Google Spreadsheet first.' });
      return;
    }

    const tables = [
      'categories', 'products', 'product_batches', 'stock_movements',
      'suppliers', 'purchases', 'purchase_items', 'customers',
      'sales', 'sale_items', 'due_payments', 'expenses',
      'coupons', 'product_reviews', 'message_logs', 'shop_settings',
    ];
    const dump: Record<string, unknown> = { exportedAt: new Date().toISOString(), version: '1.0' };
    for (const t of tables) {
      dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
    }

    const result = await writeCloudBackupToSheet(cfg.spreadsheet_id, dump, token);
    const detail = `Cloud Backup written (${result.rowsWritten} chunk row(s))`;
    db.prepare(
      `UPDATE google_sheets_config SET last_sync_at = datetime('now'), last_sync_status = 'SUCCESS', last_sync_detail = ? WHERE id = 1`
    ).run(detail);
    db.prepare(
      `INSERT INTO google_sheets_sync_logs (action, spreadsheet_id, status, rows_written, detail, user_id)
       VALUES ('CLOUD_BACKUP', ?, 'SUCCESS', ?, ?, ?)`
    ).run(cfg.spreadsheet_id, result.rowsWritten, detail, req.user?.id ?? null);
    logAudit(req.user, 'GOOGLE_SHEET_BACKUP', 'google_sheets', cfg.spreadsheet_id, { chunks: result.rowsWritten });
    res.json({ ok: true, result });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 400).json({ error: e.message });
  }
});

app.post('/api/sheets/preview', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const token = validateGoogleAccessToken(req.headers['x-google-access-token'] as string | undefined);
    const cfg = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;
    const { spreadsheetInput, tabName } = (req.body || {}) as { spreadsheetInput?: string; tabName?: string };
    const targetId = (spreadsheetInput || '').trim() || cfg.spreadsheet_id;
    if (!targetId) {
      res.status(400).json({ error: 'Provide a Google Spreadsheet ID/URL or connect a sheet first.' });
      return;
    }
    const preview = await readSheetTabPreview(targetId, tabName, token);
    res.json({
      spreadsheetId: preview.spreadsheetId,
      title: preview.title,
      sheetTitles: preview.sheetTitles,
      selectedTab: preview.selectedTab,
      headers: preview.headers,
      totalRows: preview.totalRows,
      previewRows: preview.previewRows,
    });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 400).json({ error: e.message });
  }
});

app.post('/api/sheets/import', requireAuth, requirePermission('manage_settings'), async (req: AuthedRequest, res: Response) => {
  try {
    const token = validateGoogleAccessToken(req.headers['x-google-access-token'] as string | undefined);
    const cfg = db.prepare(`SELECT * FROM google_sheets_config WHERE id = 1`).get() as unknown as GoogleSheetsConfigRow;
    const { entityType, spreadsheetInput, tabName } = (req.body || {}) as {
      entityType?: 'products' | 'customers';
      spreadsheetInput?: string;
      tabName?: string;
    };
    if (entityType !== 'products' && entityType !== 'customers') {
      res.status(400).json({ error: 'Import entityType must be "products" or "customers".' });
      return;
    }

    const targetId = (spreadsheetInput || '').trim() || cfg.spreadsheet_id;
    if (!targetId) {
      res.status(400).json({ error: 'Connect a Google Spreadsheet first.' });
      return;
    }

    const sheetData = await readSheetTabPreview(targetId, tabName, token);
    const normHeaders = sheetData.headers.map((h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));

    const colVal = (row: string[], ...candidates: string[]): string => {
      for (const c of candidates) {
        const idx = normHeaders.indexOf(c);
        if (idx >= 0 && row[idx] !== undefined) return String(row[idx]).trim();
      }
      return '';
    };

    const stats = withTransaction(() => {
      let inserted = 0;
      let updated = 0;
      let skipped = 0;

      if (entityType === 'products') {
        const defaultCat = db.prepare(`SELECT id FROM categories ORDER BY id ASC LIMIT 1`).get() as { id: number } | undefined;
        for (const row of sheetData.allRows) {
          const name = colVal(row, 'name', 'product_name', 'item_name');
          const sku = colVal(row, 'sku', 'product_sku', 'code');
          if (!name || !sku) {
            skipped++;
            continue;
          }
          const barcode = colVal(row, 'barcode');
          const nameBn = colVal(row, 'name_bn', 'bangla_name');
          const brand = colVal(row, 'brand');
          const manufacturer = colVal(row, 'manufacturer');
          const genericName = colVal(row, 'generic_name', 'generic');
          const strength = colVal(row, 'strength');
          const dosageForm = colVal(row, 'dosage_form');
          const unit = colVal(row, 'unit') || 'Piece';
          const purchasePrice = Math.max(0, Number(colVal(row, 'purchase_price', 'cost_price') || 0) || 0);
          const wholesalePrice = Math.max(0, Number(colVal(row, 'wholesale_price') || 0) || 0);
          const retailPrice = Math.max(0, Number(colVal(row, 'retail_price', 'price', 'selling_price') || 0) || 0);
          const minSellingPrice = Math.max(0, Number(colVal(row, 'min_selling_price') || 0) || 0);
          const onlinePrice = Math.max(0, Number(colVal(row, 'online_price') || retailPrice) || 0);
          const vatPercent = Math.max(0, Number(colVal(row, 'vat_', 'vat_percent', 'vat') || 0) || 0);
          const minAlert = Math.max(0, Number(colVal(row, 'min_stock_alert') || 10) || 10);
          const catName = colVal(row, 'category', 'category_name');
          let catId = defaultCat?.id ?? null;
          if (catName) {
            const catRow = db.prepare(`SELECT id FROM categories WHERE LOWER(name) = LOWER(?)`).get(catName) as { id: number } | undefined;
            if (catRow) catId = catRow.id;
          }

          const existing = db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku) as { id: number } | undefined;
          if (existing) {
            db.prepare(
              `UPDATE products SET
                name = ?, name_bn = ?, barcode = ?, category_id = ?, brand = ?, manufacturer = ?,
                generic_name = ?, strength = ?, dosage_form = ?, unit = ?,
                purchase_price = ?, wholesale_price = ?, retail_price = ?, min_selling_price = ?,
                online_price = ?, vat_percent = ?, min_stock_alert = ?, updated_at = datetime('now')
               WHERE id = ?`
            ).run(
              name, nameBn, barcode, catId, brand, manufacturer,
              genericName, strength, dosageForm, unit,
              purchasePrice, wholesalePrice, retailPrice, minSellingPrice,
              onlinePrice, vatPercent, minAlert, existing.id
            );
            updated++;
          } else {
            const pRes = db
              .prepare(
                `INSERT INTO products (
                  name, name_bn, sku, barcode, qr_code, category_id, brand, manufacturer,
                  generic_name, strength, dosage_form, unit, purchase_price, wholesale_price,
                  retail_price, min_selling_price, online_price, vat_percent, min_stock_alert
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                name, nameBn, sku, barcode, sku, catId, brand, manufacturer,
                genericName, strength, dosageForm, unit, purchasePrice, wholesalePrice,
                retailPrice, minSellingPrice, onlinePrice, vatPercent, minAlert
              );
            const newId = Number(pRes.lastInsertRowid);
            const openingStock = Math.max(0, Math.round(Number(colVal(row, 'current_stock', 'stock', 'opening_stock') || 0) || 0));
            if (openingStock > 0) {
              const expiry = colVal(row, 'nearest_expiry', 'expiry_date');
              const bRes = db
                .prepare(`INSERT INTO product_batches (product_id, batch_number, expiry_date, quantity, purchase_price) VALUES (?, 'SHEET-IMP', ?, ?, ?)`)
                .run(newId, expiry, openingStock, purchasePrice);
              db.prepare(
                `INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, unit_cost, note, user_id)
                 VALUES (?, ?, 'OPENING', ?, 0, ?, ?, 'Imported from Google Sheet', ?)`
              ).run(newId, Number(bRes.lastInsertRowid), openingStock, openingStock, purchasePrice, req.user?.id ?? null);
            }
            inserted++;
          }
        }
      } else {
        for (const row of sheetData.allRows) {
          const name = colVal(row, 'name', 'customer_name');
          const phone = colVal(row, 'phone', 'mobile', 'customer_phone');
          if (!name || !phone) {
            skipped++;
            continue;
          }
          const email = colVal(row, 'email');
          const address = colVal(row, 'address');
          const due = Math.max(0, Number(colVal(row, 'current_due_bdt_', 'current_due', 'due') || 0) || 0);
          const consentSms = colVal(row, 'sms_consent', 'consent_sms').toUpperCase() === 'NO' ? 0 : 1;
          const consentWa = colVal(row, 'whatsapp_consent', 'consent_whatsapp').toUpperCase() === 'NO' ? 0 : 1;

          const existing = db.prepare(`SELECT id FROM customers WHERE phone = ?`).get(phone) as { id: number } | undefined;
          if (existing) {
            db.prepare(
              `UPDATE customers SET name = ?, email = ?, address = ?, consent_sms = ?, consent_whatsapp = ? WHERE id = ?`
            ).run(name, email, address, consentSms, consentWa, existing.id);
            updated++;
          } else {
            const count = (db.prepare(`SELECT COUNT(*) as c FROM customers`).get() as { c: number }).c;
            const code = colVal(row, 'code') || `CUST-${1001 + count + Math.floor(Math.random() * 90)}`;
            db.prepare(
              `INSERT INTO customers (code, name, phone, email, address, consent_sms, consent_whatsapp, current_due)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(code, name, phone, email, address, consentSms, consentWa, due);
            inserted++;
          }
        }
      }

      return { inserted, updated, skipped };
    });

    const detail = `Imported ${entityType} from "${sheetData.selectedTab}": +${stats.inserted} new, ${stats.updated} updated, ${stats.skipped} skipped`;
    db.prepare(
      `INSERT INTO google_sheets_sync_logs (action, spreadsheet_id, status, rows_written, detail, user_id)
       VALUES ('IMPORT_SHEET', ?, 'SUCCESS', ?, ?, ?)`
    ).run(sheetData.spreadsheetId, stats.inserted + stats.updated, detail, req.user?.id ?? null);
    logAudit(req.user, 'IMPORT_GOOGLE_SHEET', entityType, sheetData.spreadsheetId, stats);

    res.json({ ok: true, ...stats, detail });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 400).json({ error: e.message });
  }
});

// ==========================================
// VITE / STATIC SERVING & GRACEFUL LIFECYCLE
// ==========================================

async function startServer() {
  const PORT = Number(process.env.PORT || process.env.DEFAULT_APP_PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);
  let viteServer: ViteDevServer | null = null;

  if (!isProd) {
    const hmrEnabled = process.env.ENABLE_HMR === 'true' && process.env.DISABLE_HMR !== 'true';
    const { createServer: createViteServer } = await import('vite');
    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrEnabled,
        ws: hmrEnabled ? { server: httpServer } : false,
        watch: hmrEnabled ? {} : null,
      },
      appType: 'spa',
    }).then((v) => {
      viteServer = v;
      return v;
    });

    const disabledHmrClientShim = `
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if ("document" in globalThis) {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll(\`link[rel="stylesheet"][data-vite-dev-id="\${CSS.escape(id)}"]\`).forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
const noop = () => {};
export function createHotContext() {
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    decline: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
export class ErrorOverlay {}
`.trimStart();

    app.use(async (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      if (!hmrEnabled && (req.path === '/@vite/client' || req.path === '/@vite/client/')) {
        res.status(200);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(disabledHmrClientShim);
        return;
      }
      try {
        const v = viteServer ?? (await vitePromise);
        v.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`AmarPOS Smart AI server listening on http://localhost:${PORT}`);
    });

    await vitePromise;
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`AmarPOS Smart AI server listening on http://localhost:${PORT}`);
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);
    try {
      if (viteServer) {
        await viteServer.close();
      }
    } catch (err) {
      console.error('Error closing Vite dev server:', err);
    }
    httpServer.close(() => {
      closeDatabase();
      process.exit(0);
    });
    setTimeout(() => {
      closeDatabase();
      process.exit(0);
    }, 3000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  httpServer.on('error', (err) => {
    console.error('HTTP server error:', err);
    closeDatabase();
    process.exit(1);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  closeDatabase();
  process.exit(1);
});

startServer().catch((err) => {
  console.error('Failed to start AmarPOS Smart AI server:', err);
  closeDatabase();
  process.exit(1);
});
