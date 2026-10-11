'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** 报价单固定 1000px 宽（导出图片清晰、版面稳定），预览时按容器宽度等比缩小，手机上也能看全。 */
export const QUOTE_DOC_WIDTH = 1000;

export function ScaledPreview({ children, label }: { children: ReactNode; label: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>();

  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const update = () => {
      const next = Math.min(1, o.clientWidth / QUOTE_DOC_WIDTH);
      setScale(next);
      setHeight(Math.ceil(i.offsetHeight * next));
    };
    const observer = new ResizeObserver(update);
    observer.observe(o);
    observer.observe(i);
    update();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outer} className="bos-quote-scale" style={{ height }} role="region" aria-label={label}>
      <div ref={inner} className="bos-quote-scale-inner" style={{ width: QUOTE_DOC_WIDTH, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
