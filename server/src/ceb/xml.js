// 极简 XML 组装(无外部依赖)。对象 → XML 字符串。
// 说明:CEB 报文实际 schema 以海关最新统一版规范为准,此处为原型示意结构。
function esc(s) {
  return String(s).replace(/[<>&'"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

// node: { tag, attrs?, children?: [node...], text? }
function build(node, indent = 0) {
  const pad = '  '.repeat(indent);
  const attrs = node.attrs
    ? ' ' + Object.entries(node.attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')
    : '';
  if (node.children && node.children.length) {
    const inner = node.children.map(c => build(c, indent + 1)).join('\n');
    return `${pad}<${node.tag}${attrs}>\n${inner}\n${pad}</${node.tag}>`;
  }
  if (node.text !== undefined && node.text !== null && node.text !== '') {
    return `${pad}<${node.tag}${attrs}>${esc(node.text)}</${node.tag}>`;
  }
  return `${pad}<${node.tag}${attrs}/>`;
}

// 便捷:纯对象 {k: v, ...} → 子节点数组(值为 null/undefined 的跳过)
function fields(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([tag, text]) => ({ tag, text }));
}

function document(root) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${build(root)}`;
}

module.exports = { build, fields, document, esc };
