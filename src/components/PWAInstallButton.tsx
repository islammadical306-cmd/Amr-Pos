import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  Laptop,
  Monitor,
  Share2,
  ShieldCheck,
  Smartphone,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [platform, setPlatform] = useState<'windows' | 'mac' | 'android' | 'ios' | 'other'>('windows');

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) setPlatform('ios');
    else if (/android/.test(ua)) setPlatform('android');
    else if (/macintosh|mac os x/.test(ua)) setPlatform('mac');
    else if (/windows|win32|win64/.test(ua)) setPlatform('windows');
    else setPlatform('other');

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS: platform === 'ios',
    platform,
    install,
  };
}

export const InstallAppModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { isInstallable, isInstalled, platform, install } = usePWAInstall();
  const [activeTab, setActiveTab] = useState<'pc' | 'android' | 'ios'>(
    platform === 'android' ? 'android' : platform === 'ios' ? 'ios' : 'pc'
  );

  if (!isOpen) return null;

  const downloadWindowsLauncher = () => {
    const script = `@echo off\r\ntitle AmarPOS Desktop App\r\necho Launching AmarPOS in native standalone desktop mode...\r\nstart msedge --app=http://localhost:3000 || start chrome --app=http://localhost:3000 || start http://localhost:3000\r\nexit\r\n`;
    const blob = new Blob([script], { type: 'application/x-bat' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Launch-AmarPOS-Desktop.bat';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-teal-50/50 dark:bg-teal-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-md">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-base text-slate-900 dark:text-white flex items-center gap-2">
                <span>AmarPOS অ্যাপ ইন্সটল করুন</span>
                {isInstalled && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                    ইন্সটলড ✓
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                পিসি অথবা মোবাইলে কোনো ব্রাউজার ট্যাব ছাড়া ফুলস্ক্রিন সফটওয়্যার হিসেবে চালান।
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Device Switcher Tabs */}
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('pc')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'pc'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-800'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span>Windows / Mac PC</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('android')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'android'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-800'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>Android মোবাইল</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ios')}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
              activeTab === 'ios'
                ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 shadow-sm border border-slate-200 dark:border-slate-800'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <Share2 className="w-4 h-4" />
            <span>iPhone / iPad</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* TAB 1: PC */}
          {activeTab === 'pc' && (
            <div className="space-y-4">
              {isInstallable && (
                <div className="p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-sm text-teal-950 dark:text-teal-100">
                      সরাসরি ব্রাউজার থেকে ১-ক্লিকে ইনস্টল করুন
                    </div>
                    <div className="text-[11px] text-teal-700 dark:text-teal-300 mt-0.5">
                      আপনার ব্রাউজার প্রস্তুত আছে। সরাসরি উইন্ডোজ অ্যাপ তৈরি হবে।
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await install();
                      if (ok) onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold shadow-md shrink-0 flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>এখনই ইনস্টল করুন</span>
                  </button>
                </div>
              )}

              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 bg-white dark:bg-slate-900">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold">
                    ১
                  </span>
                  <span>Google Chrome অথবা Microsoft Edge দিয়ে ইন্সটল:</span>
                </div>
                <div className="text-slate-600 dark:text-slate-400 leading-relaxed pl-7 space-y-1.5">
                  <p>
                    • ব্রাউজারের অ্যাড্রেস বারের (URL bar) একদম ডানপাশে দেখুন একটি <strong>অ্যাপ ইনস্টল আইকন (⊕ বা মনিটর আইকন)</strong> আছে।
                  </p>
                  <p>
                    • অথবা ব্রাউজারের ডানপাশের <strong>৩-ডট মেনু (⋮)</strong> চাপুন &gt; <strong>'Apps' / 'Save and share'</strong> &gt; <strong>'Install AmarPOS'</strong> নির্বাচন করুন।
                  </p>
                  <p>
                    • এর ফলে আপনার পিসির ডেস্কটপে <strong>AmarPOS</strong>-এর নিজস্ব আইকন তৈরি হবে।
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 bg-white dark:bg-slate-900">
                <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold">
                    ২
                  </span>
                  <span>উইন্ডোজ ডেস্কটপ লাউঞ্চার (.bat) ব্যবহার:</span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 pl-7 leading-relaxed">
                  যদি ব্রাউজারে ইনস্টল অপশন না পান, নিচের বাটনে ক্লিক করে <strong>'Launch-AmarPOS-Desktop.bat'</strong> ফাইলটি ডাউনলোড করে নিন। ডাবল ক্লিক করলেই ফুলস্ক্রিন ডেস্কটপ সফটওয়্যার উইন্ডো চালু হবে।
                </p>
                <div className="pl-7 pt-1">
                  <button
                    type="button"
                    onClick={downloadWindowsLauncher}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>উইন্ডোজ ডেস্কটপ লাউঞ্চার ডাউনলোড করুন</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ANDROID */}
          {activeTab === 'android' && (
            <div className="space-y-4">
              {isInstallable && (
                <div className="p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-sm text-teal-950 dark:text-teal-100">
                      মোবাইলে ১-ক্লিকে ইনস্টল করুন
                    </div>
                    <div className="text-[11px] text-teal-700 dark:text-teal-300 mt-0.5">
                      সরাসরি মোবাইল অ্যাপের মতো হোম স্ক্রিনে যোগ হবে।
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await install();
                      if (ok) onClose();
                    }}
                    className="px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-semibold shadow-md shrink-0 flex items-center gap-1.5"
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>ইন্সটল করুন</span>
                  </button>
                </div>
              )}

              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 bg-white dark:bg-slate-900">
                <div className="font-semibold text-slate-900 dark:text-white">
                  Android ফোনে Chrome ব্রাউজার থেকে ইনস্টল করার ধাপ:
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-400 leading-relaxed pl-2">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold shrink-0">১</span>
                    <span>Chrome ব্রাউজারের উপরে ডানদিকের <strong>৩-ডট (⋮) মেনু</strong> চাপুন।</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold shrink-0">২</span>
                    <span>তালিকায় থাকা <strong>'Install app'</strong> অথবা <strong>'Add to Home screen'</strong> চাপুন।</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold shrink-0">৩</span>
                    <span>কনফার্ম করতে <strong>'Install'</strong> চাপুন। মোবাইলের হোম স্ক্রিনে AmarPOS অ্যাপ আইকন যুক্ত হয়ে যাবে।</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: iOS */}
          {activeTab === 'ios' && (
            <div className="space-y-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 bg-white dark:bg-slate-900">
                <div className="font-semibold text-slate-900 dark:text-white">
                  iPhone / iPad এ Safari ব্রাউজার থেকে ইনস্টল করার ধাপ:
                </div>
                <div className="space-y-2 text-slate-600 dark:text-slate-400 leading-relaxed pl-2">
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold shrink-0">১</span>
                    <span>Safari ব্রাউজারের নিচে থাকা <strong>Share (শেয়ার আইকন ⎋)</strong> চাপুন।</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold shrink-0">২</span>
                    <span>মেনুটি একটু নিচে স্ক্রল করে <strong>'Add to Home Screen' (হোম স্ক্রিনে যোগ করুন)</strong> সিলেক্ট করুন।</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold shrink-0">৩</span>
                    <span>উপরের ডানপাশে <strong>'Add'</strong> বাটনে চাপ দিন। আপনার আইফোনে অ্যাপ হিসেবে সেভ হয়ে যাবে।</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Offline Performance Info */}
          <div className="rounded-2xl bg-slate-50 dark:bg-slate-950 p-4 border border-slate-200/80 dark:border-slate-800/80 flex items-start gap-3">
            <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-slate-900 dark:text-white">
                সুপারফাস্ট অফলাইন টেকনোলজি (IndexedDB)
              </div>
              <p className="text-slate-500 leading-relaxed">
                অ্যাপটি ইন্সটল করলে ইন্টারনেট ছাড়াও নিমেষেই ওপেন হবে। ইন্টারনেট সংযোগ বিচ্ছিন্ন থাকলেও কোনো ল্যাগ ছাড়া বারকোড স্ক্যান, বিক্রি সম্পন্ন এবং চালান প্রিন্ট করতে পারবেন। ইন্টারনেট এলে স্বয়ংক্রিয়ভাবে ক্লাউডে সিঙ্ক হয়ে যাবে।
              </p>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-xs shadow-sm hover:opacity-90"
          >
            বন্ধ করুন
          </button>
        </div>
      </div>
    </div>
  );
};

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [modalOpen, setModalOpen] = useState(false);

  if (isInstalled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 text-xs font-medium border border-emerald-200 dark:border-emerald-800 whitespace-nowrap shrink-0">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span>অ্যাপ সক্রিয়</span>
      </span>
    );
  }

  const handleClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (!ok) setModalOpen(true);
    } else {
      setModalOpen(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-all whitespace-nowrap shrink-0"
        title="পিসি অথবা মোবাইলে অ্যাপটি ইনস্টল করুন"
      >
        <Download className="w-3.5 h-3.5" />
        <span>অ্যাপ ইন্সটল</span>
      </button>

      <InstallAppModal isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};

export const OfflineBanner: React.FC<{ pendingCount: number }> = ({ pendingCount }) => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="no-print bg-amber-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between shadow-md">
      <div className="flex items-center gap-2">
        <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
        <span>
          <strong>অফলাইন মোড সক্রিয়:</strong> কোনো ইন্টারনেট প্রয়োজন নেই — ক্যাশড্রয়ার, বারকোড স্ক্যান, পস বিক্রয় ও চালান প্রিন্ট সম্পূর্ণ স্বাভাবিকভাবে কাজ করছে।
        </span>
      </div>
      {pendingCount > 0 && (
        <span className="bg-amber-800/80 px-2.5 py-0.5 rounded-full text-[11px] font-mono shrink-0 ml-2">
          {pendingCount} টি রসিদ লোকাল মেমরিতে পেন্ডিং
        </span>
      )}
    </div>
  );
};
