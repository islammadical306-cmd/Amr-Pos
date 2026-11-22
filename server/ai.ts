import { GoogleGenAI, Type } from '@google/genai';
import { db } from './db.ts';

export function getGeminiApiKey(): string {
  let apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    try {
      const row = db.prepare(`SELECT key_value FROM internal_keys WHERE key_name = 'gemini_api_key'`).get() as { key_value: string } | undefined;
      if (row?.key_value?.trim() && row.key_value.trim() !== 'MY_GEMINI_API_KEY') {
        apiKey = row.key_value.trim();
      }
    } catch {
      // ignore
    }
  }

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY কনফিগার করা হয়নি। (Gemini API Key is not configured). দয়া করে POS সেটিংস (Settings) থেকে অথবা Render ড্যাশবোর্ডের Environment-এ GEMINI_API_KEY যোগ করুন।'
    );
  }
  return apiKey;
}

function getGeminiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      apiVersion: 'v1beta',
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface RecognitionExtraction {
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
}

export async function getAvailableGeminiModels(apiKey: string): Promise<{ models: string[]; apiVersion: 'v1beta' | 'v1'; error?: string }> {
  // 1. Try v1beta
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = (await res.json()) as any;
    if (res.ok && Array.isArray(data?.models)) {
      const models = data.models
        .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m: any) => String(m.name).replace(/^models\//, ''));
      if (models.length > 0) {
        return { models, apiVersion: 'v1beta' };
      }
    } else if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      // If unauthorized, bad key, or disabled API, return error immediately
      if (res.status === 400 || res.status === 403) {
        return { models: [], apiVersion: 'v1beta', error: msg };
      }
    }
  } catch (err) {
    // continue to v1 fallback
  }

  // 2. Try v1 fallback
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    const data = (await res.json()) as any;
    if (res.ok && Array.isArray(data?.models)) {
      const models = data.models
        .filter((m: any) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m: any) => String(m.name).replace(/^models\//, ''));
      return { models, apiVersion: 'v1' };
    } else if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { models: [], apiVersion: 'v1', error: msg };
    }
  } catch (err) {
    return { models: [], apiVersion: 'v1', error: (err as Error).message };
  }

  return { models: [], apiVersion: 'v1beta' };
}

async function callGeminiRest(
  apiKey: string,
  apiVersion: 'v1beta' | 'v1',
  model: string,
  imageBase64: string,
  mimeType: string,
  languagePreference: string
): Promise<string> {
  const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
  const cleanModel = model.replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt =
    `Analyze this retail product or medicine packaging image (strips, bottles, boxes, labels, barcodes). ` +
    `Perform accurate OCR for both English and Bangla text visible on the packaging. ` +
    `CRITICAL: NEVER prescribe medicines. Return a strictly valid JSON object with these keys: ` +
    `{"extractedText": string, "productName": string, "brand": string, "manufacturer": string, "genericName": string, "strength": string, "dosageForm": string, "packageSize": string, "barcode": string, "sku": string, "batchNumber": string, "expiryDate": string, "manufacturingDate": string, "category": string, "confidence": number, "isMedicine": boolean, "warnings": string[]}. ` +
    `Language preference: ${languagePreference === 'bn' ? 'Bangla and English' : 'English'}. Return ONLY raw JSON without markdown formatting.`;

  const bodyPayload: any = {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: cleanBase64,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
  };

  if (apiVersion === 'v1beta') {
    bodyPayload.generationConfig = {
      responseMimeType: 'application/json',
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bodyPayload),
  });

  const data = (await response.json()) as any;
  if (!response.ok) {
    const msg = data?.error?.message || `HTTP ${response.status}: ${JSON.stringify(data)}`;
    throw new Error(msg);
  }

  const candidate = data.candidates?.[0];
  const textPart = candidate?.content?.parts?.[0]?.text;
  if (!textPart) {
    throw new Error('No content returned from Gemini model');
  }
  return textPart;
}

export async function recognizeProductFromImage(
  imageBase64: string,
  mimeType: string,
  languagePreference: 'en' | 'bn' = 'en'
) {
  const apiKey = getGeminiApiKey();

  // 1. Query available models dynamically from Google for this exact API Key
  const modelInfo = await getAvailableGeminiModels(apiKey);
  if (modelInfo.error) {
    throw new Error(
      `Google API Error: ${modelInfo.error}. অনুগ্রহ করে https://aistudio.google.com/app/apikey থেকে নতুন ফ্রেশ API Key তৈরি করুন এবং প্রজেক্টে Generative Language API চালু আছে কিনা নিশ্চিত করুন।`
    );
  }

  // 2. Build candidate models prioritizing available ones
  let candidateModels: string[] = [];
  if (process.env.GEMINI_MODEL) {
    candidateModels.push(process.env.GEMINI_MODEL);
  }

  if (modelInfo.models.length > 0) {
    // Prefer modern flash models first
    const preferred = [
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-1.5-flash',
      'gemini-1.5-flash-8b',
      'gemini-1.5-pro',
    ];
    for (const pref of preferred) {
      if (modelInfo.models.includes(pref) && !candidateModels.includes(pref)) {
        candidateModels.push(pref);
      }
    }
    // Add any remaining model that supports generateContent
    for (const m of modelInfo.models) {
      if (!candidateModels.includes(m)) {
        candidateModels.push(m);
      }
    }
  }

  // Default fallback if list came empty
  if (candidateModels.length === 0) {
    candidateModels = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-flash'];
  }

  const ai = getGeminiClient(apiKey);
  const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const contentPayload = {
    parts: [
      {
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: cleanBase64,
        },
      },
      {
        text:
          `Analyze this retail product or medicine packaging image (strips, bottles, boxes, labels, barcodes). ` +
          `Perform accurate OCR for both English and Bangla text visible on the packaging. ` +
          `Identify only visible product details for Point-of-Sale inventory matching. ` +
          `CRITICAL RULES: ` +
          `1) NEVER prescribe medicines, give medical advice, or recommend dosages. ` +
          `2) NEVER invent or guess prices, batch numbers, manufacturing dates, or expiry dates if they are not clearly readable in the image—leave unreadable fields as empty string "" and add a clear warning. ` +
          `3) If a medicine name or strength is partially obscured or ambiguous, lower confidence and flag it in warnings for mandatory manual verification. ` +
          `Preferred warning language context: ${languagePreference === 'bn' ? 'Bangla and English' : 'English'}.`,
      },
    ],
  };

  const configPayload = {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        extractedText: { type: Type.STRING, description: 'All visible Bangla and English OCR text from the label' },
        productName: { type: Type.STRING, description: 'Brand or product name printed on packaging' },
        brand: { type: Type.STRING, description: 'Brand name' },
        manufacturer: { type: Type.STRING, description: 'Manufacturer / pharmaceutical company name' },
        genericName: { type: Type.STRING, description: 'Generic active ingredient if medicine, else empty string' },
        strength: { type: Type.STRING, description: 'Strength e.g. 500mg, 100ml, else empty string' },
        dosageForm: { type: Type.STRING, description: 'Tablet, Capsule, Syrup, Device, Lotion, etc.' },
        packageSize: { type: Type.STRING, description: 'e.g. 10 Tablets, 100ml, 60 Capsules' },
        barcode: { type: Type.STRING, description: 'Numeric barcode digits if visible, else empty string' },
        sku: { type: Type.STRING, description: 'SKU or item code if printed, else empty string' },
        batchNumber: { type: Type.STRING, description: 'Batch/Lot number only if clearly legible, else empty string' },
        expiryDate: { type: Type.STRING, description: 'Expiry date only if clearly legible, else empty string' },
        manufacturingDate: { type: Type.STRING, description: 'Mfg date only if clearly legible, else empty string' },
        category: { type: Type.STRING, description: 'Suggested retail or pharmacy category' },
        confidence: { type: Type.NUMBER, description: 'Confidence score between 0 and 1' },
        isMedicine: { type: Type.BOOLEAN, description: 'True if pharmaceutical / medicine packaging' },
        warnings: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Any legibility or verification warnings for the cashier',
        },
      },
    },
  };

  let rawJsonText = '';
  let lastErr: Error | null = null;

  for (const model of candidateModels) {
    try {
      // 1. Try SDK call
      const response = await ai.models.generateContent({
        model,
        contents: contentPayload,
        config: configPayload,
      });
      if (response && response.text) {
        rawJsonText = response.text.trim();
        break;
      }
    } catch (sdkErr) {
      lastErr = sdkErr as Error;
      // 2. Try direct REST call
      try {
        const restResult = await callGeminiRest(apiKey, modelInfo.apiVersion, model, imageBase64, mimeType, languagePreference);
        if (restResult) {
          rawJsonText = restResult.trim();
          break;
        }
      } catch (restErr) {
        lastErr = restErr as Error;
        continue;
      }
    }
  }

  if (!rawJsonText) {
    let cleanMsg = lastErr?.message || 'Failed to generate content with Gemini AI model';
    try {
      const parsed = JSON.parse(cleanMsg);
      if (parsed?.error?.message) {
        cleanMsg = parsed.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(cleanMsg);
  }

  // Strip potential markdown code fences if model returned ```json ... ```
  let cleanText = rawJsonText;
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleanText = cleanText.substring(firstBrace, lastBrace + 1);
  }

  const extraction = JSON.parse(cleanText) as RecognitionExtraction;

  // Match against existing SQLite products catalog
  const allProducts = db
    .prepare(
      `SELECT p.*, c.name as category_name, c.name_bn as category_name_bn,
              COALESCE((SELECT SUM(quantity) FROM product_batches WHERE product_id = p.id), 0) as current_stock
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.active = 1`
    )
    .all() as Array<Record<string, unknown>>;

  const needleName = (extraction.productName || '').toLowerCase();
  const needleGeneric = (extraction.genericName || '').toLowerCase();
  const needleBrand = (extraction.brand || '').toLowerCase();
  const needleBarcode = (extraction.barcode || '').trim();
  const needleOcr = (extraction.extractedText || '').toLowerCase();

  const scored = allProducts
    .map((prod) => {
      let score = 0;
      const pName = String(prod.name || '').toLowerCase();
      const pNameBn = String(prod.name_bn || '').toLowerCase();
      const pGen = String(prod.generic_name || '').toLowerCase();
      const pBrand = String(prod.brand || '').toLowerCase();
      const pBarcode = String(prod.barcode || '').trim();
      const pSku = String(prod.sku || '').toLowerCase();

      if (needleBarcode && pBarcode && needleBarcode === pBarcode) score += 0.95;
      if (needleName && (pName.includes(needleName) || needleName.includes(pName))) score += 0.65;
      if (needleName && pNameBn && pNameBn.includes(needleName)) score += 0.6;
      if (needleGeneric && pGen && (pGen.includes(needleGeneric) || needleGeneric.includes(pGen))) score += 0.4;
      if (needleBrand && pBrand && (pBrand.includes(needleBrand) || needleBrand.includes(pBrand))) score += 0.25;
      if (pSku && needleOcr.includes(pSku)) score += 0.4;
      if (pName && needleOcr.includes(pName.split(' ')[0])) score += 0.2;

      return {
        product: prod,
        matchScore: Math.min(0.99, Number(score.toFixed(2))),
      };
    })
    .filter((entry) => entry.matchScore >= 0.2)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 5);

  return {
    extraction,
    matches: scored,
    needsManualVerification: Boolean(
      extraction.isMedicine || extraction.confidence < 0.85 || scored.length === 0
    ),
  };
}
