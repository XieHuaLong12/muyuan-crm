'use client';

import { useState } from 'react';

export function WhatsappChatPanel({ customerName = 'Customer' }: { customerName?: string }) {
  const [draft, setDraft] = useState('Hi, thanks for your interest in our compressed sofas. I will send you the latest catalog and quotation shortly.');

  return (
    <aside className="whatsapp-chat-panel">
      <header className="whatsapp-chat-header">
        <div>
          <strong>{customerName}</strong>
          <span> 🟢 WhatsApp</span>
          <p>客户详情 · 跟进记录 · 报价</p>
        </div>
        <button>已确认需求</button>
      </header>

      <section className="whatsapp-messages">
        <div className="message customer">Hello, I need compressed sofa price and shipping cost.</div>
        <div className="message seller">Thanks for your inquiry. I will send catalog and quotation.</div>
        <div className="message customer">Looking for 50-100 sets first.</div>
      </section>

      <section className="ai-draft">
        <h4>✨ AI 自动回复草稿</h4>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="chat-actions">
          <button>复制草稿</button>
          <button>重新生成</button>
          <button>更新阶段</button>
          <button className="primary">一键发送 WhatsApp</button>
        </div>
      </section>

      <footer className="whatsapp-input">
        <input placeholder="输入 WhatsApp 消息..." />
        <button className="primary">发送 WhatsApp</button>
      </footer>
    </aside>
  );
}
