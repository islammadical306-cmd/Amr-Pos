import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, ExternalLink, KeyRound, PlusCircle, RefreshCw, ScanBarcode, Upload, VideoOff } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { localOfflineProductMatch } from '../lib/offlineDb';
import { formatBDT, type Lang } from '../i18n';
import type { AIRecognitionResult, Category, Product } from '../types';

interface AIScannerViewProps {
  lang: Lang;
  isOnline: boolean;
  categories: Category[];
  onAddProductToCart: (product: Product) => void;
  onRefreshCatalog: () => Promise<void>;
}

export const AIScannerView: React.FC<AIScannerViewProps> = ({
  lang,
  isOnline,
  categories,
  onAddProductToCart,
  onRefreshCatalog,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string>('');
  const [lastMimeType, setLastMimeType] = useState<string>('image/jpeg');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [aiResult, setAiResult] = useState<AIRecognitionResult | null>(null);

  // Gemini API Key management state
  const [geminiConfigured, setGeminiConfigured] = useState<boolean | null>(null);
  const [geminiInputKey, setGeminiInputKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keySuccessMsg, setKeySuccessMsg] = useState('');
  const [showKeySetup, setShowKeySetup] = useState(false);

  // Manual verification gate for medicine safety
  const [verifiedName, setVerifiedName] = useState(false);
  const [verifiedBatchExpiry, setVerifiedBatchExpiry] = useState(false);

  // Offline / Manual Barcode & OCR Text fallback matcher
  const [manualQuery, setManualQuery] = useState('');
  const [offlineMatches, setOfflineMatches] = useState<Array<{ product: Product; matchScore: number }>>([]);

  // Quick New Product Registration modal state
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [newProd, setNewProd] = useState({
    name: '',
    sku: '',
    barcode: '',
    brand: '',
    manufacturer: '',
    generic_name: '',
    strength: '',
    dosage_form: '',
    package_size: '',
    category_id: '',
    purchase_price: '',
    retail_price: '',
    opening_stock: '10',
    batch_number: '',
    expiry_date: '',
  });

  // Check Gemini Key status on mount
  useEffect(() => {
    apiFetch<{ configured: boolean; source: string; maskedKey: string }>('/api/settings/gemini-key')
      .then((res) => {
        setGeminiConfigured(res.configured);
        if (!res.configured) {
          setShowKeySetup(true);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Ensure stream is attached to video element whenever camera becomes active
  useEffect(() => {
    if (cameraActive && videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.play().catch(() => {});
    }
  }, [cameraActive]);

  const startCamera = async () => {
    setError('');
    try {
      let stream: MediaStream;
      try {
        // Try back / environment camera first
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        // Fallback to any default camera (e.g. laptop webcam)
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
      }

      streamRef.current = stream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play().catch(() => {});
      }

      // Optional native BarcodeDetector check if available in Chromium
      const win = window as unknown as { BarcodeDetector?: new () => { detect: (el: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } };
      if (win.BarcodeDetector && videoRef.current) {
        const detector = new win.BarcodeDetector();
        const interval = setInterval(async () => {
          if (!videoRef.current || !streamRef.current) {
            clearInterval(interval);
            return;
          }
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              setManualQuery(codes[0].rawValue);
              runOfflineMatch(codes[0].rawValue);
            }
          } catch {
            // ignore frame detection error
          }
        }, 1200);
      }
    } catch (err) {
      setError(`Camera access unavailable: ${(err as Error).message}. You can upload an image or enter barcode/text manually.`);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const captureFromCamera = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 1280;
    canvas.height = videoRef.current.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setCapturedImage(dataUrl);
    setLastMimeType('image/jpeg');
    stopCamera();
    analyzeImage(dataUrl, 'image/jpeg');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setCapturedImage(dataUrl);
      const mime = file.type || 'image/jpeg';
      setLastMimeType(mime);
      analyzeImage(dataUrl, mime);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveGeminiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = geminiInputKey.trim();
    if (!cleanKey) return;
    setSavingKey(true);
    setError('');
    setKeySuccessMsg('');
    try {
      await apiFetch('/api/settings/gemini-key', {
        method: 'POST',
        body: JSON.stringify({ apiKey: cleanKey }),
      });
      setGeminiConfigured(true);
      setShowKeySetup(false);
      setKeySuccessMsg(lang === 'bn' ? 'জেমিনি এআই কি সফলভাবে সংরক্ষিত হয়েছে!' : 'Gemini AI Key saved successfully!');
      // If an image was already captured/uploaded, auto retry analysis!
      if (capturedImage) {
        analyzeImage(capturedImage, lastMimeType);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingKey(false);
    }
  };

  const analyzeImage = async (dataUrl: string, mimeType: string) => {
    setError('');
    setAiResult(null);
    setVerifiedName(false);
    setVerifiedBatchExpiry(false);

    if (!isOnline) {
      setError('Device is offline. Cloud AI Vision requires internet; use the Offline Barcode / Label Text Matcher below.');
      return;
    }

    setAnalyzing(true);
    try {
      const res = await apiFetch<AIRecognitionResult>('/api/ai/recognize', {
        method: 'POST',
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType,
          languagePreference: lang,
        }),
      });
      setAiResult(res);
      if (res.extraction) {
        setNewProd((prev) => ({
          ...prev,
          name: res.extraction.productName || '',
          sku: res.extraction.sku || `SKU-${Date.now().toString().slice(-5)}`,
          barcode: res.extraction.barcode || '',
          brand: res.extraction.brand || '',
          manufacturer: res.extraction.manufacturer || '',
          generic_name: res.extraction.genericName || '',
          strength: res.extraction.strength || '',
          dosage_form: res.extraction.dosageForm || '',
          package_size: res.extraction.packageSize || '',
          batch_number: res.extraction.batchNumber || '',
          expiry_date: res.extraction.expiryDate || '',
        }));
      }
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      if (msg.includes('GEMINI_API_KEY') || msg.includes('Gemini API Key')) {
        setShowKeySetup(true);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const runOfflineMatch = async (q: string) => {
    const res = await localOfflineProductMatch(q);
    setOfflineMatches(res);
  };

  const handleRegisterNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          ...newProd,
          category_id: newProd.category_id ? Number(newProd.category_id) : null,
          purchase_price: Number(newProd.purchase_price || 0),
          retail_price: Number(newProd.retail_price || 0),
          opening_stock: Number(newProd.opening_stock || 0),
          show_online: 1,
        }),
      });
      await onRefreshCatalog();
      setShowRegisterModal(false);
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: Camera & Upload & Offline Barcode */}
      <div className="lg:col-span-5 space-y-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-semibold text-base text-slate-900 dark:text-white">
                {lang === 'bn' ? 'AI পণ্য ও ওষুধ শনাক্তকরণ' : 'AI Product & Medicine Recognition'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {lang === 'bn'
                  ? 'ওষুধের পাতা, বোতল বা প্যাকেটের ছবি তুলুন (বাংলা ও ইংরেজি OCR)।'
                  : 'Capture strips, bottles, boxes, or labels (Bangla & English OCR).'}
              </p>
            </div>
            {geminiConfigured !== null && (
              <button
                type="button"
                onClick={() => setShowKeySetup((s) => !s)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border shrink-0 transition-colors ${
                  geminiConfigured
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                    : 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                }`}
              >
                <KeyRound className="w-3 h-3" />
                <span>
                  {geminiConfigured
                    ? lang === 'bn' ? 'AI কি সক্রিয়' : 'AI Active'
                    : lang === 'bn' ? 'AI কি দিন' : 'Setup Key'}
                </span>
              </button>
            )}
          </div>

          {/* Gemini API Key Banner & In-App Setup */}
          {showKeySetup && (
            <div className="rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50/80 dark:bg-teal-950/40 p-3.5 text-xs space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-teal-900 dark:text-teal-300 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span>{lang === 'bn' ? 'Google Gemini AI Key কনফিগারেশন' : 'Google Gemini AI Key Configuration'}</span>
                </div>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-800 dark:text-teal-400 underline underline-offset-2 shrink-0"
                >
                  <span>{lang === 'bn' ? 'ফ্রি কী নিন (Google AI Studio)' : 'Get Free Key (Google AI Studio)'}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                {lang === 'bn'
                  ? 'গুগল জেমিনি এআই সম্পূর্ণ বিনামূল্যে এপিআই কী দিয়ে থাকে। লিঙ্ক থেকে কী কপি করে নিচে পেস্ট করে সংরক্ষণ করুন।'
                  : 'Google Gemini AI provides a free API key. Copy the key from Google AI Studio and paste it below.'}
              </p>
              <form onSubmit={handleSaveGeminiKey} className="flex gap-2">
                <input
                  type="password"
                  value={geminiInputKey}
                  onChange={(e) => setGeminiInputKey(e.target.value)}
                  placeholder={lang === 'bn' ? 'Gemini API Key পেস্ট করুন (যেমন: AIzaSy...)' : 'Paste Gemini API Key (e.g. AIzaSy...)'}
                  className="flex-1 rounded-lg border border-teal-300 dark:border-teal-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="submit"
                  disabled={savingKey || !geminiInputKey.trim()}
                  className="px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white font-semibold text-xs transition-colors shrink-0"
                >
                  {savingKey ? (lang === 'bn' ? 'সেভ হচ্ছে...' : 'Saving...') : (lang === 'bn' ? 'সংরক্ষণ করুন' : 'Save Key')}
                </button>
              </form>
            </div>
          )}

          {keySuccessMsg && (
            <div className="rounded-lg border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 p-2.5 text-xs text-emerald-800 dark:text-emerald-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{keySuccessMsg}</span>
              </div>
              <button type="button" onClick={() => setKeySuccessMsg('')} className="text-emerald-700 text-xs font-semibold">✕</button>
            </div>
          )}

          {/* Always Keep Video element mounted to eliminate blank screen */}
          <div className="aspect-[4/3] rounded-xl bg-slate-950 overflow-hidden flex items-center justify-center relative border border-slate-800">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cameraActive ? 'w-full h-full object-cover' : 'hidden'}
            />
            {!cameraActive && (
              capturedImage ? (
                <img src={capturedImage} alt="Captured product" className="w-full h-full object-contain" />
              ) : (
                <div className="text-center text-slate-400 text-xs px-6">
                  <Camera className="w-8 h-8 mx-auto mb-2 opacity-60" />
                  {lang === 'bn'
                    ? 'ডিভাইসের ক্যামেরা চালু করুন অথবা ওষুধের ছবি আপলোড করে স্বয়ংক্রিয় তথ্য রিড করুন।'
                    : 'Open device camera or upload a packaging photo to extract OCR text & match stock.'}
                </div>
              )
            )}
          </div>

          <div className="flex flex-wrap gap-2.5">
            {!cameraActive ? (
              <button
                onClick={startCamera}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 text-xs font-semibold"
              >
                <Camera className="w-4 h-4" />
                {lang === 'bn' ? 'ক্যামেরা চালু করুন' : 'Open Camera'}
              </button>
            ) : (
              <>
                <button
                  onClick={captureFromCamera}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-semibold"
                >
                  {lang === 'bn' ? 'ছবি তুলুন ও শনাক্ত করুন' : 'Capture & Identify'}
                </button>
                <button
                  onClick={stopCamera}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium"
                >
                  <VideoOff className="w-4 h-4" />
                  {lang === 'bn' ? 'বন্ধ করুন' : 'Stop'}
                </button>
              </>
            )}

            <label className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 px-4 py-2 text-xs font-semibold cursor-pointer">
              <Upload className="w-4 h-4" />
              {lang === 'bn' ? 'ছবি আপলোড করুন' : 'Upload Image'}
              <input type="file" accept="image/*" capture="environment" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800 dark:text-amber-200 space-y-1.5">
              <div className="font-medium">{error}</div>
              {(error.includes('GEMINI_API_KEY') || error.includes('Gemini API Key')) && (
                <button
                  type="button"
                  onClick={() => setShowKeySetup(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 dark:text-teal-300 underline"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {lang === 'bn' ? 'এখানে ক্লিক করে Gemini API Key দিন' : 'Click here to configure Gemini API Key'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Local Offline Barcode & Text Matcher */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
            <ScanBarcode className="w-4 h-4 text-teal-700 dark:text-teal-400" />
            Local Barcode / Offline Catalog Matcher
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualQuery}
              onChange={(e) => {
                setManualQuery(e.target.value);
                runOfflineMatch(e.target.value);
              }}
              placeholder="Scan barcode, SKU, or type label text..."
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs"
            />
          </div>
          {offlineMatches.length > 0 && (
            <div className="space-y-2 pt-1">
              {offlineMatches.map((m) => (
                <div
                  key={m.product.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs"
                >
                  <div>
                    <div className="font-semibold">{m.product.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {m.product.generic_name || m.product.sku} · {formatBDT(m.product.retail_price)} · {Math.round(m.matchScore * 100)}% match
                    </div>
                  </div>
                  <button
                    onClick={() => onAddProductToCart(m.product)}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-medium shrink-0"
                  >
                    Add to Cart
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: AI Extraction & Verification */}
      <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-semibold text-sm text-slate-900 dark:text-white">
            AI Vision Extraction & Manual Verification
          </h3>
          {aiResult && (
            <span className="font-mono text-xs font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
              Confidence: {Math.round((aiResult.extraction.confidence || 0) * 100)}%
            </span>
          )}
        </div>

        {analyzing && (
          <div className="py-16 text-center text-xs text-slate-500 animate-pulse">
            Analyzing packaging text (Bangla & English OCR) and matching product database...
          </div>
        )}

        {!analyzing && !aiResult && (
          <div className="py-16 text-center text-xs text-slate-400">
            Capture or upload a product photo to inspect extracted label data, batch/expiry details, and matching inventory items.
          </div>
        )}

        {aiResult && (
          <div className="space-y-5">
            {aiResult.extraction.warnings?.length > 0 && (
              <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1 text-xs text-amber-800 dark:text-amber-200">
                <div className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4" />
                  Verification Required
                </div>
                {aiResult.extraction.warnings.map((w, i) => (
                  <div key={i}>· {w}</div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              {[
                ['Product Name', aiResult.extraction.productName],
                ['Brand', aiResult.extraction.brand],
                ['Manufacturer', aiResult.extraction.manufacturer],
                ['Generic Name', aiResult.extraction.genericName],
                ['Strength', aiResult.extraction.strength],
                ['Dosage Form', aiResult.extraction.dosageForm],
                ['Package Size', aiResult.extraction.packageSize],
                ['Barcode / SKU', aiResult.extraction.barcode || aiResult.extraction.sku],
                ['Batch No.', aiResult.extraction.batchNumber],
                ['Expiry Date', aiResult.extraction.expiryDate],
                ['Mfg Date', aiResult.extraction.manufacturingDate],
                ['Category', aiResult.extraction.category],
              ].map(([label, val]) => (
                <div key={label} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                  <div className="text-[11px] text-slate-500">{label}</div>
                  <div className="font-medium text-slate-900 dark:text-white mt-0.5 break-words">{val || '— Not visible —'}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[11px] font-medium text-slate-500 mb-1">Visible OCR Text</div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono whitespace-pre-wrap max-h-28 overflow-y-auto">
                {aiResult.extraction.extractedText || 'No text extracted.'}
              </div>
            </div>

            {/* Mandatory Manual Verification Checkboxes */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2 text-xs">
              <div className="font-semibold text-slate-900 dark:text-white">Cashier Verification Before Adding to Cart</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={verifiedName} onChange={(e) => setVerifiedName(e.target.checked)} />
                <span>I have visually verified the product name, strength, and unit price on the physical package.</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={verifiedBatchExpiry} onChange={(e) => setVerifiedBatchExpiry(e.target.checked)} />
                <span>I have checked the batch number & expiry date (not expired).</span>
              </label>
            </div>

            {/* Matching Products */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-white">
                  Matching Inventory Products ({aiResult.matches.length})
                </h4>
                <button
                  onClick={() => setShowRegisterModal(true)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  Register as New Product
                </button>
              </div>

              {aiResult.matches.length === 0 ? (
                <div className="p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-center text-xs text-slate-500">
                  No matching item found in your database. Click "Register as New Product" to save it with pre-filled AI details.
                </div>
              ) : (
                aiResult.matches.map((m) => (
                  <div
                    key={m.product.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800"
                  >
                    <div>
                      <div className="text-xs font-semibold text-slate-900 dark:text-white">
                        {m.product.name} {m.product.strength ? `(${m.product.strength})` : ''}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {m.product.generic_name || m.product.brand} · Stock: {m.product.current_stock} · Price: {formatBDT(m.product.retail_price)} · Match: {Math.round(m.matchScore * 100)}%
                      </div>
                    </div>
                    <button
                      disabled={!verifiedName || !verifiedBatchExpiry}
                      onClick={() => onAddProductToCart(m.product)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-xs font-semibold"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Add Verified to POS Cart
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Register New Product from AI Scan */}
      {showRegisterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <form
            onSubmit={handleRegisterNewProduct}
            className="w-full max-w-lg rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 space-y-3"
          >
            <h3 className="font-display font-semibold text-base">Register New Scanned Product</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <input
                required
                placeholder="Product Name *"
                value={newProd.name}
                onChange={(e) => setNewProd({ ...newProd, name: e.target.value })}
                className="col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                required
                placeholder="SKU *"
                value={newProd.sku}
                onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                placeholder="Barcode"
                value={newProd.barcode}
                onChange={(e) => setNewProd({ ...newProd, barcode: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                placeholder="Generic Name"
                value={newProd.generic_name}
                onChange={(e) => setNewProd({ ...newProd, generic_name: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                placeholder="Strength (e.g. 500mg)"
                value={newProd.strength}
                onChange={(e) => setNewProd({ ...newProd, strength: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <select
                value={newProd.category_id}
                onChange={(e) => setNewProd({ ...newProd, category_id: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              >
                <option value="">Select Category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.01"
                placeholder="Purchase Price (৳) *"
                value={newProd.purchase_price}
                onChange={(e) => setNewProd({ ...newProd, purchase_price: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                required
                type="number"
                step="0.01"
                placeholder="Retail Price (৳) *"
                value={newProd.retail_price}
                onChange={(e) => setNewProd({ ...newProd, retail_price: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                type="number"
                placeholder="Opening Stock"
                value={newProd.opening_stock}
                onChange={(e) => setNewProd({ ...newProd, opening_stock: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                placeholder="Batch Number"
                value={newProd.batch_number}
                onChange={(e) => setNewProd({ ...newProd, batch_number: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
              <input
                type="date"
                placeholder="Expiry Date"
                value={newProd.expiry_date}
                onChange={(e) => setNewProd({ ...newProd, expiry_date: e.target.value })}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowRegisterModal(false)} className="px-4 py-2 rounded-lg border text-xs">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-semibold">
                Save Product
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
