'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp } from 'lucide-react';

const W = 1200;
const H = 900;
/** 白底产品图：产品最多占宽 88%、高 78%，与图册图片的留白一致。 */
const BOX = { w: W * 0.88, h: H * 0.78 };

type Fit = 'white' | 'scene';

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('这张图片打不开，请换 JPG 或 PNG')); };
    img.src = url;
  });
}

/** 缩小一份来分析：四周大多是白色就当白底产品图，并找出产品的轮廓。 */
function analyse(img: HTMLImageElement) {
  const scale = Math.min(1, 600 / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const ink = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return 255 - Math.min(data[i], data[i + 1], data[i + 2]) > 14;
  };
  let edge = 0;
  let edgeInk = 0;
  for (let x = 0; x < w; x += 1) { edge += 2; edgeInk += Number(ink(x, 0)) + Number(ink(x, h - 1)); }
  for (let y = 0; y < h; y += 1) { edge += 2; edgeInk += Number(ink(0, y)) + Number(ink(w - 1, y)); }
  let top = h, bottom = -1, left = w, right = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!ink(x, y)) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  const fit: Fit = edgeInk / edge < 0.1 ? 'white' : 'scene';
  const box = bottom < 0
    ? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
    : { x: left / scale, y: top / scale, w: (right - left + 1) / scale, h: (bottom - top + 1) / scale };
  return { fit, box };
}

/** 处理成 1200 × 900：白底图裁到产品轮廓后居中留白，场景图居中裁成 4:3 铺满。 */
function render(img: HTMLImageElement, fit: Fit, box: { x: number; y: number; w: number; h: number }): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = 'high';
  if (fit === 'white') {
    const s = Math.min(BOX.w / box.w, BOX.h / box.h);
    const dw = box.w * s;
    const dh = box.h * s;
    ctx.drawImage(img, box.x, box.y, box.w, box.h, (W - dw) / 2, (H - dh) / 2, dw, dh);
  } else {
    const ratio = W / H;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;
    if (sw / sh > ratio) sw = sh * ratio;
    else sh = sw / ratio;
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
  }
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片处理失败'))), 'image/jpeg', 0.86));
}

/** 管理员更换主图：先在浏览器里处理成统一的 4:3 白底图并预览，确认后上传。 */
export function ProductImageUpload({ productId, label = '更换主图' }: { productId: string; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<{ img: HTMLImageElement; box: { x: number; y: number; w: number; h: number }; name: string } | null>(null);
  const [fit, setFit] = useState<Fit>('white');
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const show = async (img: HTMLImageElement, nextFit: Fit, box: { x: number; y: number; w: number; h: number }) => {
    const blob = await render(img, nextFit, box);
    setPreview(old => {
      if (old) URL.revokeObjectURL(old.url);
      return { url: URL.createObjectURL(blob), blob };
    });
  };

  const choose = async (file: File | undefined) => {
    setMessage('');
    if (!file) return;
    if (!file.type.startsWith('image/')) return setMessage('请选择图片文件（JPG / PNG / WebP）');
    try {
      const img = await loadImage(file);
      const { fit: detected, box } = analyse(img);
      setSource({ img, box, name: file.name });
      setFit(detected);
      await show(img, detected, box);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '图片处理失败');
    }
  };

  const switchFit = async (next: Fit) => {
    if (!source) return;
    setFit(next);
    await show(source.img, next, source.box);
  };

  const cancel = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setSource(null);
    if (input.current) input.current.value = '';
  };

  const upload = async () => {
    if (!preview || !source) return;
    setBusy(true);
    setMessage('');
    try {
      const form = new FormData();
      form.append('file', new File([preview.blob], source.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }));
      const response = await fetch(`/api/products/${productId}/image`, { method: 'POST', body: form });
      const result = await response.json();
      if (!result.success) throw new Error(result.error);
      cancel();
      setMessage(result.data.status === 'ACTIVE' ? '主图已更换。' : '主图已更换，资料齐全后会自动上架。');
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bos-image-upload">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="bos-sr-only"
        id={`product-image-${productId}`}
        onChange={e => choose(e.target.files?.[0])}
      />
      {!preview && (
        <label htmlFor={`product-image-${productId}`} className="bos-button">
          <ImageUp size={15} /> {label}
        </label>
      )}
      {preview && (
        <div className="bos-image-upload-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="处理后的主图预览" width={240} height={180} />
          <div>
            <p>已处理成 1200 × 900，与产品库其他图片同一规格。</p>
            <div className="bos-quote-segment" role="radiogroup" aria-label="处理方式">
              <button type="button" role="radio" aria-checked={fit === 'white'} onClick={() => switchFit('white')}>白底留白</button>
              <button type="button" role="radio" aria-checked={fit === 'scene'} onClick={() => switchFit('scene')}>场景图铺满</button>
            </div>
            <div className="bos-actions">
              <button type="button" className="bos-button bos-button-primary" onClick={upload} disabled={busy}>{busy ? '上传中…' : '使用这张图'}</button>
              <button type="button" className="bos-button" onClick={cancel} disabled={busy}>取消</button>
            </div>
          </div>
        </div>
      )}
      {message && <p className="bos-image-upload-message" role="status">{message}</p>}
    </div>
  );
}
