/* 登录页 — 对应现有 POST /api/auth/login（邮箱 + 密码，HttpOnly 会话 Cookie，登录限速 lib/login-throttle.ts）。 */
(function () {
  const LV = window.LV, U = LV.ui, I = LV.icon;

  LV.screens.login = {
    root: true,
    render(p, ui) {
      const role = ui.role || 'ADMIN';
      const user = LV.USERS[LV.DEMO_LOGIN[role]];
      const err = ui.error;
      return {
        appbar: false,
        body: `<div class="login">
          <div class="login-hero">
            <img src="assets/brand/lvanju-logo.jpg" alt="LVANJU 绿安居" width="208" height="84">
            <p>BOS 企业经营系统</p>
          </div>
          <form class="login-form" data-submit="login" novalidate>
            <div>
              <h1>登录</h1>
              <p class="login-sub">使用管理员为你开通的账号</p>
            </div>
            ${err ? `<div class="login-alert" role="alert">${I('circle-alert')}<span>${err}</span></div>` : ''}
            ${U.field({ id: 'login-email', label: '邮箱', type: 'email', value: ui.email ?? user.email, autocomplete: 'username', inputmode: 'email', input: 'login-field' })}
            ${U.field({ id: 'login-password', label: '密码', type: ui.show ? 'text' : 'password', value: ui.password ?? 'demo-password', autocomplete: 'current-password', input: 'login-field',
              extra: `<div class="input-wrap"><input class="input" id="login-password" name="login-password" type="${ui.show ? 'text' : 'password'}" value="${LV.esc(ui.password ?? 'demo-password')}" autocomplete="current-password" data-input="login-field" style="padding-right:52px"><button type="button" class="icon-btn" ${LV.attr('toggle-password')} aria-label="${ui.show ? '隐藏密码' : '显示密码'}">${I(ui.show ? 'eye-off' : 'eye')}</button></div>` })}
            ${U.btn(ui.busy ? '正在登录' : '登录', { kind: 'primary', block: true, type: 'submit', icon: ui.busy ? 'refresh-cw' : '', attrs: ui.busy ? 'disabled' : '' })}
            <p class="login-help">忘记密码请联系管理员重置。同一账号连续输错 8 次，需等待 15 分钟再试。</p>
          </form>
          <div class="login-demo" aria-label="原型演示">
            <span>原型演示身份</span>
            <div class="seg">${[['ADMIN', '管理员 · 陈立'], ['SALES', '销售 · 林晓']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${role === k}" ${LV.attr('login-role', { role: k })}>${l}</button>`).join('')}</div>
            <button type="button" class="btn btn-ghost btn-sm" ${LV.attr('login-wrong')}>演示：密码错误</button>
          </div>
        </div>`,
      };
    },
  };

  LV.on('login-role', (el, e, r) => { r.ui.role = el.dataset.role; r.ui.email = undefined; r.ui.error = ''; LV.refresh(); });
  LV.on('toggle-password', (el, e, r) => { r.ui.show = !r.ui.show; LV.refresh(); });
  LV.onInput('login-field', (el, e, r) => { if (el.id === 'login-email') r.ui.email = el.value; else r.ui.password = el.value; });
  LV.on('login-wrong', (el, e, r) => { r.ui.error = '邮箱或密码不正确，还可以再试 7 次'; LV.refresh(); });
  LV.on('login', (el, e, r) => {
    const email = (r.ui.email ?? LV.USERS[LV.DEMO_LOGIN[r.ui.role || 'ADMIN']].email).trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) { r.ui.error = '请填写正确的邮箱地址'; LV.refresh(); return; }
    r.ui.busy = true; r.ui.error = ''; LV.refresh();
    setTimeout(() => {
      const role = r.ui.role || 'ADMIN';
      LV.state.session = { userId: LV.DEMO_LOGIN[role] };
      LV.mountApp();
      LV.syncPanel?.();
      LV.toast(`欢迎回来，${LV.me().name}`, { icon: 'circle-check' });
    }, 650);
  });
})();
