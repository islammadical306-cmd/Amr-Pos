import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Printer, X } from 'lucide-react';
import type { Sale, ShopSettings } from '../types';
import { formatBDT } from '../i18n';

interface InvoiceModalProps {
  sale: Sale;
  settings: ShopSettings | null;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ sale, settings, onClose }) => {
  const [format, setFormat] = useState<'80mm' | '58mm' | 'A4'>(settings?.thermal_width === '58mm' ? '58mm' : '80mm');
  const [qrUrl, setQrUrl] = useState<string>('');

  useEffect(() => {
    const payload = JSON.stringify({
      inv: sale.invoice_no,
      total: sale.total,
      date: sale.created_at,
      shop: settings?.shop_name || 'AmarCare POS',
    });
    QRCode.toDataURL(payload, { width: 120, margin: 1 })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [sale, settings]);

  const widthClass =
    format === '58mm' ? 'max-w-[240px] text-[11px]' : format === '80mm' ? 'max-w-[330px] text-xs' : 'max-w-2xl text-sm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="no-print flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-sm text-slate-900 dark:text-white">
              Invoice Preview · {sale.invoice_no}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              {(['58mm', '80mm', 'A4'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setFormat(mode)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    format === mode
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {mode === 'A4' ? 'A4 Invoice' : `${mode} Thermal`}
                </button>
              ))}
            </div>
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              Print
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close invoice"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 bg-slate-100 dark:bg-slate-950 flex justify-center overflow-x-auto">
          <div
            className={`w-full ${widthClass} bg-white text-slate-900 p-5 border border-slate-300 font-mono leading-snug`}
          >
            <div className="text-center border-b border-dashed border-slate-400 pb-3 mb-3">
              {settings?.logo_url && (
                <div className="flex justify-center mb-2">
                  <img src={settings.logo_url} alt="Shop Logo" className="max-h-12 max-w-[140px] object-contain" />
                </div>
              )}
              <div className="font-bold text-base">{settings?.shop_name || 'AmarCare Pharmacy & Retail'}</div>
              {settings?.shop_name_bn && <div className="text-xs">{settings.shop_name_bn}</div>}
              <div className="text-[11px] text-slate-600 mt-1">{settings?.address}</div>
              <div className="text-[11px] text-slate-600">
                Tel: {settings?.phone} {settings?.vat_reg_no ? `· BIN: ${settings.vat_reg_no}` : ''}
              </div>
            </div>

            <div className="flex justify-between text-[11px] mb-1">
              <span>Inv: {sale.invoice_no}</span>
              <span>{new Date(sale.created_at).toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-[11px] border-b border-dashed border-slate-400 pb-2 mb-2">
              <span>Customer: {sale.customer_name}</span>
              <span>Mode: {sale.payment_method}</span>
            </div>

            <table className="w-full text-left border-b border-dashed border-slate-400 mb-2">
              <thead>
                <tr className="border-b border-slate-300 text-[11px]">
                  <th className="py-1">Item</th>
                  <th className="py-1 text-right">Qty</th>
                  <th className="py-1 text-right">Rate</th>
                  <th className="py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(sale.items || []).map((it, idx) => (
                  <tr key={idx} className="border-b border-dotted border-slate-200">
                    <td className="py-1 pr-2">
                      <div>{it.product_name}</div>
                      <div className="text-[10px] text-slate-500">{it.unit}</div>
                    </td>
                    <td className="py-1 text-right tabular-nums">{it.quantity}</td>
                    <td className="py-1 text-right tabular-nums">{Number(it.unit_price).toFixed(2)}</td>
                    <td className="py-1 text-right tabular-nums">{Number(it.line_total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="space-y-1.5 text-[11px] border-b border-dashed border-slate-400 pb-2.5 mb-2.5">
              <div className="flex justify-between">
                <span>Subtotal (উপমোট)</span>
                <span className="tabular-nums font-mono">{formatBDT(sale.subtotal)}</span>
              </div>
              {sale.discount_amount > 0 && (
                <div className="flex justify-between text-teal-700">
                  <span>Discount (ছাড়)</span>
                  <span className="tabular-nums font-mono">-{formatBDT(sale.discount_amount)}</span>
                </div>
              )}
              {sale.vat_amount > 0 && (
                <div className="flex justify-between">
                  <span>VAT / Tax (ভ্যাট)</span>
                  <span className="tabular-nums font-mono">{formatBDT(sale.vat_amount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm pt-1.5 border-t border-slate-300">
                <span>Grand Total (মোট প্রদেয়)</span>
                <span className="tabular-nums font-mono">{formatBDT(sale.total)}</span>
              </div>

              {/* Customer Payment & Change Return */}
              {(() => {
                const tendered =
                  sale.tendered_amount && sale.tendered_amount > 0
                    ? sale.tendered_amount
                    : sale.paid_amount + (sale.change_amount || 0);
                const change = sale.change_amount || 0;
                return (
                  <>
                    <div className="flex justify-between text-slate-700 pt-0.5">
                      <span>Cash Received (নগদ গ্রহণ)</span>
                      <span className="tabular-nums font-mono font-semibold">{formatBDT(tendered)}</span>
                    </div>
                    {change > 0 && (
                      <div className="flex justify-between font-bold text-emerald-700 dark:text-emerald-800 bg-emerald-50/80 px-1.5 py-0.5 rounded border border-emerald-200">
                        <span>Change Return (ফেরত টাকা)</span>
                        <span className="tabular-nums font-mono text-xs">{formatBDT(change)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Net Paid (পরিশোধিত)</span>
                      <span className="tabular-nums font-mono">{formatBDT(sale.paid_amount)}</span>
                    </div>
                    {sale.due_amount > 0 && (
                      <div className="flex justify-between font-bold text-red-600 bg-red-50/80 px-1.5 py-0.5 rounded border border-red-200">
                        <span>Balance Due (বকেয়া)</span>
                        <span className="tabular-nums font-mono">{formatBDT(sale.due_amount)}</span>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="flex flex-col items-center text-center pt-1 gap-2">
              {qrUrl && <img src={qrUrl} alt="Invoice QR" className="w-20 h-20" />}
              <div className="text-[10px] text-slate-600">{settings?.receipt_footer}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
