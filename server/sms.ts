import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { db, defaultDbDir, updateEnvFile } from './db.ts';

export type SmsProviderType =
  | 'SSLWIRELESS'
  | 'BULKSMSBD'
  | 'GREENWEB'
  | 'ALPHASMS'
  | 'TWILIO'
  | 'CUSTOM';

export interface SmsGatewayRow {
  id: number;
  name: string;
  provider: SmsProviderType;
  base_url: string;
  balance_url: string;
  http_method: 'POST' | 'GET';
  payload_format: 'JSON' | 'FORM' | 'QUERY';
  sender_id: string;
  api_key_enc: string;
  api_secret_enc: string;
  key_hint: string;
  to_param: string;
  message_param: string;
  sender_param: string;
  api_key_param: string;
  extra_params_json: string;
  custom_headers_json: string;
  batch_delay_ms: number;
  is_default: number;
  active: number;
  last_tested_at: string;
  last_test_status: string;
  created_at: string;
}

export const SMS_PROVIDER_PRESETS = [
  {
    provider: 'SSLWIRELESS' as SmsProviderType,
    label: 'SSLWireless (Bangladesh)',
    label_bn: 'SSLWireless (বাংলাদেশ)',
    base_url: 'https://smsplus.sslwireless.com/api/v3/send-sms',
    balance_url: '',
    http_method: 'POST' as const,
    payload_format: 'JSON' as const,
    to_param: 'msisdn',
    message_param: 'sms',
    sender_param: 'sid',
    api_key_param: 'api_token',
    extra_params_json: '{}',
    notes: 'Requires SSLWireless API Token, SID (Masking/Non-Masking), and approved DLT/BTRC template.',
    notes_bn: 'SSLWireless API Token এবং অনুমোদিত SID (Masking/Non-Masking) প্রয়োজন।',
  },
  {
    provider: 'BULKSMSBD' as SmsProviderType,
    label: 'BulkSMSBD',
    label_bn: 'BulkSMSBD (বাংলাদেশ)',
    base_url: 'https://bulksmsbd.net/api/smsapi',
    balance_url: 'https://bulksmsbd.net/api/getBalanceApi',
    http_method: 'POST' as const,
    payload_format: 'FORM' as const,
    to_param: 'number',
    message_param: 'message',
    sender_param: 'senderid',
    api_key_param: 'api_key',
    extra_params_json: '{"type":"text"}',
    notes: 'Supports English & Bangla Unicode SMS and live balance checks via BulkSMSBD API Key & Sender ID.',
    notes_bn: 'BulkSMSBD API Key ও Sender ID দিয়ে ইংরেজি ও বাংলা Unicode SMS এবং ব্যালেন্স চেক করা যায়।',
  },
  {
    provider: 'GREENWEB' as SmsProviderType,
    label: 'GreenWeb BD',
    label_bn: 'GreenWeb BD (বাংলাদেশ)',
    base_url: 'https://api.greenweb.com.bd/api.php',
    balance_url: 'https://api.greenweb.com.bd/g_api.php',
    http_method: 'POST' as const,
    payload_format: 'FORM' as const,
    to_param: 'to',
    message_param: 'message',
    sender_param: '',
    api_key_param: 'token',
    extra_params_json: '{}',
    notes: 'Enter your GreenWeb BD API Token. Sender ID is optional depending on your GreenWeb account.',
    notes_bn: 'আপনার GreenWeb BD Token দিন; অ্যাকাউন্ট অনুযায়ী Sender ID ঐচ্ছিক।',
  },
  {
    provider: 'ALPHASMS' as SmsProviderType,
    label: 'Alpha SMS (sms.net.bd)',
    label_bn: 'Alpha SMS (sms.net.bd)',
    base_url: 'https://api.sms.net.bd/sendsms',
    balance_url: 'https://api.sms.net.bd/user/balance/',
    http_method: 'POST' as const,
    payload_format: 'FORM' as const,
    to_param: 'to',
    message_param: 'msg',
    sender_param: 'sender_id',
    api_key_param: 'api_key',
    extra_params_json: '{}',
    notes: 'Supports Alpha SMS API key with optional masking sender_id.',
    notes_bn: 'Alpha SMS API Key এবং ঐচ্ছিক Masking sender_id সাপোর্ট করে।',
  },
  {
    provider: 'TWILIO' as SmsProviderType,
    label: 'Twilio Programmable SMS',
    label_bn: 'Twilio গ্লোবাল SMS',
    base_url: 'https://api.twilio.com/2010-04-01/Accounts/YOUR_ACCOUNT_SID/Messages.json',
    balance_url: '',
    http_method: 'POST' as const,
    payload_format: 'FORM' as const,
    to_param: 'To',
    message_param: 'Body',
    sender_param: 'From',
    api_key_param: 'AuthToken',
    extra_params_json: '{}',
    notes: 'Replace YOUR_ACCOUNT_SID in URL, put Account SID in API Secret, Auth Token in API Key, and Twilio phone in Sender ID.',
    notes_bn: 'URL-এ Account SID বসান, API Secret-এ Account SID এবং API Key-তে Auth Token দিন।',
  },
  {
    provider: 'CUSTOM' as SmsProviderType,
    label: 'Custom HTTPS REST / Webhook Gateway',
    label_bn: 'কাস্টম HTTPS REST গেটওয়ে',
    base_url: 'https://api.example-sms-provider.com/v1/send',
    balance_url: '',
    http_method: 'POST' as const,
    payload_format: 'JSON' as const,
    to_param: 'to',
    message_param: 'message',
    sender_param: 'sender_id',
    api_key_param: 'api_key',
    extra_params_json: '{}',
    notes: 'Connect any HTTPS SMS API using JSON, Form-URL-Encoded, or Query params plus optional Bearer headers.',
    notes_bn: 'যেকোনো HTTPS SMS API-এর JSON, Form বা Query প্যারামিটার কনফিগার করে যুক্ত করুন।',
  },
];

let cachedMasterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const envKey = process.env.SMS_ENCRYPTION_KEY?.trim() || process.env.SESSION_SECRET?.trim();
  if (envKey && envKey.length >= 16) {
    cachedMasterKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedMasterKey;
  }
  const existing = db
    .prepare(`SELECT key_value FROM internal_keys WHERE key_name = 'sms_master_key'`)
    .get() as { key_value: string } | undefined;
  if (existing?.key_value) {
    cachedMasterKey = Buffer.from(existing.key_value, 'hex');
    return cachedMasterKey;
  }
  const generated = crypto.randomBytes(32);
  db.prepare(`INSERT OR IGNORE INTO internal_keys (key_name, key_value) VALUES ('sms_master_key', ?)`).run(
    generated.toString('hex')
  );
  const row = db
    .prepare(`SELECT key_value FROM internal_keys WHERE key_name = 'sms_master_key'`)
    .get() as { key_value: string };
  cachedMasterKey = Buffer.from(row.key_value, 'hex');
  return cachedMasterKey;
}

export function encryptSecret(plaintext: string): string {
  const clean = plaintext.trim();
  if (!clean) return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3) return '';
  try {
    const [ivHex, tagHex, dataHex] = parts;
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return '';
  }
}

export function maskSecretHint(secret: string): string {
  const s = secret.trim();
  if (!s) return '';
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

export function saveSmsGatewaysBackup(): void {
  try {
    const gateways = db.prepare(`SELECT * FROM sms_gateways`).all() as unknown as SmsGatewayRow[];
    const backupList = gateways.map((g) => {
      const apiKey = decryptSecret(g.api_key_enc);
      const apiSecret = decryptSecret(g.api_secret_enc);
      return {
        ...g,
        api_key: apiKey,
        api_secret: apiSecret,
      };
    });
    const jsonStr = JSON.stringify(backupList, null, 2);
    try {
      fs.writeFileSync(path.resolve(defaultDbDir, 'saved_sms_gateways.json'), jsonStr, 'utf-8');
    } catch {}
    try {
      fs.writeFileSync(path.resolve(process.cwd(), 'saved_sms_gateways.json'), jsonStr, 'utf-8');
    } catch {}
    try {
      db.prepare(`
        INSERT INTO internal_keys (key_name, key_value) VALUES ('saved_sms_gateways', ?)
        ON CONFLICT(key_name) DO UPDATE SET key_value = excluded.key_value, created_at = datetime('now')
      `).run(jsonStr);
    } catch {}

    // Update .env with active/default gateway keys if present
    const defaultGw = gateways.find((g) => g.is_default && g.active) || gateways[0];
    if (defaultGw) {
      const apiKey = decryptSecret(defaultGw.api_key_enc);
      const updates: Record<string, string> = {};
      if (apiKey) updates.SMS_GATEWAY_API_KEY = apiKey;
      if (defaultGw.sender_id) updates.SMS_GATEWAY_SENDER_ID = defaultGw.sender_id;
      if (Object.keys(updates).length > 0) {
        updateEnvFile(updates);
      }
    }
  } catch (err) {
    console.warn('Error saving SMS gateways backup:', (err as Error).message);
  }
}

export function initPermanentSmsGateways(): void {
  try {
    const existingCount = (db.prepare(`SELECT COUNT(*) as c FROM sms_gateways`).get() as { c: number }).c;
    let restored = false;

    if (existingCount === 0) {
      // 1. Check file backup
      for (const p of [path.resolve(defaultDbDir, 'saved_sms_gateways.json'), path.resolve(process.cwd(), 'saved_sms_gateways.json')]) {
        if (fs.existsSync(p)) {
          try {
            const list = JSON.parse(fs.readFileSync(p, 'utf-8')) as Array<Record<string, unknown>>;
            if (Array.isArray(list) && list.length > 0) {
              for (const gw of list) {
                const apiKey = String(gw.api_key || '');
                const apiSecret = String(gw.api_secret || '');
                db.prepare(`
                  INSERT INTO sms_gateways (
                    name, provider, base_url, balance_url, http_method, payload_format,
                    sender_id, api_key_enc, api_secret_enc, key_hint,
                    to_param, message_param, sender_param, api_key_param,
                    extra_params_json, custom_headers_json, batch_delay_ms, is_default, active, last_test_status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
                `).run(
                  String(gw.name || 'BulkSMSBD Primary'),
                  String(gw.provider || 'BULKSMSBD'),
                  String(gw.base_url || 'https://bulksmsbd.net/api/smsapi'),
                  String(gw.balance_url || 'https://bulksmsbd.net/api/getBalanceApi'),
                  String(gw.http_method || 'POST'),
                  String(gw.payload_format || 'FORM'),
                  String(gw.sender_id || '').trim(),
                  gw.api_key_enc ? String(gw.api_key_enc) : encryptSecret(apiKey),
                  gw.api_secret_enc ? String(gw.api_secret_enc) : encryptSecret(apiSecret),
                  gw.key_hint ? String(gw.key_hint) : maskSecretHint(apiKey),
                  String(gw.to_param || 'number'),
                  String(gw.message_param || 'message'),
                  String(gw.sender_param || 'senderid'),
                  String(gw.api_key_param || 'api_key'),
                  String(gw.extra_params_json || '{"type":"text"}'),
                  String(gw.custom_headers_json || '{}'),
                  Number(gw.batch_delay_ms || 150),
                  1,
                  1
                );
              }
              restored = true;
              break;
            }
          } catch {}
        }
      }

      // 2. Check internal_keys
      if (!restored) {
        try {
          const keyRow = db.prepare(`SELECT key_value FROM internal_keys WHERE key_name = 'saved_sms_gateways'`).get() as { key_value: string } | undefined;
          if (keyRow?.key_value) {
            const list = JSON.parse(keyRow.key_value) as Array<Record<string, unknown>>;
            if (Array.isArray(list) && list.length > 0) {
              for (const gw of list) {
                const apiKey = String(gw.api_key || '');
                db.prepare(`
                  INSERT INTO sms_gateways (
                    name, provider, base_url, balance_url, http_method, payload_format,
                    sender_id, api_key_enc, api_secret_enc, key_hint,
                    to_param, message_param, sender_param, api_key_param,
                    extra_params_json, custom_headers_json, batch_delay_ms, is_default, active, last_test_status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
                `).run(
                  String(gw.name || 'BulkSMSBD Primary'),
                  String(gw.provider || 'BULKSMSBD'),
                  String(gw.base_url || 'https://bulksmsbd.net/api/smsapi'),
                  String(gw.balance_url || 'https://bulksmsbd.net/api/getBalanceApi'),
                  String(gw.http_method || 'POST'),
                  String(gw.payload_format || 'FORM'),
                  String(gw.sender_id || '').trim(),
                  gw.api_key_enc ? String(gw.api_key_enc) : encryptSecret(apiKey),
                  gw.api_secret_enc ? String(gw.api_secret_enc) : '',
                  gw.key_hint ? String(gw.key_hint) : maskSecretHint(apiKey),
                  String(gw.to_param || 'number'),
                  String(gw.message_param || 'message'),
                  String(gw.sender_param || 'senderid'),
                  String(gw.api_key_param || 'api_key'),
                  String(gw.extra_params_json || '{"type":"text"}'),
                  String(gw.custom_headers_json || '{}'),
                  Number(gw.batch_delay_ms || 150),
                  1,
                  1
                );
              }
              restored = true;
            }
          }
        } catch {}
      }

      // 3. Fallback: seed permanent default BulkSMSBD gateway (active = 1, is_default = 1)
      if (!restored) {
        const envApiKey = process.env.SMS_GATEWAY_API_KEY?.trim() || '';
        const envSenderId = process.env.SMS_GATEWAY_SENDER_ID?.trim() || '';
        db.prepare(`
          INSERT INTO sms_gateways (
            name, provider, base_url, balance_url, http_method, payload_format,
            sender_id, api_key_enc, api_secret_enc, key_hint,
            to_param, message_param, sender_param, api_key_param,
            extra_params_json, custom_headers_json, batch_delay_ms, is_default, active, last_test_status
          ) VALUES (?, 'BULKSMSBD', 'https://bulksmsbd.net/api/smsapi', 'https://bulksmsbd.net/api/getBalanceApi', 'POST', 'FORM', ?, ?, '', ?, 'number', 'message', 'senderid', 'api_key', '{"type":"text"}', '{}', 150, 1, 1, 'ACTIVE')
        `).run(
          'BulkSMSBD Primary',
          envSenderId,
          encryptSecret(envApiKey),
          maskSecretHint(envApiKey)
        );
      }
    }

    // Always ensure at least one gateway is active and default
    db.exec(`UPDATE sms_gateways SET active = 1 WHERE is_default = 1;`);
    const activeCount = (db.prepare(`SELECT COUNT(*) as c FROM sms_gateways WHERE active = 1`).get() as { c: number }).c;
    if (activeCount === 0) {
      db.exec(`UPDATE sms_gateways SET active = 1, is_default = 1 WHERE id = (SELECT id FROM sms_gateways ORDER BY id ASC LIMIT 1);`);
    }
  } catch (err) {
    console.warn('Error in initPermanentSmsGateways:', (err as Error).message);
  }
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const norm = ip.toLowerCase();
    if (norm === '::' || norm === '::1') return true;
    if (norm.startsWith('fc') || norm.startsWith('fd') || norm.startsWith('fe80')) return true;
    if (norm.startsWith('::ffff:')) {
      return isPrivateOrReservedIp(norm.slice(7));
    }
    return false;
  }
  return true;
}

export async function assertSafeGatewayUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid SMS gateway URL format.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('SMS gateway URL must use HTTPS.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('Local or internal gateway hostnames are not permitted.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private or loopback IP addresses are not permitted.');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (!records.length) {
      throw new Error('Gateway hostname could not be resolved.');
    }
    for (const r of records) {
      if (isPrivateOrReservedIp(r.address)) {
        throw new Error('Gateway hostname resolves to a restricted private IP address.');
      }
    }
  } catch (err) {
    if ((err as Error).message.includes('restricted') || (err as Error).message.includes('resolved')) {
      throw err;
    }
    throw new Error(`Unable to verify gateway hostname DNS (${host}).`);
  }

  return parsed;
}

export function normalizePhoneNumber(raw: string): {
  valid: boolean;
  digits: string;
  e164: string;
} {
  const cleaned = String(raw || '').replace(/[\s\-().]/g, '');
  if (!cleaned) return { valid: false, digits: '', e164: '' };
  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!/^\d+$/.test(digits)) return { valid: false, digits: '', e164: '' };

  // Normalize Bangladesh mobile numbers: 01XXXXXXXXX -> 8801XXXXXXXXX
  if (/^01[3-9]\d{8}$/.test(digits)) {
    digits = `88${digits}`;
  } else if (/^1[3-9]\d{8}$/.test(digits)) {
    digits = `880${digits}`;
  }

  if (digits.length < 10 || digits.length > 15) {
    return { valid: false, digits, e164: `+${digits}` };
  }

  return { valid: true, digits, e164: `+${digits}` };
}

export function calculateSmsParts(message: string): {
  length: number;
  isUnicode: boolean;
  parts: number;
} {
  const text = String(message || '');
  const isUnicode = /[^\u0000-\u007F]/.test(text);
  const length = text.length;
  if (length === 0) return { length: 0, isUnicode, parts: 0 };
  if (isUnicode) {
    const parts = length <= 70 ? 1 : Math.ceil(length / 67);
    return { length, isUnicode: true, parts };
  }
  const parts = length <= 160 ? 1 : Math.ceil(length / 153);
  return { length, isUnicode: false, parts };
}

export function renderSmsTemplate(
  template: string,
  vars: { name?: string; due?: number; phone?: string; shop?: string }
): string {
  const dueStr = Number(vars.due || 0).toLocaleString('en-BD', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, vars.name || 'Customer')
    .replace(/\{\{\s*due\s*\}\}/gi, `৳${dueStr}`)
    .replace(/\{\{\s*phone\s*\}\}/gi, vars.phone || '')
    .replace(/\{\{\s*shop\s*\}\}/gi, vars.shop || 'ইসলাম মেডিকেল এন্ড ই-সেন্টার');
}

function safeParseJsonObj(raw: string): Record<string, string> {
  try {
    const obj = JSON.parse(raw || '{}');
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k && v !== undefined && v !== null) out[k] = String(v);
      }
      return out;
    }
  } catch {
    // ignore malformed json
  }
  return {};
}

function sanitizeGatewayError(msg: string, secretValues: string[]): string {
  let out = msg || 'Gateway request failed';
  for (const s of secretValues) {
    if (s && s.length >= 4) {
      out = out.split(s).join('[REDACTED]');
    }
  }
  return out.slice(0, 260);
}

export async function dispatchSmsViaGateway(
  gateway: SmsGatewayRow,
  recipientPhone: string,
  message: string
): Promise<{ ok: boolean; providerRef: string; error?: string; rawSummary?: string }> {
  const norm = normalizePhoneNumber(recipientPhone);
  if (!norm.valid) {
    return { ok: false, providerRef: '', error: `Invalid mobile number: ${recipientPhone}` };
  }

  const apiKey = decryptSecret(gateway.api_key_enc) || process.env.SMS_GATEWAY_API_KEY?.trim() || '';
  const apiSecret = decryptSecret(gateway.api_secret_enc);
  if (!apiKey) {
    return { ok: false, providerRef: '', error: 'Gateway API key is missing. Update gateway credentials.' };
  }

  const targetUrl = await assertSafeGatewayUrl(gateway.base_url);
  const { isUnicode } = calculateSmsParts(message);
  const extraParams = safeParseJsonObj(gateway.extra_params_json);
  const customHeaders = safeParseJsonObj(gateway.custom_headers_json);

  const headers: Record<string, string> = {};
  for (const [hk, hv] of Object.entries(customHeaders)) {
    headers[hk] = hv.replace(/\{\{\s*api_key\s*\}\}/gi, apiKey).replace(/\{\{\s*api_secret\s*\}\}/gi, apiSecret);
  }

  let fetchUrl = targetUrl.toString();
  let body: string | undefined;

  if (gateway.provider === 'TWILIO') {
    const authToken = apiKey;
    const sid = apiSecret || gateway.sender_id;
    headers['Authorization'] = `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const form = new URLSearchParams({
      [gateway.to_param || 'To']: norm.e164,
      [gateway.sender_param || 'From']: gateway.sender_id,
      [gateway.message_param || 'Body']: message,
      ...extraParams,
    });
    body = form.toString();
  } else if (gateway.provider === 'SSLWIRELESS') {
    headers['Content-Type'] = 'application/json';
    const payload: Record<string, unknown> = {
      ...extraParams,
      [gateway.api_key_param || 'api_token']: apiKey,
      [gateway.sender_param || 'sid']: gateway.sender_id,
      [gateway.to_param || 'msisdn']: norm.digits,
      [gateway.message_param || 'sms']: message,
      csms_id: `AP${Date.now()}${Math.floor(100 + Math.random() * 900)}`,
    };
    body = JSON.stringify(payload);
  } else {
    const params: Record<string, string> = { ...extraParams };
    if (gateway.api_key_param) params[gateway.api_key_param] = apiKey;
    if (gateway.sender_param && gateway.sender_id) params[gateway.sender_param] = gateway.sender_id;
    if (gateway.provider === 'BULKSMSBD') {
      params.type = isUnicode ? 'unicode' : 'text';
    }
    params[gateway.to_param || 'to'] = gateway.provider === 'GREENWEB' ? norm.e164 : norm.digits;
    params[gateway.message_param || 'message'] = message;

    if (gateway.http_method === 'GET' || gateway.payload_format === 'QUERY') {
      const u = new URL(fetchUrl);
      for (const [pk, pv] of Object.entries(params)) {
        u.searchParams.set(pk, pv);
      }
      fetchUrl = u.toString();
    } else if (gateway.payload_format === 'FORM') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(params).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(params);
    }
  }

  try {
    const resp = await fetch(fetchUrl, {
      method: gateway.http_method === 'GET' ? 'GET' : 'POST',
      headers,
      body: gateway.http_method === 'GET' ? undefined : body,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });

    const rawText = await resp.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    if (!resp.ok) {
      const errDetail = parsed?.error_message || parsed?.message || parsed?.error || rawText || `HTTP ${resp.status}`;
      return {
        ok: false,
        providerRef: '',
        error: sanitizeGatewayError(String(errDetail), [apiKey, apiSecret]),
      };
    }

    // Provider-specific body validation (many BD gateways return HTTP 200 with an error JSON or string)
    if (parsed) {
      const code = Number(parsed.response_code ?? parsed.status_code ?? 0);
      const st = String(parsed.status ?? '').toUpperCase();
      if (
        (code && code >= 400) ||
        st === 'FAILED' ||
        st === 'ERROR' ||
        parsed.error === true
      ) {
        const errMsg = parsed.error_message || parsed.message || parsed.status || rawText;
        return {
          ok: false,
          providerRef: '',
          error: sanitizeGatewayError(String(errMsg), [apiKey, apiSecret]),
        };
      }
      const smsInfo = Array.isArray(parsed.smsinfo) ? (parsed.smsinfo as Array<Record<string, unknown>>) : undefined;
      const ref = String(
        parsed.sid || parsed.message_id || smsInfo?.[0]?.sms_status || parsed.csms_id || parsed.trxn_id || 'OK'
      );
      return { ok: true, providerRef: ref.slice(0, 80), rawSummary: rawText.slice(0, 140) };
    }

    if (/^error:/i.test(rawText.trim()) || /invalid/i.test(rawText.trim())) {
      return {
        ok: false,
        providerRef: '',
        error: sanitizeGatewayError(rawText, [apiKey, apiSecret]),
      };
    }

    return { ok: true, providerRef: rawText.trim().slice(0, 60) || 'OK', rawSummary: rawText.slice(0, 140) };
  } catch (err) {
    return {
      ok: false,
      providerRef: '',
      error: sanitizeGatewayError((err as Error).message, [apiKey, apiSecret]),
    };
  }
}

export async function checkGatewayBalance(gateway: SmsGatewayRow): Promise<{ ok: boolean; balanceText: string }> {
  if (!gateway.balance_url) {
    return { ok: false, balanceText: 'No balance endpoint URL configured for this gateway.' };
  }
  const apiKey = decryptSecret(gateway.api_key_enc) || process.env.SMS_GATEWAY_API_KEY?.trim() || '';
  if (!apiKey) {
    return { ok: false, balanceText: 'Gateway API key is missing.' };
  }
  const safeUrl = await assertSafeGatewayUrl(gateway.balance_url);
  if (gateway.provider === 'GREENWEB') {
    safeUrl.searchParams.set('token', apiKey);
    safeUrl.searchParams.set('balance', '');
  } else {
    safeUrl.searchParams.set(gateway.api_key_param || 'api_key', apiKey);
  }

  const resp = await fetch(safeUrl.toString(), {
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  const text = await resp.text();
  if (!resp.ok) {
    return { ok: false, balanceText: sanitizeGatewayError(`HTTP ${resp.status}: ${text}`, [apiKey]) };
  }
  return { ok: true, balanceText: sanitizeGatewayError(text.trim(), [apiKey]).slice(0, 180) };
}
