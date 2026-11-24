import { readFileSync } from 'node:fs'
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const inline = value => escape(value)
  .replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
export function productGuideHTML(path) {
  const lines = readFileSync(path, 'utf8').split('\n'), out = [], toc = []
  let code = false, table = false, list = false, headingIndex = 0
  const close = () => { if (table) { out.push('</tbody></table></div>'); table = false }; if (list) { out.push('</ul>'); list = false } }
  for (const line of lines) {
    if (line.startsWith('~~~')) { close(); out.push(code ? '</code></pre>' : '<pre><code>'); code = !code; continue }
    if (code) { out.push(escape(line) + '\n'); continue }
    if (line.startsWith('|')) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue
      const cells = line.split('|').slice(1, -1).map(value => inline(value.trim()))
      if (!table) { if (list) { out.push('</ul>'); list = false }; out.push('<div class="table"><table><thead><tr>' + cells.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>'); table = true }
      else out.push('<tr>' + cells.map(c => '<td>' + c + '</td>').join('') + '</tr>')
      continue
    }
    if (!line.trim()) { close(); continue }
    const heading = /^(#{1,3}) (.+)$/.exec(line)
    if (heading) {
      close(); const level = heading[1].length, id = 'section-' + (++headingIndex)
      if (level === 2) toc.push({ id, text: heading[2] })
      out.push('<h' + level + ' id="' + id + '">' + inline(heading[2]) + '</h' + level + '>'); continue
    }
    const item = /^(?:- |\d+\. )(.+)$/.exec(line)
    if (item) { if (table) close(); if (!list) { out.push('<ul>'); list = true }; out.push('<li>' + inline(item[1]) + '</li>'); continue }
    close(); out.push('<p>' + inline(line.replace(/^> /, '')) + '</p>')
  }
  close()
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>个人 Agent 助理 · 产品使用手册</title><style>' +
    '*{box-sizing:border-box}body{margin:0;background:#f6f8f6;color:#26342e;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;line-height:1.85}main{max-width:980px;margin:36px auto;background:#fff;padding:48px 64px;border:1px solid #e1e8e1;border-radius:16px}h1{font-size:32px;line-height:1.35;letter-spacing:-.5px}h2{font-size:23px;border-top:1px solid #e8ede8;margin-top:42px;padding-top:24px}h3{font-size:17px;margin-top:28px}p,li{font-size:15px}li{margin:7px 0}a{color:#276a4d}code,pre{font-family:ui-monospace,monospace}code{background:#edf3ef;padding:2px 5px;border-radius:4px}pre{background:#eef3ef;padding:16px;overflow:auto;border-radius:8px}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #dce5dd;text-align:left;padding:12px}th{background:#f0f5f1}nav{background:#f1f6f2;padding:16px 24px;border-radius:10px}nav a{display:block;margin:3px 0}@media(max-width:700px){main{margin:0;padding:24px;border:0;border-radius:0}h1{font-size:27px}}' +
    '</style><main><nav aria-label="手册目录">' + toc.map(item => '<a href="#' + item.id + '">' + inline(item.text) + '</a>').join('') + '</nav>' + out.join('\n') + '</main></html>'
}
