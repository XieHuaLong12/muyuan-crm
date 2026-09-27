import { redirect } from 'next/navigation';
// 已并入老板驾驶舱：那里同时有「当前阶段存量」和「历史阶段流转」两个漏斗
export default function Page(){redirect('/command-center/legacy');}
