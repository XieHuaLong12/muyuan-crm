/** 资料库 labels and ordering, shared by the chat's 产品资料 panel and the library page. */
export const MATERIAL_CATEGORIES = { CATALOG: '产品目录', SPEC: '规格表', FACTORY: '工厂介绍', OTHER: '其他' } as const;
export const MATERIAL_LANGUAGES = { en: '英语', fr: '法语', ar: '阿拉伯语' } as const;
/** Language badges on files: EN / FR / AR, or 通用 for files in every language. */
export const languageBadge = (language: string) => language ? language.toUpperCase() : '通用';
/** Files in the customer's language first, then files for every language, then English, then the rest. */
export const languageRank = (fileLanguage: string, customer: string) => fileLanguage === customer ? 0 : fileLanguage === '' ? 1 : fileLanguage === 'en' ? 2 : 3;
export function fileSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
