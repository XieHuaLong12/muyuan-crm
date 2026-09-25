'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * 数字滚动：¥0 逐渐变化到 ¥1,280,000，不直接显示最终值。
 *
 * 只在数字型数据上用（销售额、利润、订单数、客户数、现金流）。
 * 尊重 prefers-reduced-motion：直接显示最终值，不做动画。
 */
export function CountUp({
  value,
  duration = 900,
  prefix = '',
  suffix = '',
  decimals = 0,
}: {
  value: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  // 初始为 0，与服务端渲染一致，避免水合不一致
  const [shown, setShown] = useState(0);
  const frame = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(value)) {
      setShown(0);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic，与 CSS 的 --motion-ease 观感一致
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration]);

  return (
    <span>
      {prefix}
      {shown.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
