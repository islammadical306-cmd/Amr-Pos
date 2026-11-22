export type UserRole =
  | 'Super Admin'
  | 'Admin'
  | 'Manager'
  | 'Cashier'
  | 'Sales Staff'
  | 'Stock Manager';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  permissions: string[];
}

export interface Category {
  id: number;
  name: string;
  name_bn: string;
  description?: string;
}

export interface ProductBatch {
  id: number;
  product_id: number;
  batch_number: string;
  mfg_date: string;
  expiry_date: string;
  quantity: number;
  purchase_price: number;
}

export interface Product {
  id: number;
  name: string;
  name_bn: string;
  sku: string;
  barcode: string;
  qr_code: string;
  category_id: number | null;
  category_name?: string;
  category_name_bn?: string;
  subcategory: string;
  brand: string;
  manufacturer: string;
  generic_name: string;
  strength: string;
  dosage_form: string;
  package_size: string;
  unit: string;
  units_per_strip: number;
  strips_per_box: number;
  purchase_price: number;
  wholesale_price: number;
  retail_price: number;
  min_selling_price: number;
  vat_percent: number;
  image_url: string;
  show_online: number;
  online_price: number;
  description: string;
  min_stock_alert: number;
  current_stock: number;
  batches?: ProductBatch[];
  avg_rating?: number;
  review_count?: number;
}

export interface CartItem {
  product: Product;
  unit: 'Piece' | 'Tablet' | 'Strip' | 'Box' | 'Bottle';
  unit_multiplier: number;
  quantity: number;
  unit_price: number;
  discount: number;
}

export interface Customer {
  id: number;
  code: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  opt_out_marketing: number;
  consent_sms: number;
  consent_whatsapp: number;
  total_purchases: number;
  total_payments: number;
  current_due: number;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string;
  company: string;
  address: string;
  total_due: number;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  unit_multiplier: number;
  quantity: number;
  unit_price: number;
  cost_price: number;
  discount: number;
  tax: number;
  line_total: number;
  returned_qty: number;
}

export interface Sale {
  id: number;
  client_tx_id: string;
  invoice_no: string;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string;
  delivery_address?: string;
  sale_type: 'POS' | 'ONLINE';
  status: string;
  subtotal: number;
  discount_type: string;
  discount_value: number;
  discount_amount: number;
  vat_amount: number;
  total: number;
  paid_amount: number;
  due_amount: number;
  change_amount: number;
  payment_method: string;
  payment_breakdown_json: string;
  coupon_code: string;
  notes: string;
  synced_from_offline: number;
  cashier_name?: string;
  created_at: string;
  items: SaleItem[];
}

export interface Purchase {
  id: number;
  invoice_no: string;
  supplier_id: number | null;
  supplier_name?: string;
  supplier_company?: string;
  subtotal: number;
  additional_charges: number;
  total: number;
  paid_amount: number;
  due_amount: number;
  note: string;
  created_at: string;
  items: Array<{
    id: number;
    product_id: number;
    product_name: string;
    sku: string;
    batch_number: string;
    expiry_date: string;
    quantity: number;
    unit_cost: number;
    line_total: number;
    returned_qty: number;
  }>;
}

export interface Expense {
  id: number;
  client_tx_id: string;
  title: string;
  category: string;
  amount: number;
  payment_method: string;
  note: string;
  created_at: string;
}

export interface ShopSettings {
  id: number;
  shop_name: string;
  shop_name_bn: string;
  address: string;
  phone: string;
  email: string;
  vat_reg_no: string;
  default_vat_percent: number;
  currency: string;
  receipt_footer: string;
  thermal_width: '58mm' | '80mm';
  sms_gateway_url: string;
  whatsapp_phone_id: string;
  promo_banner_text: string;
  promo_banner_active: number;
}

export interface OfflineOperation {
  id: string;
  type: 'SALE' | 'DUE_PAYMENT' | 'EXPENSE' | 'CUSTOMER';
  payload: Record<string, unknown>;
  createdAt: string;
  retries: number;
  status: 'PENDING' | 'SYNCING' | 'FAILED';
  lastError?: string;
}

export interface SyncLog {
  id: number;
  client_tx_id: string;
  entity_type: string;
  status: string;
  conflict_detail: string;
  synced_at: string;
}

export interface AIRecognitionResult {
  extraction: {
    extractedText: string;
    productName: string;
    brand: string;
    manufacturer: string;
    genericName: string;
    strength: string;
    dosageForm: string;
    packageSize: string;
    barcode: string;
    sku: string;
    batchNumber: string;
    expiryDate: string;
    manufacturingDate: string;
    category: string;
    confidence: number;
    isMedicine: boolean;
    warnings: string[];
  };
  matches: Array<{
    product: Product;
    matchScore: number;
  }>;
  needsManualVerification: boolean;
}

export type SmsProviderType =
  | 'SSLWIRELESS'
  | 'BULKSMSBD'
  | 'GREENWEB'
  | 'ALPHASMS'
  | 'TWILIO'
  | 'CUSTOM';

export interface SmsProviderPreset {
  provider: SmsProviderType;
  label: string;
  label_bn: string;
  base_url: string;
  balance_url: string;
  http_method: 'POST' | 'GET';
  payload_format: 'JSON' | 'FORM' | 'QUERY';
  to_param: string;
  message_param: string;
  sender_param: string;
  api_key_param: string;
  extra_params_json: string;
  notes: string;
  notes_bn: string;
}

export interface SmsGateway {
  id: number;
  name: string;
  provider: SmsProviderType;
  base_url: string;
  balance_url: string;
  http_method: 'POST' | 'GET';
  payload_format: 'JSON' | 'FORM' | 'QUERY';
  sender_id: string;
  has_api_key: boolean;
  has_api_secret: boolean;
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

export interface SmsCampaign {
  id: number;
  title: string;
  gateway_id: number | null;
  gateway_name: string;
  audience_type: 'ALL_CONSENTED' | 'DUE_CUSTOMERS' | 'SELECTED_CUSTOMERS' | 'CUSTOM_NUMBERS';
  template_key: string;
  message_template: string;
  is_promotional: number;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  blocked_count: number;
  total_sms_parts: number;
  status: string;
  created_at: string;
}

export interface SmsCampaignPreview {
  eligibleCount: number;
  optedOutCount: number;
  invalidCount: number;
  totalParts: number;
  partsPerSample: number;
  isUnicode: boolean;
  sampleMessage: string;
  samplePhone: string;
  recipientsPreview: Array<{
    customer_id: number | null;
    name: string;
    phone: string;
    due: number;
    status: 'READY' | 'OPTED_OUT' | 'INVALID';
  }>;
}

export interface GoogleSheetsConfig {
  id: number;
  spreadsheet_id: string;
  spreadsheet_title: string;
  spreadsheet_url: string;
  auto_sync_enabled: number;
  sync_sales: number;
  sync_purchases: number;
  sync_expenses: number;
  sync_products: number;
  sync_customers: number;
  sync_pnl: number;
  last_sync_at: string;
  last_sync_status: string;
  last_sync_detail: string;
}

export interface GoogleSheetsSyncLog {
  id: number;
  action: string;
  spreadsheet_id: string;
  status: string;
  rows_written: number;
  detail: string;
  user_id: number | null;
  created_at: string;
}

export interface GoogleSheetPreview {
  spreadsheetId: string;
  title: string;
  sheetTitles: string[];
  selectedTab: string;
  headers: string[];
  totalRows: number;
  previewRows: string[][];
}


