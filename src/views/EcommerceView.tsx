import React, { useEffect, useState } from 'react';
import { ExternalLink, Search, ShoppingBag, Star, Tag, Truck, User } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type { Category, Product, Sale, ShopSettings } from '../types';
import { ProductImage } from '../components/ProductImage';

interface EcommerceAdminProps {
  lang: Lang;
  sales: Sale[];
  products: Product[];
  onRefresh: () => Promise<void>;
  onOpenStorefront: () => void;
}

export const EcommerceAdminView: React.FC<EcommerceAdminProps> = ({ sales, onRefresh, onOpenStorefront }) => {
  const [coupons, setCoupons] = useState<Array<Record<string, unknown>>>([]);
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState('PERCENT');
  const [value, setValue] = useState('10');
  const [minOrder, setMinOrder] = useState('200');
  const [error, setError] = useState('');

  const onlineOrders = sales.filter((s) => s.sale_type === 'ONLINE');

  const loadCoupons = async () => {
    try {
      const rows = await apiFetch<Array<Record<string, unknown>>>('/api/ecommerce/coupons');
      setCoupons(rows);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadCoupons();
  }, []);

  const updateOrderStatus = async (orderId: number, status: string) => {
    try {
      await apiFetch(`/api/ecommerce/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const createCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/ecommerce/coupons', {
        method: 'POST',
        body: JSON.stringify({ code, discount_type: discountType, value: Number(value), min_order: Number(minOrder) }),
      });
      setCode('');
      await loadCoupons();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
        <div>
          <h2 className="font-display font-semibold text-base">Connected E-Commerce & Online Orders</h2>
          <p className="text-xs text-slate-500">All orders placed on the online storefront appear here automatically with synchronized stock reservation.</p>
        </div>
        <button
          onClick={onOpenStorefront}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 text-xs font-semibold"
        >
          <ExternalLink className="w-4 h-4" />
          Open Live Storefront
        </button>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">
            Online Orders ({onlineOrders.length})
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Order / Date</th>
                <th className="py-2.5 px-3">Customer & Delivery</th>
                <th className="py-2.5 px-3 text-right">Total</th>
                <th className="py-2.5 px-3">Payment</th>
                <th className="py-2.5 px-4">Delivery Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {onlineOrders.map((o) => (
                <tr key={o.id}>
                  <td className="py-2.5 px-4 font-mono">
                    <div className="font-semibold">{o.invoice_no}</div>
                    <div className="text-[10px] text-slate-400">{String(o.created_at).slice(0, 16)}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium">{o.customer_name} · {o.customer_phone}</div>
                    <div className="text-[11px] text-slate-500">{o.delivery_address}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-semibold tabular-nums">{formatBDT(o.total)}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px]">{o.payment_method}</td>
                  <td className="py-2.5 px-4">
                    <select
                      value={o.status}
                      onChange={(e) => updateOrderStatus(o.id, e.target.value)}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-1 text-xs font-medium"
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="PROCESSING">PROCESSING</option>
                      <option value="SHIPPED">SHIPPED</option>
                      <option value="DELIVERED">DELIVERED</option>
                      <option value="RETURNED">RETURNED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  </td>
                </tr>
              ))}
              {!onlineOrders.length && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-slate-400">
                    No online orders yet. Open the Live Storefront to test placing a real order!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="font-display font-semibold text-sm flex items-center gap-2">
            <Tag className="w-4 h-4 text-teal-700" /> Discount Coupons
          </h3>
          <form onSubmit={createCoupon} className="space-y-2.5 text-xs">
            <input required placeholder="Coupon Code (e.g. EID15)" value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 uppercase" />
            <div className="grid grid-cols-3 gap-2">
              <select value={discountType} onChange={(e) => setDiscountType(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-2">
                <option value="PERCENT">%</option>
                <option value="FIXED">৳</option>
              </select>
              <input type="number" placeholder="Val" value={value} onChange={(e) => setValue(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-2 font-mono" />
              <input type="number" placeholder="Min ৳" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-2 font-mono" />
            </div>
            <button type="submit" className="w-full py-2 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold">
              Add Coupon
            </button>
          </form>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {coupons.map((c) => (
              <div key={String(c.id)} className="py-2 flex items-center justify-between">
                <div>
                  <span className="font-mono font-bold">{String(c.code)}</span>
                  <span className="text-slate-500 ml-2">
                    {c.discount_type === 'PERCENT' ? `${c.value}%` : formatBDT(Number(c.value))} off (min {formatBDT(Number(c.min_order))})
                  </span>
                </div>
                <button
                  onClick={async () => {
                    await apiFetch(`/api/ecommerce/coupons/${c.id}`, { method: 'DELETE' });
                    loadCoupons();
                  }}
                  className="text-red-600 hover:underline text-[11px]"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// PUBLIC CONNECTED STOREFRONT
// ==========================================

export const PublicStorefrontView: React.FC<{ onBackToPOS: () => void }> = ({ onBackToPOS }) => {
  const [catalog, setCatalog] = useState<{
    settings: ShopSettings | null;
    categories: Category[];
    products: Product[];
    reviews: Array<Record<string, unknown>>;
  }>({ settings: null, categories: [], products: [], reviews: [] });
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProd, setSelectedProd] = useState<Product | null>(null);
  const [trackOpen, setTrackOpen] = useState(false);
  const [trackQuery, setTrackQuery] = useState('');
  const [trackedOrders, setTrackedOrders] = useState<Sale[]>([]);

  // Customer account + Checkout
  const [custUser, setCustUser] = useState<{ name: string; phone: string; address: string } | null>(null);
  const [authModal, setAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authForm, setAuthForm] = useState({ name: '', phone: '', address: '', password: '' });

  const [checkoutForm, setCheckoutForm] = useState({
    name: '',
    phone: '',
    address: '',
    payment_method: 'COD' as 'COD' | 'ONLINE_GATEWAY',
    coupon_code: '',
  });
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [orderPlaced, setOrderPlaced] = useState<{ invoice_no: string; total: number } | null>(null);
  const [error, setError] = useState('');

  // Review state
  const [revName, setRevName] = useState('');
  const [revRating, setRevRating] = useState(5);
  const [revComment, setRevComment] = useState('');

  const loadCatalog = async () => {
    const res = await apiFetch<typeof catalog>('/api/store/catalog');
    setCatalog(res);
  };

  useEffect(() => {
    loadCatalog();
  }, []);

  const filtered = catalog.products.filter((p) => {
    if (catFilter !== 'ALL' && String(p.category_id) !== catFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.generic_name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q);
  });

  const addToBag = (product: Product) => {
    if (product.current_stock <= 0) return;
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product.id === product.id);
      if (idx >= 0) {
        return prev.map((i, k) => (k === idx ? { ...i, quantity: Math.min(product.current_stock, i.quantity + 1) } : i));
      }
      return [...prev, { product, quantity: 1 }];
    });
    setCartOpen(true);
  };

  const subtotal = cart.reduce((s, it) => s + Number(it.product.online_price || it.product.retail_price) * it.quantity, 0);
  const total = Math.max(0, subtotal - couponDiscount);

  const applyCoupon = async () => {
    setError('');
    try {
      const res = await apiFetch<{ discount: number }>('/api/store/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code: checkoutForm.coupon_code, subtotal }),
      });
      setCouponDiscount(res.discount);
    } catch (err) {
      setCouponDiscount(0);
      setError((err as Error).message);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiFetch<{ invoice_no: string; total: number }>('/api/store/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: checkoutForm.name || custUser?.name,
          customer_phone: checkoutForm.phone || custUser?.phone,
          delivery_address: checkoutForm.address || custUser?.address,
          payment_method: checkoutForm.payment_method,
          coupon_code: checkoutForm.coupon_code,
          items: cart.map((it) => ({ product_id: it.product.id, quantity: it.quantity })),
        }),
      });
      setOrderPlaced(res);
      setCart([]);
      setCouponDiscount(0);
      await loadCatalog();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCustomerAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const ep = authMode === 'login' ? '/api/store/login' : '/api/store/register';
      const data = await apiFetch<{ name: string; phone: string; address: string }>(ep, {
        method: 'POST',
        body: JSON.stringify(authForm),
      });
      setCustUser(data);
      setCheckoutForm((prev) => ({ ...prev, name: data.name, phone: data.phone, address: data.address || '' }));
      setAuthModal(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = trackQuery.trim();
    const param = q.startsWith('WEB') ? `invoice_no=${encodeURIComponent(q)}` : `phone=${encodeURIComponent(q)}`;
    const rows = await apiFetch<Sale[]>(`/api/store/orders/track?${param}`);
    setTrackedOrders(rows);
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProd) return;
    await apiFetch('/api/store/reviews', {
      method: 'POST',
      body: JSON.stringify({ product_id: selectedProd.id, customer_name: revName, rating: revRating, comment: revComment }),
    });
    setRevName('');
    setRevComment('');
    await loadCatalog();
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Slim Promo Strip */}
      {catalog.settings?.promo_banner_active === 1 && (
        <div className="bg-teal-800 text-white text-center py-2 px-4 text-xs font-medium">
          {catalog.settings.promo_banner_text}
        </div>
      )}

      {/* 3-Zone Top Bar */}
      <header className="max-w-7xl mx-auto px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-8">
        <a href="#top" className="flex items-center gap-2.5 font-display text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
          {catalog.settings?.logo_url ? (
            <img src={catalog.settings.logo_url} alt="Logo" className="h-8 w-auto max-w-[120px] object-contain rounded" />
          ) : null}
          <span>{catalog.settings?.shop_name || 'ইসলাম মেডিকেল এন্ড ই-সেন্টার'}</span>
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <button onClick={() => setCatFilter('ALL')} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
            Catalog
          </button>
          <button onClick={() => setTrackOpen(true)} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
            Track Order
          </button>
          <button onClick={() => setAuthModal(true)} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
            {custUser ? custUser.name : 'Account'}
          </button>
          <button onClick={onBackToPOS} className="hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0">
            POS Admin
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setCartOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            Bag ({cart.reduce((s, i) => s + i.quantity, 0)})
          </button>
        </div>
      </header>

      {/* Storefront Hero */}
      <section className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <div className="lg:col-span-5 p-8 flex flex-col justify-center gap-4">
            <div className="text-xs font-medium text-teal-700 dark:text-teal-400">
              Verified Pharmacy & Everyday Essentials
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">
              Authentic Medicines & Wellness Delivered Fast.
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Live store inventory synchronized directly with our physical counter. Pay via Cash on Delivery or Mobile Banking.
            </p>
            <div className="flex flex-wrap gap-3 pt-1">
              <a href="#catalog" className="px-5 py-2.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800">
                Shop Featured Products
              </a>
              <button onClick={() => setTrackOpen(true)} className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold">
                Track Order
              </button>
            </div>
          </div>
          <div className="lg:col-span-7 min-h-[260px]">
            <img
              src="/src/assets/images/store_hero_pharmacy_1795333807842.jpg"
              alt="ইসলাম মেডিকেল এন্ড ই-সেন্টার Storefront"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* Catalog Filter & Grid */}
      <section id="catalog" className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-lg">
            <button
              onClick={() => setCatFilter('ALL')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${catFilter === 'ALL' ? 'bg-white dark:bg-slate-800 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
            >
              All Items
            </button>
            {catalog.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCatFilter(String(c.id))}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${catFilter === String(c.id) ? 'bg-white dark:bg-slate-800 shadow-sm' : 'text-slate-600 dark:text-slate-400'}`}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products or generics..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-xs"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((p) => {
            const price = Number(p.online_price || p.retail_price);
            const inStock = p.current_stock > 0;
            return (
              <div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
                <button onClick={() => setSelectedProd(p)} className="text-left">
                  <ProductImage src={p.image_url} alt={p.name} category={p.category_name} className="w-full h-52" />
                </button>
                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">
                      {p.category_name || 'Retail'} · {inStock ? 'In Stock' : 'Out of Stock'}
                    </div>
                    <button onClick={() => setSelectedProd(p)} className="font-display font-semibold text-base mt-1 hover:underline text-left">
                      {p.name}
                    </button>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{p.description || p.generic_name}</p>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
                    <span className="font-mono font-bold text-base tabular-nums">{formatBDT(price)}</span>
                    <button
                      disabled={!inStock}
                      onClick={() => addToBag(p)}
                      className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-semibold"
                    >
                      {inStock ? 'Add to Bag' : 'Sold Out'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Product Detail & Reviews Modal */}
      {selectedProd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-5 my-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <ProductImage src={selectedProd.image_url} alt={selectedProd.name} category={selectedProd.category_name} className="w-full h-56 rounded-lg" />
              <div className="space-y-3">
                <div className="text-xs text-slate-500">{selectedProd.brand} · {selectedProd.package_size || selectedProd.unit}</div>
                <h2 className="font-display font-bold text-xl">{selectedProd.name}</h2>
                {selectedProd.generic_name && <div className="text-xs text-teal-700 dark:text-teal-400">Generic: {selectedProd.generic_name} {selectedProd.strength}</div>}
                <p className="text-xs text-slate-600 dark:text-slate-300">{selectedProd.description}</p>
                <div className="font-mono text-xl font-bold tabular-nums">{formatBDT(selectedProd.online_price || selectedProd.retail_price)}</div>
                <div className="flex gap-2 pt-2">
                  <button
                    disabled={selectedProd.current_stock <= 0}
                    onClick={() => {
                      addToBag(selectedProd);
                      setSelectedProd(null);
                    }}
                    className="flex-1 py-2.5 rounded-lg bg-teal-700 text-white text-xs font-semibold"
                  >
                    Add to Bag ({selectedProd.current_stock} available)
                  </button>
                  <button onClick={() => setSelectedProd(null)} className="px-4 py-2.5 rounded-lg border text-xs">Close</button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
              <h3 className="font-display font-semibold text-sm flex items-center gap-1.5">
                <Star className="w-4 h-4 text-amber-500" /> Customer Reviews
              </h3>
              <div className="space-y-2 max-h-36 overflow-y-auto text-xs">
                {catalog.reviews
                  .filter((r) => Number(r.product_id) === selectedProd.id)
                  .map((r) => (
                    <div key={String(r.id)} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950">
                      <div className="font-semibold">{String(r.customer_name)} · {String(r.rating)}/5</div>
                      <div className="text-slate-600 dark:text-slate-300 mt-0.5">{String(r.comment)}</div>
                    </div>
                  ))}
              </div>
              <form onSubmit={handleReviewSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
                <input required placeholder="Your Name" value={revName} onChange={(e) => setRevName(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5" />
                <select value={revRating} onChange={(e) => setRevRating(Number(e.target.value))} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2 py-1.5">
                  {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} Stars</option>)}
                </select>
                <input required placeholder="Write a review..." value={revComment} onChange={(e) => setRevComment(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-1.5" />
                <button type="submit" className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-semibold py-1.5">Post Review</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Cart & Checkout Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 h-full p-6 overflow-y-auto flex flex-col justify-between gap-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h2 className="font-display font-bold text-base">Shopping Bag</h2>
                <button onClick={() => setCartOpen(false)} className="text-xs text-slate-500">Close</button>
              </div>

              {orderPlaced ? (
                <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs space-y-2">
                  <div className="font-bold text-sm text-emerald-800 dark:text-emerald-300">Order Confirmed · {orderPlaced.invoice_no}</div>
                  <div>Total: {formatBDT(orderPlaced.total)}. Your order is now visible in the POS Order Queue!</div>
                  <button onClick={() => setOrderPlaced(null)} className="underline font-semibold">Continue Shopping</button>
                </div>
              ) : (
                <>
                  {error && <div className="text-xs text-red-600">{error}</div>}
                  <div className="space-y-2.5 max-h-56 overflow-y-auto">
                    {cart.map((it) => (
                      <div key={it.product.id} className="flex items-center justify-between text-xs border-b border-slate-100 dark:border-slate-800 pb-2">
                        <div>
                          <div className="font-semibold">{it.product.name}</div>
                          <div className="text-slate-500 font-mono">{formatBDT(it.product.online_price || it.product.retail_price)} x {it.quantity}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setCart((p) => p.map((x) => (x.product.id === it.product.id ? { ...x, quantity: x.quantity - 1 } : x)).filter((x) => x.quantity > 0))} className="px-2 py-0.5 border rounded">-</button>
                          <button onClick={() => setCart((p) => p.map((x) => (x.product.id === it.product.id ? { ...x, quantity: Math.min(it.product.current_stock, x.quantity + 1) } : x)))} className="px-2 py-0.5 border rounded">+</button>
                        </div>
                      </div>
                    ))}
                    {!cart.length && <div className="text-xs text-slate-400 py-8 text-center">Your shopping bag is empty.</div>}
                  </div>

                  {cart.length > 0 && (
                    <form onSubmit={handleCheckout} className="space-y-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800">
                      <div className="flex gap-2">
                        <input placeholder="Coupon (try WELCOME10)" value={checkoutForm.coupon_code} onChange={(e) => setCheckoutForm({ ...checkoutForm, coupon_code: e.target.value })} className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                        <button type="button" onClick={applyCoupon} className="px-3 py-2 rounded-lg border font-medium">Apply</button>
                      </div>
                      <input required placeholder="Full Name *" value={checkoutForm.name} onChange={(e) => setCheckoutForm({ ...checkoutForm, name: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                      <input required placeholder="Mobile Number *" value={checkoutForm.phone} onChange={(e) => setCheckoutForm({ ...checkoutForm, phone: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                      <textarea required rows={2} placeholder="Delivery Address *" value={checkoutForm.address} onChange={(e) => setCheckoutForm({ ...checkoutForm, address: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
                      <select value={checkoutForm.payment_method} onChange={(e) => setCheckoutForm({ ...checkoutForm, payment_method: e.target.value as 'COD' | 'ONLINE_GATEWAY' })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2">
                        <option value="COD">Cash on Delivery (COD)</option>
                        <option value="ONLINE_GATEWAY">Online Payment (bKash / Card)</option>
                      </select>

                      <div className="flex justify-between font-mono font-bold text-sm pt-2">
                        <span>Total Payable</span>
                        <span className="text-teal-700 dark:text-teal-400">{formatBDT(total)}</span>
                      </div>
                      <button type="submit" className="w-full py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold">
                        Place Order
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Order Tracking Modal */}
      {trackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="font-display font-semibold text-sm flex items-center gap-2"><Truck className="w-4 h-4 text-teal-700" /> Track Online Order</h3>
              <button onClick={() => setTrackOpen(false)} className="text-slate-500">Close</button>
            </div>
            <form onSubmit={handleTrack} className="flex gap-2">
              <input required placeholder="Order No (WEB-...) or Phone" value={trackQuery} onChange={(e) => setTrackQuery(e.target.value)} className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
              <button type="submit" className="px-4 py-2 rounded-lg bg-teal-700 text-white font-semibold">Track</button>
            </form>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {trackedOrders.map((o) => (
                <div key={o.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="flex justify-between font-mono font-bold">
                    <span>{o.invoice_no}</span>
                    <span className="text-teal-700 dark:text-teal-400">{o.status}</span>
                  </div>
                  <div className="text-slate-500 mt-1">Total: {formatBDT(o.total)} · {o.payment_method}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Customer Login / Register Modal */}
      {authModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={handleCustomerAuth} className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3 text-xs">
            <div className="flex justify-between items-center">
              <h3 className="font-display font-semibold text-sm flex items-center gap-1.5"><User className="w-4 h-4" /> Customer {authMode === 'login' ? 'Sign In' : 'Register'}</h3>
              <button type="button" onClick={() => setAuthModal(false)}>Close</button>
            </div>
            {authMode === 'register' && (
              <input required placeholder="Full Name" value={authForm.name} onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            )}
            <input required placeholder="Mobile Number" value={authForm.phone} onChange={(e) => setAuthForm({ ...authForm, phone: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            {authMode === 'register' && (
              <input placeholder="Delivery Address" value={authForm.address} onChange={(e) => setAuthForm({ ...authForm, address: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            )}
            <input required type="password" placeholder="Password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2" />
            <button type="submit" className="w-full py-2.5 rounded-lg bg-teal-700 text-white font-semibold">
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
            <button type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')} className="w-full text-center text-teal-700 underline">
              {authMode === 'login' ? 'New customer? Create an account' : 'Already registered? Sign In'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
