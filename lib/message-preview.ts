/** One line for a message in a list: media placeholders such as "[IMAGE]" read as 「[图片] 文件名」. */
export function messagePreview(message: { content: string; messageType: string; fileName: string | null } | null | undefined) {
  if (!message) return '';
  const placeholder = /^\[[^\]]*\]$/.test(message.content.trim());
  const label: Record<string, string> = { IMAGE: '图片', VIDEO: '视频', AUDIO: '语音', VOICE: '语音', DOCUMENT: '文件', FILE: '文件', STICKER: '贴纸', LOCATION: '位置', TEMPLATE: '模板消息' };
  if (label[message.messageType] && (placeholder || !message.content.trim())) return `[${label[message.messageType]}]${message.fileName ? ` ${message.fileName}` : ''}`;
  return message.content;
}
