import { redirect } from 'next/navigation';
// 已并入老板驾驶舱：销售趋势、来源表现、国家分布现在都在驾驶舱的「销售分析」里
export default function Page(){redirect('/command-center#analytics');}
