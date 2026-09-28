# LVANJU WhatsApp 本地同步扩展

在 Chrome/Edge 的扩展管理页通过“加载已解压的扩展程序”选中本目录。先在 CRM“沟通中心 → 本地同步助手”创建同步授权。扩展点击后只采集已打开 WhatsApp Web 标签页当前聊天中已挂载的 DOM 消息，不自动翻页或遍历联系人。

第一次使用填写 CRM HTTPS 地址、授权码、当前登录的本人 WhatsApp 国际号码及聊天日期顺序。账号号码需与 CRM 授权绑定；切换 WhatsApp 账号后更换授权。授权码保存在浏览器本次会话的 `chrome.storage.session`，未写入 CRM、网页 localStorage 或扩展同步存储。扩展没有读取 WhatsApp Cookie、页面内部 Store 或网络会话的权限。

建议先在 WhatsApp Web 打开目标聊天及其联系人信息，确认联系人详情显示国际号码，再用“预览匹配结果”，确认后同步。联系人信息未打开或号码不可见时，消息进入 CRM 待认领队列，不会按姓名自动关联。网页没有稳定消息 ID、明确时间或可靠方向的记录会跳过。附件仅保存元数据。当前 WhatsApp Web DOM 结构若变动，需更新 `collector.js` 选择器并重新运行 fixture 测试。
