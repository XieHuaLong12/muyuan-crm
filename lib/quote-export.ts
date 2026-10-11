'use client';
import { A4_POINTS, jpegPagesToPdf, paginate, type PdfPageImage } from './quote-pdf';

/**
 * 报价单导出（浏览器端）：图片、PDF、复制到剪贴板、系统分享。
 * 先把单据渲染成画布，再按需要输出 PNG，或在产品行边缘分页后写成 PDF。
 */

/** iOS Safari 单张画布约 1600 万像素上限，超长报价自动降低倍率。 */
const MAX_CANVAS_PIXELS = 16_000_000;
const PDF_MARGIN = 24;

const isSafari = () => typeof navigator !== 'undefined' && /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

async function imagesReady(node: HTMLElement) {
  await Promise.all(Array.from(node.querySelectorAll('img')).map(img =>
    img.complete ? Promise.resolve() : new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); })));
  if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready;
}

export async function renderQuoteCanvas(node: HTMLElement) {
  const { toCanvas } = await import('html-to-image');
  await imagesReady(node);
  const width = node.offsetWidth;
  const height = node.scrollHeight;
  const pixelRatio = Math.max(1, Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / (width * height))));
  // 单据只用系统字体，跳过网页字体内嵌：更快，也避免跨域样式表报错
  const options = { pixelRatio, backgroundColor: '#ffffff', width, height, skipFonts: true, cacheBust: false };
  // Safari 第一次渲染时图片常常还没解码，渲染两次是 html-to-image 官方建议的做法
  if (isSafari()) await toCanvas(node, options);
  const canvas = await toCanvas(node, options);
  return { canvas, scale: canvas.width / width, cssHeight: height };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('图片生成失败'))), type, quality));
}

export async function quotePng(node: HTMLElement) {
  const { canvas } = await renderQuoteCanvas(node);
  return canvasBlob(canvas, 'image/png');
}

export async function quotePdf(node: HTMLElement, title: string) {
  const { canvas, scale, cssHeight } = await renderQuoteCanvas(node);
  const top = node.getBoundingClientRect().top;
  const ratio = node.offsetWidth / node.getBoundingClientRect().width || 1;
  const breaks = Array.from(node.querySelectorAll<HTMLElement>('[data-pdf-break]')).map(el => (el.getBoundingClientRect().bottom - top) * ratio);
  const pageCss = node.offsetWidth * ((A4_POINTS.height - PDF_MARGIN * 2) / (A4_POINTS.width - PDF_MARGIN * 2));
  const pages: PdfPageImage[] = [];
  for (const [start, end] of paginate(cssHeight, breaks, pageCss)) {
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.max(1, Math.round((end - start) * scale));
    const ctx = slice.getContext('2d');
    if (!ctx) throw new Error('浏览器不支持生成 PDF');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, Math.round(start * scale), canvas.width, slice.height, 0, 0, slice.width, slice.height);
    const jpeg = new Uint8Array(await (await canvasBlob(slice, 'image/jpeg', 0.92)).arrayBuffer());
    pages.push({ jpeg, width: slice.width, height: slice.height });
  }
  const bytes = jpegPagesToPdf(pages, { title, margin: PDF_MARGIN });
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const canCopyImage = () => typeof window !== 'undefined' && 'ClipboardItem' in window && Boolean(navigator.clipboard?.write);

/** 复制到剪贴板，可以直接粘贴进 WhatsApp Web / 微信。传 Promise 让 Safari 保留用户手势。 */
export async function copyImage(png: Promise<Blob>) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

export function canShareFiles() {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([new Uint8Array(1)], 'probe.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** 手机上调起系统分享（可直接选 WhatsApp）。用户取消分享不算错误。 */
export async function shareFile(blob: Blob, filename: string, title: string) {
  try {
    await navigator.share({ files: [new File([blob], filename, { type: blob.type })], title });
    return true;
  } catch (error) {
    if ((error as Error).name === 'AbortError') return false;
    throw error;
  }
}
