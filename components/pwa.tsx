'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/bos';

/** Chrome / Edge / Samsung Internet hand this over instead of showing their own install bar. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISS_KEY = 'crm:install-banner-dismissed';

// The prompt can arrive before the shell renders, so it is kept here for the banner.
let installPrompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const setInstallPrompt = (value: InstallPrompt | null) => { installPrompt = value; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Touch devices that are not yet running the installed app. */
const installable = () => !standalone() && window.matchMedia('(pointer: coarse)').matches;
/** The banner at the top of a page (tablets) also goes away for good once closed; the entry under 更多 on phones stays. */
function bannerWanted() {
  try { if (window.localStorage.getItem(DISMISS_KEY)) return false; } catch { /* storage can be unavailable */ }
  return installable();
}

/** Registers the service worker and keeps the install prompt. Mounted once in the root layout. */
export function PwaSetup() {
  useEffect(() => {
    const keep = (event: Event) => {
      // Elsewhere the browser keeps its own install bar.
      if (!installable()) return;
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', keep);
    window.addEventListener('appinstalled', installed);
    // Production only: a worker registered by the dev server would stay on localhost for other projects.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* the CRM works without it, only offline page and phone notifications need it */ });
    }
    return () => { window.removeEventListener('beforeinstallprompt', keep); window.removeEventListener('appinstalled', installed); };
  }, []);
  return null;
}

/**
 * Suggests installing the CRM on a phone. Android browsers install with one tap; iPhone and WeChat have no install
 * API, so the banner explains the steps instead. On phones it sits under 更多 in the bottom bar (`inMenu`), where it
 * takes no room on the pages and cannot be closed; wider touch screens show it once at the top of the page.
 */
export function InstallAppBanner({ inMenu = false }: { inMenu?: boolean }) {
  const prompt = useSyncExternalStore(subscribe, () => installPrompt, () => null);
  const [hint, setHint] = useState<'ios' | 'wechat' | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!(inMenu ? installable() : bannerWanted())) return;
    setVisible(true);
    const ua = navigator.userAgent;
    if (/MicroMessenger/i.test(ua)) setHint('wechat');
    else if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) setHint('ios');
  }, [inMenu]);

  function close() {
    setVisible(false);
    try { window.localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage can be unavailable */ }
  }

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    // A prompt can only be shown once; after a refusal the browser menu still offers to install.
    await prompt.userChoice.catch(() => null);
    setInstallPrompt(null);
  }

  if (!visible || (!prompt && !hint)) return null;
  return (
    <aside className={`bos-install-banner${inMenu ? ' is-in-menu' : ''}`} aria-label="安装手机 App">
      <Smartphone size={20} strokeWidth={1.6} aria-hidden />
      <p>
        <strong>把 CRM 装到手机桌面</strong>
        <small>
          {hint === 'wechat' ? '微信里无法安装：点右上角「···」选「在浏览器打开」，再从浏览器安装。'
            : hint === 'ios' ? '点 Safari 的「分享」按钮（新版 iOS 在「···」菜单里），选「添加到主屏幕」。'
            : '以后从桌面图标一键打开，全屏使用，像 App 一样。'}
        </small>
      </p>
      {prompt && <Button variant="primary" onClick={() => void install()}>安装</Button>}
      {!inMenu && <Button variant="ghost" className="bos-install-close" onClick={close} aria-label="不再提示安装"><X size={16} aria-hidden /></Button>}
    </aside>
  );
}
