export const workspaceHome = (role: string) => role === 'ADMIN' ? '/command-center' : '/sales';

export type NavIcon = 'dashboard' | 'customers' | 'messages' | 'tasks' | 'orders' | 'growth' | 'team' | 'settings' | 'today' | 'products' | 'performance';
/** A page inside a section. `match` lists the path prefixes that belong to it (defaults to `href`). */
export type NavTab = { href: string; label: string; match?: readonly string[] };
/**
 * One sidebar entry. Related pages are tabs of the same section, so the sidebar stays short. With `keepPeriod`, the
 * section's pages share the analysis period (range / startDate / endDate), which is kept when switching tabs.
 */
export type NavSection = { href: string; label: string; icon: NavIcon; tabs?: readonly NavTab[]; badge?: 'today' | 'pool' | 'messages'; keepPeriod?: boolean };

const adminSections: readonly NavSection[] = [
  { href: '/command-center', label: '经营总览', icon: 'dashboard', keepPeriod: true, tabs: [
    { href: '/command-center', label: '经营驾驶舱' },
    { href: '/command-center/analysis', label: '来源与国家' },
    { href: '/finance', label: '财务' },
  ] },
  { href: '/customers', label: '客户', icon: 'customers', badge: 'pool', tabs: [
    { href: '/customers', label: '客户列表' },
    { href: '/sales', label: '跟进队列' },
    { href: '/crm', label: '销售看板' },
  ] },
  { href: '/messages', label: '消息', icon: 'messages', badge: 'messages' },
  { href: '/tasks', label: '任务', icon: 'tasks' },
  { href: '/orders', label: '订单', icon: 'orders', tabs: [
    { href: '/orders', label: '订单' },
    { href: '/products', label: '产品库' },
    { href: '/products/quotes', label: '报价单' },
    { href: '/products/freight', label: '运费库' },
    { href: '/products/margin', label: '利润' },
  ] },
  { href: '/analytics/ads', label: '广告与线索', icon: 'growth', keepPeriod: true, tabs: [
    { href: '/analytics/ads', label: '广告效果' },
    { href: '/analytics/conversations', label: '会话质量' },
    { href: '/analytics/loss-reasons', label: '丢单原因' },
    { href: '/analytics/data-quality', label: '数据质量' },
    { href: '/growth/intake', label: '线索接入' },
  ] },
  { href: '/team', label: '团队', icon: 'team', tabs: [
    { href: '/team', label: '销售业绩' },
    { href: '/targets', label: '目标' },
    { href: '/communication', label: '沟通监督' },
  ] },
  { href: '/settings', label: '设置', icon: 'settings', tabs: [
    { href: '/settings', label: '公司设置' },
    { href: '/settings/integrations', label: '集成与接入', match: ['/settings/integrations', '/admin'] },
  ] },
];

const salesSections: readonly NavSection[] = [
  { href: '/sales', label: '今日工作', icon: 'today', badge: 'today', tabs: [
    { href: '/sales', label: '今日跟进' },
    { href: '/tasks', label: '全部待办' },
  ] },
  { href: '/messages', label: '消息', icon: 'messages', badge: 'messages' },
  { href: '/customers', label: '我的客户', icon: 'customers', tabs: [
    { href: '/customers', label: '客户列表' },
    { href: '/crm', label: '销售看板' },
  ] },
  { href: '/products', label: '产品与报价', icon: 'products', tabs: [
    { href: '/products', label: '产品库' },
    { href: '/products/quotes', label: '报价单' },
    { href: '/products/freight', label: '运费库' },
  ] },
  { href: '/orders', label: '我的订单', icon: 'orders' },
  { href: '/sales/performance', label: '我的业绩', icon: 'performance' },
];

export function workspaceNavigation(role: string) {
  return role === 'ADMIN' ? adminSections : salesSections;
}

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** The section and tab a path belongs to: the longest matching prefix wins, so /products/margin beats /products. */
export function activeWorkspace(path: string, role: string) {
  let best: { section: NavSection; tab: NavTab | null; length: number } | null = null;
  for (const section of workspaceNavigation(role)) {
    const tabs = section.tabs ?? [{ href: section.href, label: section.label }];
    for (const tab of tabs) {
      for (const prefix of tab.match ?? [tab.href]) {
        if (matches(path, prefix) && prefix.length > (best?.length ?? -1)) best = { section, tab: section.tabs ? tab : null, length: prefix.length };
      }
    }
  }
  return best ? { section: best.section, tab: best.tab } : null;
}

export function activeWorkspaceLink(path: string, role: string) {
  return activeWorkspace(path, role)?.section.href;
}
