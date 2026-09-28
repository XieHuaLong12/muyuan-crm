/* Runs only after a user click; reads currently mounted WhatsApp Web DOM. */
(() => {
  function e164(value) {
    const v=(value||'').trim().replace(/[\s().-]/g,'');
    const x=v.startsWith('00')?'+'+v.slice(2):v;
    return /^\+[1-9]\d{7,14}$/.test(x)?x:null;
  }
  function parseTimestamp(raw,order) {
    const parts=(raw||'').match(/\[?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|上午|下午)?\s*[,，]\s*([^\]]+)/i);
    if(!parts)return null;
    let hour=Number(parts[1]),minute=Number(parts[2]),second=Number(parts[3]||0);
    const ampm=(parts[4]||'').toUpperCase();
    if(ampm==='PM'||ampm==='下午')hour=hour%12+12;
    if(ampm==='AM'||ampm==='上午')hour%=12;
    const datePart=parts[5].trim();
    const chinese=datePart.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const numeric=datePart.match(/^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})/);
    if(!chinese&&!numeric)return null;
    let year,month,day;
    if(chinese){year=Number(chinese[1]);month=Number(chinese[2]);day=Number(chinese[3]);}
    else if(numeric[1].length===4){year=Number(numeric[1]);month=Number(numeric[2]);day=Number(numeric[3]);}
    else if(numeric[3].length===4){year=Number(numeric[3]);month=Number(order==='DMY'?numeric[2]:numeric[1]);day=Number(order==='DMY'?numeric[1]:numeric[2]);}
    else return null;
    if(year<2009||year>2100||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)return null;
    const date=new Date(year,month-1,day,hour,minute,second);
    if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour||date.getMinutes()!==minute||date.getTime()>Date.now()+86400000)return null;
    return date.toISOString();
  }
  function senderOf(row) {
    const raw=row.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')||'';
    return raw.slice(raw.lastIndexOf(']')+1).trim().replace(/[：:]\s*$/u,'').trim();
  }
  function identify(id,title,visiblePhone) {
    if(/@g\.us/.test(id))return {group:true,phone:null,conversationId:'group'};
    const jid=id.match(/(?:^|_)(\d{8,15})@(c\.us|s\.whatsapp\.net)(?:_|$)/);
    if(jid)return {group:false,phone:e164('+'+jid[1]),conversationId:jid[1]+'@'+jid[2]};
    const lid=id.match(/(?:^|_)(\d{8,20})@lid(?:_|$)/);
    return {group:false,phone:visiblePhone||e164(title),conversationId:lid?lid[1]+'@lid':'opaque'};
  }
  function attachmentMetadata(row) {
    const results=[];
    const kinds=[['image','img, [data-testid="image-thumb"]'],['video','video, [data-testid="video-thumb"]'],['audio','audio, [data-testid="audio-play"]'],['document','[data-testid="document"], [data-testid="document-thumb"]'],['sticker','[data-testid="sticker"]']];
    for(const [kind,selector] of kinds){
      const node=row.querySelector(selector);
      if(!node)continue;
      if(kind==='image'&&(node.closest('[data-testid="quoted-message"]')||node.closest('.selectable-text')))continue;
      const candidate=(node.getAttribute('alt')||node.getAttribute('title')||'').slice(0,255);
      const fileName=/^(?:https?:|blob:|data:|file:)/i.test(candidate.trim())?'':candidate;
      results.push({kind,...(fileName?{fileName}:{})});
    }
    return results.slice(0,8);
  }
  function collect(options) {
    const main=document.querySelector('#main');
    if(!main)return {messages:[],warnings:['当前标签页没有已打开的聊天。']};
    const title=(main.querySelector('header [data-testid="conversation-info-header-chat-title"]')?.textContent||main.querySelector('header [title]')?.getAttribute('title')||'').trim();
    const drawer=document.querySelector('[data-testid="chat-info-drawer"]');
    const drawerTitle=drawer?.querySelector('[data-testid="contact-info-subtitle selectable-text"]')?.textContent?.trim();
    const visiblePhone=drawerTitle===title?[...(drawer?.querySelectorAll('[data-testid="selectable-text"]')||[])].map(n=>e164(n.textContent)).find(Boolean)||null:null;
    const warnings=[],messages=[];
    const rows=[...main.querySelectorAll('[data-id][data-testid^="conv-msg-"], .message-in[data-id], .message-out[data-id]')];
    if(rows.length>3000)warnings.push('当前已加载消息超过 3000 条，只处理最前面的 3000 条。');
    const inboundNames=new Set(rows.filter(r=>r.querySelector('[data-testid="tail-in"]')).map(senderOf).filter(Boolean));
    const outboundNames=new Set(rows.filter(r=>r.querySelector('[data-testid="tail-out"]')).map(senderOf).filter(Boolean));
    if(!visiblePhone&&!e164(title)&&inboundNames.size&&(!title||!inboundNames.has(title)))return {messages:[],warnings:['无法确认这是单人聊天，已跳过。']};
    for(const row of rows.slice(0,3000)){
      const id=row.getAttribute('data-id');
      if(!id||id.length>500){warnings.push('一条消息缺少有效稳定 ID，已跳过。');continue;}
      const who=identify(id,title,visiblePhone);
      if(who.group)return {messages:[],warnings:['检测到群聊，已跳过整个标签页。']};
      const sender=senderOf(row);
      let direction=null;
      if(row.classList.contains('message-out')||row.querySelector('[data-testid="tail-out"]'))direction='outbound';
      else if(row.classList.contains('message-in')||row.querySelector('[data-testid="tail-in"]'))direction='inbound';
      else if(sender&&outboundNames.has(sender)&&!inboundNames.has(sender))direction='outbound';
      else if(sender&&inboundNames.has(sender)&&!outboundNames.has(sender))direction='inbound';
      else if(sender&&sender===title)direction='inbound';
      if(!direction){warnings.push('一条消息方向无法确认，已跳过。');continue;}
      const stamp=row.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')||'';
      const sentAt=parseTimestamp(stamp,options.dateOrder);
      if(!sentAt){warnings.push('一条消息的时间无法确认，已跳过。');continue;}
      const text=[...row.querySelectorAll('.selectable-text')].filter(n=>!n.closest('[data-testid="quoted-message"]')).map(n=>n.textContent||'').join('\n').trim().slice(0,16000);
      const attachments=attachmentMetadata(row);
      if(!text&&!attachments.length){warnings.push('一条空消息已跳过。');continue;}
      messages.push({sourceMessageId:id,conversationId:who.conversationId,peerPhone:who.phone,peerName:title.slice(0,191),direction,sentAt,text,attachments});
    }
    if(!rows.length)warnings.push('当前聊天没有可读取的已加载消息。');
    if(messages.length&&messages.some(m=>!m.peerPhone))warnings.push('部分消息没有可见国际号码，会进入 CRM 待认领；可先手动打开聊天的联系人信息，再预览。');
    return {messages,warnings:[...new Set(warnings)].slice(0,10)};
  }
  globalThis.__lvanjuCollectLoaded=collect;
})();
