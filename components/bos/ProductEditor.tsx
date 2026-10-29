'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { Header, Card, Typography } from '@/components/ui/bos';
import { NumberField } from '@/components/bos/quote/NumberField';
import { api } from '@/lib/client';
import { parsePacking } from '@/lib/product-packing';
import type { ProductEditorData } from '@/services/product-admin-service';

type VariantRow = {
  key: string;
  id?: string;
  sku?: string;
  labelCn: string;
  labelEn: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  packingRaw: string;
  cbm: number | null;
  grossWeightKg: number | null;
  priceUsd: number | null;
  priceCny: number | null;
};

let rowSeq = 0;
const blankVariant = (): VariantRow => ({
  key: `new-${(rowSeq += 1)}`, labelCn: '', labelEn: '', lengthCm: null, widthCm: null, heightCm: null,
  packingRaw: '', cbm: null, grossWeightKg: null, priceUsd: null, priceCny: null,
});

/** 新增 / 编辑产品（管理员）：型号、分类、尺寸与包装、美元 / 人民币价、材料、上架方式。 */
export function ProductEditor({ data }: { data: ProductEditorData }) {
  const router = useRouter();
  const editing = data.product;
  const [model, setModel] = useState(editing?.model ?? '');
  const [categoryCode, setCategoryCode] = useState(editing?.categoryCode ?? data.categories[0]?.code ?? '');
  const [nameCn, setNameCn] = useState(editing?.nameCn ?? '');
  const [nameEn, setNameEn] = useState(editing?.nameEn ?? '');
  const [descriptionCn, setDescriptionCn] = useState(editing?.descriptionCn ?? '');
  const [descriptionEn, setDescriptionEn] = useState(editing?.descriptionEn ?? '');
  const [incoterm, setIncoterm] = useState(editing?.incoterm ?? 'FOB');
  const [listingMode, setListingMode] = useState(editing?.listingMode ?? 'AUTO');
  const [materials, setMaterials] = useState(editing?.materials.length ? editing.materials : [{ cn: '', en: '' }]);
  const [variants, setVariants] = useState<VariantRow[]>(
    editing?.variants.length ? editing.variants.map(v => ({ ...v, key: v.id })) : [blankVariant()],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const patchVariant = (key: string, patch: Partial<VariantRow>) =>
    setVariants(rows => rows.map(row => (row.key === key ? { ...row, ...patch } : row)));

  const save = async () => {
    setError('');
    if (!editing && !model.trim()) return setError('请填写型号');
    if (variants.some(v => !v.lengthCm || !v.widthCm)) return setError('每个尺寸至少要填长和宽');
    setSaving(true);
    try {
      const body = {
        ...(editing ? {} : { model: model.trim() }),
        categoryCode, nameCn, nameEn, descriptionCn, descriptionEn, incoterm, listingMode,
        materials: materials.filter(m => m.cn.trim() || m.en.trim()),
        variants: variants.map(v => ({
          id: v.id, labelCn: v.labelCn, labelEn: v.labelEn, lengthCm: v.lengthCm, widthCm: v.widthCm, heightCm: v.heightCm,
          packingRaw: v.packingRaw, cbm: v.cbm, grossWeightKg: v.grossWeightKg, priceUsd: v.priceUsd, priceCny: v.priceCny,
        })),
      };
      const result = editing
        ? await api<{ id: string }>(`products/${editing.id}`, 'PATCH', body)
        : await api<{ id: string }>('products', 'POST', body);
      router.push(`/products/${result.id}?saved=1`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      setSaving(false);
    }
  };

  return (
    <>
      <Header
        eyebrow="产品库 · 管理员"
        title={editing ? `编辑 ${editing.model}` : '新增产品'}
        description="填好尺寸、包装和价格后保存；主图在产品页上传，系统自动处理成 4:3 白底图。"
        actions={
          <Link href={editing ? `/products/${editing.id}` : '/products'} className="bos-button">
            <ArrowLeft size={15} /> 返回
          </Link>
        }
      />

      <div className="bos-product-editor">
        <Card>
          <Typography as="h2" variant="heading">基本资料</Typography>
          <div className="bos-quote-grid">
            <label className="bos-quote-field">
              <span>型号</span>
              <input
                className="bos-input"
                value={model}
                onChange={e => setModel(e.target.value)}
                readOnly={!!editing}
                aria-readonly={!!editing}
                placeholder="例如 M-809"
              />
              {editing && <em>型号创建后不能修改</em>}
            </label>
            <label className="bos-quote-field">
              <span>分类</span>
              <select className="bos-input" value={categoryCode} onChange={e => setCategoryCode(e.target.value)}>
                {data.categories.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            <label className="bos-quote-field">
              <span>中文名 <em>留空则用「分类 + 型号」</em></span>
              <input className="bos-input" value={nameCn} onChange={e => setNameCn(e.target.value)} />
            </label>
            <label className="bos-quote-field">
              <span>英文名 <em>英文报价单使用</em></span>
              <input className="bos-input" value={nameEn} onChange={e => setNameEn(e.target.value)} />
            </label>
            <label className="bos-quote-field bos-quote-span">
              <span>中文说明 <em>卖点、规格参数，显示在产品页</em></span>
              <textarea className="bos-input" rows={3} value={descriptionCn} onChange={e => setDescriptionCn(e.target.value)} />
            </label>
            <label className="bos-quote-field bos-quote-span">
              <span>英文说明</span>
              <textarea className="bos-input" rows={2} value={descriptionEn} onChange={e => setDescriptionEn(e.target.value)} />
            </label>
          </div>
        </Card>

        <Card>
          <Typography as="h2" variant="heading">上架方式</Typography>
          <div className="bos-quote-segment" role="radiogroup" aria-label="上架方式">
            <button type="button" role="radio" aria-checked={listingMode === 'AUTO'} onClick={() => setListingMode('AUTO')}>
              自动上架 <small>主图、尺寸、价格齐全就上架</small>
            </button>
            <button type="button" role="radio" aria-checked={listingMode === 'MANUAL'} onClick={() => setListingMode('MANUAL')}>
              手动上架 <small>在产品页自己点上架 / 下架</small>
            </button>
          </div>
          <p className="bos-footnote">已上架的产品才会出现在报价单的选品里；待上架、已下架的仍可在产品库查看和编辑。</p>
        </Card>

        <Card>
          <div className="bos-section-title">
            <div>
              <Typography as="h2" variant="heading">尺寸、包装与价格</Typography>
              <p>尺寸单位 cm；包装写法如 96*96*35、102*28*28 2pc、100*29*20+101*21*13；CBM 留空按包装计算。</p>
            </div>
            <label className="bos-quote-field bos-product-editor-incoterm">
              <span>价格条款</span>
              <select className="bos-input" value={incoterm} onChange={e => setIncoterm(e.target.value)}>
                {['FOB', 'EXW', 'CIF', 'DDP'].map(term => <option key={term}>{term}</option>)}
              </select>
            </label>
          </div>
          <div className="bos-product-editor-variants">
            {variants.map((v, index) => {
              const computed = v.packingRaw.trim() ? parsePacking(v.packingRaw).computedCbm || null : null;
              return (
                <fieldset key={v.key} className="bos-product-editor-variant">
                  <legend>尺寸 {index + 1}{v.sku ? <small> · {v.sku}</small> : null}</legend>
                  <div className="bos-product-editor-dims">
                    <label className="bos-quote-field"><span>长</span><NumberField value={v.lengthCm} onValue={n => patchVariant(v.key, { lengthCm: n })} aria-label={`尺寸 ${index + 1} 长`} /></label>
                    <label className="bos-quote-field"><span>宽</span><NumberField value={v.widthCm} onValue={n => patchVariant(v.key, { widthCm: n })} aria-label={`尺寸 ${index + 1} 宽`} /></label>
                    <label className="bos-quote-field"><span>高 <em>可空</em></span><NumberField value={v.heightCm} onValue={n => patchVariant(v.key, { heightCm: n })} aria-label={`尺寸 ${index + 1} 高`} /></label>
                    <label className="bos-quote-field"><span>规格名</span><input className="bos-input" value={v.labelCn} onChange={e => patchVariant(v.key, { labelCn: e.target.value })} placeholder="如 双人位" /></label>
                  </div>
                  <div className="bos-product-editor-dims">
                    <label className="bos-quote-field bos-product-editor-wide"><span>包装尺寸</span><input className="bos-input" value={v.packingRaw} onChange={e => patchVariant(v.key, { packingRaw: e.target.value })} placeholder="31*31*98" /></label>
                    <label className="bos-quote-field"><span>CBM {computed !== null && <em>包装算得 {computed}</em>}</span><NumberField value={v.cbm} onValue={n => patchVariant(v.key, { cbm: n })} aria-label={`尺寸 ${index + 1} CBM`} /></label>
                    <label className="bos-quote-field"><span>毛重 kg</span><NumberField value={v.grossWeightKg} onValue={n => patchVariant(v.key, { grossWeightKg: n })} aria-label={`尺寸 ${index + 1} 毛重`} /></label>
                  </div>
                  <div className="bos-product-editor-dims">
                    <label className="bos-quote-field"><span>美元价 USD</span><NumberField value={v.priceUsd} onValue={n => patchVariant(v.key, { priceUsd: n })} aria-label={`尺寸 ${index + 1} 美元价`} /></label>
                    <label className="bos-quote-field"><span>人民币价 CNY</span><NumberField value={v.priceCny} onValue={n => patchVariant(v.key, { priceCny: n })} aria-label={`尺寸 ${index + 1} 人民币价`} /></label>
                    <div className="bos-product-editor-remove">
                      <button
                        type="button"
                        className="bos-button bos-button-ghost"
                        onClick={() => setVariants(rows => rows.filter(row => row.key !== v.key))}
                        disabled={variants.length === 1}
                        aria-label={`删除尺寸 ${index + 1}`}
                      >
                        <Trash2 size={15} /> 删除
                      </button>
                    </div>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <button type="button" className="bos-button" onClick={() => setVariants(rows => [...rows, blankVariant()])}>
            <Plus size={15} /> 添加尺寸
          </button>
        </Card>

        <Card>
          <Typography as="h2" variant="heading">材料（由上到下）</Typography>
          <div className="bos-product-editor-materials">
            {materials.map((m, index) => (
              <div key={index} className="bos-product-editor-material">
                <input className="bos-input" value={m.cn} placeholder="中文，如 白色针织面料" aria-label={`材料 ${index + 1} 中文`}
                  onChange={e => setMaterials(rows => rows.map((row, i) => (i === index ? { ...row, cn: e.target.value } : row)))} />
                <input className="bos-input" value={m.en} placeholder="English, e.g. White knitted fabric" aria-label={`材料 ${index + 1} 英文`}
                  onChange={e => setMaterials(rows => rows.map((row, i) => (i === index ? { ...row, en: e.target.value } : row)))} />
                <button type="button" className="bos-button bos-button-ghost" aria-label={`删除材料 ${index + 1}`}
                  onClick={() => setMaterials(rows => (rows.length === 1 ? [{ cn: '', en: '' }] : rows.filter((_, i) => i !== index)))}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="bos-button" onClick={() => setMaterials(rows => [...rows, { cn: '', en: '' }])}>
            <Plus size={15} /> 添加材料
          </button>
        </Card>

        <div className="bos-product-editor-save">
          {error && <p className="bos-danger-text" role="alert">{error}</p>}
          <button type="button" className="bos-button bos-button-primary" onClick={save} disabled={saving}>
            <Save size={15} /> {saving ? '保存中…' : editing ? '保存修改' : '创建产品'}
          </button>
        </div>
      </div>
    </>
  );
}
