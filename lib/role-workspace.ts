export const workspaceHome = (role: string) => role === 'ADMIN' ? '/command-center' : '/sales';

export const adminNavigation = [
  { href: '/command-center', label: '经营驾驶舱', icon: 'dashboard' },
  { href: '/team', label: '销售团队', icon: 'team' },
  { href: '/growth', label: '增长中心', icon: 'growth' },
  { href: '/analytics/ads', label: '广告分析', icon: 'growth' },
  { href: '/customers', label: '客户管理', icon: 'customers' },
  { href: '/crm', label: '销售看板', icon: 'board' },
  { href: '/communication', label: '销售沟通监督', icon: 'communication' },
  { href: '/orders', label: '订单中心', icon: 'orders' },
  { href: '/finance', label: '财务中心', icon: 'finance' },
  { href: '/tasks', label: '团队任务', icon: 'tasks' },
  { href: '/settings', label: '系统设置', icon: 'settings' },
] as const;

export const salesNavigation = [
  { href: '/sales', label: '待跟进客户', icon: 'dashboard' },
  { href: '/customers', label: '我的客户', icon: 'customers' },
  { href: '/crm', label: '我的销售看板', icon: 'board' },
  { href: '/products', label: '产品与报价', icon: 'orders' },
  { href: '/orders', label: '我的订单', icon: 'orders' },
  { href: '/tasks', label: '我的任务', icon: 'tasks' },
  { href: '/sales/performance', label: '我的业绩', icon: 'growth' },
] as const;

export function workspaceNavigation(role: string) {
  return role === 'ADMIN' ? adminNavigation : salesNavigation;
}

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
export function activeWorkspaceLink(path: string, role: string) {
  const normalized = matches(path, '/whatsapp') ? '/communication' : path;
  return [...workspaceNavigation(role)]
    .sort((a, b) => b.href.length - a.href.length)
    .find(item => matches(normalized, item.href))?.href;
}
