'use client';
import { useState } from 'react';
import { api } from '@/lib/client';
import { Dialog } from './ui/dialog';
import { Button, Input } from './ui/bos';

/** Everyone changes their own password here. Other devices are signed out; this browser gets a fresh session. */
export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  return (
    <Dialog open className="bos bos-team-dialog" title="修改密码" onClose={() => { if (!busy) onClose(); }}>
      {done ? (
        <div className="bos-team-editor">
          <p role="status">密码已修改，其他设备上的登录已失效。</p>
          <Button onClick={onClose}>完成</Button>
        </div>
      ) : (
        <form className="bos-team-editor" onSubmit={async e => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (f.get('newPassword') !== f.get('confirm')) { setError('两次输入的新密码不一致'); return; }
          setBusy(true); setError('');
          try {
            await api('auth/password', 'POST', { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') });
            setDone(true);
          } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
        }}>
          <label>当前密码<Input name="currentPassword" type="password" autoComplete="current-password" required /></label>
          <label>新密码（至少 8 位）<Input name="newPassword" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></label>
          <label>再次输入新密码<Input name="confirm" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></label>
          {error && <p role="alert" className="bos-sales-error">{error}</p>}
          <Button type="submit" variant="primary" disabled={busy}>{busy ? '保存中…' : '保存新密码'}</Button>
        </form>
      )}
    </Dialog>
  );
}
