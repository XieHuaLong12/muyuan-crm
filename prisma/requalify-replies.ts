import { existsSync } from 'node:fs';
import { db } from '../lib/db';
import { requalifyEarlyMessages } from '../services/conversation-identity-service';

// 本机开发时读 .env；生产环境没有 .env，环境变量由平台注入。
if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) {
  console.error('缺少 DATABASE_URL：无法连接数据库。请在环境中配置后重试。');
  process.exit(1);
}

/**
 * 有效口径调整（docs/METRICS.md）：客户在我们发出第一条消息之后回复，才算已回复、有效。
 * 此前系统把广告自动消息这类「我们还没开口就收到的消息」也算成了回复，这里把这些客户改回已联系 / 新线索、待判断。
 * 只改系统自己设的「已回复」，人工改过的阶段与后续阶段都不动；每一条都写阶段历史。可重复运行。
 */
async function main() {
  const result = await requalifyEarlyMessages();
  console.log(`有效口径：检查系统标记的已回复客户 ${result.checked} 位，改回 ${result.moved} 位`
    + `（未发出的 Meta LeadQualified 取消 ${result.cancelled} 条，已发出的 ${result.alreadySent} 条无法撤回）。`);
}

main()
  .catch(error => { console.error('有效口径调整失败：', error); process.exitCode = 1; })
  .finally(() => db.$disconnect());
