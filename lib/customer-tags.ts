// Plain values, safe to import from client components.
/**
 * Customer tags (消息页): one shared library for the whole company. Colours come only from this list, each a light
 * background with a dark text colour that reads at 4.5:1 or better, and a stronger dot for the colour picker.
 */
export const TAG_COLORS = {
  green: { label: '绿', bg: '#e3f1e8', ink: '#1d5c3f', dot: '#2f8a5b' },
  blue: { label: '蓝', bg: '#e1ecfb', ink: '#1c4f99', dot: '#3a78d6' },
  purple: { label: '紫', bg: '#ece6f8', ink: '#553a9a', dot: '#7b5cc7' },
  orange: { label: '橙', bg: '#fbeadb', ink: '#8a4510', dot: '#d9772b' },
  red: { label: '红', bg: '#fbe4e2', ink: '#9b2c25', dot: '#d64c42' },
  yellow: { label: '黄', bg: '#f8f0cf', ink: '#6b5300', dot: '#c9a227' },
  teal: { label: '青', bg: '#dcf1f0', ink: '#14625e', dot: '#2a9d97' },
  gray: { label: '灰', bg: '#ececec', ink: '#4a4a4a', dot: '#8e8d86' },
} as const;
export type TagColor = keyof typeof TAG_COLORS;
export const TAG_COLOR_KEYS = Object.keys(TAG_COLORS) as [TagColor, ...TagColor[]];
export const TAG_NAME_MAX = 32;
/** Tags shown on a conversation in the list; the rest count as 「+n」. */
export const LIST_TAG_LIMIT = 2;

export type CustomerTagView = { id: string; name: string; color: string };
/** Inline colours of a tag; an unknown stored colour shows as gray rather than failing. */
export const tagStyle = (color: string) => {
  const c = TAG_COLORS[color as TagColor] ?? TAG_COLORS.gray;
  return { background: c.bg, color: c.ink };
};
