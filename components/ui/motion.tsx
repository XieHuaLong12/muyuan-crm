import type { CSSProperties, ReactNode } from 'react';

/**
 * 统一动效原语。规范见 docs/UI_MOTION_SYSTEM.md。
 *
 * 关键取舍：`Reveal` 是**服务端组件**（没有 'use client'）——
 * 入场动画纯 CSS 完成，因此分层进入不增加任何客户端 JavaScript。
 * 只有需要按帧改数字的 `CountUp` 才是客户端组件。
 */

/** 分层进入的延迟节奏（毫秒），对应规范 §3。 */
export const MOTION_DELAY = { title: 0, actions: 100, cards: 200, main: 400, aside: 600 } as const;

type RevealProps = {
  children: ReactNode;
  /** 延迟毫秒，可用 MOTION_DELAY */
  delay?: number;
  /** slideUp（默认，数据卡片/主体）或 fade（图表/辅助模块） */
  variant?: 'up' | 'fade';
  className?: string;
  as?: 'div' | 'section' | 'aside';
};

/** 分层进入容器：opacity 0→1，translateY 20px→0。 */
export function Reveal({ children, delay = 0, variant = 'up', className = '', as: Tag = 'div' }: RevealProps) {
  const style = { '--motion-delay': `${delay}ms` } as CSSProperties;
  return (
    <Tag className={`${variant === 'fade' ? 'motion-fade' : 'motion-in'} ${className}`.trim()} style={style}>
      {children}
    </Tag>
  );
}

/** AI 智能状态：绿色光点，scale 1→1.15→1，周期 3s。 */
export function AiPulse({ label = 'AI 正在分析…' }: { label?: string }) {
  return (
    <span className="bos-ai-status">
      <span className="bos-ai-orb" aria-hidden="true" />
      {label}
    </span>
  );
}

/** 页面载入：LVANJU Logo 透明度 0.3→1 循环，不用转圈。 */
export function LogoLoading({ label = '正在载入' }: { label?: string }) {
  return (
    <div className="bos-loading" role="status" aria-live="polite">
      <span className="bos-loading-mark" aria-hidden="true">L</span>
      <p>{label}</p>
    </div>
  );
}
