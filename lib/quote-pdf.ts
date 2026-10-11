/**
 * 把若干 JPEG 页面图片封装成 PDF（A4 纵向，每页一张图）。
 *
 * 报价单在浏览器里先渲染成图片，再分页写入 PDF：中文、法文与产品图都按屏幕效果原样输出，
 * 不依赖服务器字体，也不需要第三方 PDF 库。JPEG 直接以 DCTDecode 嵌入，无需重新编码。
 */

export type PdfPageImage = {
  /** JPEG 文件字节 */
  jpeg: Uint8Array;
  /** 图片像素尺寸 */
  width: number;
  height: number;
};

export const A4_POINTS = { width: 595.28, height: 841.89 };

const encoder = new TextEncoder();

/** 只保留可打印 ASCII，防止标题里的括号或反斜杠破坏 PDF 字符串。 */
function pdfText(value: string) {
  return value.replace(/[^\x20-\x7e]/g, '').replace(/([\\()])/g, '\\$1');
}

const fixed = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

export function jpegPagesToPdf(pages: PdfPageImage[], options: { title?: string; margin?: number } = {}): Uint8Array {
  if (!pages.length) throw new Error('至少需要一页');
  const margin = options.margin ?? 24;
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: () => void) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  // 对象编号：1 目录，2 页面树，3 文档信息，之后每页 3 个对象（页面、图片、内容流）
  const pageId = (index: number) => 4 + index * 3;
  const totalObjects = 4 + pages.length * 3;

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  object(3, () => push(`<< /Title (${pdfText(options.title ?? 'Quotation')}) /Producer (LVANJU BOS) >>`));

  pages.forEach((page, index) => {
    const id = pageId(index);
    const drawWidth = A4_POINTS.width - margin * 2;
    const drawHeight = (page.height / page.width) * drawWidth;
    const y = A4_POINTS.height - margin - drawHeight;
    const content = `q\n${fixed(drawWidth)} 0 0 ${fixed(drawHeight)} ${fixed(margin)} ${fixed(y)} cm\n/Im0 Do\nQ\n`;

    object(id, () => push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_POINTS.width} ${A4_POINTS.height}] ` +
      `/Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    ));
    object(id + 1, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`);
      push(page.jpeg);
      push('\nendstream');
    });
    object(id + 2, () => {
      push(`<< /Length ${encoder.encode(content).length} >>\nstream\n`);
      push(content);
      push('endstream');
    });
  });

  const xrefOffset = length;
  push(`xref\n0 ${totalObjects}\n0000000000 65535 f \n`);
  for (let id = 1; id < totalObjects; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${totalObjects} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

/**
 * 分页：在整行内容块（抬头、条款、每一行产品、合计）的下边缘断页，避免把一行产品切成两半。
 * breaks 为这些块下边缘在文档里的位置（CSS 像素），pageHeight 为一页能容纳的 CSS 像素高度。
 * 单个块比一页还高时只能在页高处硬切。返回每页的 [start, end]。
 */
export function paginate(totalHeight: number, breaks: number[], pageHeight: number): [number, number][] {
  const pages: [number, number][] = [];
  let start = 0;
  while (totalHeight - start > pageHeight + 0.5) {
    const limit = start + pageHeight;
    let cut = start;
    for (const bottom of breaks) {
      if (bottom <= limit && bottom > cut) cut = bottom;
    }
    // 没有能放下的完整块：在页高处硬切
    if (cut <= start + 1) cut = limit;
    pages.push([start, cut]);
    start = cut;
  }
  pages.push([start, totalHeight]);
  return pages;
}
