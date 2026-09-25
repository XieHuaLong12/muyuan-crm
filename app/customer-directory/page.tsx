import { redirect } from 'next/navigation';
// 表格与批量管理已经是客户管理页本身，不再需要单独入口
export default function Page(){redirect('/customers');}
