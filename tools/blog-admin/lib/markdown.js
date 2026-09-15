'use strict';

/**
 * 极简 Markdown 渲染器（零依赖）
 *
 * 支持：
 *   # ~ ###### 标题、段落、**粗体**、*斜体*、~~删除线~~、`行内代码`
 *   ```代码块```、> 引用、- / * / + 无序列表、1. 有序列表、--- 分隔线
 *   [链接](url)、![图片](src)、自动链接 http(s)://...
 *   单独成行的原始 HTML 会原样输出（方便写 <img> / <div> 等）
 *
 * 单个换行渲染为 <br>（对中文排版更友好）。
 */

const PLACEHOLDER = '\u0000';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(text) {
  return String(text)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function safeUrl(url) {
  const value = String(url).trim();
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(value)) return value;
  // 允许 images/xxx.png 这类相对路径，但拒绝 javascript: 等危险协议
  if (/^[a-z0-9_.-]+(\/[a-z0-9_.%-]+)*\.(png|jpe?g|gif|webp|svg|avif)$/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '#';
  return value;
}

function renderInline(text) {
  const store = [];
  const keep = (html) => {
    store.push(html);
    return `${PLACEHOLDER}${store.length - 1}${PLACEHOLDER}`;
  };

  let out = String(text);

  // 1. 行内代码
  out = out.replace(/(`+)([\s\S]*?)\1/g, (_m, _tick, code) => keep(`<code>${escapeHtml(code.trim())}</code>`));

  // 2. 图片 ![alt](src "title")
  out = out.replace(/!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^)]*)&quot;|\s+"([^"]*)")?\s*\)/g,
    (_m, alt, src, _t1, title) =>
      keep(`<img src="${escapeHtml(safeUrl(src))}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`));

  // 3. 链接 [text](url "title")
  out = out.replace(/\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^)]*)&quot;|\s+"([^"]*)")?\s*\)/g,
    (_m, label, href, _t1, title) => {
      const url = safeUrl(href);
      const external = /^https?:/i.test(url);
      return keep(`<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' target="_blank" rel="noopener"' : ''}>${renderInline(label)}</a>`);
    });

  // 4. 其余文本转义后再处理强调
  out = escapeHtml(out);

  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 5. 裸链接自动识别
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_m, lead, url) => `${lead}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);

  // 6. 还原占位符
  out = out.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_m, i) => store[Number(i)] || '');

  return out;
}

function isBlank(line) {
  return /^\s*$/.test(line);
}

function render(source) {
  const lines = String(source == null ? '' : source).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 空行
    if (isBlank(line)) {
      flushParagraph();
      i += 1;
      continue;
    }

    // 代码块
    const fence = trimmed.match(/^(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0];
      const lang = fence[2];
      const buffer = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s*${marker}{3,}\\s*$`).test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过结束围栏
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(buffer.join('\n'))}</code></pre>`);
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      out.push('<hr>');
      i += 1;
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // 引用（支持多行、可嵌套其他块）
    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const buffer = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buffer.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${render(buffer.join('\n'))}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        if (item) {
          items.push(item[1]);
          i += 1;
          continue;
        }
        // 缩进续行
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      out.push(`<ul>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph();
      const items = [];
      while (i < lines.length) {
        const item = lines[i].match(/^\s*\d+[.)]\s+(.*)$/);
        if (item) {
          items.push(item[1]);
          i += 1;
          continue;
        }
        if (items.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i += 1;
          continue;
        }
        break;
      }
      out.push(`<ol>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    // 原始 HTML 块（<div> ... </div> 这类跨行结构）
    if (/^<[a-zA-Z!/]/.test(trimmed)) {
      flushParagraph();
      const buffer = [line];
      i += 1;
      if (!/<\/[a-zA-Z]+>\s*$/.test(trimmed) && !/\/>\s*$/.test(trimmed)) {
        while (i < lines.length && !isBlank(lines[i])) {
          buffer.push(lines[i]);
          i += 1;
        }
      }
      out.push(buffer.join('\n'));
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return out.join('\n');
}

/** 去掉 Markdown 语法，得到纯文本（用于自动摘要） */
function toPlainText(source) {
  return String(source == null ? '' : source)
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { render, renderInline, toPlainText, escapeHtml, unescapeHtml };
