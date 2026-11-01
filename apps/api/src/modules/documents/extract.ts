/**
 * Mission 23 — native document text extraction.
 *
 * Text PDFs are read with pdf.js. Scanned PDFs and images go through a real
 * Tesseract OCR worker (local traineddata, no network call at runtime). The
 * extraction method returned to the caller is never upgraded: a text PDF is
 * reported as `pdf_text`, OCR as `ocr_pdf` or `ocr_image`.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdf as renderPdf } from 'pdf-to-img';
import { createWorker } from 'tesseract.js';

const require = createRequire(import.meta.url);
export const MAX_PAGES = 5;
const MIN_TEXT_PER_PAGE = 40;

export interface ExtractionResult {
  text: string;
  method: 'pdf_text' | 'ocr_image' | 'ocr_pdf';
  pageCount: number;
  warnings: string[];
}

function yKey(item: { transform?: number[] }): number {
  return Math.round((item.transform?.[5] ?? 0) / 4) * 4;
}
function xPos(item: { transform?: number[] }): number {
  return item.transform?.[4] ?? 0;
}

/** Rebuilds visual lines from pdf.js text items (column-aware enough for invoices). */
export function textItemsToLines(items: { str: string; transform?: number[] }[]): string {
  const groups = new Map<number, { x: number; str: string }[]>();
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const key = yKey(item);
    const list = groups.get(key) ?? [];
    list.push({ x: xPos(item), str: item.str });
    groups.set(key, list);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, list]) =>
      list
        .sort((a, b) => a.x - b.x)
        .reduce((line, part, i) => {
          if (i === 0) return part.str;
          const prev = list[i - 1]!;
          const gap = part.x - (prev.x + prev.str.length * 4.5);
          return `${line}${gap > 12 ? '   ' : ' '}${part.str}`;
        }, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number; emptyPages: number }> {
  const doc = await getDocument({
    data: bytes,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  const pageCount = doc.numPages;
  const pages = Math.min(pageCount, MAX_PAGES);
  const out: string[] = [];
  let emptyPages = 0;
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = textItemsToLines(content.items as { str: string; transform?: number[] }[]);
    if (lines.replace(/\s/g, '').length < MIN_TEXT_PER_PAGE) emptyPages += 1;
    out.push(lines);
  }
  await doc.cleanup();
  return { text: out.join('\n\n'), pageCount, emptyPages };
}

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null;
async function ocrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const cache = path.resolve('.cache/tesseract');
      await mkdir(cache, { recursive: true });
      // tesseract.js expects all requested traineddata in one folder.
      for (const code of ['eng', 'fra']) {
        const data = require(`@tesseract.js-data/${code}`) as { langPath: string };
        await copyFile(
          path.join(data.langPath, `${code}.traineddata.gz`),
          path.join(cache, `${code}.traineddata.gz`),
        ).catch(() => undefined);
      }
      return createWorker(['eng', 'fra'], 1, { langPath: cache, cachePath: cache, logger: () => undefined });
    })().catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export async function ocrImage(buffer: Buffer | Uint8Array): Promise<{ text: string; confidence: number }> {
  const worker = await ocrWorker();
  const result = await worker.recognize(Buffer.from(buffer));
  return { text: result.data.text ?? '', confidence: (result.data.confidence ?? 0) / 100 };
}

export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  try { (await workerPromise).terminate(); } catch { /* already stopped */ }
  workerPromise = null;
}

export async function extractDocument(
  buffer: Buffer,
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png',
): Promise<ExtractionResult> {
  if (mimeType === 'application/pdf') {
    const parsed = await pdfText(new Uint8Array(buffer));
    const digits = parsed.text.replace(/\s/g, '');
    if (digits.length >= MIN_TEXT_PER_PAGE * Math.min(parsed.pageCount, MAX_PAGES)) {
      return {
        text: parsed.text,
        method: 'pdf_text',
        pageCount: parsed.pageCount,
        warnings: parsed.pageCount > MAX_PAGES
          ? [`Only the first ${MAX_PAGES} pages of ${parsed.pageCount} were read.`]
          : [],
      };
    }
    const warnings = ['The PDF contains little or no embedded text; pages were rendered and OCR was used.'];
    if (parsed.pageCount > MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} pages were OCR processed.`);
    const document = await renderPdf(buffer, { scale: 2 });
    const pages: string[] = [];
    let confidence = 0;
    let count = 0;
    for await (const page of document) {
      if (count >= MAX_PAGES) break;
      const ocr = await ocrImage(page);
      pages.push(ocr.text);
      confidence += ocr.confidence;
      count += 1;
    }
    return {
      text: pages.join('\n\n'),
      method: 'ocr_pdf',
      pageCount: parsed.pageCount,
      warnings: [...warnings, `Mean OCR confidence: ${Math.round((confidence / Math.max(count, 1)) * 100)}%.`],
    };
  }
  const ocr = await ocrImage(buffer);
  return {
    text: ocr.text,
    method: 'ocr_image',
    pageCount: 1,
    warnings: [`Mean OCR confidence: ${Math.round(ocr.confidence * 100)}%. Review every field.`],
  };
}
