import { redirect } from 'next/navigation';
// 已改为客户页的「表格视图」，不再单独占一个页面
export default function Page(){redirect('/customers?view=table');}
