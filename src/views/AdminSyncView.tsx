import React, { useEffect, useState } from 'react';
import { Archive, CheckCircle2, Cloud, Database, Download, ExternalLink, Globe, Image, KeyRound, Laptop, MessageSquare, RefreshCw, Shield, Trash2, Upload, UserCheck, UserX, Volume2, WifiOff } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { getPendingQueue } from '../lib/offlineDb';
import { getCashDrawerConfig, saveCashDrawerConfig, openCashDrawer, requestSerialPort, type CashDrawerConfig, DRAWER_CODES } from '../lib/cashDrawer';
import type { Lang } from '../i18n';
import type { AuthUser, OfflineOperation, ShopSettings, SyncLog, UserLoginAudit, UserRole } from '../types';
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
  const [loginAudits, setLoginAudits] = useState<UserLoginAudit[]>([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'Cashier' as UserRole, password: '', active: true });
  const [shopForm, setShopForm] = useState<ShopSettings | null>(settings);
  const [statusMsg, setStatusMsg] = useState('');

  const [geminiStatus, setGeminiStatus] = useState<{ configured: boolean; source: string; maskedKey: string } | null>(null);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [geminiMsg, setGeminiMsg] = useState('');

  // Cash Drawer Settings State
  const [drawerConfig, setDrawerConfig] = useState<CashDrawerConfig>(getCashDrawerConfig());
  const [drawerTesting, setDrawerTesting] = useState(false);
  const [drawerStatus, setDrawerStatus] = useState<string | null>(null);

  const handleUpdateDrawerConfig = (updated: Partial<CashDrawerConfig>) => {
    const next = saveCashDrawerConfig(updated);
    setDrawerConfig(next);
  };

  const handleTestDrawer = async () => {
    setDrawerTesting(true);
    setDrawerStatus(null);
    try {
      const res = await openCashDrawer('Admin Settings Test');
      if (res.success) {
        setDrawerStatus(lang === 'bn' ? '✓ ক্যাশড্রয়ার কিক সিগন্যাল সফলভাবে পাঠানো হয়েছে!' : '✓ Cash drawer kick pulse sent successfully!');
      } else {
        setDrawerStatus(res.error || 'Failed to kick drawer');
      }
    } catch (err) {
      setDrawerStatus((err as Error).message);
    } finally {
      setDrawerTesting(false);
    }
  };

  const handleConnectSerial = async () => {
    setDrawerStatus(null);
    const res = await requestSerialPort();
    if (res.success) {
      setDrawerStatus(lang === 'bn' ? '✓ USB/সিরিয়াল পোর্ট সফলভাবে সংযুক্ত হয়েছে!' : '✓ USB / Serial port connected successfully!');
    } else {
      setDrawerStatus(res.error || 'Connection failed');
    }
  };

  useEffect(() => {
    setShopForm(settings);
  }, [settings]);

  const loadGeminiKeyStatus = async () => {
    try {
      const res = await apiFetch<{ configured: boolean; source: string; maskedKey: string }>('/api/settings/gemini-key');
      setGeminiStatus(res);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (mode === 'settings') {
      loadGeminiKeyStatus();
    }
  }, [mode]);

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
      const [uRes, aRes, hRes] = await Promise.all([
        apiFetch<{ users: Array<Record<string, unknown>>; rolePermissions: Record<string, string[]> }>('/api/users'),
        apiFetch<Array<Record<string, unknown>>>('/api/audit-logs'),
        apiFetch<UserLoginAudit[]>('/api/users/login-history').catch(() => [] as UserLoginAudit[]),
      ]);
      setUsersList(uRes.users);
      setRolePerms(uRes.rolePermissions);
      setAuditLogs(aRes);
      setLoginAudits(hRes);
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
        setNewUser({ name: '', email: '', role: 'Cashier', password: '', active: true });
        await loadUsersAudit();
        setStatusMsg(lang === 'bn' ? '✓ নতুন কর্মী অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!' : '✓ Staff account created successfully!');
      } catch (err) {
        setStatusMsg((err as Error).message);
      }
    };

    const toggleUserActive = async (id: number, currentActive: boolean) => {
      setStatusMsg('');
      try {
        await apiFetch(`/api/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: !currentActive }),
        });
        await loadUsersAudit();
        setStatusMsg(
          lang === 'bn'
            ? (!currentActive ? '✓ ইউজারকে সফলভাবে সিস্টেমে প্রবেশের অনুমতি প্রদান করা হয়েছে।' : '✕ ইউজারের সিস্টেমে প্রবেশের অনুমতি বাতিল করা হয়েছে।')
            : (!currentActive ? '✓ Login permission granted successfully.' : '✕ Login permission revoked.')
        );
      } catch (err) {
        setStatusMsg((err as Error).message);
      }
    };

    const updateUserRole = async (id: number, role: UserRole) => {
      setStatusMsg('');
      try {
        await apiFetch(`/api/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        });
        await loadUsersAudit();
        setStatusMsg(lang === 'bn' ? '✓ ইউজার রোল সফলভাবে আপডেট হয়েছে।' : '✓ User role updated successfully.');
      } catch (err) {
        setStatusMsg((err as Error).message);
      }
    };

    const deleteUser = async (id: number, email: string) => {
      const confirmPrompt = lang === 'bn'
        ? `আপনি কি নিশ্চিত যে ইউজার "${email}" মুছে ফেলতে চান?`
        : `Are you sure you want to permanently delete user "${email}"?`;
      if (!window.confirm(confirmPrompt)) return;
      setStatusMsg('');
      try {
        await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
        await loadUsersAudit();
        setStatusMsg(lang === 'bn' ? '✓ ইউজার সফলভাবে মুছে ফেলা হয়েছে।' : '✓ User deleted successfully.');
      } catch (err) {
        setStatusMsg((err as Error).message);
      }
    };

    const formatAuditDateTime = (dateStr: string) => {
      try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
      } catch {
        return dateStr;
      }
    };

    return (
      <div className="space-y-6">
        {statusMsg && (
          <div className="rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 p-3.5 text-xs text-teal-900 dark:text-teal-200 flex items-center justify-between">
            <span>{statusMsg}</span>
            <button onClick={() => setStatusMsg('')} className="text-teal-700 hover:opacity-75">✕</button>
          </div>
        )}

        {/* Section Notice Banner */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
          <div className="space-y-0.5">
            <h2 className="font-display font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Shield className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              {lang === 'bn' ? 'ইউজার ও প্রবেশের পারমিশন কন্ট্রোল' : 'Users & Access Permission Control'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {lang === 'bn'
                ? 'সিস্টেমে প্রবেশের অনুমতি (Login Permission) এখান থেকে নিয়ন্ত্রণ করা হয়। শুধুমাত্র সক্রিয় ও অনুমোদিত ইউজাররাই পাসওয়ার্ড দিয়ে প্রবেশ করতে পারবেন।'
                : 'Control login access permissions. Only active and approved users can log in to the system.'}
            </p>
          </div>
          <div className="inline-flex items-center gap-2 shrink-0">
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'bn' ? `মোট ইউজার: ${usersList.length} জন` : `Total Users: ${usersList.length}`}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              {lang === 'bn' ? `অনুমোদিত: ${usersList.filter((u) => u.active).length} জন` : `Permitted: ${usersList.filter((u) => u.active).length}`}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Add User Form */}
          <form onSubmit={createUser} className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5 text-xs shadow-sm">
            <h3 className="font-display font-semibold text-sm flex items-center gap-2 text-slate-900 dark:text-white">
              <UserCheck className="w-4 h-4 text-teal-700" />
              {lang === 'bn' ? 'নতুন কর্মী অ্যাকাউন্ট তৈরি করুন' : 'Add Staff Account'}
            </h3>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'পূর্ণ নাম' : 'Full Name'}
              </label>
              <input
                required
                placeholder={lang === 'bn' ? 'যেমন: মোহাম্মদ ইসলাম' : 'e.g. John Doe'}
                value={newUser.name}
                onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'ইমেইল অ্যাড্রেস' : 'Email Address'}
              </label>
              <input
                required
                type="email"
                placeholder="staff@store.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'পদবী ও রোল (Role)' : 'Role'}
              </label>
              <select
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value as UserRole })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {Object.keys(rolePerms).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                {lang === 'bn' ? 'পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)' : 'Password (min 6 chars)'}
              </label>
              <input
                required
                minLength={6}
                type="password"
                placeholder="••••••"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <label className="flex items-center gap-2 p-2.5 rounded-lg border border-teal-200 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/30 cursor-pointer">
              <input
                type="checkbox"
                checked={newUser.active}
                onChange={(e) => setNewUser({ ...newUser, active: e.target.checked })}
                className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-[11px] font-medium text-slate-800 dark:text-slate-200">
                {lang === 'bn' ? 'তৈরির সাথে সাথে সিস্টেমে প্রবেশের পারমিশন দিন' : 'Grant login permission immediately'}
              </span>
            </label>
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold transition-colors"
            >
              {lang === 'bn' ? 'কর্মী অ্যাকাউন্ট তৈরি করুন' : 'Create User Account'}
            </button>
          </form>

          {/* User List & Permissions Table */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                  {lang === 'bn' ? 'সিস্টেম ইউজার ও পারমিশন নিয়ন্ত্রণ' : 'POS Users & Permission Management'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {lang === 'bn'
                    ? 'অনুমতি বন্ধ করলে সেই ইউজার সিস্টেমে প্রবেশ করতে পারবে না এবং তাৎক্ষণিকভাবে লগ আউট হয়ে যাবে।'
                    : 'Revoking permission blocks user access and invalidates active sessions immediately.'}
                </p>
              </div>
              <button
                type="button"
                onClick={loadUsersAudit}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                title={lang === 'bn' ? 'রিলোড করুন' : 'Refresh'}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4 font-medium">{lang === 'bn' ? 'কর্মী / ইউজার' : 'User'}</th>
                    <th className="py-2.5 px-3 font-medium">{lang === 'bn' ? 'রোল (Role)' : 'Role'}</th>
                    <th className="py-2.5 px-4 font-medium text-center">{lang === 'bn' ? 'প্রবেশের পারমিশন' : 'Login Permission'}</th>
                    <th className="py-2.5 px-3 font-medium text-right">{lang === 'bn' ? 'অ্যাকশন' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {usersList.map((u) => {
                    const uId = Number(u.id);
                    const isSelf = uId === user.id;
                    const isActive = Boolean(u.active);
                    return (
                      <tr key={String(u.id)} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/50">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <span>{String(u.name)}</span>
                            {isSelf && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
                                {lang === 'bn' ? 'আপনি' : 'You'}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono">{String(u.email)}</div>
                        </td>
                        <td className="py-3 px-3">
                          <select
                            disabled={isSelf && u.role === 'Super Admin'}
                            value={String(u.role)}
                            onChange={(e) => updateUserRole(uId, e.target.value as UserRole)}
                            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-mono font-medium focus:ring-1 focus:ring-teal-600"
                          >
                            {Object.keys(rolePerms).map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                                isActive
                                  ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900'
                                  : 'bg-red-100 dark:bg-red-950/70 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900'
                              }`}
                            >
                              {isActive
                                ? (lang === 'bn' ? '✓ অনুমোদিত' : '✓ Permitted')
                                : (lang === 'bn' ? '✕ অনুমতি নেই' : '✕ Blocked')}
                            </span>
                            <button
                              disabled={isSelf}
                              onClick={() => toggleUserActive(uId, isActive)}
                              title={isSelf ? (lang === 'bn' ? 'নিজের অ্যাকাউন্ট নিষ্ক্রিয় করা যাবে না' : 'Cannot disable self') : undefined}
                              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-30 ${
                                isActive
                                  ? 'border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
                                  : 'bg-teal-700 hover:bg-teal-800 text-white'
                              }`}
                            >
                              {isActive
                                ? (lang === 'bn' ? 'অনুমতি বাতিল' : 'Revoke')
                                : (lang === 'bn' ? 'অনুমতি দিন' : 'Grant')}
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            disabled={isSelf}
                            onClick={() => deleteUser(uId, String(u.email))}
                            title={isSelf ? (lang === 'bn' ? 'নিজের অ্যাকাউন্ট মোছা যাবে না' : 'Cannot delete self') : (lang === 'bn' ? 'ইউজার মুছুন' : 'Delete user')}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-red-600 hover:border-red-200 dark:hover:border-red-900 disabled:opacity-20"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Device & PC Login History Audit (User requirement: কে কখন কোন পিসি থেকে ডুকে তার ডিটেইলস) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-950/50">
            <div>
              <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <Laptop className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                {lang === 'bn'
                  ? 'লগইন ডিভাইস ও পিসি অডিট হিস্টোরি (কে কখন কোন পিসি থেকে ঢুকেছে)'
                  : 'Login Device & PC History Audit'}
              </h3>
              <p className="text-[11px] text-slate-500">
                {lang === 'bn'
                  ? 'সিস্টেমে প্রবেশের সময়, ব্যবহৃত পিসি/মোবাইল, ব্রাউজার, আইপি অ্যাড্রেস ও প্রবেশের ফলাফল'
                  : 'Comprehensive record of login attempts, PC/devices, browsers, IP addresses and access outcomes.'}
              </p>
            </div>
            <button
              type="button"
              onClick={loadUsersAudit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <RefreshCw className="w-3 h-3" />
              <span>{lang === 'bn' ? 'রিফ্রেশ অডিট' : 'Refresh Audits'}</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4 font-medium">{lang === 'bn' ? 'ইউজার ও রোল' : 'User & Role'}</th>
                  <th className="py-2.5 px-3 font-medium">{lang === 'bn' ? 'লগইন সময়' : 'Login Time'}</th>
                  <th className="py-2.5 px-4 font-medium">{lang === 'bn' ? 'ডিভাইস ও পিসি (Device / OS)' : 'Device / OS'}</th>
                  <th className="py-2.5 px-3 font-medium">{lang === 'bn' ? 'ব্রাউজার' : 'Browser'}</th>
                  <th className="py-2.5 px-3 font-medium">{lang === 'bn' ? 'আইপি অ্যাড্রেস' : 'IP Address'}</th>
                  <th className="py-2.5 px-4 font-medium text-right">{lang === 'bn' ? 'ফলাফল / স্ট্যাটাস' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loginAudits.map((a) => {
                  let meta: Record<string, unknown> = {};
                  try {
                    meta = JSON.parse(a.details_json || '{}');
                  } catch {
                    // ignore
                  }
                  const deviceDisplay = a.device_info || String(meta.deviceType || meta.os || 'Desktop PC (পিসি)');
                  const browserDisplay = a.browser_info || String(meta.browser || 'Web Browser');
                  const ipDisplay = a.ip_address || String(meta.ip || '127.0.0.1');
                  const isBlocked = a.action === 'LOGIN_BLOCKED';
                  const isSignup = a.action === 'SIGNUP_USER';
                  const isBootstrap = a.action === 'BOOTSTRAP_ADMIN';

                  return (
                    <tr key={String(a.id)} className={`hover:bg-slate-50/50 dark:hover:bg-slate-950/50 ${isBlocked ? 'bg-red-50/30 dark:bg-red-950/10' : ''}`}>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{a.user_name}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {a.email ? String(a.email) : (meta.email ? String(meta.email) : `User #${a.user_id || a.entity_id}`)}
                          {a.role && ` · ${a.role}`}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {formatAuditDateTime(a.created_at)}
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                          <Laptop className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                          <span>{deviceDisplay}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                          <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{browserDisplay}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {ipDisplay}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {isBlocked ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                            {lang === 'bn' ? '✕ অনুমতি ছাড়া চেষ্টা' : '✕ Blocked (No Permission)'}
                          </span>
                        ) : isSignup ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                            {lang === 'bn' ? '🆕 নতুন সাইন আপ' : '🆕 Registered'}
                          </span>
                        ) : isBootstrap ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                            {lang === 'bn' ? '👑 বুটস্ট্র্যাপ অ্যাডমিন' : '👑 Bootstrap Admin'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            {lang === 'bn' ? '✓ সফল প্রবেশ' : '✓ Access Allowed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {loginAudits.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                      {lang === 'bn' ? 'এখনও কোনো লগইন হিস্টোরি পাওয়া যায়নি।' : 'No login audit events recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* General Audit Logs */}
        <details className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
          <summary className="p-4 cursor-pointer font-display font-semibold text-sm text-slate-700 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-400 flex items-center justify-between">
            <span>{lang === 'bn' ? 'সকল সাধারণ সিস্টেম অডিট লগ (General Audit Logs)' : 'All General System Audit Logs'}</span>
            <span className="text-xs text-slate-400">({auditLogs.length} events)</span>
          </summary>
          <div className="overflow-x-auto border-t border-slate-200 dark:border-slate-800">
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
        </details>
      </div>
    );
  }

  // Settings & Backup mode
  const saveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shopForm) return;
    try {
      setStatusMsg('');
      // 1. Immediately cache in localStorage for instant offline & reload permanence
      localStorage.setItem('amarpos_saved_shop_settings', JSON.stringify(shopForm));

      // 2. Broadcast event to instantly update App title, sidebar, and all components
      window.dispatchEvent(new CustomEvent('amarpos:settings-updated', { detail: shopForm }));

      // 3. Persist to server SQLite database & backup
      await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(shopForm) });

      setStatusMsg(
        lang === 'bn'
          ? '✓ দোকানের পরিচিতি, প্রিন্টার ও লোগো সেটিংস সফলভাবে সংরক্ষিত হয়েছে!'
          : '✓ Store profile, printer & logo settings saved successfully!'
      );
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'দোকানের নাম / সিস্টেম নাম (ইংরেজিতে) *' : 'Store Profile / System Name (EN) *'}
              </label>
              <input
                required
                value={shopForm.shop_name}
                onChange={(e) => setShopForm({ ...shopForm, shop_name: e.target.value })}
                placeholder="e.g. ইসলাম মেডিকেল এন্ড ই-সেন্টার"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-teal-600"
              />
              <span className="text-[10px] text-teal-700 dark:text-teal-400">
                {lang === 'bn' ? '✓ এই নামটি পুরো সিস্টেমে প্রধান নাম হিসেবে প্রদর্শিত হবে' : '✓ This becomes the primary system name everywhere'}
              </span>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'দোকানের নাম (বাংলায়)' : 'Store Name (Bangla)'}
              </label>
              <input
                value={shopForm.shop_name_bn}
                onChange={(e) => setShopForm({ ...shopForm, shop_name_bn: e.target.value })}
                placeholder="যেমন: ইসলাম মেডিকেল এন্ড ই-সেন্টার"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'অথবা সরাসরি লোগো ইমেজ লিঙ্ক (Image URL)' : 'Or Direct Logo Image URL'}
              </label>
              <input
                value={shopForm.logo_url || ''}
                onChange={(e) => setShopForm({ ...shopForm, logo_url: e.target.value })}
                placeholder={lang === 'bn' ? 'https://example.com/my-shop-logo.png' : 'https://example.com/logo.png'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white font-mono text-xs focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'মোবাইল / ফোন নম্বর' : 'Phone Number'}
              </label>
              <input
                value={shopForm.phone}
                onChange={(e) => setShopForm({ ...shopForm, phone: e.target.value })}
                placeholder="01719565306, 01825333334, 01729677646"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'ভ্যাট / BIN নম্বর' : 'VAT / BIN Reg No'}
              </label>
              <input
                value={shopForm.vat_reg_no}
                onChange={(e) => setShopForm({ ...shopForm, vat_reg_no: e.target.value })}
                placeholder="BIN-004928172-0101"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'দোকানের ঠিকানা' : 'Store Address'}
              </label>
              <input
                value={shopForm.address}
                onChange={(e) => setShopForm({ ...shopForm, address: e.target.value })}
                placeholder="গাজীমাহমুদ, নিশানবাড়িয়া, বরগুনা সদর, বরগুনা"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'ডিফল্ট ভ্যাট / ট্যাক্স (%)' : 'Default VAT (%)'}
              </label>
              <input
                type="number"
                value={shopForm.default_vat_percent}
                onChange={(e) => setShopForm({ ...shopForm, default_vat_percent: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'থার্মাল প্রিন্টার রোলার সাইজ' : 'Thermal Printer Width'}
              </label>
              <select
                value={shopForm.thermal_width}
                onChange={(e) => setShopForm({ ...shopForm, thermal_width: e.target.value as '58mm' | '80mm' })}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
              >
                <option value="80mm">80mm Thermal POS Roll (৩ ইঞ্চি / স্ট্যান্ডার্ড)</option>
                <option value="58mm">58mm Thermal POS Roll (২ ইঞ্চি / ছোট রোলার)</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'ই-কমার্স স্টোরফ্রন্ট প্রমো ব্যানার' : 'Online Storefront Promo Banner'}
              </label>
              <input
                value={shopForm.promo_banner_text}
                onChange={(e) => setShopForm({ ...shopForm, promo_banner_text: e.target.value })}
                placeholder="10% OFF Healthcare Essentials with code WELCOME10"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'bn' ? 'ইনভয়েস ও রসিদের শেষের শুভেচ্ছা বার্তা (Receipt Footer)' : 'Invoice Receipt Footer Note'}
              </label>
              <input
                value={shopForm.receipt_footer}
                onChange={(e) => setShopForm({ ...shopForm, receipt_footer: e.target.value })}
                placeholder="ধন্যবাদ! আবার আসবেন / Thank you for shopping with us!"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>
          <button type="submit" className="px-5 py-2 rounded-lg bg-teal-700 text-white font-semibold">
            {lang === 'bn' ? 'সেটিংস সংরক্ষণ করুন' : 'Save Settings'}
          </button>
        </form>
      )}

      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
        {/* Google Gemini AI Vision OCR Key Setup */}
        <div className="space-y-2.5 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-sm flex items-center gap-1.5 text-slate-900 dark:text-white">
              <KeyRound className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              {lang === 'bn' ? 'Google Gemini AI কী' : 'Google Gemini AI Key'}
            </h3>
            {geminiStatus && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                geminiStatus.configured
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                  : 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
              }`}>
                {geminiStatus.configured ? (lang === 'bn' ? 'সক্রিয়' : 'Active') : (lang === 'bn' ? 'অনুপস্থিত' : 'Missing')}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-[11px] leading-relaxed">
            {lang === 'bn'
              ? 'মোবাইল ক্যামেরা বা আপলোড করা ওষুধের ছবি স্বয়ংক্রিয়ভাবে রিড করতে এই কী ব্যবহৃত হয়।'
              : 'Used by the AI camera scanner to recognize medicine packaging and labels automatically.'}
          </p>

          {geminiStatus?.maskedKey && (
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 p-2 rounded border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span>{geminiStatus.maskedKey}</span>
              <span className="text-[10px] text-teal-700 dark:text-teal-400 font-semibold uppercase">{geminiStatus.source}</span>
            </div>
          )}

          <form onSubmit={async (e) => {
            e.preventDefault();
            if (!geminiKeyInput.trim()) return;
            setGeminiSaving(true);
            setGeminiMsg('');
            try {
              await apiFetch('/api/settings/gemini-key', {
                method: 'POST',
                body: JSON.stringify({ apiKey: geminiKeyInput.trim() }),
              });
              try {
                localStorage.setItem('amarpos_gemini_api_key', geminiKeyInput.trim());
              } catch {}
              setGeminiMsg(lang === 'bn' ? 'কী সফলভাবে সংরক্ষিত হয়েছে!' : 'Key saved successfully!');
              setGeminiKeyInput('');
              await loadGeminiKeyStatus();
            } catch (err) {
              setGeminiMsg(`Error: ${(err as Error).message}`);
            } finally {
              setGeminiSaving(false);
            }
          }} className="space-y-2">
            <input
              type="password"
              value={geminiKeyInput}
              onChange={(e) => setGeminiKeyInput(e.target.value)}
              placeholder={lang === 'bn' ? 'Gemini API Key পেস্ট করুন...' : 'Paste Gemini API Key...'}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
            />
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={geminiSaving || !geminiKeyInput.trim()}
                className="flex-1 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-semibold text-xs transition-colors"
              >
                {geminiSaving ? (lang === 'bn' ? 'সংরক্ষণ হচ্ছে...' : 'Saving...') : (lang === 'bn' ? 'কী সেভ করুন' : 'Save Key')}
              </button>
              {geminiStatus?.configured && (
                <button
                  type="button"
                  onClick={async () => {
                    setTestingGemini(true);
                    setGeminiMsg('');
                    try {
                      const res = await apiFetch<{ ok: boolean; apiVersion: string; modelsCount: number; availableModels: string[] }>('/api/settings/gemini-test');
                      setGeminiMsg(
                        lang === 'bn'
                          ? `✓ গুগল এআই সফলভাবে সংযুক্ত! মডেল: ${res.availableModels.slice(0, 3).join(', ')} (${res.apiVersion})`
                          : `✓ Connected! Models: ${res.availableModels.slice(0, 3).join(', ')} (${res.apiVersion})`
                      );
                    } catch (err) {
                      setGeminiMsg(`Google API Error: ${(err as Error).message}`);
                    } finally {
                      setTestingGemini(false);
                    }
                  }}
                  disabled={testingGemini}
                  className="px-2.5 py-1.5 rounded-lg border border-teal-300 dark:border-teal-700 hover:bg-teal-50 dark:hover:bg-teal-950 text-teal-700 dark:text-teal-300 font-semibold text-[11px] transition-colors"
                >
                  {testingGemini ? (lang === 'bn' ? 'টেস্ট...' : 'Testing...') : (lang === 'bn' ? 'টেস্ট সংযোগ' : 'Test AI')}
                </button>
              )}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-teal-700 dark:text-teal-400 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <span>{lang === 'bn' ? 'ফ্রি কী নিন' : 'Free Key'}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            {geminiMsg && (
              <div className="text-[11px] text-teal-700 dark:text-teal-400 font-medium">{geminiMsg}</div>
            )}
          </form>
        </div>

        {/* Electronic Cash Drawer Settings */}
        <div className="space-y-3 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-semibold text-sm flex items-center gap-1.5 text-slate-900 dark:text-white">
              <Archive className="w-4 h-4 text-teal-700 dark:text-teal-400" />
              <span>{lang === 'bn' ? 'ইলেকট্রনিক ক্যাশড্রয়ার কনফিগারেশন' : 'Electronic Cash Drawer Settings'}</span>
            </h3>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                drawerConfig.enabled
                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                  : 'bg-slate-200 dark:bg-slate-800 text-slate-600'
              }`}
            >
              {drawerConfig.enabled ? (lang === 'bn' ? 'সক্রিয়' : 'Enabled') : (lang === 'bn' ? 'নিষ্ক্রিয়' : 'Disabled')}
            </span>
          </div>

          <p className="text-slate-500 text-[11px] leading-relaxed">
            {lang === 'bn'
              ? 'থার্মাল প্রিন্টারের RJ11/RJ12 পোর্ট বা USB ক্যাশড্রয়ার ট্রিগার বক্সের মাধ্যমে কিক পালস পাঠিয়ে ড্রয়ার ওপেন করুন।'
              : 'Trigger RJ11/RJ12 printer-driven or USB serial electronic cash drawers automatically.'}
          </p>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={drawerConfig.autoOpenOnCashSale}
                onChange={(e) => handleUpdateDrawerConfig({ autoOpenOnCashSale: e.target.checked })}
                className="rounded border-slate-300 text-teal-600"
              />
              <span>{lang === 'bn' ? 'ক্যাশ বিক্রয় সম্পন্ন বা এন্টার চাপলে স্বয়ংক্রিয় ওপেন হবে' : 'Auto-kick open on Cash Sale / Enter'}</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={drawerConfig.soundEnabled}
                onChange={(e) => handleUpdateDrawerConfig({ soundEnabled: e.target.checked })}
                className="rounded border-slate-300 text-teal-600"
              />
              <span className="flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-slate-400" />
                <span>{lang === 'bn' ? 'ক্যাশড্রয়ার রিলিজ অডিও সাউন্ড বাজবে' : 'Play audio chime on drawer kick'}</span>
              </span>
            </label>
          </div>

          <div>
            <label className="block text-[11px] text-slate-500 mb-1">
              {lang === 'bn' ? 'ক্যাশড্রয়ার কিক কোড (ESC/POS Pulse Command)' : 'Kick Code (ESC/POS Pulse)'}
            </label>
            <select
              value={drawerConfig.pulseCode}
              onChange={(e) => handleUpdateDrawerConfig({ pulseCode: e.target.value as any })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs font-mono"
            >
              {(Object.keys(DRAWER_CODES) as Array<keyof typeof DRAWER_CODES>).map((k) => (
                <option key={k} value={k}>
                  {DRAWER_CODES[k].name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestDrawer}
              disabled={drawerTesting}
              className="flex-1 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>{drawerTesting ? '...' : lang === 'bn' ? 'ক্যাশড্রয়ার টেস্ট করুন' : 'Test Kick Drawer'}</span>
            </button>
            <button
              type="button"
              onClick={handleConnectSerial}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium"
              title="USB / Web Serial"
            >
              {lang === 'bn' ? 'USB কানেক্ট' : 'USB Serial'}
            </button>
          </div>

          {drawerStatus && (
            <div className="text-[11px] font-medium text-teal-700 dark:text-teal-400 bg-teal-50/80 dark:bg-teal-950/40 p-2 rounded-lg border border-teal-200 dark:border-teal-800">
              {drawerStatus}
            </div>
          )}

          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 space-y-1">
            <div className="font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'bn' ? 'থার্মাল প্রিন্টার ড্রাইভার অটো-কিক নির্দেশনা:' : 'Thermal Printer Driver Auto-Kick:'}
            </div>
            <div>
              {lang === 'bn'
                ? 'Windows Control Panel > Devices and Printers > আপনার রিসিট প্রিন্টারে রাইট ক্লিক > Printer Properties > Device Settings এ যান। সেখানে Cash Drawer অপশনে "Open Before Printing" সিলেক্ট করে Apply দিন।'
                : 'Under Windows Control Panel > Printer Properties > Device Settings, set Cash Drawer to "Open Before Printing" to kick automatically on receipt print.'}
            </div>
          </div>
        </div>

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
