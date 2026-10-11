'use client';
import Link from 'next/link';
import { Package,Layers3,AlertTriangle,ArrowUpRight,FilePlus2 } from 'lucide-react';
import { Header,Card,Table,Badge,EmptyState,Typography } from '@/components/ui/bos';

/**
 * Product OS 产品库列表（BOS 设计系统）
 * 三栏：左 分类/系列 + 数据质量；中 产品列表；右 AI 产品分析
 */

export type CatalogProduct = {
  id: string;
  model: string;
  name: string;
  categoryCode: string;
  categoryName: string;
  status: string;
  lengthLabel: string;
  isModular: boolean;
  isSofaBed: boolean;
  variantCount: number;
  reviewCount: number;
  minCbm: number | null;
  minUnitsPer40HQ: number | null;
  startingPrice: { amount: string; currency: string; incoterm: string } | null;
  image: string | null;
};

export type CatalogData = {
  query: { q: string; category: string; series: string; status: string; review: string; lang: 'zh' | 'en'; page: number };
  pageSize: number;
  total: number;
  libraryTotal: number;
  reviewCount: number;
  reviewBreakdown: { math: number; source: number; missing: number };
  tree: {
    code: string;
    name: string;
    nameCn: string;
    nameEn: string;
    children: { code: string; name: string; nameCn: string; nameEn: string; prefix: string }[];
  }[];
  products: CatalogProduct[];
};

function buildUrl(query: CatalogData['query'], patch: Partial<CatalogData['query']>) {
  const next = { ...query, ...patch, page: patch.page ?? 1 };
  const params = new URLSearchParams();
  if (next.q) params.set('q', next.q);
  if (next.category) params.set('category', next.category);
  if (next.series) params.set('series', next.series);
  if (next.status !== 'ACTIVE') params.set('status', next.status);
  if (next.review !== 'ALL') params.set('review', next.review);
  if (next.lang === 'en') params.set('lang', 'en');
  if (next.page > 1) params.set('page', String(next.page));
  const text = params.toString();
  return text ? `/products?${text}` : '/products';
}

export function ProductCatalog({ data }: { data: CatalogData }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <Header
        eyebrow="PRODUCT OS"
        title="产品库"
        description={`${data.total} 个型号 · 价格与包装以报价表为准（FOB）`}
        actions={
          <>
            <span className="bos-lang-switch" role="group" aria-label="语言">
              <Link href={buildUrl(data.query, { lang: 'zh' })} aria-current={data.query.lang === 'zh' ? 'page' : undefined}>中文</Link>
              <Link href={buildUrl(data.query, { lang: 'en' })} aria-current={data.query.lang === 'en' ? 'page' : undefined}>EN</Link>
            </span>
            <Link href={buildUrl(data.query, { review: 'NEEDS_REVIEW', page: 1 })} className="bos-button">
              <AlertTriangle size={15} />
              待核对 {data.reviewCount}
            </Link>
            <Link href="/products/quotes/new" className="bos-button bos-button-primary">
              <FilePlus2 size={15} /> 新建报价
            </Link>
          </>
        }
      />

      <div className="bos-products-grid">
        <aside className="bos-products-aside">
          <Card>
            <Typography as="h2" variant="heading">分类与系列</Typography>
            <nav className="bos-product-tree" aria-label="产品分类">
              <Link href={buildUrl(data.query, { category: '', series: '' })} aria-current={!data.query.category && !data.query.series ? 'page' : undefined}>
                <Layers3 size={15} /> 全部产品 <span>{data.total}</span>
              </Link>
              {data.tree.map(root => (
                <div className="bos-tree-group" key={root.code}>
                  <p className="bos-tree-root">{root.name}</p>
                  {root.children.map(child => (
                    <Link
                      key={child.code}
                      href={buildUrl(data.query, { category: child.code, series: '' })}
                      aria-current={data.query.category === child.code ? 'page' : undefined}
                    >
                      <Package size={15} />
                      {child.prefix && <em className="bos-tree-prefix">{child.prefix}</em>}
                      {child.name}
                    </Link>
                  ))}
                  {!root.children.length && <p className="bos-tree-empty">待上架</p>}
                </div>
              ))}
            </nav>
          </Card>

          <Card>
            <Typography as="h2" variant="heading">数据质量</Typography>
            <dl className="bos-quality">
              <div>
                <dt>算术疑点</dt>
                <dd className={data.reviewBreakdown.math ? 'bos-danger-text' : ''}>{data.reviewBreakdown.math}</dd>
              </div>
              <div>
                <dt>来源差异</dt>
                <dd>{data.reviewBreakdown.source}</dd>
              </div>
              <div>
                <dt>资料缺失</dt>
                <dd>{data.reviewBreakdown.missing}</dd>
              </div>
              <div>
                <dt>本页型号</dt>
                <dd>{data.products.length}</dd>
              </div>
            </dl>
            <p className="bos-footnote">
              <strong>算术疑点</strong>：数值自相矛盾（如 CBM 与包装尺寸算不通），需要修正。
              <strong>来源差异</strong>：中英文报价表数值不一致，需要决定以哪份为准。
              <strong>资料缺失</strong>：图册未收录。全部按报价表原值展示，未做自动修正。
            </p>
          </Card>
        </aside>

        <section className="bos-products-main">
          <Card>
            <form className="bos-lead-filter" action="/products">
              <input type="hidden" name="review" value={data.query.review === 'ALL' ? '' : data.query.review} />
              <label className="bos-search">
                <input
                  className="bos-input"
                  type="search"
                  name="q"
                  aria-label="搜索型号"
                  placeholder="搜索型号，例如 Y-601"
                  defaultValue={data.query.q}
                />
              </label>
              <select name="status" aria-label="状态" defaultValue={data.query.status}>
                <option value="ACTIVE">在售</option>
                <option value="DRAFT">草稿</option>
                <option value="ARCHIVED">归档</option>
                <option value="ALL">全部状态</option>
              </select>
              <button className="bos-button" type="submit">筛选</button>
            </form>

            <Table
              caption="产品库"
              headings={['产品图', '型号', '分类', '变体', '最低 CBM', '40HQ 可装', '起价', '状态']}
            >
              {data.products.map(product => (
                <tr key={product.id}>
                  <td>
                    <Link href={`/products/${product.id}`} className="bos-product-thumb">
                      {product.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/${product.image}`} alt={`${product.model} 产品图`} loading="lazy" width={84} height={60} />
                      ) : (
                        <span className="bos-product-thumb-missing" title="暂无产品图">待补图</span>
                      )}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/products/${product.id}`}>
                      <strong>{product.model}</strong>
                      <small>{product.lengthLabel || product.name}</small>
                    </Link>
                  </td>
                  <td>{product.categoryName}</td>
                  <td>
                    {product.variantCount}
                    {product.reviewCount > 0 && (
                      <small className="bos-danger-text">
                        <AlertTriangle size={11} /> {product.reviewCount} 待核对
                      </small>
                    )}
                  </td>
                  <td>{product.minCbm === null ? '—' : product.minCbm.toFixed(2)}</td>
                  <td>{product.minUnitsPer40HQ === null ? '—' : product.minUnitsPer40HQ}</td>
                  <td>
                    {product.startingPrice
                      ? `${product.startingPrice.currency} ${product.startingPrice.amount}`
                      : '—'}
                    {product.startingPrice && <small>{product.startingPrice.incoterm}</small>}
                  </td>
                  <td>
                    <Badge tone={product.status === 'ACTIVE' ? 'green' : 'neutral'}>
                      {product.status === 'ACTIVE' ? '在售' : product.status === 'DRAFT' ? '草稿' : '归档'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>

            {!data.products.length && (data.libraryTotal === 0 ? (
              <EmptyState
                title="产品库还没有数据"
                description="11 张产品表已经建好，但种子没有运行。部署时若产品库为空会自动灌入一次；如果这里仍然是空的，说明种子执行失败——请查看部署日志里的 “Product OS” 行，或在服务器上运行 pnpm db:seed:products。"
              />
            ) : (
              <EmptyState
                title="没有匹配的型号"
                description="试试其他型号关键词，或清除分类与状态筛选。"
                action={<Link href="/products" className="bos-button">清除筛选</Link>}
              />
            ))}

            <div className="bos-pagination">
              <span>
                第 {data.query.page} 页 · 共 {pages} 页 · {data.total} 个型号
              </span>
              <div>
                {data.query.page > 1 && (
                  <Link className="bos-button" href={buildUrl(data.query, { page: data.query.page - 1 })}>上一页</Link>
                )}
                {data.query.page < pages && (
                  <Link className="bos-button" href={buildUrl(data.query, { page: data.query.page + 1 })}>下一页</Link>
                )}
              </div>
            </div>
          </Card>
        </section>

        <aside className="bos-products-assistant">
          <Card className="bos-business-ai">
            <span className="bos-ai-symbol" aria-hidden>AI</span>
            <Typography as="h2" variant="heading">AI 产品分析</Typography>
            <p className="bos-channel-description">
              产品画像尚未生成。系统只填入可验证的检索文本（型号、材料、尺寸），
              <strong>不编造卖点与推荐市场</strong>。
            </p>
            <ul className="bos-suggestions">
              <li>
                <span className="bos-suggestion-number">01</span>
                <div>
                  <strong>选品推荐</strong>
                  <p>需要产品画像与价格数据齐全后开放。</p>
                </div>
              </li>
              <li>
                <span className="bos-suggestion-number">02</span>
                <div>
                  <strong>报价单</strong>
                  <p><Link href="/products/quotes/new">新建报价</Link>：选客户和型号，单价按价格表或该客户上次报价自动带出，运费按<Link href="/products/freight">运费库</Link>计算，生成中英文图片与 PDF。</p>
                </div>
              </li>
            </ul>
            <Link href="/products?review=NEEDS_REVIEW" className="bos-text-link">
              先处理待核对数据 <ArrowUpRight size={14} />
            </Link>
          </Card>
        </aside>
      </div>
    </>
  );
}
