import React, { useEffect, useState } from 'react';
import { Cloud, Database, Download, Image, MessageSquare, RefreshCw, Shield, Trash2, Upload, WifiOff } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { getPendingQueue } from '../lib/offlineDb';
import type { Lang } from '../i18n';
import type { AuthUser, OfflineOperation, ShopSettings, SyncLog, UserRole } from '../types';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { GoogleSheetsPanel } from '../components/GoogleSheetsPanel';

interface AdminSyncViewProps {
  mode: 'sync' | 'users' | 'settings';
  lang: Lang;
  isOnline: boolean;
  user: AuthUser;
  settings: ShopSettings | null;
  onSyncNow: () => Promise<void>;
  onRefreshSettings: () => Promise<void>;
  onOpenMessaging?: () => void;
}

export const AdminSyncView: React.FC<AdminSyncViewProps> = ({
  mode,
  lang,
  isOnline,
  user,
  settings,
  onSyncNow,
  onRefreshSettings,
  onOpenMessaging,
}) => {
  const [queue, setQueue] = useState<OfflineOperation[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [usersList, setUsersList] = useState<Array<Record<string, unknown>>>([]);
  const [rolePerms, setRolePerms] = useState<Record<string, string[]>>({});
  const [auditLogs, setAuditLogs] = useState<Array<Record<string, unknown>>>([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Cashier' as UserRole, password: '' });
  const [shopForm, setShopForm] = useState<ShopSettings | null>(settings);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    setShopForm(settings);
  }, [settings]);

  const loadSyncData = async () => {
    const q = await getPendingQueue();
    setQueue(q);
    if (isOnline) {
      try {
        const logs = await apiFetch<SyncLog[]>('/api/sync/logs');
        setSyncLogs(logs);
      } catch {
        // ignore
      }
    }
  };

  const loadUsersAudit = async () => {
    try {
      const [uRes, aRes] = await Promise.all([
        apiFetch<{ users: Array<Record<string, unknown>>; rolePermissions: Record<string, string[]> }>('/api/users'),
        apiFetch<Array<Record<string, unknown>>>('/api/audit-logs'),
      ]);
      setUsersList(uRes.users);
      setRolePerms(uRes.rolePermissions);
      setAuditLogs(aRes);
    } catch (err) {
      setStatusMsg((err as Error).message);
    }
  };

  useEffect(() => {
    if (mode === 'sync') loadSyncData();
    if (mode === 'users') loadUsersAudit();
  }, [mode, isOnline]);

  if (mode === 'sync') {
    return (
      <div className="space-y-5">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {isOnline ? <Cloud className="w-6 h-6 text-emerald-600" /> : <WifiOff className="w-6 h-6 text-amber-600" />}
            <div>
              <div className="font-display font-semibold text-sm">
                Connection State: {isOnline ? 'Online · Auto-Sync Active' : 'Offline · Local IndexedDB Recording'}
              </div>
              <div className="text-xs text-slate-500">
                Pending Queue: {queue.length} transaction(s) stored safely in IndexedDB
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <PWAInstallButton />
            <button
              disabled={!isOnline}
              onClick={async () => {
                await onSyncNow();
                await loadSyncData();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white px-4 py-2 text-xs font-semibold"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Sync Now
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="font-display font-semibold text-sm">Pending Local IndexedDB Queue ({queue.length})</h3>
            <div className="space-y-2 text-xs max-h-72 overflow-y-auto">
              {queue.map((q) => (
                <div key={q.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 flex justify-between">
                  <div>
                    <div className="font-mono font-semibold">{q.type} · {q.id}</div>
                    <div className="text-[11px] text-slate-500">{q.createdAt} · Retries: {q.retries}</div>
                    {q.lastError && <div className="text-red-600 text-[11px]">{q.lastError}</div>}
                  </div>
                  <span className="font-mono text-[11px] text-amber-600">{q.status}</span>
                </div>
              ))}
              {!queue.length && <div className="text-slate-400 py-6 text-center">All local transactions are synchronized.</div>}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="font-display font-semibold text-sm">Server Synchronization & Conflict Logs</h3>
            <div className="space-y-2 text-xs max-h-72 overflow-y-auto">
              {syncLogs.map((l) => (
                <div key={l.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="flex justify-between font-mono">
                    <span>{l.entity_type} · {l.client_tx_id}</span>
                    <span className={l.status === 'CONFLICT' || l.status === 'FAILED' ? 'text-amber-600 font-semibold' : 'text-emerald-600'}>
                      {l.status}
                    </span>
                  </div>
                  {l.conflict_detail && <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">{l.conflict_detail}</div>}
                </div>
              ))}
              {!syncLogs.length && <div className="text-slate-400 py-6 text-center">No offline sync events logged yet.</div>}
            </div>
          </div>
        </div>

        <GoogleSheetsPanel
          lang={lang}
          isOnline={isOnline}
          canManageSettings={user.permissions.includes('manage_settings')}
          onRefreshData={onRefreshSettings}
        />
      </div>
    );
  }

  if (mode === 'users') {
    const createUser = async (e: React.FormEvent) => {
      e.preventDefault();
      setStatusMsg('');
      try {
        await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(newUser) });
        setNewUser({ name: '', email: '', role: 'Cashier', password: '' });
        await loadUsersAudit();
      } catch (err) {
        setStatusMsg((err as Error).message);
      }
    };

    return (
      <div className="space-y-6">
        {statusMsg && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">{statusMsg}</div>}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form onSubmit={createUser} className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
            <h3 className="font-display font-semibold text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-teal-700" /> Add Staff Account</h3>
            <input required placeholder="Full Name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <input required type="email" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
              {Object.keys(rolePerms).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input required minLength={6} type="password" placeholder="Password (min 6 chars)" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <button type="submit" className="w-full py-2 rounded-lg bg-teal-700 text-white font-semibold">Create User</button>
          </form>

          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">POS Users & RBAC Roles</div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">User</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {usersList.map((u) => (
                  <tr key={String(u.id)}>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold">{String(u.name)}</div>
                      <div className="text-[11px] text-slate-500">{String(u.email)}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono">{String(u.role)}</td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        disabled={Number(u.id) === user.id}
                        onClick={async () => {
                          await apiFetch(`/api/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) });
                          loadUsersAudit();
                        }}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium ${u.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}
                      >
                        {u.active ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">Security Audit Logs</div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2 px-4">Time</th>
                <th className="py-2 px-3">User</th>
                <th className="py-2 px-3">Action</th>
                <th className="py-2 px-4">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {auditLogs.slice(0, 30).map((a) => (
                <tr key={String(a.id)}>
                  <td className="py-2 px-4 font-mono text-[11px] text-slate-500">{String(a.created_at)}</td>
                  <td className="py-2 px-3">{String(a.user_name)}</td>
                  <td className="py-2 px-3 font-mono font-medium">{String(a.action)}</td>
                  <td className="py-2 px-4 text-slate-500">{String(a.entity_type)} #{String(a.entity_id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Settings & Backup mode
  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopForm) return;
    try {
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(shopForm) });
      setStatusMsg('Settings saved successfully.');
      await onRefreshSettings();
    } catch (err) {
      setStatusMsg((err as Error).message);
    }
  };

  const downloadBackup = async () => {
    const dump = await apiFetch<Record<string, unknown>>('/api/backup/export');
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AmarPOS-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(String(reader.result || '{}'));
        await apiFetch('/api/backup/restore', { method: 'POST', body: JSON.stringify(json) });
        setStatusMsg('Database restored successfully from backup snapshot.');
        await onRefreshSettings();
      } catch (err) {
        setStatusMsg((err as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setStatusMsg(lang === 'bn' ? 'লোগোর ফাইলের আকার সর্বোচ্চ ২ মেগাবাইট হতে পারবে।' : 'Logo file size must be under 2MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      if (shopForm) {
        setShopForm({ ...shopForm, logo_url: result });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {shopForm && (
        <form onSubmit={saveSettings} className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
          <h3 className="font-display font-semibold text-sm">
            {lang === 'bn' ? 'দোকানের পরিচিতি, প্রিন্টার ও লোগো সেটিংস' : 'Store Profile, Printer & Logo Settings'}
          </h3>
          {statusMsg && <div className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/30 text-teal-800 dark:text-teal-200">{statusMsg}</div>}

          {/* Logo Upload Section */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex flex-col sm:flex-row items-center gap-4">
            <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center overflow-hidden shrink-0">
              {shopForm.logo_url ? (
                <img src={shopForm.logo_url} alt="Shop Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <Image className="w-8 h-8 text-slate-400" />
              )}
            </div>
            <div className="flex-1 space-y-1.5 text-center sm:text-left">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {lang === 'bn' ? 'দোকানের লোগো (Shop Logo)' : 'Store Logo'}
              </div>
              <p className="text-[11px] text-slate-500">
                {lang === 'bn'
                  ? 'এই লোগোটি পিওএস বিল/ইনভয়েস, অনলাইন ই-কমার্স স্টোর এবং সাইডবারে প্রদর্শিত হবে।'
                  : 'Appears on printed thermal/A4 invoices, storefront header, and sidebar.'}
              </p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white font-medium cursor-pointer hover:bg-teal-800 transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'ছবি আপলোড করুন' : 'Upload Image'}</span>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                </label>
                {shopForm.logo_url && (
                  <button
                    type="button"
                    onClick={() => setShopForm({ ...shopForm, logo_url: '' })}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'মুছে ফেলুন' : 'Remove'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={shopForm.shop_name} onChange={(e) => setShopForm({ ...shopForm, shop_name: e.target.value })} placeholder="Shop Name (EN)" className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <input value={shopForm.shop_name_bn} onChange={(e) => setShopForm({ ...shopForm, shop_name_bn: e.target.value })} placeholder="Shop Name (BN)" className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <input value={shopForm.logo_url || ''} onChange={(e) => setShopForm({ ...shopForm, logo_url: e.target.value })} placeholder={lang === 'bn' ? 'অথবা লোগোর সরাসরি লিঙ্ক (URL) দিন' : 'Or paste direct Logo Image URL'} className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <input value={shopForm.phone} onChange={(e) => setShopForm({ ...shopForm, phone: e.target.value })} placeholder="Phone" className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <input value={shopForm.vat_reg_no} onChange={(e) => setShopForm({ ...shopForm, vat_reg_no: e.target.value })} placeholder="BIN / VAT Reg" className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <input value={shopForm.address} onChange={(e) => setShopForm({ ...shopForm, address: e.target.value })} placeholder="Address" className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Default VAT (%)</label>
              <input type="number" value={shopForm.default_vat_percent} onChange={(e) => setShopForm({ ...shopForm, default_vat_percent: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">Thermal Printer Width</label>
              <select value={shopForm.thermal_width} onChange={(e) => setShopForm({ ...shopForm, thermal_width: e.target.value as '58mm' | '80mm' })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
                <option value="80mm">80mm Thermal Roll</option>
                <option value="58mm">58mm Thermal Roll</option>
              </select>
            </div>
            <input value={shopForm.promo_banner_text} onChange={(e) => setShopForm({ ...shopForm, promo_banner_text: e.target.value })} placeholder="Storefront Promo Banner" className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <input value={shopForm.receipt_footer} onChange={(e) => setShopForm({ ...shopForm, receipt_footer: e.target.value })} placeholder="Invoice Receipt Footer" className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
          </div>
          <button type="submit" className="px-5 py-2 rounded-lg bg-teal-700 text-white font-semibold">
            {lang === 'bn' ? 'সেটিংস সংরক্ষণ করুন' : 'Save Settings'}
          </button>
        </form>
      )}

      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
        <h3 className="font-display font-semibold text-sm flex items-center gap-2">
          <Database className="w-4 h-4 text-teal-700" /> Database Backup & Restore
        </h3>
        <p className="text-slate-500">Export a complete JSON snapshot of products, batches, sales, customers, dues, and settings.</p>
        <button onClick={downloadBackup} className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold">
          <Download className="w-4 h-4" /> Export Full Backup (.json)
        </button>
        <label className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 cursor-pointer font-semibold hover:bg-slate-50 dark:hover:bg-slate-800">
          <Upload className="w-4 h-4" /> Restore from Backup
          <input type="file" accept="application/json" onChange={handleRestore} className="hidden" />
        </label>

        {onOpenMessaging && (
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div className="font-display font-semibold text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-teal-700" />
              {lang === 'bn' ? 'বাল্ক SMS গেটওয়ে সার্ভিস' : 'Bulk SMS Gateway Service'}
            </div>
            <p className="text-slate-500">
              {lang === 'bn'
                ? 'SSLWireless, BulkSMSBD, GreenWeb, Alpha SMS, Twilio বা কাস্টম HTTPS গেটওয়ে কনফিগার এবং বাল্ক ক্যাম্পেইন পরিচালনা করুন।'
                : 'Configure SSLWireless, BulkSMSBD, GreenWeb, Alpha SMS, Twilio, or Custom HTTPS SMS gateways and test live dispatch.'}
            </p>
            <button
              type="button"
              onClick={onOpenMessaging}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold"
            >
              <MessageSquare className="w-4 h-4" />
              {lang === 'bn' ? 'SMS গেটওয়ে ও ক্যাম্পেইন খুলুন' : 'Open SMS Gateways & Bulk Campaigns'}
            </button>
          </div>
        )}
      </div>
      </div>

      <GoogleSheetsPanel
        lang={lang}
        isOnline={isOnline}
        canManageSettings={user.permissions.includes('manage_settings')}
        onRefreshData={onRefreshSettings}
      />
    </div>
  );
};
