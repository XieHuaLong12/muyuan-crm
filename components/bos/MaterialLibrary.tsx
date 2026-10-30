'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Header, Card, Table, Badge, Button, EmptyState, Typography } from '@/components/ui/bos';
import { api } from '@/lib/client';
import { FIRST_TOUCH_PRODUCT_LINES } from '@/lib/constants';
import { MATERIAL_CATEGORIES, MATERIAL_LANGUAGES, fileSize, languageBadge } from '@/lib/sales-materials';

export type MaterialRow = { id: string; title: string; category: string; language: string; productLine: string; fileName: string; mimeType: string; size: number; sort: number; updatedAt: string };
type Fields = { title: string; category: string; language: string; productLine: string };
const EMPTY: Fields = { title: '', category: 'CATALOG', language: '', productLine: '' };
const lineLabel = (value: string) => FIRST_TOUCH_PRODUCT_LINES.find(l => l.value === value)?.label ?? '全系列';
const dateText = (iso: string) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(new Date(iso));

/** Upload or replace a file: multipart, so the browser sends it as it is. */
async function sendFile(url: string, method: 'POST' | 'PUT', file: File, fields: Partial<Fields> = {}) {
  const form = new FormData();
  form.set('file', file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await fetch(`/api/${url}`, { method, body: form });
  const body = await response.json();
  if (!body.success) throw new Error(body.error || '上传失败');
  return body.data as MaterialRow;
}

function FieldInputs({ value, onChange }: { value: Fields; onChange: (next: Fields) => void }) {
  return <>
    <label className="bos-quote-field bos-quote-grow"><span>资料名称 *</span><input className="bos-input" value={value.title} maxLength={120} placeholder="例如 LVANJU 2026 产品目录（法语版）" onChange={e => onChange({ ...value, title: e.target.value })} /></label>
    <label className="bos-quote-field"><span>分类</span>
      <select className="bos-input" value={value.category} onChange={e => onChange({ ...value, category: e.target.value })}>
        {Object.entries(MATERIAL_CATEGORIES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    <label className="bos-quote-field"><span>文件语言</span>
      <select className="bos-input" value={value.language} onChange={e => onChange({ ...value, language: e.target.value })}>
        <option value="">通用（不分语言）</option>
        {Object.entries(MATERIAL_LANGUAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    <label className="bos-quote-field"><span>适用产品线</span>
      <select className="bos-input" value={value.productLine} onChange={e => onChange({ ...value, productLine: e.target.value })}>
        <option value="">全系列</option>
        {FIRST_TOUCH_PRODUCT_LINES.map(line => <option key={line.value} value={line.value}>{line.label}</option>)}
      </select></label>
  </>;
}

/**
 * 资料文件: catalogs, spec sheets and the factory introduction, uploaded once by an administrator and sent from
 * any chat's 产品资料. The file's language decides which customers see it first.
 */
export function MaterialLibrary({ initial, isAdmin }: { initial: MaterialRow[]; isAdmin: boolean }) {
  const [rows, setRows] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [editing, setEditing] = useState<{ id: string; fields: Fields } | null>(null);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const replace = useRef<HTMLInputElement>(null), replacing = useRef('');

  async function run(key: string, work: () => Promise<string>) {
    setBusy(key); setError(''); setMessage('');
    try { setMessage(await work()); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }
  const upload = () => run('upload', async () => {
    if (!file) throw new Error('请选择文件');
    const row = await sendFile('materials', 'POST', file, fields);
    setRows(list => [row, ...list]); setAdding(false); setFields(EMPTY); setFile(null);
    return `已上传「${row.title}」，聊天里的「产品资料」马上就能选到`;
  });
  const save = () => run('save', async () => {
    if (!editing) return '';
    const row = await api<MaterialRow>(`materials/${editing.id}`, 'PATCH', editing.fields);
    setRows(list => list.map(r => r.id === row.id ? row : r)); setEditing(null);
    return '已保存';
  });
  const swap = (chosen: File | undefined) => run('replace', async () => {
    const id = replacing.current;
    if (!chosen || !id) return '';
    const row = await sendFile(`materials/${id}`, 'PUT', chosen);
    setRows(list => list.map(r => r.id === row.id ? row : r));
    if (replace.current) replace.current.value = '';
    return `「${row.title}」已换成新版，以后大家发的都是新版`;
  });
  const remove = (row: MaterialRow) => run(`delete-${row.id}`, async () => {
    if (!window.confirm(`从资料库删除「${row.title}」？已经发给客户的文件不受影响。`)) return '';
    await api(`materials/${row.id}`, 'DELETE');
    setRows(list => list.filter(r => r.id !== row.id));
    return `已删除「${row.title}」`;
  });

  return <>
    <Header title="资料文件" description="产品目录、规格表、工厂介绍上传一次，所有人在聊天的「产品资料」里直接选了发；客户是哪种语言，就先看到哪种语言的文件。"
      actions={isAdmin && !adding ? <Button variant="primary" onClick={() => { setAdding(true); setMessage(''); }}><Upload size={15} /> 上传资料</Button> : undefined} />

    {adding && isAdmin && <Card className="bos-freight-form">
      <Typography as="h2" variant="heading">上传资料</Typography>
      <div className="bos-quote-grid">
        <label className="bos-quote-field bos-quote-grow"><span>文件 *（PDF、图片、Office 文档，最大 20 MB）</span>
          <input className="bos-input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx,application/zip"
            onChange={e => { const chosen = e.target.files?.[0] ?? null; setFile(chosen); if (chosen && !fields.title) setFields({ ...fields, title: chosen.name.replace(/\.[^.]+$/, '') }); }} /></label>
        <FieldInputs value={fields} onChange={setFields} />
      </div>
      {error && <p className="bos-sales-error" role="alert">{error}</p>}
      <div className="bos-quote-action-row">
        <Button variant="primary" disabled={busy === 'upload' || !file || !fields.title.trim()} onClick={() => void upload()}>{busy === 'upload' ? '上传中…' : '上传'}</Button>
        <Button onClick={() => { setAdding(false); setError(''); }}>取消</Button>
      </div>
    </Card>}

    <Card>
      {message && <p className="bos-quote-message" role="status">{message}</p>}
      {!adding && error && <p className="bos-sales-error" role="alert">{error}</p>}
      <input ref={replace} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp,.docx,.xlsx,application/zip" onChange={e => void swap(e.target.files?.[0])} />
      {!rows.length ? <EmptyState title="资料库还是空的" description={isAdmin ? '点「上传资料」，把产品目录、规格表传上来，业务员就能在聊天里直接发。' : '管理员上传产品目录、规格表后，可以在聊天的「产品资料」里直接发给客户。'} />
        : <Table caption="资料文件" headings={['资料', '分类', '语言', '产品线', '文件', '更新', '操作']}>
          {rows.map(row => editing?.id === row.id ? <tr key={row.id}><td colSpan={7}>
            <div className="bos-quote-grid"><FieldInputs value={editing.fields} onChange={next => setEditing({ id: row.id, fields: next })} /></div>
            <div className="bos-quote-action-row"><Button variant="primary" disabled={busy === 'save' || !editing.fields.title.trim()} onClick={() => void save()}>{busy === 'save' ? '保存中…' : '保存'}</Button><Button onClick={() => setEditing(null)}>取消</Button></div>
          </td></tr> : <tr key={row.id}>
            <td><strong>{row.title}</strong></td>
            <td>{MATERIAL_CATEGORIES[row.category as keyof typeof MATERIAL_CATEGORIES] ?? row.category}</td>
            <td><Badge tone={row.language ? 'green' : 'neutral'}>{languageBadge(row.language)}</Badge></td>
            <td>{lineLabel(row.productLine)}</td>
            <td><a href={`/api/materials/${row.id}/file`} target="_blank" rel="noreferrer">{row.fileName}</a><br /><small>{fileSize(row.size)}</small></td>
            <td>{dateText(row.updatedAt)}</td>
            <td>{isAdmin ? <div className="bos-quote-action-row" style={{ flexWrap: 'nowrap' }}>
              <Button variant="ghost" onClick={() => setEditing({ id: row.id, fields: { title: row.title, category: row.category, language: row.language, productLine: row.productLine } })}>编辑</Button>
              <Button variant="ghost" disabled={busy === 'replace'} onClick={() => { replacing.current = row.id; replace.current?.click(); }}>换新版</Button>
              <Button variant="ghost" disabled={busy === `delete-${row.id}`} onClick={() => void remove(row)}>删除</Button>
            </div> : <a href={`/api/materials/${row.id}/file`} target="_blank" rel="noreferrer">查看</a>}</td>
          </tr>)}
        </Table>}
    </Card>
  </>;
}
