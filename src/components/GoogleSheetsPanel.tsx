import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderSync,
  Link2,
  Loader2,
  LogOut,
  PlusCircle,
  RefreshCw,
  ShieldCheck,
  Table,
  X,
} from 'lucide-react';
import { apiFetch, downloadCsvBackup } from '../lib/api';
import {
  clearExpiredGoogleToken,
  getGoogleAccessToken,
  signInWithGoogleSheets,
  signOutGoogleSheets,
  subscribeGoogleAuth,
} from '../lib/googleSheetsAuth';
import type { Lang } from '../i18n';
import type { GoogleSheetPreview, GoogleSheetsConfig, GoogleSheetsSyncLog } from '../types';

interface GoogleSheetsPanelProps {
  lang: Lang;
  isOnline: boolean;
  canManageSettings: boolean;
  onRefreshData?: () => Promise<void>;
}

interface PendingConfirmState {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'teal' | 'amber';
  onConfirm: () => Promise<void>;
}

const CSV_DATASETS: Array<{
  id: 'pnl' | 'sales' | 'purchases' | 'expenses' | 'products' | 'customers';
  en: string;
  bn: string;
}> = [
  { id: 'pnl', en: 'Daily P&L Summary CSV', bn: 'দৈনিক লাভ-ক্ষতি (P&L) CSV' },
  { id: 'sales', en: 'Sales Ledger CSV', bn: 'বিক্রয় তালিকা (Sales) CSV' },
  { id: 'purchases', en: 'Purchases CSV', bn: 'ক্রয় তালিকা (Purchases) CSV' },
  { id: 'expenses', en: 'Expenses CSV', bn: 'খরচের তালিকা (Expenses) CSV' },
  { id: 'products', en: 'Products & Stock CSV', bn: 'পণ্য ও স্টক CSV' },
  { id: 'customers', en: 'Customer Dues CSV', bn: 'কাস্টমার বাকি তালিকা CSV' },
];

export const GoogleSheetsPanel: React.FC<GoogleSheetsPanelProps> = ({
  lang,
  isOnline,
  canManageSettings,
  onRefreshData,
}) => {
  const [config, setConfig] = useState<GoogleSheetsConfig | null>(null);
  const [logs, setLogs] = useState<GoogleSheetsSyncLog[]>([]);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(getGoogleAccessToken());

  const [newSheetTitle, setNewSheetTitle] = useState('AmarPOS Smart AI · Cloud Ledger & Backup');
  const [connectInput, setConnectInput] = useState('');
  const [importEntity, setImportEntity] = useState<'products' | 'customers'>('products');
  const [importSheetInput, setImportSheetInput] = useState('');
  const [preview, setPreview] = useState<GoogleSheetPreview | null>(null);
  const [selectedTab, setSelectedTab] = useState('');

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(null);

  useEffect(() => {
    const unsub = subscribeGoogleAuth(({ user, accessToken }) => {
      setGoogleEmail(user?.email || null);
      setGoogleToken(accessToken);
    });
    return unsub;
  }, []);

  const loadConfig = useCallback(async () => {
    if (!isOnline) return;
    try {
      const res = await apiFetch<{ config: GoogleSheetsConfig; logs: GoogleSheetsSyncLog[] }>('/api/sheets/config');
      setConfig(res.config);
      setLogs(res.logs || []);
    } catch {
      // ignore offline or restricted
    }
  }, [isOnline]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const sheetsRequest = async <T,>(url: string, options: RequestInit = {}): Promise<T> => {
    const token = getGoogleAccessToken();
    if (!token) {
      throw new Error(
        lang === 'bn'
          ? 'প্রথমে "Sign in with Google" বাটনে ক্লিক করে Google Sheets অনুমতি দিন।'
          : 'Please click "Sign in with Google" first to authorize Google Sheets.'
      );
    }
    const headers = new Headers(options.headers || {});
    headers.set('X-Google-Access-Token', token);
    try {
      return await apiFetch<T>(url, { ...options, headers });
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/expired|authorization token|401/i.test(msg)) {
        clearExpiredGoogleToken();
      }
      throw err;
    }
  };

  const handleGoogleSignIn = async () => {
    setBanner(null);
    setBusyAction('auth');
    try {
      const res = await signInWithGoogleSheets();
      setBanner({
        type: 'ok',
        text:
          lang === 'bn'
            ? `Google অ্যাকাউন্ট সংযুক্ত হয়েছে (${res.user.email || 'Connected'})`
            : `Signed in with Google (${res.user.email || 'Connected'}).`,
      });
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/unauthorized-domain/i.test(msg)) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
        setBanner({
          type: 'err',
          text:
            lang === 'bn'
              ? `Firebase এরর (auth/unauthorized-domain): আপনার বর্তমান হোস্ট/ডোমেইন (${currentHost}) Firebase Authentication-এ অনুমোদিত নয়। আপনি যদি '127.0.0.1' দিয়ে প্রবেশ করে থাকেন, তবে ব্রাউজারে 'http://localhost:3000' ব্যবহার করুন। অন্য ডোমেইন হলে Firebase Console > Authentication > Settings > Authorized Domains-এ '${currentHost}' যোগ করুন।`
              : `Firebase Error (auth/unauthorized-domain): Your current host (${currentHost}) is not authorized in Firebase. If accessing via '127.0.0.1', switch to 'http://localhost:3000', or add '${currentHost}' in Firebase Console > Authentication > Settings > Authorized domains.`,
        });
      } else {
        setBanner({ type: 'err', text: msg });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleGoogleSignOut = async () => {
    setBusyAction('auth-out');
    try {
      await signOutGoogleSheets();
      setBanner({
        type: 'ok',
        text: lang === 'bn' ? 'Google সেশন বিচ্ছিন্ন করা হয়েছে।' : 'Disconnected Google Sheets session.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runConfirmedAction = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm.onConfirm;
    setPendingConfirm(null);
    setBanner(null);
    await action();
  };

  const requestCreateWorkbook = () => {
    const title = newSheetTitle.trim() || 'AmarPOS Smart AI · Cloud Ledger & Backup';
    setPendingConfirm({
      title: lang === 'bn' ? 'নতুন Google Sheet তৈরি ও সিঙ্ক করবেন?' : 'Create New AmarPOS Google Sheet?',
      description:
        lang === 'bn'
          ? `আপনার Google Drive-এ "${title}" নামে একটি নতুন স্প্রেডশীট তৈরি করা হবে এবং আজকের লাভ-ক্ষতি, বিক্রয়, ক্রয়, খরচ, পণ্য ও বাকি ডেটা তাতে লেখা হবে।`
          : `This will create "${title}" in your Google account and write all active tabs (Daily P&L, Sales, Purchases, Expenses, Products, Customer Dues).`,
      confirmLabel: lang === 'bn' ? 'তৈরি ও সিঙ্ক করুন' : 'Create & Sync Sheet',
      tone: 'teal',
      onConfirm: async () => {
        setBusyAction('create');
        try {
          const res = await sheetsRequest<{ config: GoogleSheetsConfig; created: { title: string } }>('/api/sheets/create', {
            method: 'POST',
            body: JSON.stringify({ title, syncNow: true }),
          });
          setConfig(res.config);
          await loadConfig();
          setBanner({
            type: 'ok',
            text:
              lang === 'bn'
                ? `নতুন Google Sheet "${res.created.title}" তৈরি ও সিঙ্ক সম্পন্ন হয়েছে!`
                : `Created and synced "${res.created.title}".`,
          });
        } catch (err) {
          setBanner({ type: 'err', text: (err as Error).message });
        } finally {
          setBusyAction(null);
        }
      },
    });
  };

  const requestConnectExisting = () => {
    if (!connectInput.trim()) {
      setBanner({
        type: 'err',
        text: lang === 'bn' ? 'Google Sheet URL বা Spreadsheet ID লিখুন।' : 'Enter a Google Sheet URL or Spreadsheet ID.',
      });
      return;
    }
    setPendingConfirm({
      title: lang === 'bn' ? 'বিদ্যমান Google Sheet সংযুক্ত করবেন?' : 'Connect Existing Google Sheet?',
      description:
        lang === 'bn'
          ? `টার্গেট শীট (${connectInput.trim()}) AmarPOS-এর ক্লাউড সিঙ্ক টার্গেট হিসেবে সংযুক্ত হবে।`
          : `This will link "${connectInput.trim()}" as the target workbook for AmarPOS reports and backup.`,
      confirmLabel: lang === 'bn' ? 'সংযুক্ত করুন' : 'Connect Sheet',
      tone: 'teal',
      onConfirm: async () => {
        setBusyAction('connect');
        try {
          const res = await sheetsRequest<{ config: GoogleSheetsConfig; metadata: { title: string } }>('/api/sheets/connect', {
            method: 'POST',
            body: JSON.stringify({ spreadsheetInput: connectInput.trim() }),
          });
          setConfig(res.config);
          setConnectInput('');
          await loadConfig();
          setBanner({
            type: 'ok',
            text:
              lang === 'bn'
                ? `Google Sheet "${res.metadata.title}" সংযুক্ত হয়েছে।`
                : `Connected "${res.metadata.title}".`,
          });
        } catch (err) {
          setBanner({ type: 'err', text: (err as Error).message });
        } finally {
          setBusyAction(null);
        }
      },
    });
  };

  const updateConfigFields = (patch: Partial<GoogleSheetsConfig>, actionTitle: string, actionDesc: string) => {
    if (!config) return;
    const nextCfg = { ...config, ...patch };
    setPendingConfirm({
      title: actionTitle,
      description: actionDesc,
      confirmLabel: lang === 'bn' ? 'সেটিংস সেভ করুন' : 'Save Sync Settings',
      tone: 'teal',
      onConfirm: async () => {
        setBusyAction('config');
        try {
          const res = await apiFetch<{ config: GoogleSheetsConfig }>('/api/sheets/config', {
            method: 'PUT',
            body: JSON.stringify(nextCfg),
          });
          setConfig(res.config);
          window.dispatchEvent(new CustomEvent('amarpos:sheets-config-updated', { detail: res.config }));
          setBanner({
            type: 'ok',
            text: lang === 'bn' ? 'অটো-সিঙ্ক সেটিংস আপডেট হয়েছে।' : 'Google Sheets sync preferences saved.',
          });
        } catch (err) {
          setBanner({ type: 'err', text: (err as Error).message });
        } finally {
          setBusyAction(null);
        }
      },
    });
  };

  const requestManualSync = () => {
    const targetName = config?.spreadsheet_title || config?.spreadsheet_id || 'Google Sheet';
    setPendingConfirm({
      title: lang === 'bn' ? 'Google Sheet-এ এখনই ডেটা আপডেট করবেন?' : 'Sync POS Data to Google Sheet Now?',
      description:
        lang === 'bn'
          ? `"${targetName}" স্প্রেডশীটের নির্বাচিত ট্যাবগুলো (লাভ-ক্ষতি, বিক্রয়, ক্রয়, খরচ, স্টক, বাকি) SQLite ডাটাবেজের সর্বশেষ ডেটা দিয়ে আপডেট করা হবে।`
          : `This will update the enabled tabs in "${targetName}" with the latest SQLite sales, purchases, expenses, stock, customer dues, and P&L records.`,
      confirmLabel: lang === 'bn' ? 'এখনই সিঙ্ক করুন' : 'Sync Now',
      tone: 'teal',
      onConfirm: async () => {
        setBusyAction('sync');
        try {
          const res = await sheetsRequest<{
            ok: boolean;
            result: { rowsWritten: number; tabsUpdated: string[] };
            config: GoogleSheetsConfig;
          }>('/api/sheets/sync', {
            method: 'POST',
            body: JSON.stringify({ reason: 'manual' }),
          });
          setConfig(res.config);
          await loadConfig();
          setBanner({
            type: 'ok',
            text:
              lang === 'bn'
                ? `সিঙ্ক সফল! ${res.result.tabsUpdated.length}টি ট্যাবে মোট ${res.result.rowsWritten} সারি আপডেট হয়েছে।`
                : `Synced ${res.result.tabsUpdated.length} tabs (${res.result.rowsWritten} rows).`,
          });
        } catch (err) {
          setBanner({ type: 'err', text: (err as Error).message });
        } finally {
          setBusyAction(null);
        }
      },
    });
  };

  const requestCloudBackup = () => {
    const targetName = config?.spreadsheet_title || config?.spreadsheet_id || 'Google Sheet';
    setPendingConfirm({
      title: lang === 'bn' ? 'ক্লাউড ব্যাকআপ স্ন্যাপশট সেভ করবেন?' : 'Write Full Cloud Backup Snapshot?',
      description:
        lang === 'bn'
          ? `"${targetName}"-এর "Cloud Backup" ট্যাবে সম্পূর্ণ AmarPOS ডাটাবেজের (পণ্য, ব্যাচ, বিক্রয়, কাস্টমার, বাকি, সেটিংস) এনক্রিপ্টেবল JSON ব্যাকআপ লেখা হবে।`
          : `This will overwrite the "Cloud Backup" tab in "${targetName}" with a full JSON snapshot of your entire SQLite database.`,
      confirmLabel: lang === 'bn' ? 'ব্যাকআপ সেভ করুন' : 'Save Cloud Backup',
      tone: 'teal',
      onConfirm: async () => {
        setBusyAction('backup');
        try {
          const res = await sheetsRequest<{ ok: boolean; result: { rowsWritten: number } }>('/api/sheets/backup', {
            method: 'POST',
            body: JSON.stringify({}),
          });
          await loadConfig();
          setBanner({
            type: 'ok',
            text:
              lang === 'bn'
                ? `ক্লাউড ব্যাকআপ সম্পন্ন (${res.result.rowsWritten}টি ব্লক)।`
                : `Cloud backup written to "Cloud Backup" tab (${res.result.rowsWritten} chunk row(s)).`,
          });
        } catch (err) {
          setBanner({ type: 'err', text: (err as Error).message });
        } finally {
          setBusyAction(null);
        }
      },
    });
  };

  const handleLoadPreview = async (overrideTab?: string) => {
    setBanner(null);
    setBusyAction('preview');
    try {
      const res = await sheetsRequest<GoogleSheetPreview>('/api/sheets/preview', {
        method: 'POST',
        body: JSON.stringify({
          spreadsheetInput: importSheetInput.trim() || undefined,
          tabName: overrideTab || undefined,
        }),
      });
      setPreview(res);
      setSelectedTab(res.selectedTab);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/unauthorized-domain/i.test(msg)) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
        setBanner({
          type: 'err',
          text:
            lang === 'bn'
              ? `Firebase এরর (auth/unauthorized-domain): আপনার বর্তমান হোস্ট/ডোমেইন (${currentHost}) Firebase Authentication-এ অনুমোদিত নয়। আপনি যদি '127.0.0.1' দিয়ে প্রবেশ করে থাকেন, তবে ব্রাউজারে 'http://localhost:3000' ব্যবহার করুন। অন্য ডোমেইন হলে Firebase Console > Authentication > Settings > Authorized Domains-এ '${currentHost}' যোগ করুন।`
              : `Firebase Error (auth/unauthorized-domain): Your current host (${currentHost}) is not authorized in Firebase. If accessing via '127.0.0.1', switch to 'http://localhost:3000', or add '${currentHost}' in Firebase Console > Authentication > Settings > Authorized domains.`,
        });
      } else {
        setBanner({ type: 'err', text: msg });
      }
    } finally {
      setBusyAction(null);
    }
  };

  const requestImportFromSheet = () => {
    if (!preview) return;
    const entityLabel =
      importEntity === 'products'
        ? lang === 'bn'
          ? 'পণ্য ও স্টক (Products)'
          : 'Products & Stock'
        : lang === 'bn'
          ? 'কাস্টমার ও বাকি (Customers)'
          : 'Customers & Dues';

    setPendingConfirm({
      title: lang === 'bn' ? `Google Sheet থেকে ${entityLabel} ইমপোর্ট করবেন?` : `Import ${entityLabel} into SQLite?`,
      description:
        lang === 'bn'
          ? `"${preview.title}" শীটের "${selectedTab}" ট্যাব থেকে ${preview.totalRows}টি সারি SQLite ডাটাবেজে (amarpos.db) যোগ বা আপডেট করা হবে।`
          : `This will read ${preview.totalRows} row(s) from tab "${selectedTab}" of "${preview.title}" and insert/update ${importEntity} in your local SQLite database.`,
      confirmLabel: lang === 'bn' ? 'ইমপোর্ট নিশ্চিত করুন' : 'Confirm Import',
      tone: 'amber',
      onConfirm: async () => {
        setBusyAction('import');
        try {
          const res = await sheetsRequest<{ ok: boolean; inserted: number; updated: number; skipped: number; detail: string }>(
            '/api/sheets/import',
            {
              method: 'POST',
              body: JSON.stringify({
                entityType: importEntity,
                spreadsheetInput: importSheetInput.trim() || preview.spreadsheetId,
                tabName: selectedTab,
              }),
            }
          );
          await loadConfig();
          if (onRefreshData) await onRefreshData();
          setBanner({ type: 'ok', text: res.detail });
        } catch (err) {
          setBanner({ type: 'err', text: (err as Error).message });
        } finally {
          setBusyAction(null);
        }
      },
    });
  };

  const handleCsvDownload = async (dataset: 'pnl' | 'sales' | 'purchases' | 'expenses' | 'products' | 'customers') => {
    setBusyAction(`csv-${dataset}`);
    setBanner(null);
    try {
      await downloadCsvBackup(dataset);
      setBanner({
        type: 'ok',
        text:
          lang === 'bn'
            ? 'কম্পিউটারের জন্য CSV রিপোর্ট ডাউনলোড হয়েছে (Excel-এ খোলা যাবে)।'
            : 'CSV report downloaded to your computer.',
      });
    } catch (err) {
      const msg = (err as Error).message || '';
      if (/unauthorized-domain/i.test(msg)) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : '';
        setBanner({
          type: 'err',
          text:
            lang === 'bn'
              ? `Firebase এরর (auth/unauthorized-domain): আপনার বর্তমান হোস্ট/ডোমেইন (${currentHost}) Firebase Authentication-এ অনুমোদিত নয়। আপনি যদি '127.0.0.1' দিয়ে প্রবেশ করে থাকেন, তবে ব্রাউজারে 'http://localhost:3000' ব্যবহার করুন। অন্য ডোমেইন হলে Firebase Console > Authentication > Settings > Authorized Domains-এ '${currentHost}' যোগ করুন।`
              : `Firebase Error (auth/unauthorized-domain): Your current host (${currentHost}) is not authorized in Firebase. If accessing via '127.0.0.1', switch to 'http://localhost:3000', or add '${currentHost}' in Firebase Console > Authentication > Settings > Authorized domains.`,
        });
      } else {
        setBanner({ type: 'err', text: msg });
      }
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Architecture & Google Sign-In Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <h3 className="font-display font-semibold text-base flex items-center gap-2 text-slate-900 dark:text-white">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              {lang === 'bn'
                ? 'হাইব্রিড ব্যাকআপ: লোকাল SQLite (কম্পিউটার) + Google Sheets অটো-সিঙ্ক'
                : 'Hybrid Backup: Local SQLite + Computer CSV + Google Sheets Auto-Sync'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {lang === 'bn'
                ? 'মূল দ্রুত বিলিং ও অফলাইন FEFO স্টক আপনার লোকাল SQLite (amarpos.db)-এ সুরক্ষিত থাকে। পাশাপাশি প্রতিদিনের বিক্রয়, ক্রয়, খরচ, লাভ-ক্ষতি, স্টক এবং কাস্টমার বাকি অটোমেটিক Google Sheet-এ সিঙ্ক হয় এবং কম্পিউটারে JSON/CSV হিসেবে ডাউনলোড করা যায়।'
                : 'Fast offline/online POS billing runs on local SQLite (amarpos.db). Sales, purchases, expenses, P&L, stock, and customer dues automatically sync to Google Sheets and can also be exported to your computer as Excel-ready CSV or JSON.'}
            </p>
          </div>

          {/* Google Account Auth Control */}
          <div className="flex flex-col items-end gap-2">
            {!googleToken ? (
              <button
                type="button"
                disabled={!isOnline || busyAction === 'auth'}
                onClick={handleGoogleSignIn}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className="block">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {busyAction === 'auth' ? 'Connecting...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                    {googleEmail || (lang === 'bn' ? 'Google সংযুক্ত' : 'Google Connected')}
                  </div>
                  <div className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                    {lang === 'bn' ? 'অস্থায়ী সেশন টোকেন সক্রিয়' : 'In-memory session authorized'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleGoogleSignOut}
                  className="ml-2 p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900 text-slate-500 hover:text-red-600"
                  title={lang === 'bn' ? 'Google থেকে লগ আউট' : 'Sign out Google'}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {banner && (
          <div
            className={`rounded-lg px-3.5 py-2.5 text-xs flex items-center justify-between border ${
              banner.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
            }`}
          >
            <span>{banner.text}</span>
            <button type="button" onClick={() => setBanner(null)} className="ml-2 opacity-70 hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Connected Sheet Status Row */}
        {config && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
              <div className="text-[11px] text-slate-500 mb-0.5">
                {lang === 'bn' ? 'সংযুক্ত Google Sheet' : 'Connected Workbook'}
              </div>
              {config.spreadsheet_id ? (
                <div className="space-y-1">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">
                    {config.spreadsheet_title || config.spreadsheet_id}
                  </div>
                  <a
                    href={config.spreadsheet_url || `https://docs.google.com/spreadsheets/d/${config.spreadsheet_id}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-400 hover:underline font-medium"
                  >
                    {lang === 'bn' ? 'Google Sheet খুলুন' : 'Open Live Google Sheet'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <div className="text-amber-600 font-medium">
                  {lang === 'bn' ? 'এখনও কোনো শীট সংযুক্ত নয়' : 'Not connected yet'}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
              <div className="text-[11px] text-slate-500 mb-0.5">
                {lang === 'bn' ? 'অটো-সিঙ্ক স্ট্যাটাস' : 'Auto-Sync Mode'}
              </div>
              <div className="font-semibold flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    config.auto_sync_enabled && config.spreadsheet_id ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                />
                {config.auto_sync_enabled
                  ? lang === 'bn'
                    ? 'চালু (প্রতি বিক্রয়/ক্রয়/খরচে অটো সিঙ্ক)'
                    : 'Enabled (Auto-sync on POS changes)'
                  : lang === 'bn'
                    ? 'বন্ধ (শুধু ম্যানুয়াল সিঙ্ক)'
                    : 'Paused (Manual sync only)'}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 truncate">
                {config.last_sync_at ? `${config.last_sync_status} · ${config.last_sync_at}` : 'No sync recorded yet'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 flex flex-col justify-between gap-2">
              <div className="text-[11px] text-slate-500 truncate">
                {config.last_sync_detail || (lang === 'bn' ? 'সিঙ্ক করার জন্য প্রস্তুত' : 'Ready to sync')}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!isOnline || !googleToken || !config.spreadsheet_id || busyAction !== null}
                  onClick={requestManualSync}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white font-semibold"
                >
                  {busyAction === 'sync' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {lang === 'bn' ? 'এখনই সিঙ্ক' : 'Sync All Now'}
                </button>
                {canManageSettings && (
                  <button
                    type="button"
                    disabled={!isOnline || !googleToken || !config.spreadsheet_id || busyAction !== null}
                    onClick={requestCloudBackup}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 font-semibold"
                  >
                    {busyAction === 'backup' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudUpload className="w-3.5 h-3.5" />}
                    {lang === 'bn' ? 'ক্লাউড ব্যাকআপ' : 'Cloud Snapshot'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Controls Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Create/Connect + Auto-Sync Settings */}
        <div className="lg:col-span-7 space-y-5">
          {canManageSettings && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
              <h4 className="font-display font-semibold text-sm flex items-center gap-2">
                <FolderSync className="w-4 h-4 text-teal-700" />
                {lang === 'bn' ? '১. Google Sheet তৈরি বা সংযুক্ত করুন' : '1. Create or Connect Google Spreadsheet'}
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/70 dark:bg-slate-950/60">
                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <PlusCircle className="w-3.5 h-3.5 text-emerald-600" />
                    {lang === 'bn' ? 'নতুন ফরম্যাট করা শীট তৈরি' : 'Create New AmarPOS Sheet'}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {lang === 'bn'
                      ? 'লাভ-ক্ষতি, বিক্রয়, ক্রয়, খরচ, স্টক ও বাকি ট্যাবসহ নতুন Google Sheet তৈরি করে।'
                      : 'Creates a fresh multi-tab workbook and performs initial sync.'}
                  </p>
                  <input
                    value={newSheetTitle}
                    onChange={(e) => setNewSheetTitle(e.target.value)}
                    placeholder="Spreadsheet Title"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                  />
                  <button
                    type="button"
                    disabled={!isOnline || !googleToken || busyAction !== null}
                    onClick={requestCreateWorkbook}
                    className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold"
                  >
                    {busyAction === 'create'
                      ? lang === 'bn'
                        ? 'তৈরি হচ্ছে...'
                        : 'Creating...'
                      : lang === 'bn'
                        ? 'নতুন Google Sheet তৈরি ও সিঙ্ক'
                        : 'Create & Initial Sync'}
                  </button>
                </div>

                <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2.5 bg-slate-50/70 dark:bg-slate-950/60">
                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-teal-700" />
                    {lang === 'bn' ? 'আগের Google Sheet লিঙ্ক করুন' : 'Connect Existing Sheet'}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {lang === 'bn'
                      ? 'আপনার Google Sheets লিংক বা Spreadsheet ID এখানে পেস্ট করুন।'
                      : 'Paste any Google Sheet URL or Spreadsheet ID you own/edit.'}
                  </p>
                  <input
                    value={connectInput}
                    onChange={(e) => setConnectInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2"
                  />
                  <button
                    type="button"
                    disabled={!isOnline || !googleToken || !connectInput.trim() || busyAction !== null}
                    onClick={requestConnectExisting}
                    className="w-full py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-40 font-semibold"
                  >
                    {busyAction === 'connect'
                      ? lang === 'bn'
                        ? 'সংযুক্ত হচ্ছে...'
                        : 'Connecting...'
                      : lang === 'bn'
                        ? 'শীট সংযুক্ত করুন'
                        : 'Connect Spreadsheet'}
                  </button>
                </div>
              </div>

              {config && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(config.auto_sync_enabled)}
                        onChange={(e) => {
                          const nextVal = e.target.checked ? 1 : 0;
                          updateConfigFields(
                            { auto_sync_enabled: nextVal },
                            nextVal ? (lang === 'bn' ? 'অটো-সিঙ্ক চালু করবেন?' : 'Enable Automatic Google Sheet Sync?') : (lang === 'bn' ? 'অটো-সিঙ্ক বন্ধ করবেন?' : 'Pause Automatic Sync?'),
                            nextVal
                              ? lang === 'bn'
                                ? 'চালু করলে প্রতিটি বিক্রয়, ক্রয়, খরচ, স্টক ও বাকি পরিবর্তনের ২ সেকেন্ড পর অটোমেটিক আপনার Google Sheet আপডেট হবে (যতক্ষণ ব্রাউজার ও Google সেশন খোলা থাকবে)।'
                                : 'When enabled, every POS sale, purchase, expense, due payment, or inventory update automatically updates your connected Google Sheet when online.'
                              : lang === 'bn'
                                ? 'অটো-সিঙ্ক বন্ধ করলে শুধু ম্যানুয়ালি "Sync All Now" ক্লিক করলে শীট আপডেট হবে।'
                                : 'Automatic background writes will be paused until you enable them again.'
                          );
                        }}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span>
                        {lang === 'bn'
                          ? 'লেনদেনের সাথে সাথে অটোমেটিক Google Sheet-এ পাঠান (Auto-Sync)'
                          : 'Auto-Sync to Google Sheets on every POS transaction'}
                      </span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {(
                      [
                        ['sync_pnl', lang === 'bn' ? 'দৈনিক লাভ-ক্ষতি (P&L)' : 'Daily P&L'],
                        ['sync_sales', lang === 'bn' ? 'বিক্রয় (Sales)' : 'Sales Ledger'],
                        ['sync_purchases', lang === 'bn' ? 'ক্রয় (Purchases)' : 'Purchases'],
                        ['sync_expenses', lang === 'bn' ? 'খরচ (Expenses)' : 'Expenses'],
                        ['sync_products', lang === 'bn' ? 'পণ্য ও স্টক' : 'Products & Stock'],
                        ['sync_customers', lang === 'bn' ? 'কাস্টমার বাকি' : 'Customer Dues'],
                      ] as const
                    ).map(([field, label]) => (
                      <label
                        key={field}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(config[field])}
                          onChange={(e) => {
                            const val = e.target.checked ? 1 : 0;
                            updateConfigFields(
                              { [field]: val },
                              lang === 'bn' ? 'সিঙ্ক ট্যাব পরিবর্তন সেভ করবেন?' : 'Update Synced Sheet Tabs?',
                              lang === 'bn'
                                ? `"${label}" ট্যাবটি সিঙ্ক তালিকায় ${val ? 'যুক্ত' : 'বাদ'} করা হবে।`
                                : `"${label}" will be ${val ? 'included in' : 'excluded from'} future Google Sheets syncs.`
                            );
                          }}
                          className="rounded border-slate-300 text-teal-700"
                        />
                        <span className="truncate">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Import Products / Customers from Google Sheet */}
          {canManageSettings && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-display font-semibold text-sm flex items-center gap-2">
                  <Table className="w-4 h-4 text-teal-700" />
                  {lang === 'bn' ? '২. Google Sheet থেকে পণ্য বা কাস্টমার ইমপোর্ট' : '2. Preview & Import from Google Sheet'}
                </h4>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setImportEntity('products')}
                    className={`px-3 py-1 font-medium ${
                      importEntity === 'products' ? 'bg-teal-700 text-white' : 'bg-white dark:bg-slate-900 text-slate-600'
                    }`}
                  >
                    {lang === 'bn' ? 'পণ্য (Products)' : 'Products'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportEntity('customers')}
                    className={`px-3 py-1 font-medium ${
                      importEntity === 'customers' ? 'bg-teal-700 text-white' : 'bg-white dark:bg-slate-900 text-slate-600'
                    }`}
                  >
                    {lang === 'bn' ? 'কাস্টমার (Customers)' : 'Customers'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  value={importSheetInput}
                  onChange={(e) => setImportSheetInput(e.target.value)}
                  placeholder={
                    config?.spreadsheet_id
                      ? lang === 'bn'
                        ? `খালি রাখলে "${config.spreadsheet_title || 'সংযুক্ত শীট'}" থেকে পড়া হবে, অথবা নতুন URL দিন`
                        : `Leave blank to use "${config.spreadsheet_title || 'connected sheet'}", or paste another Sheet URL`
                      : 'Paste Google Sheet URL or ID'
                  }
                  className="flex-1 min-w-[220px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
                <button
                  type="button"
                  disabled={!isOnline || !googleToken || busyAction !== null}
                  onClick={() => handleLoadPreview()}
                  className="px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold disabled:opacity-40"
                >
                  {busyAction === 'preview' ? (lang === 'bn' ? 'পড়ছে...' : 'Loading...') : lang === 'bn' ? 'ট্যাব দেখুন' : 'Load Tabs & Preview'}
                </button>
              </div>

              {preview && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-950 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    <div>
                      <span className="font-semibold">{preview.title}</span> ·{' '}
                      <span className="text-slate-500">{preview.totalRows} data row(s)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedTab}
                        onChange={(e) => {
                          setSelectedTab(e.target.value);
                          handleLoadPreview(e.target.value);
                        }}
                        className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                      >
                        {preview.sheetTitles.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!preview.totalRows || busyAction !== null}
                        onClick={requestImportFromSheet}
                        className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold disabled:opacity-40"
                      >
                        {busyAction === 'import'
                          ? lang === 'bn'
                            ? 'ইমপোর্ট হচ্ছে...'
                            : 'Importing...'
                          : lang === 'bn'
                            ? `${importEntity === 'products' ? 'পণ্য' : 'কাস্টমার'} ইমপোর্ট করুন`
                            : `Import ${importEntity === 'products' ? 'Products' : 'Customers'}`}
                      </button>
                    </div>
                  </div>

                  {preview.headers.length > 0 && (
                    <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg max-h-56">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-100 dark:bg-slate-950 text-slate-600 dark:text-slate-300 sticky top-0">
                          <tr>
                            {preview.headers.slice(0, 8).map((h, i) => (
                              <th key={i} className="py-1.5 px-2.5 font-semibold whitespace-nowrap">
                                {h || `Col ${i + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {preview.previewRows.slice(0, 6).map((row, rIdx) => (
                            <tr key={rIdx}>
                              {preview.headers.slice(0, 8).map((_, cIdx) => (
                                <td key={cIdx} className="py-1.5 px-2.5 whitespace-nowrap max-w-[160px] truncate">
                                  {row[cIdx] || ''}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Computer CSV Exports + Google Sync Logs */}
        <div className="lg:col-span-5 space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
            <h4 className="font-display font-semibold text-sm flex items-center gap-2">
              <Download className="w-4 h-4 text-teal-700" />
              {lang === 'bn' ? 'কম্পিউটার ব্যাকআপ (Excel / CSV ডাউনলোড)' : 'Computer Archive (Excel-Ready CSV Downloads)'}
            </h4>
            <p className="text-slate-500">
              {lang === 'bn'
                ? 'ইন্টারনেট ছাড়াই আপনার কম্পিউটারে আলাদা করে সংরক্ষণের জন্য যেকোনো তালিকা CSV ফরম্যাটে ডাউনলোড করুন।'
                : 'Download local UTF-8 CSV spreadsheets from SQLite for offline PC archiving or Microsoft Excel.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CSV_DATASETS.map((ds) => (
                <button
                  key={ds.id}
                  type="button"
                  disabled={!isOnline || busyAction === `csv-${ds.id}`}
                  onClick={() => handleCsvDownload(ds.id)}
                  className="inline-flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 font-medium text-left"
                >
                  <span className="truncate">{lang === 'bn' ? ds.bn : ds.en}</span>
                  {busyAction === `csv-${ds.id}` ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
            <h4 className="font-display font-semibold text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              {lang === 'bn' ? 'Google Sheets সিঙ্ক ও ব্যাকআপ লগ' : 'Google Sheets Sync & Backup Logs'}
            </h4>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {logs.map((l) => (
                <div key={l.id} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 space-y-0.5">
                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{l.action}</span>
                    <span className={l.status === 'FAILED' ? 'text-red-600 font-semibold' : 'text-emerald-600 font-semibold'}>
                      {l.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">{l.detail}</div>
                  <div className="text-[10px] font-mono text-slate-400">{l.created_at}</div>
                </div>
              ))}
              {!logs.length && (
                <div className="text-slate-400 py-6 text-center">
                  {lang === 'bn' ? 'এখনও কোনো Google Sheets সিঙ্ক লগ নেই।' : 'No Google Sheets sync activity logged yet.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Explicit Confirmation Dialog Modal */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-5 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-lg shrink-0 ${
                  pendingConfirm.tone === 'amber'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                    : 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                  {pendingConfirm.title}
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {pendingConfirm.description}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {lang === 'bn' ? 'বাতিল (Cancel)' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={runConfirmedAction}
                className={`px-4 py-2 rounded-lg text-xs font-semibold text-white ${
                  pendingConfirm.tone === 'amber'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-teal-700 hover:bg-teal-800'
                }`}
              >
                {pendingConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
