import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Category, Customer, OfflineOperation, Product, Sale } from '../types';

interface AmarPOSDB extends DBSchema {
  products: {
    key: number;
    value: Product;
  };
  categories: {
    key: number;
    value: Category;
  };
  customers: {
    key: number;
    value: Customer;
  };
  sales_cache: {
    key: string;
    value: Sale;
  };
  sync_queue: {
    key: string;
    value: OfflineOperation;
  };
}

let dbPromise: Promise<IDBPDatabase<AmarPOSDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AmarPOSDB>('amarpos-offline-v1', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sales_cache')) db.createObjectStore('sales_cache', { keyPath: 'invoice_no' });
        if (!db.objectStoreNames.contains('sync_queue')) db.createObjectStore('sync_queue', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function cacheCatalogToIndexedDB(
  products: Product[],
  categories: Category[],
  customers: Customer[],
  sales: Sale[]
) {
  const db = await getDB();
  const tx = db.transaction(['products', 'categories', 'customers', 'sales_cache'], 'readwrite');
  await tx.objectStore('products').clear();
  for (const p of products) await tx.objectStore('products').put(p);

  await tx.objectStore('categories').clear();
  for (const c of categories) await tx.objectStore('categories').put(c);

  await tx.objectStore('customers').clear();
  for (const cu of customers) await tx.objectStore('customers').put(cu);

  await tx.objectStore('sales_cache').clear();
  for (const s of sales.slice(0, 100)) await tx.objectStore('sales_cache').put(s);

  await tx.done;
}

export async function readOfflineCatalog() {
  const db = await getDB();
  const [products, categories, customers, sales] = await Promise.all([
    db.getAll('products'),
    db.getAll('categories'),
    db.getAll('customers'),
    db.getAll('sales_cache'),
  ]);
  return { products, categories, customers, sales: sales.reverse() };
}

export async function queueOfflineOperation(op: Omit<OfflineOperation, 'retries' | 'status'>) {
  const db = await getDB();
  const record: OfflineOperation = {
    ...op,
    retries: 0,
    status: 'PENDING',
  };
  await db.put('sync_queue', record);

  // Optimistically update local IndexedDB state so offline sales/dues stay accurate immediately
  if (op.type === 'SALE' && op.payload.status !== 'HELD') {
    const items = (op.payload.items as Array<{ product_id: number; quantity: number; unit_multiplier: number }>) || [];
    for (const it of items) {
      const p = await db.get('products', Number(it.product_id));
      if (p) {
        p.current_stock = p.current_stock - Number(it.quantity) * Number(it.unit_multiplier || 1);
        await db.put('products', p);
      }
    }
    const custId = op.payload.customer_id ? Number(op.payload.customer_id) : null;
    if (custId) {
      const c = await db.get('customers', custId);
      if (c) {
        const total = Number(op.payload.total || 0);
        const paid = Number(op.payload.paid_amount || 0);
        const due = Math.max(0, total - paid);
        c.total_purchases += total;
        c.total_payments += Math.min(total, paid);
        c.current_due += due;
        await db.put('customers', c);
      }
    }
    const offlineSale: Sale = {
      id: -Date.now(),
      client_tx_id: op.id,
      invoice_no: String(op.payload.invoice_no || `OFF-${Date.now().toString().slice(-6)}`),
      customer_id: custId,
      customer_name: String(op.payload.customer_name || 'Walk-in Customer'),
      customer_phone: String(op.payload.customer_phone || ''),
      sale_type: 'POS',
      status: String(op.payload.status || 'COMPLETED'),
      subtotal: Number(op.payload.subtotal || 0),
      discount_type: String(op.payload.discount_type || 'FIXED'),
      discount_value: Number(op.payload.discount_value || 0),
      discount_amount: Number(op.payload.discount_amount || 0),
      vat_amount: Number(op.payload.vat_amount || 0),
      total: Number(op.payload.total || 0),
      paid_amount: Number(op.payload.paid_amount || 0),
      due_amount: Math.max(0, Number(op.payload.total || 0) - Number(op.payload.paid_amount || 0)),
      change_amount: Math.max(0, Number(op.payload.paid_amount || 0) - Number(op.payload.total || 0)),
      payment_method: String(op.payload.payment_method || 'CASH'),
      payment_breakdown_json: JSON.stringify(op.payload.payment_breakdown || {}),
      coupon_code: '',
      notes: 'Recorded offline (pending sync)',
      synced_from_offline: 1,
      created_at: op.createdAt,
      items: (op.payload.items as Sale['items']) || [],
    };
    await db.put('sales_cache', offlineSale);
  } else if (op.type === 'DUE_PAYMENT') {
    const custId = Number(op.payload.customer_id);
    const amt = Number(op.payload.amount || 0);
    const c = await db.get('customers', custId);
    if (c) {
      c.total_payments += amt;
      c.current_due = Math.max(0, c.current_due - amt);
      await db.put('customers', c);
    }
  }

  return record;
}

export async function getPendingQueue(): Promise<OfflineOperation[]> {
  const db = await getDB();
  return db.getAll('sync_queue');
}

export async function markQueueItemSynced(id: string) {
  const db = await getDB();
  await db.delete('sync_queue', id);
}

export async function markQueueItemFailed(id: string, errorMsg: string) {
  const db = await getDB();
  const item = await db.get('sync_queue', id);
  if (item) {
    item.retries += 1;
    item.status = 'FAILED';
    item.lastError = errorMsg;
    await db.put('sync_queue', item);
  }
}

export async function localOfflineProductMatch(query: string): Promise<Array<{ product: Product; matchScore: number }>> {
  const db = await getDB();
  const products = await db.getAll('products');
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);

  return products
    .map((p) => {
      let score = 0;
      const hay = `${p.name} ${p.name_bn} ${p.generic_name} ${p.brand} ${p.sku} ${p.barcode}`.toLowerCase();
      if (p.barcode && p.barcode.toLowerCase() === q) score += 0.98;
      if (p.sku.toLowerCase() === q) score += 0.95;
      if (p.name.toLowerCase().includes(q)) score += 0.75;
      for (const t of tokens) {
        if (hay.includes(t)) score += 0.25;
      }
      return { product: p, matchScore: Math.min(0.99, Number(score.toFixed(2))) };
    })
    .filter((r) => r.matchScore >= 0.25)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
}
