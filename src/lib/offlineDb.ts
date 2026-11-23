import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Category, Customer, Expense, OfflineOperation, Product, Sale, Supplier } from '../types';

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
  suppliers: {
    key: number;
    value: Supplier;
  };
  expenses: {
    key: number | string;
    value: Expense;
  };
}

let dbPromise: Promise<IDBPDatabase<AmarPOSDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<AmarPOSDB>('amarpos-offline-v1', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('products')) db.createObjectStore('products', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sales_cache')) db.createObjectStore('sales_cache', { keyPath: 'invoice_no' });
        if (!db.objectStoreNames.contains('sync_queue')) db.createObjectStore('sync_queue', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('suppliers')) db.createObjectStore('suppliers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

export async function cacheCatalogToIndexedDB(
  products: Product[],
  categories: Category[],
  customers: Customer[],
  sales: Sale[],
  suppliers?: Supplier[],
  expenses?: Expense[]
) {
  try {
    const db = await getDB();
    const storeNames = ['products', 'categories', 'customers', 'sales_cache', 'suppliers', 'expenses'] as const;
    const tx = db.transaction(storeNames as unknown as string[], 'readwrite');

    await tx.objectStore('products').clear();
    for (const p of products) await tx.objectStore('products').put(p);

    await tx.objectStore('categories').clear();
    for (const c of categories) await tx.objectStore('categories').put(c);

    await tx.objectStore('customers').clear();
    for (const cu of customers) await tx.objectStore('customers').put(cu);

    await tx.objectStore('sales_cache').clear();
    for (const s of sales.slice(0, 150)) await tx.objectStore('sales_cache').put(s);

    if (suppliers && suppliers.length > 0) {
      await tx.objectStore('suppliers').clear();
      for (const sup of suppliers) await tx.objectStore('suppliers').put(sup);
    }

    if (expenses && expenses.length > 0) {
      await tx.objectStore('expenses').clear();
      for (const ex of expenses.slice(0, 100)) await tx.objectStore('expenses').put(ex);
    }

    await tx.done;
  } catch (err) {
    console.warn('Failed to cache catalog to IndexedDB:', err);
  }
}

export async function readOfflineCatalog() {
  try {
    const db = await getDB();
    const [products, categories, customers, sales, suppliers, expenses] = await Promise.all([
      db.getAll('products').catch(() => []),
      db.getAll('categories').catch(() => []),
      db.getAll('customers').catch(() => []),
      db.getAll('sales_cache').catch(() => []),
      db.getAll('suppliers').catch(() => []),
      db.getAll('expenses').catch(() => []),
    ]);
    return {
      products,
      categories,
      customers,
      sales: sales.reverse(),
      suppliers,
      expenses: expenses.reverse(),
    };
  } catch (err) {
    console.warn('Failed to read from IndexedDB:', err);
    return { products: [], categories: [], customers: [], sales: [], suppliers: [], expenses: [] };
  }
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
  if (op.type === 'SALE') {
    if (op.payload.status !== 'HELD') {
      const items = (op.payload.items as Array<{ product_id: number; quantity: number; unit_multiplier: number }>) || [];
      for (const it of items) {
        const p = await db.get('products', Number(it.product_id));
        if (p) {
          p.current_stock = Math.max(0, p.current_stock - Number(it.quantity) * Number(it.unit_multiplier || 1));
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
          c.total_purchases = (c.total_purchases || 0) + total;
          c.total_payments = (c.total_payments || 0) + Math.min(total, paid);
          c.current_due = (c.current_due || 0) + due;
          await db.put('customers', c);
        }
      }
    }

    const offlineSale: Sale = {
      id: -Date.now(),
      client_tx_id: op.id,
      invoice_no: String(op.payload.invoice_no || `OFF-${Date.now().toString().slice(-6)}`),
      customer_id: op.payload.customer_id ? Number(op.payload.customer_id) : null,
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
      notes: op.payload.status === 'HELD' ? 'Held sale recorded offline' : 'Recorded offline (pending sync)',
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
      c.total_payments = (c.total_payments || 0) + amt;
      c.current_due = Math.max(0, (c.current_due || 0) - amt);
      await db.put('customers', c);
    }
  } else if (op.type === 'CUSTOMER') {
    const custId = Number(op.payload.id || -Date.now());
    const newCust: Customer = {
      id: custId,
      code: String(op.payload.code || `OFF-${Date.now().toString().slice(-4)}`),
      name: String(op.payload.name || ''),
      phone: String(op.payload.phone || ''),
      email: String(op.payload.email || ''),
      address: String(op.payload.address || ''),
      total_purchases: 0,
      total_payments: 0,
      current_due: 0,
      total_spent: 0,
      total_due: 0,
      created_at: op.createdAt,
    };
    await db.put('customers', newCust);
  } else if (op.type === 'EXPENSE') {
    const expId = -Date.now();
    const newExp: Expense = {
      id: expId,
      title: String(op.payload.title || 'Expense'),
      category: String(op.payload.category || 'General'),
      amount: Number(op.payload.amount || 0),
      payment_method: String(op.payload.payment_method || 'CASH'),
      created_at: op.createdAt,
    };
    await db.put('expenses', newExp);
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
      if (p.sku && p.sku.toLowerCase() === q) score += 0.95;
      if (p.name && p.name.toLowerCase().includes(q)) score += 0.75;
      for (const t of tokens) {
        if (hay.includes(t)) score += 0.25;
      }
      return { product: p, matchScore: Math.min(0.99, Number(score.toFixed(2))) };
    })
    .filter((r) => r.matchScore >= 0.25)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
}
