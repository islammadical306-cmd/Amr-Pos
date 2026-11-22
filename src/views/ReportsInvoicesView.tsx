import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Printer, RotateCcw } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { queueOfflineOperation } from '../lib/offlineDb';
import { formatBDT, type Lang } from '../i18n';
import type { Expense, Sale } from '../types';

interface ReportsInvoicesViewProps {
  mode: 'reports' | 'invoices';
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
    if (mode === 'reports') loadReports();
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

  const handleReturnItem = async (saleId: number, saleItemId: number) => {
    try {
      await apiFetch(`/api/sales/${saleId}/return`, {
        method: 'POST',
        body: JSON.stringify({ items: [{ sale_item_id: saleItemId, return_qty: 1 }] }),
      });
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (mode === 'invoices') {
    return (
      <div className="space-y-4">
        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">{error}</div>}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">
            Invoices, Thermal Printing & Sales Returns
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Invoice</th>
                <th className="py-2.5 px-3">Customer</th>
                <th className="py-2.5 px-3">Type / Status</th>
                <th className="py-2.5 px-3 text-right">Total</th>
                <th className="py-2.5 px-3 text-right">Due</th>
                <th className="py-2.5 px-3">Items & Return</th>
                <th className="py-2.5 px-4 text-right">Print</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {sales.map((s) => (
                <tr key={s.invoice_no}>
                  <td className="py-2.5 px-4 font-mono font-medium">
                    <div>{s.invoice_no}</div>
                    <div className="text-[10px] text-slate-400">{String(s.created_at).slice(0, 16)}</div>
                  </td>
                  <td className="py-2.5 px-3">{s.customer_name}</td>
                  <td className="py-2.5 px-3 text-[11px] font-mono">
                    {s.sale_type} · {s.status}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">{formatBDT(s.total)}</td>
                  <td className="py-2.5 px-3 text-right font-mono text-amber-600 tabular-nums">{formatBDT(s.due_amount)}</td>
                  <td className="py-2.5 px-3 space-y-1">
                    {(s.items || []).map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-[11px]">
                        <span>{it.product_name} x{it.quantity - (it.returned_qty || 0)}</span>
                        {s.id > 0 && it.quantity - (it.returned_qty || 0) > 0 && s.status !== 'CANCELLED' && (
                          <button onClick={() => handleReturnItem(s.id, it.id)} className="inline-flex items-center gap-0.5 text-red-600 hover:underline">
                            <RotateCcw className="w-3 h-3" /> Return 1
                          </button>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      onClick={() => onPrintSale(s)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px] font-medium"
                    >
                      <Printer className="w-3.5 h-3.5" /> Print
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 no-print">
        <div className="flex items-center gap-2 text-xs">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
          <span>to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1.5" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportCSV} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800">
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
          <button onClick={exportExcel} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800">
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
                  <input required placeholder="Expense Title" value={expTitle} onChange={(e) => setExpTitle(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5" />
                  <select value={expCat} onChange={(e) => setExpCat(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5">
                    <option value="Utilities">Utilities</option>
                    <option value="Rent">Shop Rent</option>
                    <option value="Transport">Delivery / Transport</option>
                    <option value="Maintenance">Maintenance</option>
                    <option value="General">General</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input required type="number" min={1} placeholder="Amount (৳)" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} className="flex-1 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5" />
                  <button type="submit" className="px-4 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold">Add</button>
                </div>
              </form>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="font-display font-semibold text-sm mb-2">Recent Expenses</div>
                <div className="space-y-2 max-h-56 overflow-y-auto text-xs">
                  {expenses.map((ex) => (
                    <div key={ex.id} className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <div className="font-medium">{ex.title}</div>
                        <div className="text-[11px] text-slate-500">{ex.category} · {String(ex.created_at).slice(0, 10)}</div>
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
