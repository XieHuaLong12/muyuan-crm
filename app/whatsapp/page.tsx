import { redirect } from 'next/navigation';
// WhatsApp 收件箱就是销售工作台的「等待回复」队列：客户发过消息但我们还没回。
// 不再单独做一个几乎一模一样的页面。
export default function Page(){redirect('/sales?queue=waiting');}
