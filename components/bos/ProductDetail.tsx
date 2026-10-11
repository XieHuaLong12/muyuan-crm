'use client';
import Link from 'next/link';
import { ArrowLeft,AlertTriangle,Boxes,Truck,Sparkles,FilePlus2 } from 'lucide-react';
import { Header,Card,Table,Badge,EmptyState,Typography } from '@/components/ui/bos';

type Carton = {
  id: string;
  label: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  cartonCount: number;
  grossWeightKg: string | null;
};

type Variant = {
  id: string;
  sku: string;
  variantType: string;
  labelEn: string;
  labelCn: string;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  secondaryLabelCn: string;
  secondaryLengthCm: number | null;
  secondaryWidthCm: number | null;
  secondaryHeightCm: number | null;
  bedSizeCm: string;
  packingRaw: string;
  cartonCount: number;
  cbm: string;
  cbmComputed: string | null;
  grossWeightKg: string;
  grossWeightRaw: string;
  needsReview: boolean;
  reviewNote: string;
  unitsPer40HQ: number | null;
  cartons: Carton[];
  prices: { id: string; currency: string; incoterm: string; unitPrice: string; minQty: number; priceListKey: string; effectiveFrom: string }[];
  startingPrice: { amount: string; currency: string; incoterm: string } | null;
};

export type ProductDetailData = {
  id: string;
  model: string;
  nameEn: string;
  status: string;
  lengthLabel: string;
  lang: 'zh' | 'en';
  category: { code: string; name: string; path: string };
  series: { code: string; nameEn: string } | null;
  isModular: boolean;
  isSofaBed: boolean;
  leadTimeDays: number;
  qaMonths: number;
  variants: Variant[];
  materials: { id: string; role: string; name: string; nameEn: string; nameCn: string; specEn: string }[];
  options: { id: string; kind: string; code: string; name: string; nameEn: string; nameCn: string }[];
  moqs: { channel: string; channelLabelCn: string; minQty: number }[];
  media: { id: string; role: string; fileName: string; storageKey: string }[];
  aiProfile: { status: string; keywords: string[]; searchText: string } | null;
};

const ROLE_LABEL: Record<string, string> = {
  FOAM: '海绵',
  FILLING: '填充',
  COVER: '面料',
  FRAME: '结构',
  OTHER: '其他',
};

function dims(v: Variant): string {
  if (!v.lengthCm || !v.widthCm || !v.heightCm) return '—';
  const main = `${v.lengthCm}×${v.widthCm}×${v.heightCm}`;
  if (v.secondaryLengthCm && v.secondaryWidthCm && v.secondaryHeightCm) {
    return `${main} / ${v.secondaryLabelCn || '内空'} ${v.secondaryLengthCm}×${v.secondaryWidthCm}×${v.secondaryHeightCm}`;
  }
  if (v.bedSizeCm) return `${main} / 床 ${v.bedSizeCm}`;
  return main;
}

export function ProductDetail({ data }: { data: ProductDetailData }) {
  const reviewVariants = data.variants.filter(v => v.needsReview);
  const hero = data.media.find(m => m.role === 'HERO') ?? null;

  return (
    <>
      <Header
        eyebrow={`产品库 · ${data.category.path}`}
        title={`${data.model} ${data.series ? `· ${data.series.nameEn}` : ''}`}
        description={`${data.lengthLabel || data.nameEn} · ${data.variants.length} 个尺寸变体 · 交期 ${data.leadTimeDays} 天 · 质保 ${data.qaMonths} 个月`}
        actions={
          <>
            <Link href="/products" className="bos-button">
              <ArrowLeft size={15} /> 返回产品库
            </Link>
            <Link href={`/products/quotes/new?product=${data.id}`} className="bos-button bos-button-primary">
              <FilePlus2 size={15} /> 用此产品报价
            </Link>
          </>
        }
      />

      <Card className="bos-product-hero">
        {hero ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/${hero.storageKey}`} alt={`${data.model} 产品图`} />
            <p className="bos-footnote">产品图来自 2026 产品图册（{data.model}）。</p>
          </>
        ) : (
          <div className="bos-product-hero-missing">
            <strong>暂无产品图</strong>
            <p>该型号未收录在图册中，需要单独提供照片。</p>
          </div>
        )}
      </Card>

      {reviewVariants.length > 0 && (
        <Card className="bos-review-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>{reviewVariants.length} 个变体待核对</strong>
            <p>
              报价表的 CBM 与包装尺寸推导值偏差超过 15%，或存在已登记的来源冲突。
              数值仍按「以报价表为准」展示，<strong>未做自动修正</strong>，请人工确认后通过 API 更正。
            </p>
          </div>
        </Card>
      )}

      <Card>
        <div className="bos-section-title">
          <div>
            <Typography as="h2" variant="heading">尺寸变体与包装</Typography>
            <p>包装为多箱结构，CBM 校验值来自各纸箱尺寸推导</p>
          </div>
        </div>
        <Table
          caption="尺寸变体"
          headings={['尺寸 (cm)', '变体', '包装', '箱数', 'CBM', '推导 CBM', '毛重 (kg)', '40HQ', '价格']}
        >
          {data.variants.map(variant => (
            <tr key={variant.id} className={variant.needsReview ? 'bos-row-review' : undefined}>
              <td>
                <strong>{dims(variant)}</strong>
                <small>{variant.sku}</small>
              </td>
              <td>
                {variant.labelCn || variant.labelEn || '—'}
                {variant.variantType === 'MODULE' && <small>模块件</small>}
              </td>
              <td>
                <code>{variant.packingRaw || '—'}</code>
                {variant.cartons.length > 0 && (
                  <small>
                    {variant.cartons
                      .map(c => `${c.lengthCm}×${c.widthCm}×${c.heightCm}${c.cartonCount > 1 ? `×${c.cartonCount}` : ''}`)
                      .join(' + ')}
                  </small>
                )}
              </td>
              <td>{variant.cartonCount}</td>
              <td>{variant.cbm}</td>
              <td className={variant.needsReview ? 'bos-danger-text' : ''}>
                {variant.cbmComputed ?? '—'}
                {variant.needsReview && <AlertTriangle size={11} />}
              </td>
              <td>
                {variant.grossWeightKg}
                {variant.grossWeightRaw && <small>{variant.grossWeightRaw}</small>}
              </td>
              <td>{variant.unitsPer40HQ ?? '—'}</td>
              <td>
                {variant.startingPrice
                  ? `${variant.startingPrice.currency} ${variant.startingPrice.amount}`
                  : '—'}
                {variant.startingPrice && <small>{variant.startingPrice.incoterm}</small>}
              </td>
            </tr>
          ))}
        </Table>
        {reviewVariants.length > 0 && (
          <details className="bos-review-detail">
            <summary>查看 {reviewVariants.length} 条待核对说明</summary>
            <ul>
              {reviewVariants.map(v => (
                <li key={v.id}>
                  <strong>{v.sku}</strong>：{v.reviewNote}
                </li>
              ))}
            </ul>
          </details>
        )}
        {!data.variants.length && <EmptyState title="尚无尺寸变体" description="该型号还没有录入可报价的尺寸变体。" />}
      </Card>

      <div className="bos-product-columns">
        <Card>
          <div className="bos-section-title">
            <div>
              <Typography as="h2" variant="heading">材料（分层）</Typography>
              <p>报价表为权威值</p>
            </div>
          </div>
          <Table caption="材料" headings={['层次', '材料', '规格']}>
            {data.materials.map(material => (
              <tr key={material.id}>
                <td><Badge>{ROLE_LABEL[material.role] ?? material.role}</Badge></td>
                <td>{material.name}{material.name !== material.nameCn && material.nameCn && <small>{material.nameCn}</small>}</td>
                <td>{material.specEn || '—'}</td>
              </tr>
            ))}
          </Table>
          {!data.materials.length && <EmptyState title="尚未录入材料" description="报价表未提供该型号的材料分层。" />}
        </Card>

        <Card>
          <div className="bos-section-title">
            <div>
              <Typography as="h2" variant="heading">渠道起订量</Typography>
              <p>业务规则，非文档数据</p>
            </div>
          </div>
          <dl className="bos-moq-list">
            {data.moqs.map(moq => (
              <div key={moq.channel}>
                <dt>{moq.channelLabelCn || moq.channel}</dt>
                <dd>{moq.minQty} 件</dd>
              </div>
            ))}
          </dl>
          {!data.moqs.length && <p className="bos-footnote">该型号尚未配置渠道起订量。</p>}

          <div className="bos-section-title" style={{ marginTop: 24 }}>
            <div>
              <Typography as="h2" variant="heading">面料与颜色</Typography>
            </div>
          </div>
          {data.options.length ? (
            <ul className="bos-option-list">
              {data.options.map(option => (
                <li key={option.id}>
                  <Badge tone={option.kind === 'FABRIC' ? 'green' : 'neutral'}>
                    {option.kind === 'FABRIC' ? '面料' : '颜色'}
                  </Badge>
                  <span>{option.name}{option.code && ` (${option.code})`}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bos-footnote">尚未录入面料或颜色选项。</p>
          )}
        </Card>

        <Card className="bos-business-ai">
          <span className="bos-ai-symbol" aria-hidden><Sparkles size={17} /></span>
          <Typography as="h2" variant="heading">AI 产品画像</Typography>
          <p className="bos-channel-description">
            状态：{data.aiProfile?.status === 'APPROVED' ? '已审核' : '草稿（不可用于对外）'}
          </p>
          <p className="bos-footnote">
            系统只填入可从资料验证的检索文本。卖点、目标客群与推荐市场<strong>留空待人工填写</strong>，不编造。
          </p>
          {data.aiProfile?.searchText && (
            <>
              <Typography as="h3" variant="heading" style={{ marginTop: 16 }}>检索文本</Typography>
              <code className="bos-search-text">{data.aiProfile.searchText}</code>
            </>
          )}
          <div className="bos-inline-actions" style={{ marginTop: 16 }}>
            <span className="bos-text-link"><Boxes size={14} /> 变体 {data.variants.length}</span>
            <span className="bos-text-link"><Truck size={14} /> FOB 报价</span>
          </div>
        </Card>
      </div>
    </>
  );
}
