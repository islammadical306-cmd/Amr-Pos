import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Coins,
  Edit3,
  Eye,
  History,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Server,
  Star,
  Trash2,
  Upload,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBDT, type Lang } from '../i18n';
import type {
  Customer,
  ShopSettings,
  SmsCampaign,
  SmsCampaignPreview,
  SmsGateway,
  SmsProviderPreset,
  SmsProviderType,
} from '../types';

interface BulkSmsWorkspaceProps {
  lang: Lang;
  isOnline: boolean;
  customers: Customer[];
  settings: ShopSettings | null;
  canManageGateways: boolean;
}

type SubTab = 'bulk' | 'gateways' | 'single' | 'campaigns';

const SINGLE_TEMPLATES = {
  due_reminder: {
    en: (name: string, due: number) =>
      `Dear ${name}, your current due balance at AmarCare Pharmacy & Retail is ${formatBDT(due)}. Please settle at your convenience. Thank you.`,
    bn: (name: string, due: number) =>
      `প্রিয় ${name}, আমারকেয়ার ফার্মেসি ও রিটেইলে আপনার বর্তমান বাকি ${formatBDT(due)}। অনুগ্রহ করে সুবিধামতো পরিশোধ করুন। ধন্যবাদ।`,
  },
  payment_confirm: {
    en: (name: string, amt: number) =>
      `Dear ${name}, we received your payment of ${formatBDT(amt)}. Thank you for shopping with AmarCare!`,
    bn: (name: string, amt: number) =>
      `প্রিয় ${name}, আপনার ${formatBDT(amt)} পেমেন্ট সফলভাবে গ্রহণ করা হয়েছে। ধন্যবাদ!`,
  },
  promo_offer: {
    en: (name: string) =>
      `Hi ${name}, enjoy 10% OFF healthcare & daily essentials this week using code WELCOME10 at AmarCare!`,
    bn: (name: string) =>
      `হ্যালো ${name}, এই সপ্তাহে WELCOME10 কোড ব্যবহার করে সব পণ্যে ১০% ছাড় উপভোগ করুন!`,
  },
};

const BULK_TEMPLATES: Record<string, { labelEn: string; labelBn: string; en: string; bn: string; promo: boolean }> = {
  due_reminder: {
    labelEn: 'Due Reminder',
    labelBn: 'বাকি তাগাদা',
    en: 'Dear {{name}}, your current due at {{shop}} is {{due}}. Please settle at your convenience. Thank you.',
    bn: 'প্রিয় {{name}}, {{shop}}-এ আপনার বর্তমান বাকি {{due}}। অনুগ্রহ করে সুবিধামতো পরিশোধ করুন। ধন্যবাদ।',
    promo: false,
  },
  promo_offer: {
    labelEn: 'Promotional Offer',
    labelBn: 'অফার ও ডিসকাউন্ট',
    en: 'Hi {{name}}! Visit {{shop}} this week and get 10% OFF on healthcare & daily essentials with code WELCOME10.',
    bn: 'প্রিয় {{name}}, {{shop}}-এ চলছে বিশেষ ছাড়! কোড WELCOME10 ব্যবহার করে সব পণ্যে ১০% ডিসকাউন্ট উপভোগ করুন।',
    promo: true,
  },
  restock_notice: {
    labelEn: 'Stock Arrival Alert',
    labelBn: 'নতুন স্টক এলার্ট',
    en: 'Dear {{name}}, essential medicines & wellness stock have been freshly restocked at {{shop}}. Call or order online!',
    bn: 'প্রিয় {{name}}, {{shop}}-এ প্রয়োজনীয় ওষুধ ও নতুন পণ্য স্টকে এসেছে। আজই অর্ডার বা ভিজিট করুন।',
    promo: true,
  },
  eid_greeting: {
    labelEn: 'Festive Greeting',
    labelBn: 'উৎসব শুভেচ্ছা',
    en: 'Warm festive greetings from {{shop}} to {{name}} & family! Wishing you good health and happiness.',
    bn: 'প্রিয় {{name}}, {{shop}}-এর পক্ষ থেকে আপনাকে ও আপনার পরিবারকে জানাই আন্তরিক শুভেচ্ছা ও সুস্বাস্থ্য কামনা।',
    promo: false,
  },
  custom: {
    labelEn: 'Custom Message',
    labelBn: 'কাস্টম মেসেজ',
    en: '',
    bn: '',
    promo: false,
  },
};

function computeClientSmsStats(text: string) {
  const isUnicode = /[^\u0000-\u007F]/.test(text);
  const length = text.length;
  if (length === 0) return { length: 0, isUnicode, parts: 0, perPart: isUnicode ? 70 : 160 };
  if (isUnicode) {
    const parts = length <= 70 ? 1 : Math.ceil(length / 67);
    return { length, isUnicode: true, parts, perPart: length <= 70 ? 70 : 67 };
  }
  const parts = length <= 160 ? 1 : Math.ceil(length / 153);
  return { length, isUnicode: false, parts, perPart: length <= 160 ? 160 : 153 };
}

const STORAGE_PERMANENT_GW_KEY = 'amarpos_permanent_sms_gateway';
const STORAGE_SELECTED_GW_KEY = 'amarpos_selected_gateway_id';

interface GwFormState {
  name: string;
  provider: SmsProviderType;
  base_url: string;
  balance_url: string;
  http_method: 'POST' | 'GET';
  payload_format: 'JSON' | 'FORM' | 'QUERY';
  sender_id: string;
  api_key: string;
  api_secret: string;
  to_param: string;
  message_param: string;
  sender_param: string;
  api_key_param: string;
  extra_params_json: string;
  custom_headers_json: string;
  batch_delay_ms: number;
  is_default: boolean;
  active: boolean;
}

export const BulkSmsWorkspace: React.FC<BulkSmsWorkspaceProps> = ({
  lang,
  isOnline,
  customers,
  settings,
  canManageGateways,
}) => {
  const bn = lang === 'bn';
  const [subTab, setSubTab] = useState<SubTab>('bulk');

  // Gateways & Presets
  const [presets, setPresets] = useState<SmsProviderPreset[]>([]);
  const [gateways, setGateways] = useState<SmsGateway[]>([]);
  const [campaigns, setCampaigns] = useState<SmsCampaign[]>([]);
  const [msgLogs, setMsgLogs] = useState<Array<Record<string, unknown>>>([]);
  const [selectedCampaignLogs, setSelectedCampaignLogs] = useState<{
    campaign: SmsCampaign;
    logs: Array<Record<string, unknown>>;
  } | null>(null);

  // Gateway form state
  const [editingGwId, setEditingGwId] = useState<number | null>(null);
  const [gwForm, setGwForm] = useState<GwFormState>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PERMANENT_GW_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return {
      name: 'BulkSMSBD Primary',
      provider: 'BULKSMSBD',
      base_url: 'https://bulksmsbd.net/api/smsapi',
      balance_url: 'https://bulksmsbd.net/api/getBalanceApi',
      http_method: 'POST',
      payload_format: 'FORM',
      sender_id: '',
      api_key: '',
      api_secret: '',
      to_param: 'number',
      message_param: 'message',
      sender_param: 'senderid',
      api_key_param: 'api_key',
      extra_params_json: '{"type":"text"}',
      custom_headers_json: '{}',
      batch_delay_ms: 150,
      is_default: true,
      active: true,
    };
  });
  const [showAdvancedGw, setShowAdvancedGw] = useState(false);
  const [gwBusy, setGwBusy] = useState(false);
  const [gwBanner, setGwBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [testTargetGwId, setTestTargetGwId] = useState<number | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testMsg, setTestMsg] = useState('');
  const [balanceByGw, setBalanceByGw] = useState<Record<number, string>>({});

  // Bulk Campaign state
  const [campaignTitle, setCampaignTitle] = useState('');
  const [selectedGatewayId, setSelectedGatewayId] = useState<number | ''>(() => {
    try {
      const rawId = localStorage.getItem(STORAGE_SELECTED_GW_KEY);
      if (rawId) return Number(rawId);
    } catch {
      // ignore
    }
    return '';
  });
  const [audienceType, setAudienceType] = useState<'ALL_CONSENTED' | 'DUE_CUSTOMERS' | 'SELECTED_CUSTOMERS' | 'CUSTOM_NUMBERS'>('DUE_CUSTOMERS');
  const [minDue, setMinDue] = useState('1');
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([]);
  const [customerFilter, setCustomerFilter] = useState('');
  const [rawNumbers, setRawNumbers] = useState('');
  const [bulkTemplateKey, setBulkTemplateKey] = useState<string>('due_reminder');
  const [bulkTemplateLang, setBulkTemplateLang] = useState<'bn' | 'en'>('bn');
  const [bulkMessage, setBulkMessage] = useState<string>(BULK_TEMPLATES.due_reminder.bn);
  const [isPromo, setIsPromo] = useState(false);
  const [preview, setPreview] = useState<SmsCampaignPreview | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // Single message state
  const [selectedCustId, setSelectedCustId] = useState<number | ''>('');
  const [channel, setChannel] = useState<'SMS' | 'WHATSAPP' | 'EMAIL'>('SMS');
  const [templateLang, setTemplateLang] = useState<'bn' | 'en'>('bn');
  const [templateKey, setTemplateKey] = useState<'due_reminder' | 'payment_confirm' | 'promo_offer'>('due_reminder');
  const [msgBody, setMsgBody] = useState('');
  const [singleStatus, setSingleStatus] = useState('');

  const loadAll = async () => {
    if (!isOnline) return;
    try {
      const [pr, gws, camps, logs] = await Promise.all([
        apiFetch<SmsProviderPreset[]>('/api/sms/presets'),
        apiFetch<SmsGateway[]>('/api/sms/gateways'),
        apiFetch<SmsCampaign[]>('/api/sms/campaigns'),
        apiFetch<Array<Record<string, unknown>>>('/api/messages/logs'),
      ]);

      let currentGateways = gws;
      // Auto-restore permanent SMS gateway if server restarted with empty DB
      if (currentGateways.length === 0) {
        try {
          const raw = localStorage.getItem(STORAGE_PERMANENT_GW_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.name && parsed.base_url) {
              await apiFetch('/api/sms/gateways', {
                method: 'POST',
                body: JSON.stringify({ ...parsed, is_default: true, active: true }),
              });
              currentGateways = await apiFetch<SmsGateway[]>('/api/sms/gateways');
            }
          }
        } catch {
          // ignore
        }
      }

      setPresets(pr);
      setGateways(currentGateways);
      setCampaigns(camps);
      setMsgLogs(logs);

      const def = currentGateways.find((g) => g.active && g.is_default) || currentGateways.find((g) => g.active) || null;
      if (def) {
        setSelectedGatewayId(def.id);
        localStorage.setItem(STORAGE_SELECTED_GW_KEY, String(def.id));
      }
    } catch {
      // ignore offline or unauthorized sub-calls
    }
  };

  useEffect(() => {
    loadAll();
  }, [isOnline]);

  useEffect(() => {
    const c = customers.find((x) => x.id === selectedCustId);
    if (!c) return;
    if (templateKey === 'due_reminder') setMsgBody(SINGLE_TEMPLATES.due_reminder[templateLang](c.name, c.current_due));
    else if (templateKey === 'payment_confirm')
      setMsgBody(SINGLE_TEMPLATES.payment_confirm[templateLang](c.name, Number(c.total_payments || 0)));
    else setMsgBody(SINGLE_TEMPLATES.promo_offer[templateLang](c.name));
  }, [selectedCustId, templateKey, templateLang, customers]);

  const activeDefaultGw = useMemo(
    () => gateways.find((g) => g.active === 1 && g.is_default === 1) || gateways.find((g) => g.active === 1) || null,
    [gateways]
  );

  const smsStats = useMemo(() => computeClientSmsStats(bulkMessage), [bulkMessage]);

  const applyPreset = (provider: SmsProviderType) => {
    const p = presets.find((x) => x.provider === provider);
    if (!p) return;
    setGwForm((prev) => ({
      ...prev,
      name: editingGwId ? prev.name : `${p.label.split(' ')[0]} Gateway`,
      provider: p.provider,
      base_url: p.base_url,
      balance_url: p.balance_url,
      http_method: p.http_method,
      payload_format: p.payload_format,
      to_param: p.to_param,
      message_param: p.message_param,
      sender_param: p.sender_param,
      api_key_param: p.api_key_param,
      extra_params_json: p.extra_params_json,
    }));
  };

  const resetGwForm = () => {
    setEditingGwId(null);
    setGwForm({
      name: 'BulkSMSBD Primary',
      provider: 'BULKSMSBD',
      base_url: 'https://bulksmsbd.net/api/smsapi',
      balance_url: 'https://bulksmsbd.net/api/getBalanceApi',
      http_method: 'POST',
      payload_format: 'FORM',
      sender_id: '',
      api_key: '',
      api_secret: '',
      to_param: 'number',
      message_param: 'message',
      sender_param: 'senderid',
      api_key_param: 'api_key',
      extra_params_json: '{"type":"text"}',
      custom_headers_json: '{}',
      batch_delay_ms: 150,
      is_default: true,
      active: true,
    });
  };

  const handleSaveGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    setGwBusy(true);
    setGwBanner(null);
    try {
      const payload = {
        ...gwForm,
        is_default: true,
        active: true,
      };

      if (editingGwId) {
        await apiFetch(`/api/sms/gateways/${editingGwId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setGwBanner({
          ok: true,
          text: bn ? 'SMS গেটওয়ে স্থায়ীভাবে সফলভাবে আপডেট হয়েছে।' : 'SMS gateway updated and permanently saved.',
        });
      } else {
        await apiFetch('/api/sms/gateways', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setGwBanner({
          ok: true,
          text: bn ? 'নতুন SMS গেটওয়ে যুক্ত ও স্থায়ীভাবে সংরক্ষিত হয়েছে।' : 'New SMS gateway added and permanently saved.',
        });
      }

      // Permanently save to localStorage
      try {
        localStorage.setItem(STORAGE_PERMANENT_GW_KEY, JSON.stringify(payload));
      } catch {
        // ignore
      }

      resetGwForm();
      await loadAll();
    } catch (err) {
      setGwBanner({ ok: false, text: (err as Error).message });
    } finally {
      setGwBusy(false);
    }
  };

  const startEditGateway = (gw: SmsGateway) => {
    setEditingGwId(gw.id);
    setGwForm({
      name: gw.name,
      provider: gw.provider,
      base_url: gw.base_url,
      balance_url: gw.balance_url,
      http_method: gw.http_method,
      payload_format: gw.payload_format,
      sender_id: gw.sender_id,
      api_key: '',
      api_secret: '',
      to_param: gw.to_param,
      message_param: gw.message_param,
      sender_param: gw.sender_param,
      api_key_param: gw.api_key_param,
      extra_params_json: gw.extra_params_json || '{}',
      custom_headers_json: gw.custom_headers_json || '{}',
      batch_delay_ms: gw.batch_delay_ms || 150,
      is_default: gw.is_default === 1,
      active: gw.active === 1,
    });
  };

  const handleTestGateway = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTargetGwId || !testPhone.trim()) return;
    setGwBusy(true);
    setGwBanner(null);
    try {
      const res = await apiFetch<{ ok: boolean; providerRef?: string; error?: string }>(
        `/api/sms/gateways/${testTargetGwId}/test`,
        {
          method: 'POST',
          body: JSON.stringify({ test_phone: testPhone, test_message: testMsg }),
        }
      );
      setGwBanner({
        ok: res.ok,
        text: res.ok
          ? `${bn ? 'টেস্ট SMS সফল হয়েছে' : 'Test SMS sent'} · Ref: ${res.providerRef || 'OK'}`
          : `${bn ? 'টেস্ট ব্যর্থ' : 'Test failed'}: ${res.error || 'Unknown error'}`,
      });
      await loadAll();
    } catch (err) {
      setGwBanner({ ok: false, text: (err as Error).message });
    } finally {
      setGwBusy(false);
    }
  };

  const handleCheckBalance = async (gwId: number) => {
    try {
      const res = await apiFetch<{ ok: boolean; balanceText: string }>(`/api/sms/gateways/${gwId}/balance`, {
        method: 'POST',
      });
      setBalanceByGw((prev) => ({ ...prev, [gwId]: res.balanceText }));
    } catch (err) {
      setBalanceByGw((prev) => ({ ...prev, [gwId]: (err as Error).message }));
    }
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setRawNumbers((prev) => (prev ? `${prev}\n${text}` : text));
      setPreview(null);
    };
    reader.readAsText(file);
  };

  const handlePreviewCampaign = async () => {
    setBulkBusy(true);
    setBulkStatus(null);
    try {
      const res = await apiFetch<SmsCampaignPreview>('/api/sms/campaigns/preview', {
        method: 'POST',
        body: JSON.stringify({
          audience_type: audienceType,
          min_due: Number(minDue || 0),
          customer_ids: selectedCustomerIds,
          raw_numbers: rawNumbers,
          message_template: bulkMessage,
          is_promotional: isPromo,
        }),
      });
      setPreview(res);
    } catch (err) {
      setBulkStatus({ ok: false, text: (err as Error).message });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleSendCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkBusy(true);
    setBulkStatus(null);
    try {
      const res = await apiFetch<SmsCampaign>('/api/sms/campaigns/send', {
        method: 'POST',
        body: JSON.stringify({
          title: campaignTitle,
          gateway_id: selectedGatewayId || undefined,
          audience_type: audienceType,
          min_due: Number(minDue || 0),
          customer_ids: selectedCustomerIds,
          raw_numbers: rawNumbers,
          template_key: bulkTemplateKey,
          message_template: bulkMessage,
          is_promotional: isPromo,
        }),
      });
      setBulkStatus({
        ok: res.sent_count > 0 || res.failed_count === 0,
        text: bn
          ? `ক্যাম্পেইন সম্পন্ন: সফল ${res.sent_count}, ব্যর্থ ${res.failed_count}, অপ্ট-আউট ব্লক ${res.blocked_count} (মোট পার্ট ${res.total_sms_parts})`
          : `Campaign finished: ${res.sent_count} sent, ${res.failed_count} failed, ${res.blocked_count} opted-out (${res.total_sms_parts} SMS parts).`,
      });
      setPreview(null);
      await loadAll();
    } catch (err) {
      setBulkStatus({ ok: false, text: (err as Error).message });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleLoadCampaignLogs = async (camp: SmsCampaign) => {
    const logs = await apiFetch<Array<Record<string, unknown>>>(`/api/sms/campaigns/${camp.id}/logs`);
    setSelectedCampaignLogs({ campaign: camp, logs });
  };

  const handleRetryCampaign = async (campaignId: number) => {
    setBulkBusy(true);
    try {
      const res = await apiFetch<{ retriedSent: number; stillFailed: number }>(`/api/sms/campaigns/${campaignId}/retry`, {
        method: 'POST',
      });
      setBulkStatus({
        ok: res.stillFailed === 0,
        text: bn
          ? `রিট্রাই সম্পন্ন: নতুন সফল ${res.retriedSent}, এখনো ব্যর্থ ${res.stillFailed}`
          : `Retry complete: ${res.retriedSent} sent, ${res.stillFailed} still failed.`,
      });
      await loadAll();
      if (selectedCampaignLogs?.campaign.id === campaignId) {
        await handleLoadCampaignLogs(selectedCampaignLogs.campaign);
      }
    } catch (err) {
      setBulkStatus({ ok: false, text: (err as Error).message });
    } finally {
      setBulkBusy(false);
    }
  };

  const handleSingleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustId || !msgBody.trim()) return;
    setSingleStatus('');
    try {
      const res = await apiFetch<{ status: string; providerRef?: string; errorDetail?: string }>('/api/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: Number(selectedCustId),
          channel,
          template_key: templateKey,
          message_body: msgBody,
          is_promotional: templateKey === 'promo_offer',
          gateway_id: selectedGatewayId || undefined,
        }),
      });
      if (res.status === 'OPTED_OUT_BLOCKED') {
        setSingleStatus(bn ? 'ব্লকড: কাস্টমার এই চ্যানেল/প্রোমোশনাল মেসেজ বন্ধ রেখেছেন।' : 'Blocked: Customer opted out of this channel.');
      } else if (res.status === 'LOGGED_NO_GATEWAY') {
        setSingleStatus(
          bn
            ? 'লগে সংরক্ষিত হয়েছে, তবে লাইভ SMS পাঠাতে Gateway Setup ট্যাবে গিয়ে একটি SMS গেটওয়ে যুক্ত করুন।'
            : 'Saved to log, but no active SMS gateway is configured yet. Add one in Gateway Setup.'
        );
      } else if (res.status === 'FAILED') {
        setSingleStatus(`${bn ? 'ব্যর্থ হয়েছে' : 'Failed'}: ${res.errorDetail || 'Gateway error'}`);
      } else {
        setSingleStatus(`${bn ? 'সফলভাবে পাঠানো হয়েছে' : 'Sent'} (${channel}) ${res.providerRef ? `· Ref: ${res.providerRef}` : ''}`);
      }
      await loadAll();
    } catch (err) {
      setSingleStatus((err as Error).message);
    }
  };

  const filteredCustomers = useMemo(() => {
    const q = customerFilter.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => `${c.name} ${c.phone} ${c.code}`.toLowerCase().includes(q));
  }, [customers, customerFilter]);

  const activePreset = presets.find((p) => p.provider === gwForm.provider);

  return (
    <div className="space-y-5">
      {/* Top Gateway Health & Sub-navigation */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'bulk', icon: Send, en: 'Bulk SMS Campaign', bn: 'বাল্ক SMS ক্যাম্পেইন' },
              { id: 'gateways', icon: Server, en: 'SMS Gateway Setup', bn: 'গেটওয়ে সেটআপ' },
              { id: 'single', icon: MessageSquare, en: 'Single SMS / WhatsApp', bn: 'সিঙ্গেল মেসেজ' },
              { id: 'campaigns', icon: History, en: 'Campaigns & Logs', bn: 'ক্যাম্পেইন ও লগ' },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = subTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-teal-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{bn ? t.bn : t.en}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 text-xs">
          {activeDefaultGw ? (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="font-medium">
                {activeDefaultGw.name} ({activeDefaultGw.provider})
                {activeDefaultGw.sender_id ? ` · SID: ${activeDefaultGw.sender_id}` : ''}
              </span>
            </div>
          ) : (
            <button
              onClick={() => setSubTab('gateways')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-medium"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{bn ? 'গেটওয়ে সেটআপ করা নেই — সেটআপ করুন' : 'No SMS Gateway configured — Set up now'}</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: BULK SMS CAMPAIGN */}
      {subTab === 'bulk' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form
            onSubmit={handleSendCampaign}
            className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-semibold text-sm flex items-center gap-2">
                <Users className="w-4 h-4 text-teal-700" />
                {bn ? 'ধাপ ১ ও ২: প্রাপক এবং বাল্ক SMS কম্পোজার' : 'Step 1 & 2: Audience & Bulk SMS Composer'}
              </h2>
              <span className="text-[11px] text-slate-500">{settings?.shop_name || 'AmarCare Pharmacy'}</span>
            </div>

            {bulkStatus && (
              <div
                className={`p-3 rounded-lg border text-xs ${
                  bulkStatus.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                }`}
              >
                {bulkStatus.text}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {bn ? 'ক্যাম্পেইনের নাম' : 'Campaign Title'}
                </label>
                <input
                  value={campaignTitle}
                  onChange={(e) => setCampaignTitle(e.target.value)}
                  placeholder={bn ? 'যেমন: নভেম্বর বাকি তাগাদা' : 'e.g. November Due Reminder'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {bn ? 'SMS গেটওয়ে নির্বাচন' : 'Dispatch SMS Gateway'}
                </label>
                <select
                  value={selectedGatewayId}
                  onChange={(e) => setSelectedGatewayId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                >
                  <option value="">{bn ? 'ডিফল্ট সক্রিয় গেটওয়ে' : 'Default Active Gateway'}</option>
                  {gateways
                    .filter((g) => g.active === 1)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.provider})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Audience Selector */}
            <div className="space-y-2.5 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <div className="font-semibold text-slate-700 dark:text-slate-200">
                {bn ? 'টার্গেট অডিয়েন্স (প্রাপক গ্রুপ)' : 'Target Audience Segment'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { id: 'DUE_CUSTOMERS', en: 'Due Customers', bn: 'বাকি কাস্টমার' },
                    { id: 'ALL_CONSENTED', en: 'All Customers', bn: 'সকল কাস্টমার' },
                    { id: 'SELECTED_CUSTOMERS', en: 'Pick Customers', bn: 'নির্দিষ্ট কাস্টমার' },
                    { id: 'CUSTOM_NUMBERS', en: 'Paste / CSV', bn: 'নম্বর পেস্ট / CSV' },
                  ] as const
                ).map((aud) => (
                  <button
                    type="button"
                    key={aud.id}
                    onClick={() => {
                      setAudienceType(aud.id);
                      setPreview(null);
                    }}
                    className={`py-2 px-2.5 rounded-lg border text-[11px] font-semibold transition-colors ${
                      audienceType === aud.id
                        ? 'bg-teal-700 border-teal-700 text-white'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:border-teal-600'
                    }`}
                  >
                    {bn ? aud.bn : aud.en}
                  </button>
                ))}
              </div>

              {audienceType === 'DUE_CUSTOMERS' && (
                <div className="flex items-center gap-3 pt-1">
                  <label className="text-[11px] text-slate-600 dark:text-slate-400">
                    {bn ? 'সর্বনিম্ন বাকি (৳):' : 'Minimum Due (৳):'}
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="1"
                    value={minDue}
                    onChange={(e) => {
                      setMinDue(e.target.value);
                      setPreview(null);
                    }}
                    className="w-28 font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                  />
                  <span className="text-[11px] text-slate-500">
                    ({customers.filter((c) => c.current_due >= Number(minDue || 0.01)).length}{' '}
                    {bn ? 'জন মিলেছে' : 'matched'})
                  </span>
                </div>
              )}

              {audienceType === 'SELECTED_CUSTOMERS' && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      value={customerFilter}
                      onChange={(e) => setCustomerFilter(e.target.value)}
                      placeholder={bn ? 'নাম বা ফোন দিয়ে খুঁজুন...' : 'Filter by name or phone...'}
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5"
                    />
                    <button
                      type="button"
                      onClick={() => setSelectedCustomerIds(filteredCustomers.map((c) => c.id))}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px]"
                    >
                      {bn ? 'সব সিলেক্ট' : 'Select All'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedCustomerIds([])}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px]"
                    >
                      {bn ? 'ক্লিয়ার' : 'Clear'}
                    </button>
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                    {filteredCustomers.map((c) => {
                      const checked = selectedCustomerIds.includes(c.id);
                      return (
                        <label key={c.id} className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedCustomerIds((prev) =>
                                  checked ? prev.filter((id) => id !== c.id) : [...prev, c.id]
                                )
                              }
                            />
                            <span className="font-medium">{c.name}</span>
                            <span className="font-mono text-[11px] text-slate-500">{c.phone}</span>
                          </span>
                          <span className="font-mono text-[11px] text-amber-600">{formatBDT(c.current_due)}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {audienceType === 'CUSTOM_NUMBERS' && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      {bn
                        ? 'প্রতি লাইনে বা কমা দিয়ে নম্বর লিখুন (যেমন: 01711223344 অথবা Rahim 01812345678)'
                        : 'Paste numbers separated by newline or comma (e.g. 01711223344 or Rahim 01812345678)'}
                    </span>
                    <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 cursor-pointer text-[11px] font-medium">
                      <Upload className="w-3 h-3" />
                      <span>{bn ? 'CSV / TXT আপলোড' : 'Upload CSV/TXT'}</span>
                      <input type="file" accept=".csv,.txt" onChange={handleCsvUpload} className="hidden" />
                    </label>
                  </div>
                  <textarea
                    rows={3}
                    value={rawNumbers}
                    onChange={(e) => {
                      setRawNumbers(e.target.value);
                      setPreview(null);
                    }}
                    placeholder={'01711000001\n01811000002\nKarim 01911000003'}
                    className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5"
                  />
                </div>
              )}
            </div>

            {/* Template & Message Composer */}
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    {bn ? 'SMS টেমপ্লেট' : 'Quick Template'}
                  </label>
                  <select
                    value={bulkTemplateKey}
                    onChange={(e) => {
                      const k = e.target.value;
                      setBulkTemplateKey(k);
                      const tpl = BULK_TEMPLATES[k];
                      if (tpl && k !== 'custom') {
                        setBulkMessage(tpl[bulkTemplateLang]);
                        setIsPromo(tpl.promo);
                      }
                      setPreview(null);
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2"
                  >
                    {Object.entries(BULK_TEMPLATES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {bn ? v.labelBn : v.labelEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    {bn ? 'টেমপ্লেট ভাষা' : 'Template Language'}
                  </label>
                  <select
                    value={bulkTemplateLang}
                    onChange={(e) => {
                      const l = e.target.value as 'bn' | 'en';
                      setBulkTemplateLang(l);
                      const tpl = BULK_TEMPLATES[bulkTemplateKey];
                      if (tpl && bulkTemplateKey !== 'custom') {
                        setBulkMessage(tpl[l]);
                      }
                      setPreview(null);
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2"
                  >
                    <option value="bn">বাংলা (Unicode)</option>
                    <option value="en">English (GSM-7)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-slate-500 mr-1">
                  {bn ? 'ডাইনামিক ভেরিয়েবল:' : 'Insert variable:'}
                </span>
                {(['{{name}}', '{{due}}', '{{phone}}', '{{shop}}'] as const).map((token) => (
                  <button
                    type="button"
                    key={token}
                    onClick={() => setBulkMessage((prev) => `${prev}${prev.endsWith(' ') || !prev ? '' : ' '}${token}`)}
                    className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-teal-50 dark:hover:bg-teal-950 font-mono text-[11px] border border-slate-200 dark:border-slate-700"
                  >
                    {token}
                  </button>
                ))}
              </div>

              <textarea
                rows={4}
                required
                value={bulkMessage}
                onChange={(e) => {
                  setBulkMessage(e.target.value);
                  setPreview(null);
                }}
                placeholder={bn ? 'বাংলা বা ইংরেজিতে SMS লিখুন...' : 'Compose Bangla or English bulk SMS...'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3"
              />

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                <div className="font-mono">
                  {smsStats.length} chars · {smsStats.isUnicode ? 'Unicode/বাংলা (70/67)' : 'GSM-7 (160/153)'} ·{' '}
                  <span className="font-semibold text-teal-700 dark:text-teal-400">
                    {smsStats.parts} SMS part{smsStats.parts === 1 ? '' : 's'}/recipient
                  </span>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={isPromo} onChange={(e) => setIsPromo(e.target.checked)} />
                  <span>{bn ? 'প্রোমোশনাল (অপ্ট-আউট বাদ দেবে)' : 'Promotional (skips marketing opt-outs)'}</span>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                type="button"
                disabled={bulkBusy || !bulkMessage.trim()}
                onClick={handlePreviewCampaign}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold disabled:opacity-40"
              >
                <Eye className="w-3.5 h-3.5" />
                {bn ? 'প্রিভিউ ও খরচ দেখুন' : 'Preview Audience & Credits'}
              </button>
              <button
                type="submit"
                disabled={bulkBusy || !bulkMessage.trim() || !activeDefaultGw}
                className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" />
                {bulkBusy
                  ? bn
                    ? 'পাঠানো হচ্ছে...'
                    : 'Sending Bulk SMS...'
                  : bn
                    ? 'বাল্ক SMS ক্যাম্পেইন পাঠান'
                    : 'Send Bulk SMS Campaign'}
              </button>
            </div>
          </form>

          {/* Right Panel: Live Preview & Credit Estimate */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 text-xs">
            <h3 className="font-display font-semibold text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-teal-700" />
              {bn ? 'ধাপ ৩: প্রাপক প্রিভিউ ও SMS ক্রেডিট হিসাব' : 'Step 3: Live Audience Preview & Credit Estimate'}
            </h3>

            {!preview ? (
              <div className="py-10 text-center text-slate-400 space-y-2">
                <p>
                  {bn
                    ? 'প্রাপক সংখ্যা, অপ্ট-আউট ফিল্টার, পার্সোনালাইজড স্যাম্পল ও মোট SMS পার্ট দেখতে "প্রিভিউ ও খরচ দেখুন" ক্লিক করুন।'
                    : 'Click "Preview Audience & Credits" to verify eligible numbers, opted-out exclusions, and total SMS parts before dispatching.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                    <div className="font-mono font-bold text-base text-emerald-700 dark:text-emerald-300">
                      {preview.eligibleCount}
                    </div>
                    <div className="text-[10px] text-slate-500">{bn ? 'যোগ্য প্রাপক' : 'Eligible'}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                    <div className="font-mono font-bold text-base text-amber-700 dark:text-amber-300">
                      {preview.optedOutCount}
                    </div>
                    <div className="text-[10px] text-slate-500">{bn ? 'অপ্ট-আউট বাদ' : 'Opted Out'}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                    <div className="font-mono font-bold text-base text-red-600">{preview.invalidCount}</div>
                    <div className="text-[10px] text-slate-500">{bn ? 'ভুল নম্বর' : 'Invalid'}</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800">
                    <div className="font-mono font-bold text-base text-teal-700 dark:text-teal-300">
                      {preview.totalParts}
                    </div>
                    <div className="text-[10px] text-slate-500">{bn ? 'মোট SMS পার্ট' : 'Total Parts'}</div>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-500">
                    {bn ? `স্যাম্পল SMS (${preview.samplePhone}):` : `Sample Rendered SMS (${preview.samplePhone}):`}
                  </div>
                  <div className="text-slate-800 dark:text-slate-100 whitespace-pre-wrap">{preview.sampleMessage}</div>
                </div>

                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {preview.recipientsPreview.map((r, idx) => (
                    <div key={`${r.phone}-${idx}`} className="px-3 py-2 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">{r.phone || '—'}</div>
                      </div>
                      <span
                        className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded ${
                          r.status === 'READY'
                            ? 'bg-emerald-50 text-emerald-700'
                            : r.status === 'OPTED_OUT'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-red-50 text-red-600'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SMS GATEWAY SETUP */}
      {subTab === 'gateways' && (
        <div className="space-y-4">
          {activeDefaultGw && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                <div>
                  <div className="font-bold text-sm flex items-center gap-2">
                    <span>{bn ? 'SMS গেটওয়ে স্থায়ীভাবে সক্রিয় রয়েছে — সিস্টেম থেকে চালু করার প্রয়োজন নেই' : 'SMS Gateway is Permanently Active — No manual activation needed'}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-200/80 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100 font-mono">ALWAYS ACTIVE</span>
                  </div>
                  <div className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-0.5">
                    {activeDefaultGw.name} ({activeDefaultGw.provider}) · SID: <span className="font-mono font-semibold">{activeDefaultGw.sender_id || 'N/A'}</span> · API Key: <span className="font-mono">✓ স্থায়ীভাবে সংরক্ষিত ({activeDefaultGw.key_hint || 'Configured'})</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEditGateway(activeDefaultGw)}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs transition-colors"
                >
                  {bn ? 'সেন্ডার আইডি বা কী পরিবর্তন করুন' : 'Change Sender ID / Key'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Gateway Setup Form */}
          <form
            onSubmit={handleSaveGateway}
            className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3.5 text-xs"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-sm flex items-center gap-2">
                <Server className="w-4 h-4 text-teal-700" />
                {editingGwId
                  ? bn
                    ? 'SMS গেটওয়ে এডিট করুন'
                    : 'Edit SMS Gateway'
                  : bn
                    ? 'নতুন বাল্ক SMS গেটওয়ে যোগ করুন'
                    : 'Add Bulk SMS Gateway'}
              </h2>
              {editingGwId && (
                <button type="button" onClick={resetGwForm} className="text-[11px] text-slate-500 underline">
                  {bn ? 'নতুন তৈরি করুন' : 'Cancel Edit'}
                </button>
              )}
            </div>

            {!canManageGateways && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                {bn
                  ? 'নতুন গেটওয়ে যুক্ত বা পরিবর্তন করতে Admin / Super Admin পারমিশন প্রয়োজন।'
                  : 'Admin or Super Admin permission (manage_settings) is required to modify SMS gateway credentials.'}
              </div>
            )}

            {gwBanner && (
              <div
                className={`p-3 rounded-lg border ${
                  gwBanner.ok
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                    : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
                }`}
              >
                {gwBanner.text}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-[11px] text-slate-500 font-semibold">
                {bn ? 'ধাপ ১: প্রোভাইডার প্রিসেট নির্বাচন করুন' : 'Step 1: Choose SMS Gateway Provider'}
              </label>
              <select
                disabled={!canManageGateways}
                value={gwForm.provider}
                onChange={(e) => applyPreset(e.target.value as SmsProviderType)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-medium"
              >
                {presets.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {bn ? p.label_bn : p.label}
                  </option>
                ))}
              </select>
              {activePreset && (
                <p className="text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-950 p-2 rounded-lg border border-slate-200 dark:border-slate-800">
                  {bn ? activePreset.notes_bn : activePreset.notes}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {bn ? 'গেটওয়ের নাম' : 'Gateway Display Name'}
                </label>
                <input
                  required
                  disabled={!canManageGateways}
                  value={gwForm.name}
                  onChange={(e) => setGwForm({ ...gwForm, name: e.target.value })}
                  placeholder="e.g. SSLWireless Main"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {bn ? 'Sender ID / Masking নাম' : 'Sender ID / Masking / From'}
                </label>
                <input
                  disabled={!canManageGateways}
                  value={gwForm.sender_id}
                  onChange={(e) => setGwForm({ ...gwForm, sender_id: e.target.value })}
                  placeholder="e.g. AMARCARE or 88096..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                {bn ? 'HTTPS API এন্ডপয়েন্ট URL' : 'HTTPS Send SMS Endpoint URL'}
              </label>
              <input
                required
                type="url"
                disabled={!canManageGateways}
                value={gwForm.base_url}
                onChange={(e) => setGwForm({ ...gwForm, base_url: e.target.value })}
                placeholder="https://..."
                className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {bn ? 'API Key / Token' : 'API Key / Token'}{' '}
                  {editingGwId && <span className="text-slate-400">({bn ? 'খালি রাখলে আগেরটি থাকবে' : 'blank keeps current'})</span>}
                </label>
                <input
                  type="password"
                  disabled={!canManageGateways}
                  value={gwForm.api_key}
                  onChange={(e) => setGwForm({ ...gwForm, api_key: e.target.value })}
                  placeholder={editingGwId ? '••••••••••••' : 'Paste provider API key / token'}
                  className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">
                  {bn ? 'API Secret / Account SID (ঐচ্ছিক)' : 'API Secret / Account SID (Optional)'}
                </label>
                <input
                  type="password"
                  disabled={!canManageGateways}
                  value={gwForm.api_secret}
                  onChange={(e) => setGwForm({ ...gwForm, api_secret: e.target.value })}
                  placeholder="Optional secondary secret"
                  className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 font-semibold border border-emerald-300 dark:border-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  {bn ? 'স্থায়ীভাবে সক্রিয় ও ডিফল্ট গেটওয়ে' : 'Permanently Active & Default Gateway'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvancedGw((v) => !v)}
                className="text-[11px] text-teal-700 dark:text-teal-400 underline"
              >
                {showAdvancedGw
                  ? bn
                    ? 'অ্যাডভান্সড ফিল্ড লুকান'
                    : 'Hide Field Mapping'
                  : bn
                    ? 'অ্যাডভান্সড প্যারামিটার / কাস্টম ফিল্ড'
                    : 'Advanced Payload & Field Mapping'}
              </button>
            </div>

            {showAdvancedGw && (
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">HTTP Method</label>
                    <select
                      value={gwForm.http_method}
                      onChange={(e) => setGwForm({ ...gwForm, http_method: e.target.value as 'POST' | 'GET' })}
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                    >
                      <option value="POST">POST</option>
                      <option value="GET">GET</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">Payload Format</label>
                    <select
                      value={gwForm.payload_format}
                      onChange={(e) => setGwForm({ ...gwForm, payload_format: e.target.value as 'JSON' | 'FORM' | 'QUERY' })}
                      className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                    >
                      <option value="JSON">JSON</option>
                      <option value="FORM">FORM (URL Encoded)</option>
                      <option value="QUERY">Query Params</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-slate-500 mb-1">Batch Delay (ms)</label>
                    <input
                      type="number"
                      min={50}
                      max={5000}
                      value={gwForm.batch_delay_ms}
                      onChange={(e) => setGwForm({ ...gwForm, batch_delay_ms: Number(e.target.value) })}
                      className="w-full font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <input
                    value={gwForm.to_param}
                    onChange={(e) => setGwForm({ ...gwForm, to_param: e.target.value })}
                    placeholder="to param"
                    className="font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                  />
                  <input
                    value={gwForm.message_param}
                    onChange={(e) => setGwForm({ ...gwForm, message_param: e.target.value })}
                    placeholder="message param"
                    className="font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                  />
                  <input
                    value={gwForm.sender_param}
                    onChange={(e) => setGwForm({ ...gwForm, sender_param: e.target.value })}
                    placeholder="sender param"
                    className="font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                  />
                  <input
                    value={gwForm.api_key_param}
                    onChange={(e) => setGwForm({ ...gwForm, api_key_param: e.target.value })}
                    placeholder="api_key param"
                    className="font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                  />
                </div>
                <input
                  value={gwForm.balance_url}
                  onChange={(e) => setGwForm({ ...gwForm, balance_url: e.target.value })}
                  placeholder="Optional HTTPS Balance Check URL"
                  className="w-full font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={gwForm.extra_params_json}
                    onChange={(e) => setGwForm({ ...gwForm, extra_params_json: e.target.value })}
                    placeholder='Extra JSON params e.g. {"type":"text"}'
                    className="font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                  />
                  <input
                    value={gwForm.custom_headers_json}
                    onChange={(e) => setGwForm({ ...gwForm, custom_headers_json: e.target.value })}
                    placeholder='Custom Headers e.g. {"Authorization":"Bearer {{api_key}}"}'
                    className="font-mono rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={gwBusy || !canManageGateways}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              {editingGwId
                ? bn
                  ? 'গেটওয়ে আপডেট করুন'
                  : 'Save Gateway Changes'
                : bn
                  ? 'SMS গেটওয়ে সংরক্ষণ করুন'
                  : 'Save SMS Gateway'}
            </button>
          </form>

          {/* Saved Gateways List & Test Runner */}
          <div className="lg:col-span-6 space-y-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
              <h3 className="font-display font-semibold text-sm">
                {bn ? `কনফিগার করা গেটওয়ে (${gateways.length})` : `Configured SMS Gateways (${gateways.length})`}
              </h3>
              {gateways.length === 0 ? (
                <div className="py-8 text-center text-slate-400">
                  {bn
                    ? 'এখনো কোনো বাল্ক SMS গেটওয়ে যুক্ত করা হয়নি। বাম পাশের ফর্ম থেকে আপনার প্রোভাইডার যুক্ত করুন।'
                    : 'No SMS gateways added yet. Add SSLWireless, BulkSMSBD, GreenWeb, Alpha SMS, Twilio, or a Custom HTTPS API on the left.'}
                </div>
              ) : (
                <div className="space-y-3">
                  {gateways.map((gw) => (
                    <div
                      key={gw.id}
                      className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{gw.name}</span>
                            {gw.is_default === 1 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 text-[10px] font-semibold">
                                <Star className="w-2.5 h-2.5" /> Default
                              </span>
                            )}
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                                gw.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {gw.active ? 'ACTIVE' : 'PAUSED'}
                            </span>
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5 break-all">
                            {gw.provider} · {gw.http_method} ({gw.payload_format}) · {gw.base_url}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            SID: <span className="font-mono">{gw.sender_id || '—'}</span> · API Key:{' '}
                            <span className="font-mono">{gw.has_api_key ? gw.key_hint || 'Saved' : 'Missing'}</span>
                          </div>
                        </div>

                        {canManageGateways && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEditGateway(gw)}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800"
                              title="Edit"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                await apiFetch(`/api/sms/gateways/${gw.id}`, { method: 'DELETE' });
                                await loadAll();
                              }}
                              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {gw.last_test_status && (
                        <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-800">
                          Last test ({gw.last_tested_at}): {gw.last_test_status}
                        </div>
                      )}
                      {balanceByGw[gw.id] && (
                        <div className="text-[11px] font-mono text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/30 px-2.5 py-1 rounded">
                          Balance: {balanceByGw[gw.id]}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 pt-1">
                        {canManageGateways && (
                          <button
                            type="button"
                            onClick={() => {
                              setTestTargetGwId(gw.id);
                              setTestMsg('');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px] font-medium"
                          >
                            <Send className="w-3 h-3" /> {bn ? 'টেস্ট SMS পাঠান' : 'Send Test SMS'}
                          </button>
                        )}
                        {gw.balance_url && (
                          <button
                            type="button"
                            onClick={() => handleCheckBalance(gw.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-[11px] font-medium"
                          >
                            <Coins className="w-3 h-3" /> {bn ? 'ব্যালেন্স চেক' : 'Check Balance'}
                          </button>
                        )}
                        {canManageGateways && gw.is_default === 0 && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiFetch(`/api/sms/gateways/${gw.id}`, {
                                method: 'PUT',
                                body: JSON.stringify({ is_default: true, active: true }),
                              });
                              await loadAll();
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-teal-600 text-teal-700 dark:text-teal-300 text-[11px] font-medium"
                          >
                            {bn ? 'ডিফল্ট করুন' : 'Make Default'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {testTargetGwId && canManageGateways && (
              <form
                onSubmit={handleTestGateway}
                className="bg-white dark:bg-slate-900 border border-teal-600 rounded-xl p-4 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="font-display font-semibold text-sm">
                    {bn ? 'ধাপ ২: লাইভ টেস্ট SMS যাচাইকরণ' : 'Step 2: Live Gateway Test SMS'}
                  </div>
                  <button type="button" onClick={() => setTestTargetGwId(null)} className="text-[11px] text-slate-500">
                    Close
                  </button>
                </div>
                <input
                  required
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  placeholder={bn ? 'টেস্ট মোবাইল নম্বর দিন (যেমন: 01711223344)' : 'Recipient mobile (e.g. 01711223344)'}
                  className="w-full font-mono rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
                <input
                  value={testMsg}
                  onChange={(e) => setTestMsg(e.target.value)}
                  placeholder={bn ? 'টেস্ট মেসেজ (খালি রাখলে অটো টেক্সট যাবে)' : 'Optional custom test message'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
                />
                <button
                  type="submit"
                  disabled={gwBusy}
                  className="w-full py-2 rounded-lg bg-teal-700 text-white font-semibold disabled:opacity-40"
                >
                  {gwBusy ? (bn ? 'পাঠানো হচ্ছে...' : 'Dispatching...') : bn ? 'টেস্ট SMS পাঠান' : 'Dispatch Test SMS'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
      )}

      {/* TAB 3: SINGLE SMS / WHATSAPP / EMAIL */}
      {subTab === 'single' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <form
            onSubmit={handleSingleSend}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs"
          >
            <h2 className="font-display font-semibold text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-teal-700" />
              {bn ? 'একক কাস্টমার SMS, WhatsApp ও Email' : 'Single Customer SMS, WhatsApp & Email'}
            </h2>
            {singleStatus && <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">{singleStatus}</div>}
            <select
              required
              value={selectedCustId}
              onChange={(e) => setSelectedCustId(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
            >
              <option value="">{bn ? 'কাস্টমার নির্বাচন করুন' : 'Select Customer'}</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.phone}) · Due {formatBDT(c.current_due)}
                </option>
              ))}
            </select>

            <div className="grid grid-cols-3 gap-2">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2"
              >
                <option value="SMS">SMS (Gateway)</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
              </select>
              <select
                value={templateKey}
                onChange={(e) => setTemplateKey(e.target.value as typeof templateKey)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2"
              >
                <option value="due_reminder">Due Reminder</option>
                <option value="payment_confirm">Payment Confirm</option>
                <option value="promo_offer">Promotional Offer</option>
              </select>
              <select
                value={templateLang}
                onChange={(e) => setTemplateLang(e.target.value as 'bn' | 'en')}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-2.5 py-2"
              >
                <option value="bn">বাংলা Template</option>
                <option value="en">English Template</option>
              </select>
            </div>

            <textarea
              rows={4}
              required
              value={msgBody}
              onChange={(e) => setMsgBody(e.target.value)}
              placeholder={bn ? 'বাংলা বা ইংরেজিতে মেসেজ লিখুন...' : 'Compose Bangla or English message...'}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3"
            />

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold"
            >
              <Send className="w-3.5 h-3.5" />
              {bn ? 'মেসেজ পাঠান (অপ্ট-আউট সুরক্ষিত)' : 'Send Notification (Respects Opt-Out)'}
            </button>
          </form>

          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 font-display font-semibold text-sm">
              {bn ? 'সাম্প্রতিক মেসেজ ডিসপ্যাচ লগ' : 'Recent Message Dispatch Log'}
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Recipient</th>
                  <th className="py-2.5 px-3">Channel / Gateway</th>
                  <th className="py-2.5 px-3">Message</th>
                  <th className="py-2.5 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {msgLogs.slice(0, 40).map((m) => (
                  <tr key={String(m.id)}>
                    <td className="py-2.5 px-4">
                      <div className="font-medium">{String(m.customer_name || 'Recipient')}</div>
                      <div className="text-[11px] font-mono text-slate-500">{String(m.recipient_phone)}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">
                      <div>{String(m.channel)}</div>
                      {m.gateway_name ? <div className="text-slate-400">{String(m.gateway_name)}</div> : null}
                    </td>
                    <td className="py-2.5 px-3 max-w-xs truncate">{String(m.message_body)}</td>
                    <td className="py-2.5 px-4 text-[11px]">
                      <div
                        className={`font-semibold ${
                          m.status === 'OPTED_OUT_BLOCKED' || m.status === 'FAILED'
                            ? 'text-red-600'
                            : m.status === 'LOGGED_NO_GATEWAY'
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                        }`}
                      >
                        {String(m.status)}
                      </div>
                      {m.error_detail ? <div className="text-red-500 truncate max-w-[160px]">{String(m.error_detail)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: CAMPAIGNS & DELIVERY LOGS */}
      {subTab === 'campaigns' && (
        <div className="space-y-5">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display font-semibold text-sm">
                {bn ? 'বাল্ক SMS ক্যাম্পেইন ইতিহাস ও ডেলিভারি রিপোর্ট' : 'Bulk SMS Campaign History & Delivery Reports'}
              </h3>
              <button
                onClick={loadAll}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
              >
                <RefreshCw className="w-3 h-3" /> Refresh
              </button>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Campaign</th>
                  <th className="py-2.5 px-3">Gateway</th>
                  <th className="py-2.5 px-3">Sent / Failed / Blocked</th>
                  <th className="py-2.5 px-3">Parts</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold">{c.title}</div>
                      <div className="text-[11px] text-slate-500">{c.created_at} · {c.audience_type}</div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">{c.gateway_name || '—'}</td>
                    <td className="py-2.5 px-3 font-mono">
                      <span className="text-emerald-600 font-semibold">{c.sent_count}</span> /{' '}
                      <span className="text-red-600 font-semibold">{c.failed_count}</span> /{' '}
                      <span className="text-amber-600">{c.blocked_count}</span>
                    </td>
                    <td className="py-2.5 px-3 font-mono">{c.total_sms_parts}</td>
                    <td className="py-2.5 px-3 font-mono font-semibold">{c.status}</td>
                    <td className="py-2.5 px-4 text-right space-x-2">
                      <button
                        onClick={() => handleLoadCampaignLogs(c)}
                        className="px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-[11px] font-medium"
                      >
                        {bn ? 'লগ দেখুন' : 'View Logs'}
                      </button>
                      {c.failed_count > 0 && (
                        <button
                          disabled={bulkBusy}
                          onClick={() => handleRetryCampaign(c.id)}
                          className="px-2.5 py-1 rounded bg-amber-600 text-white text-[11px] font-medium"
                        >
                          {bn ? 'ব্যর্থগুলো রিট্রাই' : 'Retry Failed'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {campaigns.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      {bn ? 'এখনো কোনো বাল্ক SMS ক্যাম্পেইন পাঠানো হয়নি।' : 'No bulk SMS campaigns dispatched yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedCampaignLogs && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="font-display font-semibold text-sm">
                  Delivery Details: {selectedCampaignLogs.campaign.title}
                </div>
                <button
                  onClick={() => setSelectedCampaignLogs(null)}
                  className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  Close
                </button>
              </div>
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-4">Recipient</th>
                    <th className="py-2 px-3">Message</th>
                    <th className="py-2 px-3">Parts</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-4">Gateway Ref / Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {selectedCampaignLogs.logs.map((l) => (
                    <tr key={String(l.id)}>
                      <td className="py-2 px-4">
                        <div className="font-medium">{String(l.customer_name || 'Recipient')}</div>
                        <div className="font-mono text-[11px] text-slate-500">{String(l.recipient_phone)}</div>
                      </td>
                      <td className="py-2 px-3 max-w-sm truncate">{String(l.message_body)}</td>
                      <td className="py-2 px-3 font-mono">{String(l.sms_parts || 1)}</td>
                      <td
                        className={`py-2 px-3 font-semibold ${
                          l.status === 'SENT'
                            ? 'text-emerald-600'
                            : l.status === 'OPTED_OUT_BLOCKED'
                              ? 'text-amber-600'
                              : 'text-red-600'
                        }`}
                      >
                        {String(l.status)}
                      </td>
                      <td className="py-2 px-4 font-mono text-[11px] text-slate-500">
                        {String(l.provider_ref || l.error_detail || '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
