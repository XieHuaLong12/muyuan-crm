'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as Sheet from '@radix-ui/react-dialog';
import { Ellipsis, KeyRound, LogOut, X } from 'lucide-react';
import { PasswordDialog } from '@/components/password-dialog';
import { InstallAppBanner } from '@/components/pwa';
import { activeWorkspaceLink, phoneNavigation } from '@/lib/role-workspace';
import { navIcons, signOut, type NavBadges } from './Sidebar';

/**
 * The phone's navigation (shown up to 760px, where the sidebar is hidden): a bar fixed to the bottom of the screen
 * with four sections under the thumb, and 更多 for the remaining sections, the account and installing the app.
 * Which sections go where is decided in lib/role-workspace.ts (`phoneNavigation`).
 */
export function MobileNav({ name, role, badges = {} }: { name: string; role: string; badges?: NavBadges }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [error, setError] = useState('');
  const { bar, more } = phoneNavigation(role);
  const active = activeWorkspaceLink(path, role);
  const inMore = more.some(section => section.href === active);
  // Following a link in the sheet closes it.
  useEffect(() => { setOpen(false); }, [path]);
  async function logout() {
    try { await signOut(); router.push('/login'); } catch (e) { setError((e as Error).message); }
  }
  return (
    <>
      <nav className="bos-mobile-nav" aria-label="主导航">
        {bar.map(({ label, section }) => {
          const Icon = navIcons[section.icon];
          const live = section.badge ? badges[section.badge] : undefined;
          return (
            <Link key={section.href} href={section.href} aria-current={active === section.href ? 'page' : undefined}>
              <span className="bos-mobile-nav-icon">
                <Icon size={22} strokeWidth={1.7} aria-hidden />
                {!!live?.count && <b className={live.urgent ? 'is-urgent' : undefined} aria-label={`${live.count} 项`}>{live.count > 99 ? '99+' : live.count}</b>}
              </span>
              {label}
            </Link>
          );
        })}
        <button type="button" aria-haspopup="dialog" aria-expanded={open} className={inMore ? 'is-current' : undefined} onClick={() => setOpen(true)}>
          <span className="bos-mobile-nav-icon"><Ellipsis size={22} strokeWidth={1.7} aria-hidden /></span>
          更多
        </button>
      </nav>
      <Sheet.Root open={open} onOpenChange={setOpen}>
        <Sheet.Portal>
          <Sheet.Overlay className="bos-more-overlay" />
          <Sheet.Content className="bos-more-sheet" aria-describedby={undefined}>
            <div className="bos-more-head">
              <Sheet.Title>更多</Sheet.Title>
              <Sheet.Close className="bos-more-close" aria-label="关闭"><X size={20} aria-hidden /></Sheet.Close>
            </div>
            <nav className="bos-more-grid" aria-label="更多页面">
              {more.map(section => {
                const Icon = navIcons[section.icon];
                return (
                  <Link key={section.href} href={section.href} aria-current={active === section.href ? 'page' : undefined} onClick={() => setOpen(false)}>
                    <Icon size={22} strokeWidth={1.7} aria-hidden />
                    {section.label}
                  </Link>
                );
              })}
            </nav>
            <InstallAppBanner inMenu />
            <div className="bos-more-account">
              <span className="bos-more-avatar" aria-hidden>{name.slice(0, 1)}</span>
              <div><strong>{name}</strong><small>{role === 'ADMIN' ? '管理员' : '销售顾问'}</small></div>
              <button type="button" onClick={() => { setOpen(false); setPasswordOpen(true); }}><KeyRound size={16} aria-hidden />修改密码</button>
              <button type="button" onClick={() => void logout()}><LogOut size={16} aria-hidden />退出登录</button>
            </div>
            {error && <p className="bos-more-error" role="alert">{error}</p>}
          </Sheet.Content>
        </Sheet.Portal>
      </Sheet.Root>
      {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} />}
    </>
  );
}
