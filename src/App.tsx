import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Building2,
  Camera,
  Cloud,
  Coins,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Package,
  Printer,
  Receipt,
  RefreshCw,
  RotateCcw,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Truck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { apiFetch, setAuthToken } from './lib/api';
import { clearExpiredGoogleToken, getGoogleAccessToken } from './lib/googleSheetsAuth';
import {
  cacheCatalogToIndexedDB,
  getPendingQueue,
  markQueueItemFailed,
  markQueueItemSynced,
  readOfflineCatalog,
} from './lib/offlineDb';
import { MENU_LABELS, type Lang } from './i18n';
import type { AuthUser, CartItem, Category, Customer, Expense, GoogleSheetsConfig, Product, Sale, ShopSettings, Supplier } from './types';
import { OfflineBanner, PWAInstallButton, useOnlineStatus } from './components/PWAInstallButton';
import { InvoiceModal } from './components/InvoiceModal';
import { AuthView } from './views/AuthView';
import { DashboardView } from './views/DashboardView';
import { POSView } from './views/POSView';
import { AIScannerView } from './views/AIScannerView';
import { InventoryView } from './views/InventoryView';
import { PurchasesView } from './views/PurchasesView';
import { CustomersView } from './views/CustomersView';
import { DuesMessagingView } from './views/DuesMessagingView';
import { ReportsInvoicesView } from './views/ReportsInvoicesView';
import { LedgerView } from './views/LedgerView';
import { EcommerceAdminView, PublicStorefrontView } from './views/EcommerceView';
import { AdminSyncView } from './views/AdminSyncView';
import { AboutView } from './views/AboutView';

type TabId =
  | 'dashboard'
  | 'pos'
  | 'purchases'
  | 'invoices'
  | 'inventory'
  | 'expenses'
  | 'ledger'
  | 'customers'
  | 'dues'
  | 'suppliers'
  | 'returns'
  | 'reports'
  | 'users'
  | 'messaging'
  | 'settings'
  | 'aiScanner'
  | 'ecommerce'
  | 'sync'
  | 'about';

export default function App() {
  const isOnline = useOnlineStatus();
  const [dark, setDark] = useState(false);
  const [lang, setLang] = useState<Lang>('en');
  const [viewMode, setViewMode] = useState<'pos_app' | 'storefront'>('pos_app');

  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(() => {
    try {
      const saved = localStorage.getItem('amarpos_saved_shop_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.shop_name && parsed.shop_name !== 'AmarCare Pharmacy & Retail') {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return {
      shop_name: 'ইসলাম মেডিকেল এন্ড ই-সেন্টার',
      shop_name_bn: 'ইসলাম মেডিকেল এন্ড ই-সেন্টার',
      address: 'গাজীমাহমুদ, নিশানবাড়িয়া, বরগুনা সদর, বরগুনা',
      phone: '01719565306, 01825333334, 01729677646',
      email: 'islammedical@gmail.com',
      vat_reg_no: '',
      default_vat_percent: 0,
      currency: 'BDT',
      receipt_footer: 'ধন্যবাদ! আবার আসবেন / সুস্থ থাকুন, ভালো থাকুন',
      thermal_width: '80mm',
      sms_gateway_url: '',
      whatsapp_phone_id: '',
      promo_banner_text: 'ইসলাম মেডিকেল এন্ড ই-সেন্টার — আপনার বিশ্বস্ত স্বাস্থ্যসেবা ও ডিজিটাল সেবা কেন্দ্র',
      promo_banner_active: 1,
    };
  });
  const [cart, setCart] = useState<CartItem[]>([]);
  const [printSale, setPrintSale] = useState<Sale | null>(null);

  const [pendingCount, setPendingCount] = useState(0);
  const [syncState, setSyncState] = useState<'IDLE' | 'SYNCING' | 'DONE' | 'ERROR'>('IDLE');
  const [sheetsAutoReady, setSheetsAutoReady] = useState(false);
  const autoSyncTimerRef = useRef<number | null>(null);

  // Sync settings with document.title and localStorage
  useEffect(() => {
    if (settings) {
      try {
        localStorage.setItem('amarpos_saved_shop_settings', JSON.stringify(settings));
      } catch {
        // ignore
      }
    }
    const title = settings?.shop_name?.trim() || 'ইসলাম মেডিকেল এন্ড ই-সেন্টার';
    document.title = `${title} · Retail & Pharmacy POS`;
  }, [settings]);

  // Load public store settings on boot (even before login)
  useEffect(() => {
    apiFetch<ShopSettings>('/api/settings')
      .then((s) => {
        if (s) {
          const cachedRaw = localStorage.getItem('amarpos_saved_shop_settings');
          if (cachedRaw) {
            try {
              const cached = JSON.parse(cachedRaw) as ShopSettings;
              if (cached.shop_name && cached.shop_name !== 'AmarCare Pharmacy & Retail') {
                setSettings(cached);
                return;
              }
            } catch {
              // ignore
            }
          }
          setSettings(s);
        }
      })
      .catch(() => {
        // offline fallback handled by initial state
      });
  }, []);

  // Auto-restore and synchronize permanent Gemini API Key and SMS Gateway from localStorage if server lacks them
  useEffect(() => {
    if (!isOnline) return;

    // 1. Silent Gemini Key sync
    const localGeminiKey = localStorage.getItem('amarpos_gemini_api_key')?.trim();
    if (localGeminiKey) {
      apiFetch<{ configured: boolean }>('/api/settings/gemini-key')
        .then((res) => {
          if (!res.configured) {
            apiFetch('/api/settings/gemini-key', {
              method: 'POST',
              body: JSON.stringify({ apiKey: localGeminiKey }),
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }

    // 2. Silent SMS Gateway sync
    const localGwRaw = localStorage.getItem('amarpos_permanent_sms_gateway');
    if (localGwRaw) {
      apiFetch<Array<{ active: number; is_default: number; sender_id?: string; key_hint?: string }>>('/api/sms/gateways')
        .then((gws) => {
          const hasActiveCredentials = gws.some((g) => g.active === 1 && (g.key_hint || g.sender_id));
          if (!hasActiveCredentials) {
            try {
              const parsed = JSON.parse(localGwRaw);
              if (parsed && parsed.name && parsed.base_url) {
                apiFetch('/api/sms/gateways', {
                  method: 'POST',
                  body: JSON.stringify({ ...parsed, is_default: true, active: true }),
                }).catch(() => {});
              }
            } catch {}
          }
        })
        .catch(() => {});
    }
  }, [isOnline]);

  // Listen to custom settings update events
  useEffect(() => {
    const handleSettingsUpdated = (e: Event) => {
      const customEvent = e as CustomEvent<ShopSettings>;
      if (customEvent.detail) {
        setSettings(customEvent.detail);
      }
    };
    window.addEventListener('amarpos:settings-updated', handleSettingsUpdated);
    return () => window.removeEventListener('amarpos:settings-updated', handleSettingsUpdated);
  }, []);

  // Toggle .dark class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // Check bootstrap status and restore active persistent session on boot
  useEffect(() => {
    apiFetch<{ authenticated: boolean; user: AuthUser | null; needsBootstrap: boolean }>('/api/auth/session')
      .then((res) => {
        setNeedsBootstrap(res.needsBootstrap);
        if (res.authenticated && res.user) {
          setUser(res.user);
        }
      })
      .catch(() => setNeedsBootstrap(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const refreshData = useCallback(async () => {
    const q = await getPendingQueue();
    setPendingCount(q.length);

    // 1. Instantly load local offline database for 0ms immediate render
    try {
      const offline = await readOfflineCatalog();
      if (offline.products.length > 0) {
        setProducts(offline.products);
        setCategories(offline.categories);
        setCustomers(offline.customers);
        setSales(offline.sales);
      }
    } catch {
      // ignore
    }

    if (!isOnline) {
      return;
    }

    // 2. In background, fetch fresh data from server without freezing UI
    try {
      const [prods, cats, custs, sls, sets, sups, exps] = await Promise.all([
        apiFetch<Product[]>('/api/products', { timeoutMs: 4000 }),
        apiFetch<Category[]>('/api/categories', { timeoutMs: 4000 }),
        apiFetch<Customer[]>('/api/customers', { timeoutMs: 4000 }),
        apiFetch<Sale[]>('/api/sales', { timeoutMs: 4000 }),
        apiFetch<ShopSettings>('/api/settings', { timeoutMs: 4000 }).catch(() => null),
        apiFetch<Supplier[]>('/api/suppliers', { timeoutMs: 4000 }).catch(() => []),
        apiFetch<Expense[]>('/api/expenses', { timeoutMs: 4000 }).catch(() => []),
      ]);
      setProducts(prods);
      setCategories(cats);
      setCustomers(custs);
      setSales(sls);
      if (sets) setSettings(sets);
      void cacheCatalogToIndexedDB(prods, cats, custs, sls, sups, exps);
    } catch {
      // offline already rendered, zero disruption
    }
  }, [isOnline]);

  const triggerAutoGoogleSync = useCallback(
    async (reason: string) => {
      if (!isOnline || !user || !sheetsAutoReady) return;
      const gToken = getGoogleAccessToken();
      if (!gToken) return;
      try {
        await apiFetch('/api/sheets/sync', {
          method: 'POST',
          headers: { 'X-Google-Access-Token': gToken },
          body: JSON.stringify({ reason }),
        });
      } catch (err) {
        if (/expired|authorization token|401/i.test((err as Error).message || '')) {
          clearExpiredGoogleToken();
        }
      }
    },
    [isOnline, user, sheetsAutoReady]
  );

  const syncNow = useCallback(async () => {
    if (!isOnline || !user) return;
    const queue = await getPendingQueue();
    setPendingCount(queue.length);
    if (queue.length === 0) return;

    setSyncState('SYNCING');
    try {
      const res = await apiFetch<{ results: Array<{ id: string; status: string; conflict?: string }> }>(
        '/api/sync/batch',
        {
          method: 'POST',
          body: JSON.stringify({ operations: queue }),
        }
      );
      for (const r of res.results) {
        if (r.status === 'FAILED') {
          await markQueueItemFailed(r.id, r.conflict || 'Sync failed');
        } else {
          await markQueueItemSynced(r.id);
        }
      }
      const remaining = await getPendingQueue();
      setPendingCount(remaining.length);
      setSyncState(remaining.length === 0 ? 'DONE' : 'ERROR');
      await refreshData();
      if (res.results.length > 0) {
        void triggerAutoGoogleSync('offline-queue-synced');
      }
    } catch {
      setSyncState('ERROR');
    }
  }, [isOnline, user, refreshData, triggerAutoGoogleSync]);

  useEffect(() => {
    if (!user || !isOnline) {
      setSheetsAutoReady(false);
      return;
    }
    apiFetch<{ config: GoogleSheetsConfig }>('/api/sheets/config')
      .then((res) => {
        setSheetsAutoReady(Boolean(res.config?.spreadsheet_id && res.config?.auto_sync_enabled));
      })
      .catch(() => setSheetsAutoReady(false));
  }, [user, isOnline]);

  useEffect(() => {
    const onConfigUpdated = (e: Event) => {
      const cfg = (e as CustomEvent<GoogleSheetsConfig>).detail;
      setSheetsAutoReady(Boolean(cfg?.spreadsheet_id && cfg?.auto_sync_enabled));
    };
    const onTxCompleted = () => {
      if (!isOnline || !user || !sheetsAutoReady || !getGoogleAccessToken()) return;
      if (autoSyncTimerRef.current !== null) {
        window.clearTimeout(autoSyncTimerRef.current);
      }
      autoSyncTimerRef.current = window.setTimeout(() => {
        autoSyncTimerRef.current = null;
        void triggerAutoGoogleSync('auto-transaction');
      }, 2000);
    };
    window.addEventListener('amarpos:sheets-config-updated', onConfigUpdated);
    window.addEventListener('amarpos:tx-completed', onTxCompleted);
    return () => {
      window.removeEventListener('amarpos:sheets-config-updated', onConfigUpdated);
      window.removeEventListener('amarpos:tx-completed', onTxCompleted);
      if (autoSyncTimerRef.current !== null) {
        window.clearTimeout(autoSyncTimerRef.current);
      }
    };
  }, [isOnline, user, sheetsAutoReady, triggerAutoGoogleSync]);

  useEffect(() => {
    if (user) {
      refreshData().then(() => {
        if (isOnline) syncNow();
      });
    }
  }, [user, isOnline, refreshData, syncNow]);

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore offline logout
    }
    setAuthToken(null);
    setUser(null);
  };

  const addScannedProductToCart = (p: Product) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === p.id);
      if (idx >= 0) {
        return prev.map((c, i) => (i === idx ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [
        ...prev,
        {
          product: p,
          unit: (['Piece', 'Tablet', 'Strip', 'Box', 'Bottle'].includes(p.unit) ? p.unit : 'Piece') as CartItem['unit'],
          unit_multiplier: 1,
          quantity: 1,
          unit_price: p.retail_price,
          discount: 0,
        },
      ];
    });
    setActiveTab('pos');
  };

  if (viewMode === 'storefront') {
    return <PublicStorefrontView onBackToPOS={() => setViewMode('pos_app')} />;
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-xs text-slate-500">
        Loading AmarPOS Smart AI...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthView
        needsBootstrap={needsBootstrap}
        lang={lang}
        settings={settings}
        onToggleLang={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
        onAuthenticated={(u) => {
          setNeedsBootstrap(false);
          setUser(u);
        }}
        onOpenStorefront={() => setViewMode('storefront')}
      />
    );
  }

  const navItems: Array<{ id: TabId; icon: React.FC<{ className?: string }>; perm?: string }> = [
    { id: 'dashboard', icon: LayoutDashboard },
    { id: 'pos', icon: ShoppingCart, perm: 'create_sales' },
    { id: 'purchases', icon: Truck, perm: 'manage_purchases' },
    { id: 'invoices', icon: Receipt },
    { id: 'inventory', icon: Package },
    { id: 'expenses', icon: Coins, perm: 'view_profit_reports' },
    { id: 'ledger', icon: BookOpen },
    { id: 'customers', icon: Users, perm: 'manage_customers' },
    { id: 'dues', icon: Wallet, perm: 'collect_dues' },
    { id: 'suppliers', icon: Building2, perm: 'manage_purchases' },
    { id: 'returns', icon: RotateCcw, perm: 'create_sales' },
    { id: 'reports', icon: BarChart3, perm: 'view_profit_reports' },
    { id: 'users', icon: ShieldCheck, perm: 'manage_users' },
    { id: 'messaging', icon: MessageSquare, perm: 'send_messages' },
    { id: 'settings', icon: Settings, perm: 'manage_settings' },
  ];

  const visibleNav = navItems.filter((n) => !n.perm || user.permissions.includes(n.perm));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <OfflineBanner pendingCount={pendingCount} />

      <div className="flex flex-1 min-h-0">
        {/* Sidebar (256px Desktop, Drawer Mobile) */}
        <aside
          className={`no-print fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform lg:static lg:translate-x-0 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              {settings?.logo_url ? (
                <img src={settings.logo_url} alt="Logo" className="w-8 h-8 rounded-lg object-contain bg-slate-50 dark:bg-slate-800 p-0.5 shrink-0" />
              ) : null}
              <div className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white truncate">
                {settings?.shop_name || 'ইসলাম মেডিকেল এন্ড ই-সেন্টার'}
              </div>
            </div>
            <button onClick={() => setMobileMenuOpen(false)} className="lg:hidden p-1 text-slate-500">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all text-left ${
                    active
                      ? 'bg-teal-700 text-white shadow-sm font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                  <span className="truncate">{MENU_LABELS[item.id][lang]}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <div className="px-2 py-1">
              <div className="font-semibold text-slate-900 dark:text-white truncate">{user.name}</div>
              <div className="text-[11px] text-slate-500">{user.role}</div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <LogOut className="w-4 h-4" />
              <span>{lang === 'bn' ? 'লগ আউট' : 'Sign Out'}</span>
            </button>
          </div>
        </aside>

        {/* Main Workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="no-print bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-5 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                <Menu className="w-4 h-4" />
              </button>
              <div className="font-display font-semibold text-sm truncate">
                {MENU_LABELS[activeTab][lang]}
              </div>
              <span className="hidden sm:inline text-xs text-slate-400">·</span>
              <span className="hidden sm:inline text-xs text-slate-500 truncate">
                {isOnline ? (syncState === 'SYNCING' ? 'Syncing...' : 'Online') : 'Offline'}
                {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {pendingCount > 0 && isOnline && (
                <button
                  onClick={syncNow}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3 h-3 ${syncState === 'SYNCING' ? 'animate-spin' : ''}`} />
                  Sync ({pendingCount})
                </button>
              )}

              <PWAInstallButton />

              <button
                onClick={() => setViewMode('storefront')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {lang === 'bn' ? 'অনলাইন স্টোর' : 'Storefront'}
              </button>

              <button
                onClick={() => setLang((l) => (l === 'en' ? 'bn' : 'en'))}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                {lang === 'en' ? 'বাংলা' : 'EN'}
              </button>

              <button
                onClick={() => setDark((d) => !d)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                aria-label="Toggle color theme"
              >
                {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-5 overflow-y-auto max-w-[1440px] w-full mx-auto pb-20 lg:pb-6">
            {activeTab === 'dashboard' && <DashboardView lang={lang} onNavigate={(t) => setActiveTab(t as TabId)} />}
            {activeTab === 'pos' && (
              <POSView
                lang={lang}
                isOnline={isOnline}
                products={products}
                categories={categories}
                customers={customers}
                sales={sales}
                settings={settings}
                cart={cart}
                setCart={setCart}
                onOpenAIScanner={() => setActiveTab('aiScanner')}
                onRefreshData={refreshData}
                onPrintSale={setPrintSale}
              />
            )}
            {activeTab === 'aiScanner' && (
              <AIScannerView
                lang={lang}
                isOnline={isOnline}
                categories={categories}
                onAddProductToCart={addScannedProductToCart}
                onRefreshCatalog={refreshData}
              />
            )}
            {activeTab === 'inventory' && (
              <InventoryView lang={lang} user={user} products={products} categories={categories} onRefresh={refreshData} />
            )}
            {activeTab === 'purchases' && (
              <PurchasesView initialTab="purchases" lang={lang} products={products} onRefreshCatalog={refreshData} />
            )}
            {activeTab === 'suppliers' && (
              <PurchasesView initialTab="suppliers" lang={lang} products={products} onRefreshCatalog={refreshData} />
            )}
            {activeTab === 'expenses' && (
              <ReportsInvoicesView
                mode="expenses"
                lang={lang}
                isOnline={isOnline}
                sales={sales}
                onRefresh={refreshData}
                onPrintSale={setPrintSale}
              />
            )}
            {activeTab === 'returns' && (
              <ReportsInvoicesView
                mode="returns"
                lang={lang}
                isOnline={isOnline}
                sales={sales}
                onRefresh={refreshData}
                onPrintSale={setPrintSale}
              />
            )}
            {activeTab === 'ledger' && (
              <LedgerView
                lang={lang}
                isOnline={isOnline}
                customers={customers}
                sales={sales}
                settings={settings}
                onRefresh={refreshData}
              />
            )}
            {activeTab === 'customers' && (
              <CustomersView
                lang={lang}
                customers={customers}
                isOnline={isOnline}
                settings={settings}
                onRefresh={refreshData}
              />
            )}
            {activeTab === 'dues' && (
              <DuesMessagingView
                mode="dues"
                lang={lang}
                isOnline={isOnline}
                customers={customers}
                settings={settings}
                canManageGateways={user.permissions.includes('manage_settings')}
                onRefresh={refreshData}
              />
            )}
            {activeTab === 'messaging' && (
              <DuesMessagingView
                mode="messaging"
                lang={lang}
                isOnline={isOnline}
                customers={customers}
                settings={settings}
                canManageGateways={user.permissions.includes('manage_settings')}
                onRefresh={refreshData}
              />
            )}
            {activeTab === 'reports' && (
              <ReportsInvoicesView
                mode="reports"
                lang={lang}
                isOnline={isOnline}
                sales={sales}
                onRefresh={refreshData}
                onPrintSale={setPrintSale}
              />
            )}
            {activeTab === 'invoices' && (
              <ReportsInvoicesView
                mode="invoices"
                lang={lang}
                isOnline={isOnline}
                sales={sales}
                onRefresh={refreshData}
                onPrintSale={setPrintSale}
              />
            )}
            {activeTab === 'ecommerce' && (
              <EcommerceAdminView
                lang={lang}
                sales={sales}
                products={products}
                onRefresh={refreshData}
                onOpenStorefront={() => setViewMode('storefront')}
              />
            )}
            {(activeTab === 'sync' || activeTab === 'users' || activeTab === 'settings') && (
              <AdminSyncView
                mode={activeTab}
                lang={lang}
                isOnline={isOnline}
                user={user}
                settings={settings}
                onSyncNow={syncNow}
                onRefreshSettings={refreshData}
                onOpenMessaging={() => setActiveTab('messaging')}
              />
            )}
            {activeTab === 'about' && <AboutView lang={lang} />}
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation Bar (হোম মেনু বার, ড্যাশবোর্ড, পস, এআই ক্যামেরা, কাস্টমার, বাকি ও পেমেন্ট) */}
      <nav className="no-print lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-1 py-1 flex items-center justify-around shadow-lg">
        {/* 1. হোম মেনু বার (Home / Full Drawer Menu) */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex flex-col items-center justify-center flex-1 py-1 text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
        >
          <Menu className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium leading-tight">{lang === 'bn' ? 'হোম মেনু' : 'Menu'}</span>
        </button>

        {/* 2. ড্যাশবোর্ড (Dashboard) */}
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            activeTab === 'dashboard'
              ? 'text-teal-700 dark:text-teal-400 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400'
          }`}
        >
          <LayoutDashboard className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium leading-tight">{lang === 'bn' ? 'ড্যাশবোর্ড' : 'Dashboard'}</span>
        </button>

        {/* 3. পস (POS Checkout) */}
        <button
          type="button"
          onClick={() => setActiveTab('pos')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors relative ${
            activeTab === 'pos'
              ? 'text-teal-700 dark:text-teal-400 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400'
          }`}
        >
          <ShoppingCart className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium leading-tight">{lang === 'bn' ? 'পস' : 'POS'}</span>
          {cart.length > 0 && (
            <span className="absolute top-0.5 right-2 w-4 h-4 rounded-full bg-teal-600 text-white text-[9px] font-bold flex items-center justify-center">
              {cart.reduce((s, it) => s + it.quantity, 0)}
            </span>
          )}
        </button>

        {/* 4. এআই ক্যামেরা (AI Camera Scanner) */}
        <button
          type="button"
          onClick={() => setActiveTab('aiScanner')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            activeTab === 'aiScanner'
              ? 'text-teal-700 dark:text-teal-400 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400'
          }`}
        >
          <Camera className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium leading-tight">{lang === 'bn' ? 'এআই ক্যামেরা' : 'AI Scan'}</span>
        </button>

        {/* 5. কাস্টমার (Customer Directory) */}
        <button
          type="button"
          onClick={() => setActiveTab('customers')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            activeTab === 'customers'
              ? 'text-teal-700 dark:text-teal-400 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400'
          }`}
        >
          <Users className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium leading-tight">{lang === 'bn' ? 'কাস্টমার' : 'Customer'}</span>
        </button>

        {/* 6. বাকি ও পেমেন্ট (Dues & Collection) */}
        <button
          type="button"
          onClick={() => setActiveTab('dues')}
          className={`flex flex-col items-center justify-center flex-1 py-1 transition-colors ${
            activeTab === 'dues'
              ? 'text-teal-700 dark:text-teal-400 font-bold'
              : 'text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400'
          }`}
        >
          <Wallet className="w-5 h-5 mb-0.5" />
          <span className="text-[10px] font-medium leading-tight">{lang === 'bn' ? 'বাকি ও পেমেন্ট' : 'Dues'}</span>
        </button>
      </nav>

      {printSale && <InvoiceModal sale={printSale} settings={settings} onClose={() => setPrintSale(null)} />}
    </div>
  );
}
