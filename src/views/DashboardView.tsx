import React, { useEffect, useState } from 'react';
import { Calendar, RefreshCw, TrendingUp } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';

interface DashboardResponse {
  kpis: {
    todaySales: number;
    todayPurchases: number;
    todayGrossProfit: number | null;
    todayNetProfit: number | null;
    todayExpenses: number;
    totalCustomerDue: number;
    totalSupplierDue: number;
    totalProducts: number;
    totalStockValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    expiredProducts: number;
    nearExpiryProducts: number;
    totalCustomers: number;
    todayTransactions: number;
    onlineOrders: number;
    pendingOrders: number;
  };
  chartTrends: Array<{ label: string; sales: number; profit: number; expenses: number }>;
  topProducts: Array<{ name: string; qty: number; revenue: number }>;
  paymentStats: Array<{ method: string; count: number; amount: number }>;
}

export const DashboardView: React.FC<{ lang: Lang; onNavigate: (tab: string) => void }> = ({ lang, onNavigate }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<DashboardResponse>(
        `/api/dashboard?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&period=${period}`
      );
      setData(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [fromDate, toDate, period]);

  const k = data?.kpis;
  const maxTrend = Math.max(100, ...(data?.chartTrends || []).map((t) => Math.max(t.sales, Math.abs(t.profit), t.expenses)));

  const kpiCards = k
    ? [
        { label: lang === 'bn' ? 'আজকের মোট বিক্রয়' : "Today's Total Sales", value: formatBDT(k.todaySales), accent: 'text-teal-700 dark:text-teal-400' },
        { label: lang === 'bn' ? 'আজকের ক্রয়' : "Today's Purchases", value: formatBDT(k.todayPurchases) },
        {
          label: lang === 'bn' ? 'মোট লাভ (Gross)' : 'Gross Profit',
          value: k.todayGrossProfit === null ? 'Restricted' : formatBDT(k.todayGrossProfit),
          accent: 'text-emerald-700 dark:text-emerald-400',
        },
        {
          label: lang === 'bn' ? 'আনুমানিক নিট লাভ' : 'Est. Net Profit',
          value: k.todayNetProfit === null ? 'Restricted' : formatBDT(k.todayNetProfit),
          accent: (k.todayNetProfit ?? 0) >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
        },
        { label: lang === 'bn' ? 'আজকের খরচ' : "Today's Expenses", value: formatBDT(k.todayExpenses) },
        { label: lang === 'bn' ? 'মোট কাস্টমার বাকি' : 'Total Customer Due', value: formatBDT(k.totalCustomerDue), accent: 'text-amber-600 dark:text-amber-400' },
        { label: lang === 'bn' ? 'সাপ্লায়ার বাকি' : 'Total Supplier Due', value: formatBDT(k.totalSupplierDue) },
        { label: lang === 'bn' ? 'মোট স্টক মূল্য' : 'Total Stock Value', value: formatBDT(k.totalStockValue) },
        { label: lang === 'bn' ? 'মোট পণ্য' : 'Total Products', value: String(k.totalProducts) },
        { label: lang === 'bn' ? 'কম স্টক পণ্য' : 'Low-Stock Products', value: String(k.lowStockCount), accent: k.lowStockCount > 0 ? 'text-amber-600 dark:text-amber-400' : '' },
        { label: lang === 'bn' ? 'স্টক আউট পণ্য' : 'Out-of-Stock', value: String(k.outOfStockCount), accent: k.outOfStockCount > 0 ? 'text-red-600 dark:text-red-400' : '' },
        { label: lang === 'bn' ? 'মেয়াদ উত্তীর্ণ' : 'Expired Products', value: String(k.expiredProducts), accent: k.expiredProducts > 0 ? 'text-red-600 dark:text-red-400' : '' },
        { label: lang === 'bn' ? 'মেয়াদ প্রায় শেষ' : 'Near-Expiry (60d)', value: String(k.nearExpiryProducts), accent: k.nearExpiryProducts > 0 ? 'text-amber-600 dark:text-amber-400' : '' },
        { label: lang === 'bn' ? 'মোট কাস্টমার' : 'Total Customers', value: String(k.totalCustomers) },
        { label: lang === 'bn' ? 'আজকের লেনদেন' : "Today's Transactions", value: String(k.todayTransactions) },
        { label: lang === 'bn' ? 'অনলাইন / পেন্ডিং অর্ডার' : 'Online / Pending Orders', value: `${k.onlineOrders} / ${k.pendingOrders}` },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Calendar className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            />
            <span>to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                  period === p
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadDashboard}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => onNavigate('pos')}
            className="px-4 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium hover:bg-teal-800 whitespace-nowrap shrink-0"
          >
            {lang === 'bn' ? 'নতুন POS বিক্রয়' : 'Open POS Sale'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* KPI Grid */}
      {loading && !data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {kpiCards.map((item, i) => (
            <div
              key={i}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col justify-between"
            >
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.label}</div>
              <div className={`mt-2 font-mono text-lg font-bold tabular-nums ${item.accent || 'text-slate-900 dark:text-white'}`}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Charts & Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                {lang === 'bn' ? 'বিক্রয়, লাভ ও খরচের ধারা' : `Sales, Profit & Expense Trends (${period})`}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Calculated directly from recorded database transactions</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
              <span>Teal: Sales</span>
              <span>Emerald: Net Profit</span>
              <span>Amber: Expenses</span>
            </div>
          </div>

          {!data?.chartTrends.length ? (
            <div className="h-56 flex items-center justify-center text-xs text-slate-500">
              No sales records found yet for trend plotting.
            </div>
          ) : (
            <div className="h-60 flex items-end gap-3 pt-4 overflow-x-auto">
              {data.chartTrends.map((t) => {
                const salesH = Math.max(4, Math.round((t.sales / maxTrend) * 180));
                const profitH = Math.max(4, Math.round((Math.max(0, t.profit) / maxTrend) * 180));
                const expH = Math.max(4, Math.round((t.expenses / maxTrend) * 180));
                return (
                  <div key={t.label} className="flex-1 min-w-[54px] flex flex-col items-center gap-2">
                    <div className="w-full flex items-end justify-center gap-1 h-[185px]">
                      <div
                        title={`Sales: ${formatBDT(t.sales)}`}
                        style={{ height: `${salesH}px` }}
                        className="w-3 rounded-t bg-teal-600 dark:bg-teal-500 transition-all"
                      />
                      <div
                        title={`Net Profit: ${formatBDT(t.profit)}`}
                        style={{ height: `${profitH}px` }}
                        className="w-3 rounded-t bg-emerald-500 transition-all"
                      />
                      <div
                        title={`Expenses: ${formatBDT(t.expenses)}`}
                        style={{ height: `${expH}px` }}
                        className="w-3 rounded-t bg-amber-500 transition-all"
                      />
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-full">
                      {t.label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between gap-5">
          <div>
            <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white mb-3">
              {lang === 'bn' ? 'সর্বাধিক বিক্রিত পণ্য' : 'Top-Selling Products'}
            </h3>
            <div className="space-y-2.5">
              {(data?.topProducts || []).map((tp, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs border-b border-slate-100 dark:border-slate-800 pb-2">
                  <div className="truncate pr-2">
                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{tp.name}</div>
                    <div className="text-slate-500 tabular-nums">{tp.qty} units sold</div>
                  </div>
                  <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white shrink-0">
                    {formatBDT(tp.revenue)}
                  </div>
                </div>
              ))}
              {!data?.topProducts.length && <div className="text-xs text-slate-500">No product sales yet.</div>}
            </div>
          </div>

          <div>
            <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white mb-2.5">
              {lang === 'bn' ? 'পেমেন্ট মাধ্যম পরিসংখ্যান' : 'Payment Method Statistics'}
            </h3>
            <div className="space-y-2">
              {(data?.paymentStats || []).map((pm) => (
                <div key={pm.method} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">
                    {pm.method} ({pm.count})
                  </span>
                  <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatBDT(pm.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
