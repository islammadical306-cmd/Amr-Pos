import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'amarpos.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
export const db = new DatabaseSync(dbPath);

db.exec(`PRAGMA busy_timeout = 5000;`);
db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA foreign_keys = ON;`);

export function closeDatabase() {
  try {
    db.close();
  } catch {
    // ignore if already closed
  }
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('Super Admin', 'Admin', 'Manager', 'Cashier', 'Sales Staff', 'Stock Manager')),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_bn TEXT NOT NULL,
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_bn TEXT DEFAULT '',
      sku TEXT NOT NULL UNIQUE,
      barcode TEXT DEFAULT '',
      qr_code TEXT DEFAULT '',
      category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      subcategory TEXT DEFAULT '',
      brand TEXT DEFAULT '',
      manufacturer TEXT DEFAULT '',
      generic_name TEXT DEFAULT '',
      strength TEXT DEFAULT '',
      dosage_form TEXT DEFAULT '',
      package_size TEXT DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'Piece',
      units_per_strip INTEGER NOT NULL DEFAULT 1,
      strips_per_box INTEGER NOT NULL DEFAULT 1,
      purchase_price REAL NOT NULL DEFAULT 0,
      wholesale_price REAL NOT NULL DEFAULT 0,
      retail_price REAL NOT NULL DEFAULT 0,
      min_selling_price REAL NOT NULL DEFAULT 0,
      vat_percent REAL NOT NULL DEFAULT 0,
      image_url TEXT DEFAULT '',
      show_online INTEGER NOT NULL DEFAULT 1,
      online_price REAL NOT NULL DEFAULT 0,
      description TEXT DEFAULT '',
      min_stock_alert INTEGER NOT NULL DEFAULT 10,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_number TEXT NOT NULL,
      mfg_date TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      purchase_price REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      quantity_delta INTEGER NOT NULL,
      previous_qty INTEGER NOT NULL,
      new_qty INTEGER NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      reference_id TEXT DEFAULT '',
      note TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      company TEXT DEFAULT '',
      address TEXT DEFAULT '',
      total_due REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT NOT NULL UNIQUE,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      additional_charges REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      due_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      note TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      batch_number TEXT DEFAULT '',
      expiry_date TEXT DEFAULT '',
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL,
      returned_qty INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      email TEXT DEFAULT '',
      address TEXT DEFAULT '',
      password_hash TEXT DEFAULT '',
      password_salt TEXT DEFAULT '',
      opt_out_marketing INTEGER NOT NULL DEFAULT 0,
      consent_sms INTEGER NOT NULL DEFAULT 1,
      consent_whatsapp INTEGER NOT NULL DEFAULT 1,
      total_purchases REAL NOT NULL DEFAULT 0,
      total_payments REAL NOT NULL DEFAULT 0,
      current_due REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_tx_id TEXT UNIQUE,
      invoice_no TEXT NOT NULL UNIQUE,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      customer_name TEXT DEFAULT 'Walk-in Customer',
      customer_phone TEXT DEFAULT '',
      delivery_address TEXT DEFAULT '',
      sale_type TEXT NOT NULL DEFAULT 'POS' CHECK(sale_type IN ('POS', 'ONLINE')),
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      subtotal REAL NOT NULL DEFAULT 0,
      discount_type TEXT NOT NULL DEFAULT 'FIXED',
      discount_value REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      vat_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      due_amount REAL NOT NULL DEFAULT 0,
      change_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      payment_breakdown_json TEXT DEFAULT '{}',
      coupon_code TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      synced_from_offline INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      batch_id INTEGER REFERENCES product_batches(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'Piece',
      unit_multiplier INTEGER NOT NULL DEFAULT 1,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      tax REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL,
      returned_qty INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS due_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_tx_id TEXT UNIQUE,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      note TEXT DEFAULT '',
      receipt_no TEXT NOT NULL UNIQUE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_tx_id TEXT UNIQUE,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'General',
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      note TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_type TEXT NOT NULL DEFAULT 'PERCENT',
      value REAL NOT NULL DEFAULT 0,
      min_order REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS product_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      recipient_phone TEXT DEFAULT '',
      channel TEXT NOT NULL CHECK(channel IN ('SMS', 'WHATSAPP', 'EMAIL')),
      template_key TEXT DEFAULT '',
      message_body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SENT',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT DEFAULT 'System',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT DEFAULT '',
      details_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_tx_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      status TEXT NOT NULL,
      conflict_detail TEXT DEFAULT '',
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shop_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      shop_name TEXT NOT NULL DEFAULT 'AmarCare Pharmacy & Retail',
      shop_name_bn TEXT NOT NULL DEFAULT 'আমারকেয়ার ফার্মেসি ও রিটেইল',
      logo_url TEXT DEFAULT '',
      address TEXT NOT NULL DEFAULT 'House 24, Road 7, Dhanmondi, Dhaka 1205',
      phone TEXT NOT NULL DEFAULT '+8801711000000',
      email TEXT NOT NULL DEFAULT 'store@amarcare.com',
      vat_reg_no TEXT NOT NULL DEFAULT 'BIN-004928172-0101',
      default_vat_percent REAL NOT NULL DEFAULT 5,
      currency TEXT NOT NULL DEFAULT 'BDT',
      receipt_footer TEXT NOT NULL DEFAULT 'ধন্যবাদ! আবার আসবেন / Thank you for shopping with us!',
      thermal_width TEXT NOT NULL DEFAULT '80mm',
      sms_gateway_url TEXT DEFAULT '',
      whatsapp_phone_id TEXT DEFAULT '',
      promo_banner_text TEXT NOT NULL DEFAULT '10% OFF Healthcare Essentials with code WELCOME10 · Same-Day Dhaka Delivery',
      promo_banner_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS internal_keys (
      key_name TEXT PRIMARY KEY,
      key_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sms_gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('SSLWIRELESS', 'BULKSMSBD', 'GREENWEB', 'ALPHASMS', 'TWILIO', 'CUSTOM')),
      base_url TEXT NOT NULL,
      balance_url TEXT DEFAULT '',
      http_method TEXT NOT NULL DEFAULT 'POST' CHECK(http_method IN ('POST', 'GET')),
      payload_format TEXT NOT NULL DEFAULT 'JSON' CHECK(payload_format IN ('JSON', 'FORM', 'QUERY')),
      sender_id TEXT DEFAULT '',
      api_key_enc TEXT DEFAULT '',
      api_secret_enc TEXT DEFAULT '',
      key_hint TEXT DEFAULT '',
      to_param TEXT NOT NULL DEFAULT 'msisdn',
      message_param TEXT NOT NULL DEFAULT 'sms',
      sender_param TEXT NOT NULL DEFAULT 'sid',
      api_key_param TEXT NOT NULL DEFAULT 'api_token',
      extra_params_json TEXT DEFAULT '{}',
      custom_headers_json TEXT DEFAULT '{}',
      batch_delay_ms INTEGER NOT NULL DEFAULT 150,
      is_default INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      last_tested_at TEXT DEFAULT '',
      last_test_status TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sms_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      gateway_id INTEGER REFERENCES sms_gateways(id) ON DELETE SET NULL,
      gateway_name TEXT DEFAULT '',
      audience_type TEXT NOT NULL,
      template_key TEXT DEFAULT 'CUSTOM',
      message_template TEXT NOT NULL,
      is_promotional INTEGER NOT NULL DEFAULT 0,
      total_recipients INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      blocked_count INTEGER NOT NULL DEFAULT 0,
      total_sms_parts INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'COMPLETED',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS google_sheets_config (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      spreadsheet_id TEXT DEFAULT '',
      spreadsheet_title TEXT DEFAULT '',
      spreadsheet_url TEXT DEFAULT '',
      auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
      sync_sales INTEGER NOT NULL DEFAULT 1,
      sync_purchases INTEGER NOT NULL DEFAULT 1,
      sync_expenses INTEGER NOT NULL DEFAULT 1,
      sync_products INTEGER NOT NULL DEFAULT 1,
      sync_customers INTEGER NOT NULL DEFAULT 1,
      sync_pnl INTEGER NOT NULL DEFAULT 1,
      last_sync_at TEXT DEFAULT '',
      last_sync_status TEXT DEFAULT '',
      last_sync_detail TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS google_sheets_sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      spreadsheet_id TEXT DEFAULT '',
      status TEXT NOT NULL,
      rows_written INTEGER NOT NULL DEFAULT 0,
      detail TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`INSERT OR IGNORE INTO google_sheets_config (id) VALUES (1)`).run();

  const msgCols = db.prepare(`PRAGMA table_info(message_logs)`).all() as Array<{ name: string }>;
  const colNames = new Set(msgCols.map((c) => c.name));
  if (!colNames.has('campaign_id')) {
    db.exec(`ALTER TABLE message_logs ADD COLUMN campaign_id INTEGER REFERENCES sms_campaigns(id) ON DELETE SET NULL;`);
  }
  if (!colNames.has('gateway_id')) {
    db.exec(`ALTER TABLE message_logs ADD COLUMN gateway_id INTEGER REFERENCES sms_gateways(id) ON DELETE SET NULL;`);
  }
  if (!colNames.has('provider_ref')) {
    db.exec(`ALTER TABLE message_logs ADD COLUMN provider_ref TEXT DEFAULT '';`);
  }
  if (!colNames.has('error_detail')) {
    db.exec(`ALTER TABLE message_logs ADD COLUMN error_detail TEXT DEFAULT '';`);
  }
  if (!colNames.has('sms_parts')) {
    db.exec(`ALTER TABLE message_logs ADD COLUMN sms_parts INTEGER NOT NULL DEFAULT 1;`);
  }

  const settingsCols = db.prepare(`PRAGMA table_info(shop_settings)`).all() as Array<{ name: string }>;
  const settingsColNames = new Set(settingsCols.map((c) => c.name));
  if (!settingsColNames.has('logo_url')) {
    db.exec(`ALTER TABLE shop_settings ADD COLUMN logo_url TEXT DEFAULT '';`);
  }

  seedInitialData();
}

function seedInitialData() {
  const settingsCount = (db.prepare('SELECT COUNT(*) as c FROM shop_settings').get() as { c: number }).c;
  if (settingsCount === 0) {
    db.prepare(`INSERT INTO shop_settings (id) VALUES (1)`).run();
  }

  const catCount = (db.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c;
  if (catCount > 0) return;

  const insertCat = db.prepare(`INSERT INTO categories (name, name_bn, description) VALUES (?, ?, ?)`);
  const cMed = insertCat.run('Medicine & Tablets', 'ওষুধ ও ট্যাবলেট', 'Prescription & OTC tablets, capsules, and strips').lastInsertRowid as number;
  const cSyrup = insertCat.run('Syrups & Drops', 'সিরাপ ও ড্রপ', 'Oral solutions, pediatric drops, and elixirs').lastInsertRowid as number;
  const cDevice = insertCat.run('Medical Devices', 'মেডিকেল ডিভাইস', 'Thermometers, BP monitors, and diagnostics').lastInsertRowid as number;
  const cCare = insertCat.run('Personal & Skin Care', 'পার্সোনাল ও স্কিন কেয়ার', 'Moisturizers, vitamins, and daily wellness').lastInsertRowid as number;
  const cGrocery = insertCat.run('Daily Essentials', 'নিত্যপ্রয়োজনীয় পণ্য', 'Oral rehydration, hygiene, and retail essentials').lastInsertRowid as number;

  const insertProd = db.prepare(`
    INSERT INTO products (
      name, name_bn, sku, barcode, qr_code, category_id, subcategory, brand, manufacturer,
      generic_name, strength, dosage_form, package_size, unit, units_per_strip, strips_per_box,
      purchase_price, wholesale_price, retail_price, min_selling_price, vat_percent,
      image_url, show_online, online_price, description, min_stock_alert
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertBatch = db.prepare(`
    INSERT INTO product_batches (product_id, batch_number, mfg_date, expiry_date, quantity, purchase_price)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMove = db.prepare(`
    INSERT INTO stock_movements (product_id, batch_id, type, quantity_delta, previous_qty, new_qty, unit_cost, note)
    VALUES (?, ?, 'OPENING', ?, ?, ?, ?, 'Opening catalog stock')
  `);

  const today = new Date();
  const addDays = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const catalog = [
    {
      name: 'Napa Extra 500mg', name_bn: 'নাপা এক্সট্রা ৫০০ মি.গ্রা.', sku: 'MED-NAPA-500', barcode: '8941100500112',
      cat: cMed, sub: 'Analgesic', brand: 'Napa', mfg: 'Beximco Pharmaceuticals Ltd.',
      generic: 'Paracetamol + Caffeine', strength: '500mg + 65mg', dosage: 'Tablet', pkg: '10 Tabs / Strip',
      unit: 'Tablet', uStrip: 10, sBox: 10, buy: 1.8, whole: 2.1, retail: 2.5, minSell: 2.3, vat: 0,
      img: '', online: 1, onlinePrice: 25,
      desc: 'Fast-acting pain and fever relief tablets (10 tablet strip price online).', minAlert: 50,
      batches: [
        { b: 'NX2601A', mfg: addDays(-90), exp: addDays(340), qty: 320 },
        { b: 'NX2508B', mfg: addDays(-280), exp: addDays(45), qty: 60 },
      ],
    },
    {
      name: 'Sergel 20mg Capsule', name_bn: 'সার্জেল ২০ মি.গ্রা. ক্যাপসুল', sku: 'MED-SRG-020', barcode: '8941100200334',
      cat: cMed, sub: 'Gastro', brand: 'Sergel', mfg: 'Healthcare Pharmaceuticals Ltd.',
      generic: 'Esomeprazole', strength: '20mg', dosage: 'Capsule', pkg: '10 Caps / Strip',
      unit: 'Tablet', uStrip: 10, sBox: 10, buy: 5.2, whole: 6.0, retail: 7.0, minSell: 6.5, vat: 0,
      img: '', online: 1, onlinePrice: 70,
      desc: 'Proton pump inhibitor for acidity and gastric relief.', minAlert: 40,
      batches: [
        { b: 'SG2602', mfg: addDays(-60), exp: addDays(420), qty: 240 },
      ],
    },
    {
      name: 'Neuro-Rest Melatonin 5mg', name_bn: 'নিউরো-রেস্ট মেলাটোনিন ৫ মি.গ্রা.', sku: 'SUP-NEU-005', barcode: '8941100991102',
      cat: cMed, sub: 'Sleep Support', brand: 'MediCare', mfg: 'MediCare Pharmaceuticals',
      generic: 'Melatonin', strength: '5mg', dosage: 'Film-Coated Tablet', pkg: '30 Tabs / Box',
      unit: 'Box', uStrip: 10, sBox: 3, buy: 340, whole: 390, retail: 450, minSell: 410, vat: 5,
      img: '', online: 1, onlinePrice: 430,
      desc: 'Sleep and relaxation supplement, 30 film-coated tablets.', minAlert: 10,
      batches: [
        { b: 'NR23B10', mfg: addDays(-120), exp: addDays(25), qty: 18 },
      ],
    },
    {
      name: 'Vita-C+ Immune Complex (60 Caps)', name_bn: 'ভিটা-সি প্লাস কমপ্লেক্স', sku: 'VIT-VITC-060', barcode: '8942200112233',
      cat: cCare, sub: 'Vitamins', brand: 'Lumen', mfg: 'Lumen Wellness Labs',
      generic: 'Ascorbic Acid + Zinc', strength: '1000mg', dosage: 'Capsule', pkg: '60 Capsules Bottle',
      unit: 'Bottle', uStrip: 1, sBox: 1, buy: 520, whole: 610, retail: 750, minSell: 680, vat: 5,
      img: '', online: 1, onlinePrice: 720,
      desc: 'Daily Vitamin C + Zinc immune support and skin health supplement.', minAlert: 8,
      batches: [
        { b: 'LM26C04', mfg: addDays(-45), exp: addDays(520), qty: 34 },
      ],
    },
    {
      name: 'Radiance Ceramide Moisturizer 100ml', name_bn: 'রেডিয়েন্স ময়েশ্চারাইজার ১০০ মি.লি.', sku: 'SKN-RAD-100', barcode: '8942200445566',
      cat: cCare, sub: 'Skincare', brand: 'Lumen', mfg: 'Lumen Derma Care',
      generic: 'Hyaluronic Acid + Ceramides', strength: '100ml', dosage: 'Lotion', pkg: '100ml Pump Bottle',
      unit: 'Bottle', uStrip: 1, sBox: 1, buy: 680, whole: 790, retail: 950, minSell: 880, vat: 5,
      img: '', online: 1, onlinePrice: 920,
      desc: 'Deep hydration daily barrier moisturizer with hyaluronic acid & ceramides.', minAlert: 10,
      batches: [
        { b: 'LM26M09', mfg: addDays(-30), exp: addDays(600), qty: 22 },
      ],
    },
    {
      name: 'Aurora Restorative Elixir 100ml', name_bn: 'অরোরা রেস্টোরেটিভ সিরাপ ১০০ মি.লি.', sku: 'SYR-AUR-100', barcode: '8943300778899',
      cat: cSyrup, sub: 'Herbal Cough & Immunity', brand: 'Aurora Pharma', mfg: 'Aurora Apothecary',
      generic: 'Herbal Mucilage Extract', strength: '100ml', dosage: 'Syrup', pkg: '100ml Amber Bottle',
      unit: 'Bottle', uStrip: 1, sBox: 1, buy: 145, whole: 170, retail: 210, minSell: 190, vat: 0,
      img: '', online: 1, onlinePrice: 210,
      desc: 'Soothing oral solution for throat comfort and daily recovery.', minAlert: 15,
      batches: [
        { b: '231105A', mfg: addDays(-200), exp: addDays(180), qty: 6 },
      ],
    },
    {
      name: 'Digital Blood Pressure Monitor', name_bn: 'ডিজিটাল ব্লাড প্রেসার মনিটর', sku: 'DEV-BPM-101', barcode: '8944400101010',
      cat: cDevice, sub: 'Diagnostics', brand: 'Omron', mfg: 'Omron Healthcare',
      generic: 'Upper Arm BP Monitor', strength: 'Automatic', dosage: 'Device', pkg: '1 Unit Box',
      unit: 'Piece', uStrip: 1, sBox: 1, buy: 2450, whole: 2750, retail: 3200, minSell: 2950, vat: 5,
      img: '', online: 1, onlinePrice: 3150,
      desc: 'Clinical-grade automatic upper arm blood pressure & pulse monitor.', minAlert: 4,
      batches: [
        { b: 'OM26-881', mfg: addDays(-100), exp: '', qty: 9 },
      ],
    },
    {
      name: 'SMC ORSaline-N (Pack of 10)', name_bn: 'এসএমসি ওরস্যালাইন-এন', sku: 'ESS-ORS-010', barcode: '8941122334455',
      cat: cGrocery, sub: 'Hydration', brand: 'SMC', mfg: 'SMC Enterprise Ltd.',
      generic: 'Oral Rehydration Salts', strength: '10.25g', dosage: 'Powder Sachet', pkg: '10 Sachets',
      unit: 'Piece', uStrip: 1, sBox: 25, buy: 4.5, whole: 5.0, retail: 6.0, minSell: 5.5, vat: 0,
      img: '', online: 1, onlinePrice: 60,
      desc: 'Essential WHO-formula oral rehydration saline.', minAlert: 40,
      batches: [
        { b: 'SMC2601', mfg: addDays(-50), exp: addDays(380), qty: 180 },
        { b: 'SMC2401', mfg: addDays(-400), exp: addDays(-5), qty: 12 },
      ],
    },
  ];

  for (const item of catalog) {
    const res = insertProd.run(
      item.name, item.name_bn, item.sku, item.barcode, item.sku,
      item.cat, item.sub, item.brand, item.mfg,
      item.generic, item.strength, item.dosage, item.pkg,
      item.unit, item.uStrip, item.sBox,
      item.buy, item.whole, item.retail, item.minSell, item.vat,
      item.img, item.online, item.onlinePrice, item.desc, item.minAlert
    );
    const pid = res.lastInsertRowid as number;
    let running = 0;
    for (const b of item.batches) {
      const bRes = insertBatch.run(pid, b.b, b.mfg, b.exp, b.qty, item.buy);
      const bid = bRes.lastInsertRowid as number;
      insertMove.run(pid, bid, b.qty, running, running + b.qty, item.buy);
      running += b.qty;
    }
  }

  // Seed suppliers
  const insSup = db.prepare(`INSERT INTO suppliers (name, phone, company, address, total_due) VALUES (?, ?, ?, ?, ?)`);
  const sup1 = insSup.run('Kamrul Hasan', '+8801712345678', 'Beximco Pharma Depot', 'Tejgaon Industrial Area, Dhaka', 4500).lastInsertRowid as number;
  insSup.run('Tariqul Islam', '+8801819876543', 'Lumen Wellness Distribution', 'Banani, Dhaka', 0);

  // Seed customers
  const insCust = db.prepare(`
    INSERT INTO customers (code, name, phone, email, address, consent_sms, consent_whatsapp, total_purchases, total_payments, current_due)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const cust1 = insCust.run('CUST-1001', 'Rafiqul Islam', '+8801711223344', 'rafiq@example.com', 'Road 4, Dhanmondi, Dhaka', 1, 1, 2450, 1800, 650).lastInsertRowid as number;
  insCust.run('CUST-1002', 'Nusrat Jahan', '+8801911556677', 'nusrat@example.com', 'Mirpur 10, Dhaka', 1, 1, 1670, 1670, 0);

  // Seed coupons
  db.prepare(`INSERT INTO coupons (code, discount_type, value, min_order, active, expires_at) VALUES (?, ?, ?, ?, 1, ?)`).run(
    'WELCOME10', 'PERCENT', 10, 300, addDays(180)
  );
  db.prepare(`INSERT INTO coupons (code, discount_type, value, min_order, active, expires_at) VALUES (?, ?, ?, ?, 1, ?)`).run(
    'HEALTH50', 'FIXED', 50, 500, addDays(90)
  );

  // Seed 2 initial sales and 1 expense so dashboard charts & reports reflect real database records immediately
  const insSale = db.prepare(`
    INSERT INTO sales (
      client_tx_id, invoice_no, customer_id, customer_name, customer_phone, sale_type, status,
      subtotal, discount_type, discount_value, discount_amount, vat_amount, total, paid_amount, due_amount,
      payment_method, notes
    ) VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, 'FIXED', 0, 0, ?, ?, ?, ?, ?, ?)
  `);
  const s1 = insSale.run('seed-sale-1', 'INV-2026-0001', cust1, 'Rafiqul Islam', '+8801711223344', 'POS', 1450, 45, 1495, 845, 650, 'CASH', 'Partial due recorded').lastInsertRowid as number;
  db.prepare(`
    INSERT INTO sale_items (sale_id, product_id, product_name, unit, unit_multiplier, quantity, unit_price, cost_price, line_total)
    VALUES (?, 4, 'Vita-C+ Immune Complex (60 Caps)', 'Bottle', 1, 1, 750, 520, 750),
           (?, 2, 'Sergel 20mg Capsule', 'Tablet', 1, 100, 7, 5.2, 700)
  `).run(s1, s1);

  const s2 = insSale.run('seed-sale-2', 'INV-2026-0002', null, 'Walk-in Customer', '', 'POS', 950, 47.5, 997.5, 997.5, 0, 'MOBILE_BANKING', 'bKash payment').lastInsertRowid as number;
  db.prepare(`
    INSERT INTO sale_items (sale_id, product_id, product_name, unit, unit_multiplier, quantity, unit_price, cost_price, line_total)
    VALUES (?, 5, 'Radiance Ceramide Moisturizer 100ml', 'Bottle', 1, 1, 950, 680, 950)
  `).run(s2);

  // Seed initial purchase
  const p1 = db.prepare(`
    INSERT INTO purchases (invoice_no, supplier_id, subtotal, additional_charges, total, paid_amount, due_amount, note)
    VALUES ('PUR-2026-0001', ?, 12000, 250, 12250, 7750, 4500, 'Monthly pharma restock')
  `).run(sup1).lastInsertRowid as number;
  db.prepare(`
    INSERT INTO purchase_items (purchase_id, product_id, batch_number, expiry_date, quantity, unit_cost, line_total)
    VALUES (?, 1, 'NX2601A', ?, 320, 1.8, 576)
  `).run(p1, addDays(340));

  // Seed initial expense
  db.prepare(`INSERT INTO expenses (client_tx_id, title, category, amount, payment_method, note) VALUES ('seed-exp-1', 'Store Electricity & AC', 'Utilities', 420, 'CASH', 'Daily utility share')`).run();

  // Seed product review
  db.prepare(`INSERT INTO product_reviews (product_id, customer_name, rating, comment) VALUES (4, 'Nusrat Jahan', 5, 'Authentic sealed bottle and super fast delivery in Dhaka.')`).run();
}

export function cleanupBrokenLocalImagePaths() {
  const rows = db
    .prepare(`SELECT id, image_url FROM products WHERE image_url LIKE '/src/assets/images/%'`)
    .all() as Array<{ id: number; image_url: string }>;
  const clearStmt = db.prepare(`UPDATE products SET image_url = '' WHERE id = ?`);
  for (const r of rows) {
    const abs = path.resolve(process.cwd(), r.image_url.replace(/^\//, ''));
    let valid = false;
    try {
      const st = fs.statSync(abs);
      valid = st.isFile() && st.size > 0;
    } catch {
      valid = false;
    }
    if (!valid) {
      clearStmt.run(r.id);
    }
  }
}
