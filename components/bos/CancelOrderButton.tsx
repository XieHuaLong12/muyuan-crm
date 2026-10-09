'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { ReasonDialog } from '@/components/forms';

/** Administrators cancel an order; an order created from a deal voids that deal so revenue stays consistent. */
export function CancelOrderButton({ orderId, orderNo, updatedAt, hasDeal }: { orderId: string; orderNo: string; updatedAt: string; hasDeal: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="bos-button" onClick={() => setOpen(true)}>取消订单</button>
      {open && (
        <ReasonDialog title={`取消订单 ${orderNo}`} danger confirmText="确认取消订单" label="取消原因"
          description={<p>{hasDeal ? '关联的成交会同时作废并从业绩中移除，客户回到成交前的阶段（如果没有其他成交）。' : '订单将标记为已取消。'}广告平台不会再回传这笔购买，操作会留下记录。</p>}
          onClose={() => setOpen(false)}
          onConfirm={async reason => {
            await api(`orders/${orderId}/cancel`, 'POST', { reason, expectedUpdatedAt: updatedAt });
            setOpen(false);
            router.refresh();
          }} />
      )}
    </>
  );
}
