/** Shared by server-rendered order details and the interactive order list. */
export function rmb(value: string | number) {
  return `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}
