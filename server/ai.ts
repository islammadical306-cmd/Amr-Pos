import { GoogleGenAI, Type } from '@google/genai';
import { db } from './db.ts';

function getGeminiClient() {
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
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
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

export async function recognizeProductFromImage(
  imageBase64: string,
  mimeType: string,
  languagePreference: 'en' | 'bn' = 'en'
) {
  const ai = getGeminiClient();

  const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

  const candidateModels = [
    process.env.GEMINI_MODEL,
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ].filter(Boolean) as string[];

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

  let response: any = null;
  let lastErr: Error | null = null;
  for (const model of candidateModels) {
    try {
      response = await ai.models.generateContent({
        model,
        contents: contentPayload,
        config: configPayload,
      });
      if (response) break;
    } catch (err) {
      lastErr = err as Error;
      continue;
    }
  }

  if (!response) {
    throw lastErr || new Error('Failed to generate content with Gemini model');
  }

  const rawText = (response.text ?? '{}').trim();
  const extraction = JSON.parse(rawText) as RecognitionExtraction;

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
