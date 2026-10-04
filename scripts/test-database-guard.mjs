const url=new URL(process.env.DATABASE_URL||'mysql://invalid/invalid');
if(url.protocol!=='mysql:'||!['127.0.0.1','localhost','mysql'].includes(url.hostname)||!url.pathname.endsWith('_test')){
  throw new Error('测试会写入验收数据，只允许本机/CI 的 MySQL *_test 数据库；禁止使用生产 DATABASE_URL。');
}
