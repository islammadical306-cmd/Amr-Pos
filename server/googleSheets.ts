import { db } from './db.ts';

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface GoogleSheetsConfigRow {
  id: number;
  spreadsheet_id: string;
  spreadsheet_title: string;
  spreadsheet_url: string;
  auto_sync_enabled: number;
  sync_sales: number;
  sync_purchases: number;
  sync_expenses: number;
  sync_products: number;
  sync_customers: number;
  sync_pnl: number;
  last_sync_at: string;
  last_sync_status: string;
  last_sync_detail: string;
}

export const SHEET_TABS = {
  PNL: 'Daily Summary (P&L)',
  SALES: 'Sales Ledger',
  PURCHASES: 'Purchases',
  EXPENSES: 'Expenses',
  PRODUCTS: 'Products & Stock',
  CUSTOMERS: 'Customer Dues',
  BACKUP: 'Cloud Backup',
} as const;

export function extractSpreadsheetId(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Spreadsheet ID or Google Sheets URL is required.');

  const urlMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,120})/);
  const id = urlMatch ? urlMatch[1] : raw;

  if (!/^[a-zA-Z0-9_-]{10,120}$/.test(id)) {
    throw new Error('Invalid Google Spreadsheet ID or URL format.');
  }
  return id;
}

export function validateGoogleAccessToken(token: string | undefined): string {
  const clean = String(token || '').trim();
  if (!clean || !/^[\x21-\x7E]{20,4096}$/.test(clean)) {
    const err = new Error('Google Sheets authorization token missing or invalid. Please click "Sign in with Google".') as Error & {
      status?: number;
    };
    err.status = 401;
    throw err;
  }
  return clean;
}

function sanitizeSheetCell(val: unknown): string | number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : 0;
  }
  if (val === null || val === undefined) return '';
  const s = String(val);
  // Neutralize spreadsheet formula injection when exported/viewed
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function sanitizeRows(rows: Array<Array<unknown>>): Array<Array<string | number>> {
  return rows.map((row) => row.map(sanitizeSheetCell));
}

function quoteTabRange(tabName: string, range = 'A1:Z50000'): string {
  return `'${tabName.replace(/'/g, "''")}'!${range}`;
}

async function sheetsFetch<T>(url: string, accessToken: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text };
    }

    if (!res.ok) {
      const apiErr = (json.error as { message?: string } | undefined)?.message || text || `Google Sheets API error (${res.status})`;
      const err = new Error(
        res.status === 401
          ? 'Google sign-in expired. Please click "Sign in with Google" to reconnect.'
          : res.status === 403
            ? `Google Sheets permission denied: ${apiErr}`
            : apiErr
      ) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    return json as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSpreadsheetMetadata(spreadsheetId: string, accessToken: string) {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(cleanId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties`;
  const data = await sheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>(url, accessToken);

  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    title: data.properties?.title || 'AmarPOS Smart AI Workbook',
    sheetTitles: (data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean),
  };
}

export async function createAmarPosSpreadsheet(title: string, accessToken: string) {
  const cleanTitle = String(title || '').trim() || `AmarPOS Smart AI · Backup & Reports`;
  const tabList = Object.values(SHEET_TABS);

  const data = await sheetsFetch<{
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { title?: string } }>;
  }>(SHEETS_API_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: cleanTitle },
      sheets: tabList.map((tabTitle) => ({
        properties: {
          title: tabTitle,
          gridProperties: { frozenRowCount: 1 },
        },
      })),
    }),
  });

  return {
    spreadsheetId: data.spreadsheetId,
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    title: data.properties?.title || cleanTitle,
    sheetTitles: (data.sheets || []).map((s) => s.properties?.title || '').filter(Boolean),
  };
}

export async function ensureSheetTabsExist(spreadsheetId: string, requiredTabs: string[], accessToken: string) {
  const meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  const existing = new Set(meta.sheetTitles);
  const missing = requiredTabs.filter((t) => !existing.has(t));

  if (missing.length > 0) {
    await sheetsFetch(`${SHEETS_API_BASE}/${encodeURIComponent(meta.spreadsheetId)}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map((title) => ({
          addSheet: {
            properties: {
              title,
              gridProperties: { frozenRowCount: 1 },
            },
          },
        })),
      }),
    });
  }
  return meta;
}

export async function writeTabsToGoogleSheet(
  spreadsheetId: string,
  tabMap: Record<string, Array<Array<unknown>>>,
  accessToken: string
): Promise<{ rowsWritten: number; tabsUpdated: string[]; title: string; spreadsheetUrl: string }> {
  const tabNames = Object.keys(tabMap);
  if (tabNames.length === 0) {
    throw new Error('No tabs selected to synchronize.');
  }

  const meta = await ensureSheetTabsExist(spreadsheetId, tabNames, accessToken);
  const clearRanges = tabNames.map((t) => quoteTabRange(t, 'A1:Z50000'));

  await sheetsFetch(`${SHEETS_API_BASE}/${encodeURIComponent(meta.spreadsheetId)}/values:batchClear`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ ranges: clearRanges }),
  });

  let rowsWritten = 0;
  const dataPayload = tabNames.map((tabName) => {
    const rawRows = tabMap[tabName] || [];
    const safeRows = sanitizeRows(rawRows);
    rowsWritten += Math.max(0, safeRows.length - 1);
    return {
      range: quoteTabRange(tabName, 'A1'),
      majorDimension: 'ROWS',
      values: safeRows,
    };
  });

  await sheetsFetch(`${SHEETS_API_BASE}/${encodeURIComponent(meta.spreadsheetId)}/values:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: dataPayload,
    }),
  });

  return {
    rowsWritten,
    tabsUpdated: tabNames,
    title: meta.title,
    spreadsheetUrl: meta.spreadsheetUrl,
  };
}

export function buildDatasetTablesFromDb() {
  // 1. Daily Summary (P&L)
  const dailySales = db
    .prepare(
      `SELECT date(s.created_at) as dt,
              COUNT(*) as tx_count,
              COALESCE(SUM(s.total), 0) as total_sales,
              COALESCE(SUM((SELECT COALESCE(SUM((si.quantity - si.returned_qty) * si.unit_multiplier * si.cost_price), 0) FROM sale_items si WHERE si.sale_id = s.id)), 0) as cogs
       FROM sales s
       WHERE s.status NOT IN ('HELD', 'CANCELLED')
       GROUP BY date(s.created_at)
       ORDER BY dt DESC
       LIMIT 365`
    )
    .all() as Array<{ dt: string; tx_count: number; total_sales: number; cogs: number }>;

  const dailyPurchases = db
    .prepare(
      `SELECT date(created_at) as dt, COALESCE(SUM(total), 0) as total_purchases
       FROM purchases
       GROUP BY date(created_at)`
    )
    .all() as Array<{ dt: string; total_purchases: number }>;

  const dailyExpenses = db
    .prepare(
      `SELECT date(created_at) as dt, COALESCE(SUM(amount), 0) as total_expenses
       FROM expenses
       GROUP BY date(created_at)`
    )
    .all() as Array<{ dt: string; total_expenses: number }>;

  const totalCustomerDue = (db.prepare(`SELECT COALESCE(SUM(current_due), 0) as v FROM customers`).get() as { v: number }).v;
  const totalSupplierDue = (db.prepare(`SELECT COALESCE(SUM(total_due), 0) as v FROM suppliers`).get() as { v: number }).v;
  const stockValue = (
    db.prepare(`SELECT COALESCE(SUM(quantity * purchase_price), 0) as v FROM product_batches WHERE quantity > 0`).get() as { v: number }
  ).v;

  const purMap = new Map(dailyPurchases.map((r) => [r.dt, Number(r.total_purchases || 0)]));
  const expMap = new Map(dailyExpenses.map((r) => [r.dt, Number(r.total_expenses || 0)]));
  const allDates = Array.from(new Set([...dailySales.map((r) => r.dt), ...purMap.keys(), ...expMap.keys()]))
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a));
  const salesMap = new Map(dailySales.map((r) => [r.dt, r]));

  const pnlRows: Array<Array<unknown>> = [
    [
      'Date',
      'Transactions',
      'Total Sales (BDT)',
      'COGS (BDT)',
      'Gross Profit (BDT)',
      'Expenses (BDT)',
      'Net Profit (BDT)',
      'Purchases (BDT)',
      'Snapshot Customer Due (BDT)',
      'Snapshot Supplier Due (BDT)',
      'Snapshot Stock Cost Value (BDT)',
    ],
  ];

  for (let i = 0; i < allDates.length; i++) {
    const dt = allDates[i];
    const s = salesMap.get(dt);
    const salesAmt = Number(s?.total_sales || 0);
    const cogs = Number(s?.cogs || 0);
    const gp = Number((salesAmt - cogs).toFixed(2));
    const exp = Number((expMap.get(dt) || 0).toFixed(2));
    const np = Number((gp - exp).toFixed(2));
    const pur = Number((purMap.get(dt) || 0).toFixed(2));
    pnlRows.push([
      dt,
      s?.tx_count || 0,
      Number(salesAmt.toFixed(2)),
      Number(cogs.toFixed(2)),
      gp,
      exp,
      np,
      pur,
      i === 0 ? Number(totalCustomerDue.toFixed(2)) : '',
      i === 0 ? Number(totalSupplierDue.toFixed(2)) : '',
      i === 0 ? Number(stockValue.toFixed(2)) : '',
    ]);
  }

  // 2. Sales Ledger
  const salesList = db
    .prepare(
      `SELECT s.*, u.name as cashier_name
       FROM sales s
       LEFT JOIN users u ON u.id = s.user_id
       ORDER BY s.id DESC
       LIMIT 2000`
    )
    .all() as Array<Record<string, unknown>>;

  const salesRows: Array<Array<unknown>> = [
    [
      'Invoice No',
      'Date & Time',
      'Channel',
      'Status',
      'Customer Name',
      'Customer Phone',
      'Payment Method',
      'Subtotal (BDT)',
      'Discount (BDT)',
      'VAT (BDT)',
      'Grand Total (BDT)',
      'Paid (BDT)',
      'Due (BDT)',
      'Cashier',
      'Notes',
    ],
  ];
  for (const s of salesList) {
    salesRows.push([
      s.invoice_no,
      s.created_at,
      s.sale_type,
      s.status,
      s.customer_name || 'Walk-in Customer',
      s.customer_phone || '',
      s.payment_method,
      Number(s.subtotal || 0),
      Number(s.discount_amount || 0),
      Number(s.vat_amount || 0),
      Number(s.total || 0),
      Number(s.paid_amount || 0),
      Number(s.due_amount || 0),
      s.cashier_name || '',
      s.notes || '',
    ]);
  }

  // 3. Purchases
  const purList = db
    .prepare(
      `SELECT p.*, s.name as supplier_name, s.company as supplier_company
       FROM purchases p
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ORDER BY p.id DESC
       LIMIT 1500`
    )
    .all() as Array<Record<string, unknown>>;

  const purchaseRows: Array<Array<unknown>> = [
    ['Invoice No', 'Date & Time', 'Supplier', 'Company', 'Subtotal (BDT)', 'Charges (BDT)', 'Total (BDT)', 'Paid (BDT)', 'Due (BDT)', 'Status', 'Note'],
  ];
  for (const p of purList) {
    purchaseRows.push([
      p.invoice_no,
      p.created_at,
      p.supplier_name || '',
      p.supplier_company || '',
      Number(p.subtotal || 0),
      Number(p.additional_charges || 0),
      Number(p.total || 0),
      Number(p.paid_amount || 0),
      Number(p.due_amount || 0),
      p.status,
      p.note || '',
    ]);
  }

  // 4. Expenses
  const expList = db.prepare(`SELECT * FROM expenses ORDER BY id DESC LIMIT 1500`).all() as Array<Record<string, unknown>>;
  const expenseRows: Array<Array<unknown>> = [['ID', 'Date & Time', 'Title', 'Category', 'Amount (BDT)', 'Payment Method', 'Note']];
  for (const e of expList) {
    expenseRows.push([e.id, e.created_at, e.title, e.category, Number(e.amount || 0), e.payment_method, e.note || '']);
  }

  // 5. Products & Stock
  const prodList = db
    .prepare(
      `SELECT p.*, c.name as category_name,
              COALESCE((SELECT SUM(quantity) FROM product_batches pb WHERE pb.product_id = p.id), 0) as current_stock,
              COALESCE((SELECT MIN(expiry_date) FROM product_batches pb WHERE pb.product_id = p.id AND pb.quantity > 0 AND pb.expiry_date != ''), '') as nearest_expiry
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1
       ORDER BY p.id ASC`
    )
    .all() as Array<Record<string, unknown>>;

  const productRows: Array<Array<unknown>> = [
    [
      'ID',
      'SKU',
      'Barcode',
      'Name',
      'Name (BN)',
      'Category',
      'Brand',
      'Manufacturer',
      'Generic Name',
      'Strength',
      'Dosage Form',
      'Unit',
      'Purchase Price',
      'Wholesale Price',
      'Retail Price',
      'Min Selling Price',
      'Online Price',
      'VAT %',
      'Current Stock',
      'Min Stock Alert',
      'Nearest Expiry',
    ],
  ];
  for (const pr of prodList) {
    productRows.push([
      pr.id,
      pr.sku,
      pr.barcode || '',
      pr.name,
      pr.name_bn || '',
      pr.category_name || '',
      pr.brand || '',
      pr.manufacturer || '',
      pr.generic_name || '',
      pr.strength || '',
      pr.dosage_form || '',
      pr.unit,
      Number(pr.purchase_price || 0),
      Number(pr.wholesale_price || 0),
      Number(pr.retail_price || 0),
      Number(pr.min_selling_price || 0),
      Number(pr.online_price || 0),
      Number(pr.vat_percent || 0),
      Number(pr.current_stock || 0),
      Number(pr.min_stock_alert || 0),
      pr.nearest_expiry || '',
    ]);
  }

  // 6. Customer Dues
  const custList = db
    .prepare(`SELECT * FROM customers ORDER BY current_due DESC, id DESC`)
    .all() as Array<Record<string, unknown>>;

  const customerRows: Array<Array<unknown>> = [
    ['Code', 'Name', 'Phone', 'Email', 'Address', 'Total Purchases (BDT)', 'Total Payments (BDT)', 'Current Due (BDT)', 'SMS Consent', 'WhatsApp Consent'],
  ];
  for (const c of custList) {
    customerRows.push([
      c.code,
      c.name,
      c.phone,
      c.email || '',
      c.address || '',
      Number(c.total_purchases || 0),
      Number(c.total_payments || 0),
      Number(c.current_due || 0),
      Number(c.consent_sms) === 1 ? 'YES' : 'NO',
      Number(c.consent_whatsapp) === 1 ? 'YES' : 'NO',
    ]);
  }

  return {
    [SHEET_TABS.PNL]: pnlRows,
    [SHEET_TABS.SALES]: salesRows,
    [SHEET_TABS.PURCHASES]: purchaseRows,
    [SHEET_TABS.EXPENSES]: expenseRows,
    [SHEET_TABS.PRODUCTS]: productRows,
    [SHEET_TABS.CUSTOMERS]: customerRows,
  };
}

export async function writeCloudBackupToSheet(
  spreadsheetId: string,
  backupJson: Record<string, unknown>,
  accessToken: string
): Promise<{ rowsWritten: number; title: string; spreadsheetUrl: string }> {
  const serialized = JSON.stringify(backupJson);
  const chunkSize = 40000;
  const chunks: string[] = [];
  for (let i = 0; i < serialized.length; i += chunkSize) {
    chunks.push(serialized.slice(i, i + chunkSize));
  }

  const meta = await ensureSheetTabsExist(spreadsheetId, [SHEET_TABS.BACKUP], accessToken);
  const exportedAt = new Date().toISOString();

  const rows: Array<Array<unknown>> = [
    ['Snapshot Timestamp', 'Total Chunks', 'Total Bytes', 'Chunk Index', 'Backup JSON Chunk'],
  ];
  chunks.forEach((chunk, idx) => {
    rows.push([idx === 0 ? exportedAt : '', idx === 0 ? chunks.length : '', idx === 0 ? serialized.length : '', idx + 1, chunk]);
  });

  await sheetsFetch(`${SHEETS_API_BASE}/${encodeURIComponent(meta.spreadsheetId)}/values:batchClear`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ ranges: [quoteTabRange(SHEET_TABS.BACKUP, 'A1:E5000')] }),
  });

  await sheetsFetch(`${SHEETS_API_BASE}/${encodeURIComponent(meta.spreadsheetId)}/values:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        {
          range: quoteTabRange(SHEET_TABS.BACKUP, 'A1'),
          majorDimension: 'ROWS',
          values: rows,
        },
      ],
    }),
  });

  return { rowsWritten: chunks.length, title: meta.title, spreadsheetUrl: meta.spreadsheetUrl };
}

export async function readSheetTabPreview(spreadsheetId: string, tabName: string | undefined, accessToken: string) {
  const meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  const chosenTab = tabName && meta.sheetTitles.includes(tabName) ? tabName : meta.sheetTitles[0];
  if (!chosenTab) {
    throw new Error('No sheets/tabs found inside the selected Google Spreadsheet.');
  }

  const range = encodeURIComponent(quoteTabRange(chosenTab, 'A1:Z2000'));
  const data = await sheetsFetch<{ values?: Array<Array<string>> }>(
    `${SHEETS_API_BASE}/${encodeURIComponent(meta.spreadsheetId)}/values/${range}`,
    accessToken
  );

  const values = data.values || [];
  const headers = values[0] || [];
  const rows = values.slice(1);

  return {
    spreadsheetId: meta.spreadsheetId,
    title: meta.title,
    sheetTitles: meta.sheetTitles,
    selectedTab: chosenTab,
    headers,
    totalRows: rows.length,
    previewRows: rows.slice(0, 12),
    allRows: rows,
  };
}

export function rowsToCsvString(rows: Array<Array<unknown>>): string {
  const escapeCsv = (cell: unknown) => {
    const safe = sanitizeSheetCell(cell);
    const str = String(safe ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return '\uFEFF' + rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
}
