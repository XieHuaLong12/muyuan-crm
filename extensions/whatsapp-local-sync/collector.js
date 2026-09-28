/* Runs only after an explicit click in the popup; reads currently mounted DOM. */
(() => {
  function e164(value) {
    const v=(value||'').trim().replace(/[\s().-]/g,'');
    const x=v.startsWith('00')?'+'+v.slice(2):v;
    return /^\+[1-9]\d{7,14}$/.test(x)?x:null;
  }
  function parseTimestamp(raw,order) {
    if(!raw)return null;
    const match=raw.match(/\[?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|上午|下午)?\s*[,，]\s*(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})/i);
    if(!match)return null;
    let hour=Number(match[1]),minute=Number(match[2]),second=Number(match[3]||0);
    const ampm=(match[4]||'').toUpperCase();
    if(ampm==='PM'||ampm==='下午')hour=(hour%12)+12;
    if(ampm==='AM'||ampm==='上午')hour=hour%12;
    let a=Number(match[5]),b=Number(match[6]),c=Number(match[7]);
    let year,month,day;
    if(String(match[5]).length===4){year=a;month=b;day=c;}
    else if(String(match[7]).length===4){year=c;month=order==='DMY'?b:a;day=order==='DMY'?a:b;}
    else return null;
    if(year<2000||year>2100||month<1||month>12||day<1||day>31||hour>23||minute>59||second>59)return null;
    const date=new Date(year,month-1,day,hour,minute,second);
    if(date.getFullYear()!==year||date.getMonth()!==month-1||date.getDate()!==day||date.getHours()!==hour)return null;
    return date.toISOString();
  }
  function identify(id,header) {
    if(/@g\.us/.test(id))return {group:true,phone:null,conversationId:'group'};
    const match=id.match(/(?:^|_)(\d{8,15})@(c\.us|s\.whatsapp\.net)(?:_|$)/);
    if(match)return {group:false,phone:e164('+'+match[1]),conversationId:match[1]+'@'+match[2]};
    const lid=id.match(/(?:^|_)(\d{8,20})@lid(?:_|$)/);
    const title=e164(header);
    return {group:false,phone:title,conversationId:lid?lid[1]+'@lid':'unresolved'};
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
    const title=main.querySelector('header [title]')?.getAttribute('title')||'';
    const warnings=[],messages=[];
    const rows=main.querySelectorAll('.message-in[data-id], .message-out[data-id], [data-id].message-in, [data-id].message-out');
    if(rows.length>3000)warnings.push('当前已加载消息超过 3000 条，只处理最前面的 3000 条。');
    for(const row of [...rows].slice(0,3000)){
      const id=row.getAttribute('data-id');
      if(!id||id.length>500){warnings.push('一条消息缺少有效稳定 ID，已跳过。');continue;}
      const who=identify(id,title);
      if(who.group)return {messages:[],warnings:['检测到群聊，已跳过整个标签页。']};
      const stamp=row.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')||'';
      const sentAt=parseTimestamp(stamp,options.dateOrder);
      if(!sentAt){warnings.push('一条消息的时间无法确认，已跳过。');continue;}
      const text=[...row.querySelectorAll('.selectable-text')].filter(n=>!n.closest('[data-testid="quoted-message"]')).map(n=>n.textContent||'').join('\n').trim().slice(0,16000);
      const attachments=attachmentMetadata(row);
      if(!text&&!attachments.length){warnings.push('一条空消息已跳过。');continue;}
      messages.push({sourceMessageId:id,conversationId:who.conversationId,peerPhone:who.phone,peerName:title.slice(0,191),
        direction:row.classList.contains('message-out')?'outbound':'inbound',sentAt,text,attachments});
    }
    if(!rows.length)warnings.push('当前聊天没有可读取的已加载消息。');
    return {messages,warnings:[...new Set(warnings)].slice(0,10)};
  }
  globalThis.__lvanjuCollectLoaded=collect;
})();
