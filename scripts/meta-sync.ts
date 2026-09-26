/**
 * 本地一次性同步 Meta 广告数据与表单目录（等价于 cron 入口）。
 *
 * 用法：
 *   pnpm meta:sync            # 广告 + 表单
 *   pnpm meta:sync ads        # 只同步广告
 *   pnpm meta:sync forms      # 只同步表单目录
 */
import { syncAds } from '../services/meta-ads-service';
import { syncLeadForms } from '../services/meta-form-service';

async function main() {
  const kind = process.argv[2] ?? 'all';
  if (!['all', 'ads', 'forms'].includes(kind)) {
    console.error('用法：pnpm meta:sync [all|ads|forms]');
    process.exit(1);
  }
  if (kind === 'ads' || kind === 'all') {
    console.log('→ 同步 Meta 广告数据…');
    console.log(JSON.stringify(await syncAds(), null, 2));
  }
  if (kind === 'forms' || kind === 'all') {
    console.log('→ 同步 Meta 表单目录…');
    console.log(JSON.stringify(await syncLeadForms(), null, 2));
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
