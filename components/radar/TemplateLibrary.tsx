'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Lock, PencilLine, Plus } from 'lucide-react';
import { Button, Card, EmptyState, Header, Table } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { LANGUAGE_LABELS, TEMPLATE_STATUSES, TEMPLATE_VARIABLES, TEMPLATE_VARIANTS, checkTemplate, greetingFor, mailBody, nextTemplateCode, renderTemplate, type MailLanguage } from '@/lib/radar-mail';
import type { listTemplates } from '@/services/radar-template-service';

type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
type Template = Jsonify<Awaited<ReturnType<typeof listTemplates>>>[number];
type Form = { id: string | null; code: string; variant: string; subject: string; body: string; status: string; versionNote: string; locked: boolean };
const STEP_LABELS = ['第 1 封 · 入队列后按计划时间', '第 2 封 · 第 1 封后 3 个工作日未回复', '第 3 封 · 第 2 封后 4 个工作日未回复'];
// Preview only: a made-up company, so the wording can be read with the variables filled in.
const SAMPLE: Record<MailLanguage, { company: string; city: string; opening: string }> = {
  fr: { company: 'Meubles Dupont', city: 'Lyon', opening: 'Vos trois magasins à Lyon mettent en avant les canapés en tissu.' },
  en: { company: 'Gulf Home Furniture', city: 'Dubai', opening: 'Your showroom in Dubai focuses on modular sofas for families.' },
};

/** 开发信模板: language-step-version codes, locked once sent, with a live check and a preview of the mail as sent. */
export function TemplateLibrary({ templates, catalogUrls }: { templates: Template[]; catalogUrls: Record<MailLanguage, string> }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const codes = templates.map(t => t.code);
  const blank = (code = 'FR-1-A'): Form => ({ id: null, code: nextTemplateCode(code, codes), variant: 'STANDARD', subject: '', body: '{称呼}\n\n{个性化开头}\n\n', status: 'TESTING', versionNote: '', locked: false });
  const fromTemplate = (t: Template, version: boolean): Form => ({ id: version ? null : t.id, code: version ? nextTemplateCode(t.code, codes) : t.code, variant: t.variant,
    subject: t.subject, body: t.body, status: version ? 'TESTING' : t.status, versionNote: version ? '' : t.versionNote, locked: !version && t.locked });
  const step = Number(form?.code.split('-')[1]) || 1;
  const language = (form?.code.startsWith('EN') ? 'en' : 'fr') as MailLanguage;
  const check = useMemo(() => form ? checkTemplate({ step, subject: form.subject, body: form.body }) : null, [form, step]);
  const preview = form ? (() => {
    const values = { greeting: greetingFor(language), ...SAMPLE[language], catalogUrl: catalogUrls[language] || '（设置里还没填目录链接）' };
    return { subject: renderTemplate(form.subject, values), body: mailBody(renderTemplate(form.body, values), 'Jason · LVANJU\n（发信邮箱的签名）', language) };
  })() : null;

  async function save() {
    if (!form) return;
    setBusy(true); setError(''); setMessage('');
    const body = { variant: form.variant, status: form.status, versionNote: form.versionNote, ...(form.locked ? {} : { subject: form.subject, body: form.body }) };
    try {
      if (form.id) await api(`radar/templates/${form.id}`, 'PATCH', body); else await api('radar/templates', 'POST', { ...body, code: form.code, subject: form.subject, body: form.body });
      setMessage(form.id ? `${form.code} 已保存` : `${form.code} 已加入模板库，会和同封次的其他测试中版本轮流使用`);
      setForm(null); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function setStatus(t: Template, status: string) {
    setBusy(true); setError(''); setMessage('');
    try { await api(`radar/templates/${t.id}`, 'PATCH', { status }); setMessage(`${t.code} 已改为「${TEMPLATE_STATUSES[status as keyof typeof TEMPLATE_STATUSES]}」`); router.refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const groups = (['fr', 'en'] as const).flatMap(lang => [1, 2, 3].map(s => ({ lang, step: s, rows: templates.filter(t => t.language === lang && t.step === s) })));
  return <div className="bos-radar">
    <Header title="模板" description="编号为 语言-封次-版本（FR-1-A）。同一封次有两个测试中的版本时轮流使用，各满 100 封后比较回复率。发出过的模板内容锁定，要改请新建版本。"
      actions={<Button variant="primary" onClick={() => { setForm(blank()); setMessage(''); }}><Plus size={15} />新建模板</Button>} />
    {message && <p className="bos-radar-message" role="status">{message}</p>}
    {error && <p className="bos-sales-error" role="alert">{error}</p>}

    {form && <Card className="bos-radar-form">
      <h2>{form.id ? `编辑 ${form.code}` : '新建模板'}</h2>
      <div className="bos-radar-form-grid">
        <label><span>编号（语言-封次-版本）</span><input className="bos-input" value={form.code} disabled={!!form.id} maxLength={16} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} /></label>
        <label><span>版本类型</span><select className="bos-input" value={form.variant} onChange={e => setForm({ ...form, variant: e.target.value })}>
          {Object.entries(TEMPLATE_VARIANTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>状态</span><select className="bos-input" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
          {Object.entries(TEMPLATE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span>版本说明（和上一版相比改了什么）</span><input className="bos-input" value={form.versionNote} maxLength={300} onChange={e => setForm({ ...form, versionNote: e.target.value })} /></label>
      </div>
      <div className="bos-radar-template-edit">
        <div className="bos-radar-form">
          {step === 1 && <label><span>主题{form.locked && <> <Lock size={12} aria-hidden="true" /> 已发出过，已锁定</>}</span><input className="bos-input" value={form.subject} readOnly={form.locked} maxLength={200} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>}
          <label><span>正文{form.locked && <> <Lock size={12} aria-hidden="true" /> 已发出过，已锁定</>}</span>
            <textarea className="bos-input" rows={12} value={form.body} readOnly={form.locked} maxLength={5000} onChange={e => setForm({ ...form, body: e.target.value })} /></label>
          <p className="bos-radar-hint">变量：{TEMPLATE_VARIABLES.map(v => `{${v}}`).join(' ')}。签名和退订句发送时自动附上，不用写。{step === 1 ? '单独一行的 {个性化开头} 在没有开头时整行去掉。' : '第 2、3 封在同一线程里回复，主题自动用「Re: 第 1 封主题」。'}</p>
          {check && (check.errors.length > 0 || check.warnings.length > 0) && <ul className="bos-radar-checks">
            {check.errors.map(e => <li key={e} className="is-error">{e}</li>)}{check.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          <p className="bos-radar-hint">约 {check?.words ?? 0} 词 · {check?.links ?? 0} 个链接</p>
        </div>
        {preview && <div className="bos-radar-form"><span className="bos-radar-hint">预览（示例公司）</span>
          {step === 1 && <p><strong>{preview.subject || '（还没写主题）'}</strong></p>}<pre className="bos-radar-mail">{preview.body}</pre></div>}
      </div>
      <div className="bos-radar-actions"><Button variant="primary" disabled={busy || !!check?.errors.length} onClick={save}>保存</Button><Button onClick={() => setForm(null)}>取消</Button></div>
    </Card>}

    {!templates.length ? <Card><EmptyState title="还没有模板" description="先写第一批：法语和英语各 3 封，第 1 封各写 A、B 两个版本。每封只问一个问题，第 1 封 120 词以内。" /></Card>
      : groups.filter(g => g.rows.length).map(g => <Card key={`${g.lang}-${g.step}`}>
        <h2>{LANGUAGE_LABELS[g.lang]} · {STEP_LABELS[g.step - 1]}</h2>
        <Table caption={`${LANGUAGE_LABELS[g.lang]}第 ${g.step} 封模板`} headings={['编号', '内容', '版本说明', '已发', '状态', '操作']}>
          {g.rows.map(t => <tr key={t.id}>
            <td><strong>{t.code}</strong>{t.locked && <small><Lock size={11} aria-hidden="true" /> 已锁定</small>}{t.variant === 'FAIR' && <small>广交会邀请版</small>}</td>
            <td className="bos-radar-template-text">{t.subject && <strong>{t.subject}</strong>}<span>{t.body}</span>
              {t.check.errors.length > 0 && <small className="bos-radar-error">{t.check.errors[0]}</small>}</td>
            <td>{t.versionNote || '—'}</td>
            <td>{t.sent}</td>
            <td><select className="bos-input bos-radar-status" aria-label={`${t.code} 状态`} value={t.status} disabled={busy} onChange={e => setStatus(t, e.target.value)}>
              {Object.entries(TEMPLATE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
            <td><div className="bos-radar-actions">
              <Button variant="ghost" onClick={() => { setForm(fromTemplate(t, false)); setMessage(''); }}><PencilLine size={14} />编辑</Button>
              <Button variant="ghost" onClick={() => { setForm(fromTemplate(t, true)); setMessage(''); }}><Copy size={14} />新建版本</Button>
            </div></td>
          </tr>)}
        </Table>
      </Card>)}
  </div>;
}
