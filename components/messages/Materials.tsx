'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, FileText, Loader2, Search, X } from 'lucide-react';
import { api } from '@/lib/client';
import { MATERIAL_CATEGORIES, fileSize, languageBadge } from '@/lib/sales-materials';
import { formatDateTime, requestId } from './types';

type Picker = {
  language: string;
  files: { id: string; title: string; category: string; language: string; fileName: string; mimeType: string; size: number; updatedAt: string }[];
  products: { id: string; model: string; name: string; images: { id: string; hero: boolean; src: string }[] }[];
  recent: { id: string; fileName: string; mimeType: string; sentAt: string; to: string }[];
};
type Kind = 'MATERIAL' | 'PRODUCT_IMAGE' | 'RECENT';
type Picked = { kind: Kind; id: string };
const TABS: { key: Kind; label: string }[] = [{ key: 'MATERIAL', label: '目录与资料' }, { key: 'PRODUCT_IMAGE', label: '产品图' }, { key: 'RECENT', label: '最近发过' }];

/**
 * 产品资料 above the composer: catalogs and spec sheets from the 资料库 (the customer's language first), product
 * photos by model, and files sent lately. Tick several and send them together, with one optional line of text.
 */
export function MaterialsPanel({ customerId, timezone, canChat, onClose, onSent }: { customerId: string; timezone: string; canChat: boolean; onClose: () => void; onSent: () => void }) {
  const [tab, setTab] = useState<Kind>('MATERIAL');
  const [q, setQ] = useState('');
  const [data, setData] = useState<Picker>();
  const [picked, setPicked] = useState<Picked[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(''), [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      api<Picker>(`inbox/materials?customerId=${encodeURIComponent(customerId)}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
        .then(r => { setData(r); setError(''); }).catch(e => setError((e as Error).message));
    }, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [customerId, q]);

  const has = (kind: Kind, id: string) => picked.some(p => p.kind === kind && p.id === id);
  const toggle = (kind: Kind, id: string) => setPicked(list => has(kind, id) ? list.filter(p => !(p.kind === kind && p.id === id)) : [...list, { kind, id }]);

  async function send() {
    if (!picked.length || busy) return;
    setBusy('send'); setError('');
    try {
      const { assets } = await api<{ assets: { id: string }[] }>('inbox/materials', 'POST', { customerId, items: picked });
      // One message per file, in the order ticked; the line of text goes with the first one.
      for (const [i, asset] of assets.entries()) {
        setBusy(`${i + 1}/${assets.length}`);
        const r = await api<{ error?: string }>('whatsapp/send', 'POST', { customerId, content: i === 0 ? caption.trim() : '', mediaAssetId: asset.id, requestId: requestId() });
        if (r.error) throw new Error(`第 ${i + 1} 个没发出去：${r.error}`);
      }
      setPicked([]); setCaption(''); onSent(); onClose();
    } catch (e) { setError((e as Error).message); onSent(); } finally { setBusy(''); }
  }

  const count = (kind: Kind) => picked.filter(p => p.kind === kind).length;
  return <div className="bos-chat-panel bos-chat-materials" role="dialog" aria-label="产品资料">
    <div className="bos-chat-panel-head">
      <div className="bos-chat-segments" role="tablist" aria-label="资料来源">
        {TABS.map(t => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}>{t.label}{count(t.key) ? ` ${count(t.key)}` : ''}</button>)}
      </div>
      <label className="bos-chat-panel-search"><Search size={14} aria-hidden="true" /><span className="bos-chat-sr">搜资料</span>
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={tab === 'PRODUCT_IMAGE' ? '搜型号或名字，比如 M-803' : '搜资料名称或文件名'} /></label>
      <button type="button" className="bos-chat-icon-button" onClick={onClose} aria-label="关闭产品资料"><X size={16} /></button>
    </div>
    {!canChat && <p className="bos-chat-panel-note">客户超过 24 小时没回复时只能发模板消息。先发模板，客户回复后再发资料。</p>}
    <div className="bos-chat-panel-body">
      {!data && !error && <p className="bos-chat-hint" style={{ display: 'block' }}>正在加载…</p>}
      {data && tab === 'MATERIAL' && (data.files.length ? data.files.map(f => <button key={f.id} type="button" className="bos-chat-pick-row" aria-pressed={has('MATERIAL', f.id)} onClick={() => toggle('MATERIAL', f.id)}>
        <i className="bos-chat-check" aria-hidden="true">{has('MATERIAL', f.id) && <Check size={12} />}</i>
        <b className="bos-chat-file-badge">{f.mimeType === 'application/pdf' ? 'PDF' : (f.fileName.split('.').pop() || 'FILE').slice(0, 4).toUpperCase()}</b>
        <span><strong>{f.title}</strong><small>{[MATERIAL_CATEGORIES[f.category as keyof typeof MATERIAL_CATEGORIES] ?? f.category, fileSize(f.size), `更新于 ${formatDateTime(f.updatedAt, timezone)}`].join(' · ')}</small></span>
        <em className={f.language && f.language === data.language ? 'is-match' : undefined}>{languageBadge(f.language)}</em>
      </button>) : <p className="bos-chat-panel-empty">{q ? '没有找到匹配的资料。' : '资料库还没有文件。'}管理员可以在「产品库 · 资料文件」上传产品目录、规格表。</p>)}
      {data && tab === 'PRODUCT_IMAGE' && (data.products.length ? data.products.map(p => <div key={p.id} className="bos-chat-pick-product">
        <span><strong>{p.model}</strong> · {p.name}</span>
        <div>{p.images.map((image, i) => <button key={image.id} type="button" aria-pressed={has('PRODUCT_IMAGE', image.id)} aria-label={`${p.model} 第 ${i + 1} 张${image.hero ? '（主图）' : ''}`} onClick={() => toggle('PRODUCT_IMAGE', image.id)}>
          {/* Authenticated product photos from our own route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.src} alt="" loading="lazy" /><i className="bos-chat-check" aria-hidden="true">{has('PRODUCT_IMAGE', image.id) && <Check size={12} />}</i>
          {image.hero && <small>主图</small>}
        </button>)}</div>
      </div>) : <p className="bos-chat-panel-empty">{q ? '没有这个型号的产品图。' : '产品库还没有上传产品图。'}</p>)}
      {data && tab === 'RECENT' && (data.recent.length ? data.recent.map(f => <button key={f.id} type="button" className="bos-chat-pick-row" aria-pressed={has('RECENT', f.id)} onClick={() => toggle('RECENT', f.id)}>
        <i className="bos-chat-check" aria-hidden="true">{has('RECENT', f.id) && <Check size={12} />}</i>
        <FileText size={18} aria-hidden="true" color="#4b6455" />
        <span><strong>{f.fileName}</strong><small>{formatDateTime(f.sentAt, timezone)} 发给 {f.to}</small></span>
      </button>) : <p className="bos-chat-panel-empty">最近 60 天你还没在这里发过文件或图片。</p>)}
    </div>
    {error && <p className="bos-chat-error" role="alert">{error}</p>}
    <div className="bos-chat-panel-foot">
      <span>已选 {picked.length} 个</span>
      <label><span className="bos-chat-sr">附一句话（可选）</span><input value={caption} maxLength={1000} onChange={e => setCaption(e.target.value)} placeholder="附一句话（可选），和第一个文件一起发" /></label>
      <button type="button" className="bos-chat-panel-send" disabled={!picked.length || !canChat || !!busy} onClick={send}>{busy ? <><Loader2 size={14} aria-hidden="true" />{busy === 'send' ? '准备中…' : `发送中 ${busy}`}</> : '一起发送'}</button>
    </div>
    <p className="bos-chat-panel-tip">资料在 <Link href="/products/materials">产品库 · 资料文件</Link> 里维护，换新版后大家自动发新版。</p>
  </div>;
}
