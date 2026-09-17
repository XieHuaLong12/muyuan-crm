'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/client';

type ConnectionStatus = {
  configured: boolean;
  missing: string[];
  appId: string;
  configurationId: string;
  graphVersion: string;
  webhookUrl: string;
  connection: null | {
    status: string;
    connectionMode: string;
    businessId: string;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string;
    tokenExpiresAt: string | null;
    subscribedAt: string | null;
    connectedAt: string | null;
    lastVerifiedAt: string | null;
    lastError: string;
  };
};

type EmbeddedSession = {
  wabaId: string;
  phoneNumberId?: string;
  businessId?: string;
};

type FacebookSdk = {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

function parseMetaMessage(data: unknown) {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return data && typeof data === 'object' ? data as Record<string, unknown> : null;
}

export function WhatsAppConnect() {
  const [status, setStatus] = useState<ConnectionStatus>();
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const sessionRef = useRef<EmbeddedSession | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<ConnectionStatus>('whatsapp/connect'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!status?.configured || !status.appId) return;
    const init = () => {
      if (!window.FB) return;
      window.FB.init({ appId: status.appId, cookie: true, xfbml: false, version: status.graphVersion });
      setSdkReady(true);
    };
    if (window.FB) {
      init();
      return;
    }
    window.fbAsyncInit = init;
    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = 'https://connect.facebook.net/en_US/sdk.js';
      document.body.appendChild(script);
    }
  }, [status]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (!['https://www.facebook.com', 'https://web.facebook.com', 'https://business.facebook.com'].includes(event.origin)) return;
      const data = parseMetaMessage(event.data);
      if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
      const eventName = typeof data.event === 'string' ? data.event : '';
      const payload = data.data && typeof data.data === 'object' ? data.data as Record<string, unknown> : {};
      if (eventName === 'FINISH' || eventName === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        const wabaId = String(payload.waba_id ?? '');
        const phoneNumberId = String(payload.phone_number_id ?? '');
        const businessId = String(payload.business_id ?? '');
        if (wabaId) {
          sessionRef.current = { wabaId, phoneNumberId: phoneNumberId || undefined, businessId: businessId || undefined };
          setInfo('Meta 已确认 WhatsApp Business 账号，正在完成 CRM 连接…');
        }
      } else if (eventName === 'CANCEL' || eventName === 'CANCEL_WHATSAPP_BUSINESS_APP_ONBOARDING') {
        setInfo('你取消了 WhatsApp 连接，没有修改现有号码。');
      } else if (eventName === 'ERROR') {
        setError(typeof payload.error_message === 'string' ? payload.error_message : 'Meta Embedded Signup 返回错误');
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  const waitForSession = async () => {
    for (let i = 0; i < 24; i++) {
      if (sessionRef.current) return sessionRef.current;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  };

  const connect = () => {
    if (!status?.configured || !window.FB || !sdkReady) return;
    sessionRef.current = null;
    setBusy(true);
    setError('');
    setInfo('正在打开 Meta 官方 WhatsApp 共存授权…');
    window.FB.login(async (response) => {
      try {
        const code = response.authResponse?.code;
        if (!code) {
          setInfo('授权未完成，没有修改现有 WhatsApp。');
          return;
        }
        const session = await waitForSession();
        if (!session) throw new Error('Meta 已返回授权码，但没有返回 WABA ID。请确认使用的是 WhatsApp Business App Coexistence 配置。');
        const next = await api<ConnectionStatus>('whatsapp/connect', 'POST', {
          code,
          wabaId: session.wabaId,
          phoneNumberId: session.phoneNumberId,
          businessId: session.businessId,
        });
        setStatus(next);
        setInfo('WhatsApp 已连接到 CRM，Webhook 已订阅。');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }, {
      config_id: status.configurationId,
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: {},
        featureType: 'whatsapp_business_app_onboarding',
        version: 'v4',
        sessionInfoVersion: '3',
      },
    });
  };

  const connection = status?.connection;
  const connected = connection?.status === 'CONNECTED';
  return <section className="card full">
    <div className="card-title">
      <div>
        <h3>WhatsApp Business 连接</h3>
        <p className="muted">使用 Meta 官方 Coexistence，让手机 WhatsApp Business 保持可用，同时把新消息同步进 CRM。</p>
      </div>
      <span className={connected ? 'green' : 'muted'}>{connected ? '● 已连接' : '○ 未连接'}</span>
    </div>

    {!status ? <div className="loading">正在检查 WhatsApp 配置…</div> : <>
      {!status.configured && <div className="notice">
        CRM 代码已就绪，但 Hostinger 还缺少：<strong>{status.missing.join('、')}</strong>
      </div>}

      <div className="target-grid">
        <div className="target-item"><div className="between"><strong>Webhook</strong><ShieldCheck size={18}/></div><small>{status.webhookUrl}</small></div>
        <div className="target-item"><div className="between"><strong>连接模式</strong><Link2 size={18}/></div><small>WhatsApp Business App + Cloud API 共存</small></div>
        {connected && <>
          <div className="target-item"><strong>{connection.displayPhoneNumber || '已连接号码'}</strong><small>{connection.verifiedName || 'WhatsApp Business'}</small></div>
          <div className="target-item"><strong>Phone Number ID</strong><small>{connection.phoneNumberId}</small></div>
          <div className="target-item"><strong>WABA ID</strong><small>{connection.wabaId}</small></div>
          <div className="target-item"><div className="between"><strong>Webhook 订阅</strong><CheckCircle2 size={18}/></div><small>{connection.subscribedAt ? '已完成' : '等待确认'}</small></div>
        </>}
      </div>

      {connection?.lastError && <p className="error">上次连接错误：{connection.lastError}</p>}
      {error && <p className="error">{error}</p>}
      {info && <p className="muted">{info}</p>}

      <div className="actions">
        <button className="primary" disabled={!status.configured || !sdkReady || busy} onClick={connect}>
          {busy ? <RefreshCw size={17}/> : <Link2 size={17}/>}{connected ? '重新连接 WhatsApp' : '连接现有 WhatsApp'}
        </button>
        <button disabled={busy} onClick={()=>void refresh()}><RefreshCw size={17}/>刷新状态</button>
      </div>
      <p className="muted">此按钮不会执行“迁移号码”或“解除 WhatsApp Business App”。只有 Meta 官方 Embedded Signup 共存流程完成后，CRM 才会保存连接。</p>
    </>}
  </section>;
}
