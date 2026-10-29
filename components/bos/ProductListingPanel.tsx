'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PencilLine, Store, Archive, Wand2 } from 'lucide-react';
import { Card, Badge } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { ProductImageUpload } from '@/components/bos/ProductImageUpload';

export type ListingSummary = { status: string; listingMode: string; missing: string[] };

const STATUS_TEXT: Record<string, string> = { ACTIVE: '已上架', DRAFT: '待上架', ARCHIVED: '已下架' };

/** 产品页的上架管理（管理员）：状态、上架方式、还缺什么，以及上架 / 下架 / 自动上架、编辑与换主图。 */
export function ProductListingPanel({ productId, listing }: { productId: string; listing: ListingSummary }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const act = async (action: 'LIST' | 'UNLIST' | 'AUTO') => {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<ListingSummary>(`products/${productId}/listing`, 'POST', { action });
      setMessage(
        action === 'AUTO'
          ? result.status === 'ACTIVE' ? '已改为自动上架，资料齐全，已上架。' : `已改为自动上架，补齐 ${result.missing.join('、')} 后自动上架。`
          : action === 'LIST' ? '已上架，报价单可以选到这个型号了。' : '已下架，报价单不再显示这个型号。',
      );
      router.refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const auto = listing.listingMode === 'AUTO';
  return (
    <Card className="bos-listing-panel">
      <div className="bos-listing-state">
        <Badge tone={listing.status === 'ACTIVE' ? 'green' : listing.status === 'DRAFT' ? 'warning' : 'neutral'}>
          {STATUS_TEXT[listing.status] ?? listing.status}
        </Badge>
        <span>{auto ? '自动上架：主图、尺寸、价格齐全就上架' : '手动上架：由管理员上架、下架'}</span>
        {listing.missing.length > 0 && <span className="bos-danger-text">还缺：{listing.missing.join('、')}</span>}
      </div>
      <div className="bos-actions">
        {listing.status !== 'ACTIVE' && (
          <button type="button" className="bos-button bos-button-primary" onClick={() => act('LIST')} disabled={busy}>
            <Store size={15} /> 上架
          </button>
        )}
        {listing.status !== 'ARCHIVED' && (
          <button type="button" className="bos-button" onClick={() => act('UNLIST')} disabled={busy}>
            <Archive size={15} /> 下架
          </button>
        )}
        {!auto && (
          <button type="button" className="bos-button" onClick={() => act('AUTO')} disabled={busy}>
            <Wand2 size={15} /> 改为自动上架
          </button>
        )}
        <Link href={`/products/${productId}/edit`} className="bos-button">
          <PencilLine size={15} /> 编辑资料与价格
        </Link>
        <ProductImageUpload productId={productId} />
      </div>
      {message && <p className="bos-image-upload-message" role="status">{message}</p>}
    </Card>
  );
}
