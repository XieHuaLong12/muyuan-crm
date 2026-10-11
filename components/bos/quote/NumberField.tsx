'use client';
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/**
 * 数字输入：编辑时保留原始文字（可以输入「12.」「0.0」或先清空再输入），
 * 每次能解析成数字就回传；失焦后按当前数值重新显示。逗号小数点按点处理。
 */
export function NumberField({ value, onValue, className = '', ...props }: {
  value: number | null;
  onValue: (value: number | null) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const show = (v: number | null) => (v === null || Number.isNaN(v) ? '' : String(v));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);

  return (
    <input
      {...props}
      className={`bos-input ${className}`}
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={e => { focused.current = true; props.onFocus?.(e); }}
      onBlur={e => { focused.current = false; setText(show(value)); props.onBlur?.(e); }}
      onChange={e => {
        setText(e.target.value);
        const raw = e.target.value.replace(',', '.').trim();
        if (!raw) onValue(null);
        else if (/^-?\d*\.?\d*$/.test(raw) && Number.isFinite(Number(raw))) onValue(Number(raw));
      }}
    />
  );
}
