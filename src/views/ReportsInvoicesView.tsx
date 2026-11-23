import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  PackageCheck,
  Printer,
  RotateCcw,
  Search,
  Undo2,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { queueOfflineOperation } from '../lib/offlineDb';
import { formatBDT, type Lang } from '../i18n';
import type { Expense, Sale } from '../types';

interface ReportsInvoicesViewProps {
  mode: 'reports' | 'invoices' | 'expenses' | 'returns';
  lang: Lang;
  isOnline: boolean;
  sales: Sale[];
  onRefresh: () => Promise<void>;
  onPrintSale: (sale: Sale) => void;
}

interface FinancialReport {
  range: { from: string; to: string };
  summary: {
    netSales: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    estimatedNetProfit: number;
    purchases: number;
    creditSalesInPeriod: number;
    collectedPayments: number;
    cashReceived: number;
    digitalReceived: number;
    totalCustomerReceivables: number;
    totalSupplierPayables: number;
    salesReturns: number;
  };
  productProfit: Array<{ product_name: string; units_sold: number; net_sales: number; cogs: number; gross_profit: number }>;
  categoryProfit: Array<{ category_name: string; net_sales: number; cogs: number; gross_profit: number }>;
  paymentMethods: Array<{ payment_method: string; count: number; total: number }>;
}

export const ReportsInvoicesView: React.FC<ReportsInvoicesViewProps> = ({
  mode,
  lang,
  isOnline,
  sales,
  onRefresh,
  onPrintSale,
}) => {
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expTitle, setExpTitle] = useState('');
  const [expCat, setExpCat] = useState('Utilities');
  const [expAmount, setExpAmount] = useState('');
  const [error, setError] = useState('');

  // Invoices & Return State
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'RETURNED' | 'DUE'>('ALL');
  const [returnModalSale, setReturnModalSale] = useState<Sale | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [returnLoading, setReturnLoading] = useState(false);
  const [returnSuccessMsg, setReturnSuccessMsg] = useState('');
  const [returnErrorMsg, setReturnErrorMsg] = useState('');

  const loadReports = async () => {
    if (!isOnline) return;
    setError('');
    try {
      const [rep, exp] = await Promise.all([
        apiFetch<FinancialReport>(`/api/reports/financial?from=${from}&to=${to}`),
        apiFetch<Expense[]>('/api/expenses'),
      ]);
      setReport(rep);
      setExpenses(exp);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (mode === 'reports' || mode === 'expenses') loadReports();
  }, [mode, from, to, isOnline]);

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const txId = `exp-${Date.now()}`;
    const payload = { client_tx_id: txId, title: expTitle, category: expCat, amount: Number(expAmount), payment_method: 'CASH' };
    try {
      if (isOnline) {
        await apiFetch('/api/expenses', { method: 'POST', body: JSON.stringify(payload) });
        await loadReports();
      } else {
        await queueOfflineOperation({ id: txId, type: 'EXPENSE', payload, createdAt: new Date().toISOString() });
      }
      setExpTitle('');
      setExpAmount('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const exportCSV = () => {
    if (!report) return;
    const rows = [
      ['Metric', 'Amount (BDT)'],
      ['Net Sales', report.summary.netSales],
      ['Cost of Goods Sold (COGS)', report.summary.cogs],
      ['Gross Profit', report.summary.grossProfit],
      ['Recorded Business Expenses', report.summary.expenses],
      ['Estimated Net Profit', report.summary.estimatedNetProfit],
      ['Cash Received', report.summary.cashReceived],
      ['Digital Payments Received', report.summary.digitalReceived],
      ['Credit Sales in Period', report.summary.creditSalesInPeriod],
      ['Total Customer Receivables', report.summary.totalCustomerReceivables],
      ['Total Supplier Payables', report.summary.totalSupplierPayables],
      [],
      ['Product', 'Units Sold', 'Net Sales', 'COGS', 'Gross Profit'],
      ...report.productProfit.map((p) => [p.product_name, p.units_sold, p.net_sales, p.cogs, p.gross_profit]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AmarPOS-Financial-Report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportExcel = () => {
    if (!report) return;
    const html = `
      <table>
        <tr><th colspan="2">AmarPOS Financial Report (${from} to ${to})</th></tr>
        <tr><td>Net Sales</td><td>${report.summary.netSales}</td></tr>
        <tr><td>COGS</td><td>${report.summary.cogs}</td></tr>
        <tr><td>Gross Profit</td><td>${report.summary.grossProfit}</td></tr>
        <tr><td>Expenses</td><td>${report.summary.expenses}</td></tr>
        <tr><td>Estimated Net Profit</td><td>${report.summary.estimatedNetProfit}</td></tr>
        <tr><td>Customer Receivables</td><td>${report.summary.totalCustomerReceivables}</td></tr>
      </table>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AmarPOS-Financial-Report-${from}-to-${to}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Open Return Modal for an invoice
  const handleOpenReturnModal = (s: Sale) => {
    setReturnModalSale(s);
    setReturnQuantities({});
    setReturnSuccessMsg('');
    setReturnErrorMsg('');
  };

  // Set quantity for a return item with bounds check
  const setItemReturnQty = (itemId: number, qty: number, maxQty: number) => {
    const validQty = Math.max(0, Math.min(maxQty, Math.floor(qty) || 0));
    setReturnQuantities((prev) => ({
      ...prev,
      [itemId]: validQty,
    }));
  };

  // Quick return all available items
  const handleReturnAllItems = () => {
    if (!returnModalSale) return;
    const all: Record<number, number> = {};
    for (const it of returnModalSale.items || []) {
      const maxQty = it.quantity - (it.returned_qty || 0);
      if (maxQty > 0) {
        all[it.id] = maxQty;
      }
    }
    setReturnQuantities(all);
  };

  // Submit return
  const handleProcessReturn = async () => {
    if (!returnModalSale) return;
    const itemsToReturn = Object.entries(returnQuantities)
      .map(([idStr, qty]) => ({ sale_item_id: Number(idStr), return_qty: Number(qty) }))
      .filter((x) => x.return_qty > 0);

    if (itemsToReturn.length === 0) {
      setReturnErrorMsg(
        lang === 'bn'
          ? 'অনুগ্রহ করে কমপক্ষে একটি পণ্যের রিটার্ন পরিমাণ নির্বাচন করুন।'
          : 'Please specify a return quantity for at least one item.'
      );
      return;
    }

    setReturnLoading(true);
    setReturnErrorMsg('');
    try {
      const res = await apiFetch<{ ok: boolean; refundTotal: number }>(`/api/sales/${returnModalSale.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ items: itemsToReturn }),
      });
      setReturnSuccessMsg(
        lang === 'bn'
          ? `সফলভাবে মোট ${formatBDT(res.refundTotal)} টাকার প্রোডাক্ট রিটার্ন সম্পন্ন হয়েছে! স্টক ও কাস্টমার হিসাব সমন্বয় করা হয়েছে।`
          : `Successfully returned items worth ${formatBDT(res.refundTotal)}! Inventory and customer balance have been updated.`
      );
      await onRefresh();
      setTimeout(() => {
        setReturnModalSale(null);
        setReturnSuccessMsg('');
      }, 1600);
    } catch (err) {
      setReturnErrorMsg((err as Error).message);
    } finally {
      setReturnLoading(false);
    }
  };

  // Filter sales for Invoice table
  const filteredSales = sales.filter((s) => {
    const q = invoiceSearch.trim().toLowerCase();
    const matchQuery =
      !q ||
      s.invoice_no?.toLowerCase().includes(q) ||
      s.customer_name?.toLowerCase().includes(q) ||
      (s.customer_phone && s.customer_phone.toLowerCase().includes(q));

    if (!matchQuery) return false;

    if (statusFilter === 'COMPLETED') return s.status === 'COMPLETED';
    if (statusFilter === 'RETURNED') return s.status === 'RETURNED';
    if (statusFilter === 'DUE') return Number(s.due_amount) > 0;
    return true;
  });

  // Calculate return preview metrics
  const totalReturnUnits = returnModalSale
    ? Object.values(returnQuantities).reduce((acc, q) => acc + (q || 0), 0)
    : 0;

  const totalRefundAmount = returnModalSale
    ? (returnModalSale.items || []).reduce((sum, it) => {
        const q = returnQuantities[it.id] || 0;
        return sum + q * Number(it.unit_price);
      }, 0)
    : 0;

  if (mode === 'expenses') {
    const totalExp = expenses.reduce((s, ex) => s + Number(ex.amount || 0), 0);
    return (
      <div className="space-y-5">
        {error && (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 p-3.5 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-white">
                {lang === 'bn' ? 'জমা খরচ এন্ট্রি' : 'Income & Expenses Entry'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'bn'
                  ? 'দোকানের দৈনিক পরিচালনা খরচ, দোকান ভাড়া, বিদ্যুৎ বিল, কর্মচারীর বেতন ও অন্যান্য ব্যয় লিপিবদ্ধ করুন।'
                  : 'Record daily operating expenses, rent, utilities, staff salaries, and misc charges.'}
              </p>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-slate-500">{lang === 'bn' ? 'মোট খরচ' : 'Total Expenses'}</div>
              <div className="font-mono font-bold text-lg text-red-600 dark:text-red-400 tabular-nums">
                {formatBDT(totalExp)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Add Expense Form */}
          <div className="lg:col-span-5">
            <form onSubmit={handleAddExpense} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-sm">
              <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
                {lang === 'bn' ? 'নতুন খরচ লিপিবদ্ধ করুন' : 'Record Business Expense'}
              </h3>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-slate-600 dark:text-slate-400 block mb-1">
                    {lang === 'bn' ? 'খরচের বিবরণ / টাইটেল' : 'Expense Title'}
                  </label>
                  <input
                    required
                    placeholder={lang === 'bn' ? 'যেমন: দোকানের বিদ্যুৎ বিল' : 'e.g., Electricity Bill'}
                    value={expTitle}
                    onChange={(e) => setExpTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-600 dark:text-slate-400 block mb-1">
                      {lang === 'bn' ? 'খরচের ক্যাটাগরি' : 'Category'}
                    </label>
                    <select
                      value={expCat}
                      onChange={(e) => setExpCat(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950"
                    >
                      <option value="Utilities">{lang === 'bn' ? 'বিদ্যুৎ/পানি বিল' : 'Utilities'}</option>
                      <option value="Rent">{lang === 'bn' ? 'দোকান ভাড়া' : 'Shop Rent'}</option>
                      <option value="Salary">{lang === 'bn' ? 'কর্মচারীর বেতন' : 'Salary'}</option>
                      <option value="Transport">{lang === 'bn' ? 'যাতায়াত / পরিবহন' : 'Transport'}</option>
                      <option value="Maintenance">{lang === 'bn' ? 'মেরামত / ডেকোরেশন' : 'Maintenance'}</option>
                      <option value="Tea/Snacks">{lang === 'bn' ? 'আপ্যায়ন / চা-নাস্তা' : 'Tea / Refreshment'}</option>
                      <option value="General">{lang === 'bn' ? 'অন্যান্য সাধারণ খরচ' : 'General'}</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-600 dark:text-slate-400 block mb-1">
                      {lang === 'bn' ? 'টাকার পরিমাণ (৳)' : 'Amount (৳)'}
                    </label>
                    <input
                      required
                      type="number"
                      min={1}
                      placeholder="৳ 0.00"
                      value={expAmount}
                      onChange={(e) => setExpAmount(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-md transition-colors"
              >
                {lang === 'bn' ? 'খরচ সংরক্ষণ করুন' : 'Save Expense'}
              </button>
            </form>
          </div>

          {/* Expenses List */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="font-display font-semibold text-xs text-slate-900 dark:text-white">
                {lang === 'bn' ? 'খরচের তালিকা ও ইতিহাস' : 'Recent Expense Logs'}
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                {expenses.length} {lang === 'bn' ? 'টি এন্ট্রি' : 'items'}
              </span>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">{lang === 'bn' ? 'বিবরণ' : 'Title'}</th>
                    <th className="py-2.5 px-3">{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</th>
                    <th className="py-2.5 px-3">{lang === 'bn' ? 'তারিখ' : 'Date'}</th>
                    <th className="py-2.5 px-4 text-right">{lang === 'bn' ? 'পরিমাণ (৳)' : 'Amount (৳)'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {expenses.map((ex) => (
                    <tr key={ex.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white">{ex.title}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px]">
                          {ex.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] font-mono text-slate-400">
                        {String(ex.created_at).slice(0, 10)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-red-600 dark:text-red-400 tabular-nums">
                        {formatBDT(ex.amount)}
                      </td>
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-10 text-xs text-slate-400">
                        {lang === 'bn' ? 'এখনো কোনো খরচ লিপিবদ্ধ করা হয়নি।' : 'No expenses recorded yet.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === 'invoices' || mode === 'returns') {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 p-3.5 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Invoice Search & Filters Header */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-white">
                {mode === 'returns'
                  ? lang === 'bn'
                    ? 'রিটার্ন ও এডজাস্টমেন্ট'
                    : 'Sales Product Returns'
                  : lang === 'bn'
                  ? 'বিক্রয় তালিকা ও চালান'
                  : 'Sales Invoices & Receipts'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {mode === 'returns'
                  ? lang === 'bn'
                    ? 'কাস্টমারের ক্রয়কৃত পণ্য ফেরত গ্রহণ করে স্টক বৃদ্ধি এবং রিফান্ড বা বাকি সমন্বয় করুন।'
                    : 'Process product returns, restore inventory stock, and adjust refunds or dues.'
                  : lang === 'bn'
                  ? 'পূর্ববর্তী সকল বিক্রয় রসিদ দেখুন, থার্মাল প্রিন্ট করুন এবং ফিল্টার করুন।'
                  : 'View past sale receipts, search customer records, and print thermal invoices.'}
              </p>
            </div>
            <div className="text-xs font-mono px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300">
              {lang === 'bn' ? `মোট ইনভয়েস: ${filteredSales.length} টি` : `Total Invoices: ${filteredSales.length}`}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={invoiceSearch}
                onChange={(e) => setInvoiceSearch(e.target.value)}
                placeholder={lang === 'bn' ? 'ইনভয়েস নং, কাস্টমারের নাম বা ফোন...' : 'Search by invoice #, customer name or phone...'}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Status Filter Buttons */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  statusFilter === 'ALL'
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {lang === 'bn' ? 'সকল' : 'All'}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('COMPLETED')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  statusFilter === 'COMPLETED'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {lang === 'bn' ? 'পরিশোধিত' : 'Paid'}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('RETURNED')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  statusFilter === 'RETURNED'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {lang === 'bn' ? 'রিটার্ন সমন্বিত' : 'Returned'}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('DUE')}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  statusFilter === 'DUE'
                    ? 'bg-red-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {lang === 'bn' ? 'বকেয়া আছে' : 'Has Due'}
              </button>
            </div>
          </div>
        </div>

        {/* Invoices Table */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">{lang === 'bn' ? 'ইনভয়েস' : 'Invoice'}</th>
                  <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'কাস্টমার' : 'Customer'}</th>
                  <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'স্ট্যাটাস' : 'Status'}</th>
                  <th className="py-3 px-3 text-right font-semibold">{lang === 'bn' ? 'মোট বিক্রয়' : 'Total'}</th>
                  <th className="py-3 px-3 text-right font-semibold">{lang === 'bn' ? 'বকেয়া' : 'Due'}</th>
                  <th className="py-3 px-3 font-semibold">{lang === 'bn' ? 'বিক্রিত পণ্য ও রিটার্ন হিস্ট্রি' : 'Items & Return Status'}</th>
                  <th className="py-3 px-4 text-center font-semibold">{lang === 'bn' ? 'অ্যাকশন' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      {lang === 'bn' ? 'কোনো ইনভয়েস পাওয়া যায়নি।' : 'No invoices found.'}
                    </td>
                  </tr>
                ) : (
                  filteredSales.map((s) => {
                    const hasReturnableItems =
                      s.status !== 'CANCELLED' &&
                      s.id > 0 &&
                      (s.items || []).some((it) => it.quantity - (it.returned_qty || 0) > 0);

                    return (
                      <tr key={s.invoice_no} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-medium">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{s.invoice_no}</div>
                          <div className="text-[10px] text-slate-400">{String(s.created_at).slice(0, 16)}</div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-medium text-slate-800 dark:text-slate-200">{s.customer_name}</div>
                          {s.customer_phone && <div className="text-[10px] text-slate-400 font-mono">{s.customer_phone}</div>}
                        </td>
                        <td className="py-3 px-3">
                          {s.status === 'RETURNED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              রিটার্ন সমন্বিত
                            </span>
                          ) : s.status === 'CANCELLED' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              বাতিল
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                              {s.status || 'COMPLETED'}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                          {formatBDT(s.total)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums">
                          {s.due_amount > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 font-semibold">{formatBDT(s.due_amount)}</span>
                          ) : (
                            <span className="text-slate-400">৳০.০০</span>
                          )}
                        </td>
                        <td className="py-3 px-3 space-y-1 min-w-[200px]">
                          {(s.items || []).map((it, idx) => {
                            const returned = it.returned_qty || 0;
                            const remaining = it.quantity - returned;
                            return (
                              <div key={idx} className="flex items-center justify-between gap-2 text-[11px] leading-tight">
                                <span className="text-slate-700 dark:text-slate-300 truncate">
                                  {it.product_name} <span className="font-mono text-slate-500">x{it.quantity}</span>
                                </span>
                                {returned > 0 && (
                                  <span className="text-[10px] text-red-600 dark:text-red-400 font-mono font-medium shrink-0">
                                    (-{returned} Ret)
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                            {/* Thermal Print Button */}
                            <button
                              type="button"
                              onClick={() => onPrintSale(s)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:bg-slate-800 text-[11px] font-medium shadow-sm transition-colors"
                              title={lang === 'bn' ? 'চালান ও রসিদ প্রিন্ট করুন' : 'Print Invoice'}
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>{lang === 'bn' ? 'প্রিন্ট' : 'Print'}</span>
                            </button>

                            {/* Product Return Button */}
                            {hasReturnableItems ? (
                              <button
                                type="button"
                                onClick={() => handleOpenReturnModal(s)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-300 dark:border-red-800/80 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/60 text-[11px] font-semibold transition-colors shadow-sm"
                                title={lang === 'bn' ? 'এই বিক্রয়ের পণ্য রিটার্ন গ্রহণ করুন' : 'Process product return'}
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>{lang === 'bn' ? 'প্রোডাক্ট রিটার্ন' : 'Return'}</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-slate-400 dark:text-slate-600 px-2 py-1">
                                {s.status === 'CANCELLED' ? (lang === 'bn' ? 'বাতিল' : 'Cancelled') : (lang === 'bn' ? 'রিটার্ন সম্পন্ন' : 'Fully Returned')}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Dedicated Product Return Modal */}
        {returnModalSale && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
            <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-950/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <Undo2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-sm text-slate-900 dark:text-white">
                      {lang === 'bn' ? 'প্রোডাক্ট রিটার্ন ও এডজাস্টমেন্ট' : 'Sales Product Return & Adjustment'}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      {lang === 'bn'
                        ? `ইনভয়েস: ${returnModalSale.invoice_no} · কাস্টমার: ${returnModalSale.customer_name}`
                        : `Invoice: ${returnModalSale.invoice_no} · Customer: ${returnModalSale.customer_name}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReturnModalSale(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Feedback messages */}
              {returnSuccessMsg && (
                <div className="mx-5 mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>{returnSuccessMsg}</span>
                </div>
              )}
              {returnErrorMsg && (
                <div className="mx-5 mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>{returnErrorMsg}</span>
                </div>
              )}

              {/* Modal Body / Items List */}
              <div className="p-5 overflow-y-auto flex-1 space-y-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {lang === 'bn' ? 'রিটার্নযোগ্য পণ্যের তালিকা' : 'Returnable Items List'}
                  </span>
                  <button
                    type="button"
                    onClick={handleReturnAllItems}
                    className="text-[11px] font-medium text-teal-600 dark:text-teal-400 hover:underline inline-flex items-center gap-1"
                  >
                    <PackageCheck className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'সব পণ্য সিলেক্ট করুন' : 'Select All Returnable'}</span>
                  </button>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800">
                  {(returnModalSale.items || []).map((it) => {
                    const alreadyReturned = it.returned_qty || 0;
                    const maxReturnable = Math.max(0, it.quantity - alreadyReturned);
                    const selectedQty = returnQuantities[it.id] || 0;
                    const lineRefund = selectedQty * Number(it.unit_price);

                    return (
                      <div
                        key={it.id}
                        className={`p-3.5 transition-colors ${
                          maxReturnable === 0
                            ? 'bg-slate-50/60 dark:bg-slate-900/40 opacity-60'
                            : selectedQty > 0
                            ? 'bg-red-50/30 dark:bg-red-950/20'
                            : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-[160px] flex-1">
                            <div className="font-semibold text-xs text-slate-900 dark:text-white">{it.product_name}</div>
                            <div className="text-[11px] text-slate-500 space-x-2 mt-0.5">
                              <span>{lang === 'bn' ? 'দর:' : 'Rate:'} {formatBDT(it.unit_price)}</span>
                              <span>·</span>
                              <span>{lang === 'bn' ? 'বিক্রিত:' : 'Sold:'} {it.quantity}</span>
                              {alreadyReturned > 0 && (
                                <>
                                  <span>·</span>
                                  <span className="text-red-500 font-medium">
                                    {lang === 'bn' ? `রিটার্ন হয়েছে: ${alreadyReturned}` : `Returned: ${alreadyReturned}`}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>

                          {maxReturnable > 0 ? (
                            <div className="flex items-center gap-3">
                              {/* Quantity Stepper */}
                              <div className="flex items-center rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-950">
                                <button
                                  type="button"
                                  onClick={() => setItemReturnQty(it.id, selectedQty - 1, maxReturnable)}
                                  disabled={selectedQty <= 0}
                                  className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  max={maxReturnable}
                                  value={selectedQty}
                                  onChange={(e) => setItemReturnQty(it.id, Number(e.target.value), maxReturnable)}
                                  className="w-12 text-center text-xs font-mono font-bold bg-transparent focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => setItemReturnQty(it.id, selectedQty + 1, maxReturnable)}
                                  disabled={selectedQty >= maxReturnable}
                                  className="w-8 h-8 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                                >
                                  +
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => setItemReturnQty(it.id, maxReturnable, maxReturnable)}
                                className="px-2 py-1 text-[10px] font-semibold rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
                              >
                                {lang === 'bn' ? 'সব' : 'All'} ({maxReturnable})
                              </button>

                              {/* Line Total Refund */}
                              <div className="w-24 text-right">
                                <div className="text-[10px] text-slate-400">{lang === 'bn' ? 'ফেরত মূল্য' : 'Refund'}</div>
                                <div className="font-mono font-bold text-xs text-red-600 dark:text-red-400">
                                  {formatBDT(lineRefund)}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">
                              {lang === 'bn' ? 'সম্পূর্ণ ফেরত সম্পন্ন' : 'Already Returned'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Return Summary Box */}
                <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                    <span>{lang === 'bn' ? 'মোট রিটার্নকৃত পণ্য সংখ্যা:' : 'Total items to return:'}</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">{totalReturnUnits} টি</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-red-600 dark:text-red-400 border-t border-slate-200 dark:border-slate-800 pt-2">
                    <span>{lang === 'bn' ? 'কাস্টমারকে ফেরত / এডজাস্টযোগ্য টাকা:' : 'Total Refund / Due Adjustment:'}</span>
                    <span className="font-mono text-base">{formatBDT(totalRefundAmount)}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 pt-1 leading-relaxed">
                    {lang === 'bn'
                      ? '✓ রিটার্ন নিশ্চিত করলে পণ্য স্বয়ংক্রিয়ভাবে মূল ইনভেন্টরি স্টকে ফেরত যোগ হবে এবং কাস্টমারের বাকি ও বিক্রয় হিসেব স্বয়ংক্রিয়ভাবে এডজাস্ট হবে।'
                      : '✓ Confirming this return will automatically restore product units back into inventory and deduct the refunded amount from customer due / sale total.'}
                  </div>
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50 dark:bg-slate-950/50">
                <button
                  type="button"
                  onClick={() => setReturnModalSale(null)}
                  disabled={returnLoading}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleProcessReturn}
                  disabled={totalReturnUnits === 0 || returnLoading}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${returnLoading ? 'animate-spin' : ''}`} />
                  <span>
                    {returnLoading
                      ? lang === 'bn'
                        ? 'প্রসেসিং হচ্ছে...'
                        : 'Processing...'
                      : lang === 'bn'
                      ? `রিটার্ন নিশ্চিত করুন (${formatBDT(totalRefundAmount)})`
                      : `Confirm Return (${formatBDT(totalRefundAmount)})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 no-print">
        <div className="flex items-center gap-2 text-xs">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5"
          />
          <span>to</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button
            onClick={exportExcel}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium">
            <Printer className="w-3.5 h-3.5" /> PDF / Print
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">{error}</div>}

      {report && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[
              ['Net Sales', report.summary.netSales],
              ['Cost of Goods Sold (COGS)', report.summary.cogs],
              ['Gross Profit (Net Sales - COGS)', report.summary.grossProfit],
              ['Recorded Business Expenses', report.summary.expenses],
              ['Estimated Net Profit', report.summary.estimatedNetProfit],
              ['Cash Received', report.summary.cashReceived],
              ['Digital Payments Received', report.summary.digitalReceived],
              ['Credit Sales (Unpaid at Sale)', report.summary.creditSalesInPeriod],
              ['Collected Payments (Sales + Dues)', report.summary.collectedPayments],
              ['Customer Receivables (Total Due)', report.summary.totalCustomerReceivables],
              ['Supplier Payables (Total Due)', report.summary.totalSupplierPayables],
              ['Sales Returns / Refunds', report.summary.salesReturns],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="text-[11px] text-slate-500">{label}</div>
                <div className="font-mono font-bold text-base mt-1 tabular-nums">{formatBDT(Number(val))}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">Product-Wise Profit</div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Product</th>
                    <th className="py-2.5 px-3 text-right">Sold</th>
                    <th className="py-2.5 px-3 text-right">Net Sales</th>
                    <th className="py-2.5 px-3 text-right">COGS</th>
                    <th className="py-2.5 px-4 text-right">Gross Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {report.productProfit.map((p, i) => (
                    <tr key={i}>
                      <td className="py-2 px-4 font-medium">{p.product_name}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{p.units_sold}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatBDT(p.net_sales)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatBDT(p.cogs)}</td>
                      <td className="py-2 px-4 text-right font-mono font-semibold text-emerald-600 tabular-nums">{formatBDT(p.gross_profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-5 space-y-4">
              <form onSubmit={handleAddExpense} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-2.5 text-xs no-print">
                <div className="font-display font-semibold text-sm">Record Business Expense</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    required
                    placeholder="Expense Title"
                    value={expTitle}
                    onChange={(e) => setExpTitle(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5"
                  />
                  <select
                    value={expCat}
                    onChange={(e) => setExpCat(e.target.value)}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5"
                  >
                    <option value="Utilities">Utilities</option>
                    <option value="Rent">Shop Rent</option>
                    <option value="Transport">Delivery / Transport</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    required
                    type="number"
                    min={1}
                    placeholder="Amount (৳)"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    className="flex-1 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5"
                  />
                  <button type="submit" className="px-4 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold">
                    Add
                  </button>
                </div>
              </form>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="font-display font-semibold text-sm mb-2">Recent Expenses</div>
                <div className="space-y-2 max-h-56 overflow-y-auto text-xs">
                  {expenses.map((ex) => (
                    <div key={ex.id} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <div className="font-medium">{ex.title}</div>
                        <div className="text-[11px] text-slate-500">
                          {ex.category} · {String(ex.created_at).slice(0, 10)}
                        </div>
                      </div>
                      <div className="font-mono font-semibold text-amber-600 tabular-nums">{formatBDT(ex.amount)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
