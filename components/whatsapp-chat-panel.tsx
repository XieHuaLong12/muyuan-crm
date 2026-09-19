'use client';

import { useState } from 'react';

type Message = {
  id: number;
  role: 'customer' | 'seller';
  text: string;
};

export function WhatsappChatPanel({ customerName = 'Customer' }: { customerName?: string }) {
  const [stage, setStage] = useState('已联系');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState(
    'Hi, thanks for your interest in our compressed sofas. Could you please share your required quantity, target market and preferred models?'
  );

  const [messages, setMessages] = useState<Message[]>([
    { id: 1, role: 'customer', text: 'Hello, I need compressed sofa price and shipping cost.' },
    { id: 2, role: 'seller', text: 'Thanks for your inquiry. I will send catalog and quotation.' },
    { id: 3, role: 'customer', text: 'Looking for 50-100 sets first.' },
  ]);

  function sendMessage() {
    if (!message.trim()) return;
    setMessages((items) => [
      ...items,
      { id: Date.now(), role: 'seller', text: message },
    ]);
    setMessage('');
  }

  return (
    <aside className="whatsapp-chat-panel">
      <header className="whatsapp-chat-header">
        <div>
          <strong>{customerName}</strong>
          <span> 🟢 WhatsApp CRM</span>
          <p>实时聊天 · AI助手 · 客户阶段</p>
        </div>
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          <option>新客户</option>
          <option>已联系</option>
          <option>已报价</option>
          <option>跟进中</option>
          <option>已成交</option>
        </select>
      </header>

      <section className="whatsapp-messages">
        {messages.map((item) => (
          <div key={item.id} className={`message ${item.role}`}>
            {item.text}
          </div>
        ))}
      </section>

      <section className="ai-draft">
        <h4>✨ DeepSeek AI 回复草稿</h4>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="chat-actions">
          <button onClick={() => navigator.clipboard.writeText(draft)}>复制草稿</button>
          <button onClick={() => setDraft('Thanks for your message. Could you please confirm your quantity and delivery country?')}>AI重新生成</button>
          <button onClick={() => setStage('已报价')}>更新阶段</button>
          <button className="primary">一键发送 WhatsApp</button>
        </div>
      </section>

      <footer className="whatsapp-input">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="输入 WhatsApp 消息..."
        />
        <button className="primary" onClick={sendMessage}>发送</button>
      </footer>
    </aside>
  );
}
