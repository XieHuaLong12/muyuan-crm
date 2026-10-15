-- 已回复到确认采购的客户自动算有效（lib/constants.ts QUALIFYING_STAGES）。已经在这些阶段的客户补标为有效。
-- 只改有效性：不改「最近更新时间」，也不向 Meta 补发历史的 LeadQualified 事件。
UPDATE `Customer` SET `isQualified` = true
WHERE `stage` IN ('REPLIED', 'CATALOG_SENT', 'NEEDS_CONFIRMED', 'PRODUCT_CONFIRMED', 'QUOTED', 'FOLLOW_UP', 'ORDER')
  AND (`isQualified` IS NULL OR `isQualified` = false);
