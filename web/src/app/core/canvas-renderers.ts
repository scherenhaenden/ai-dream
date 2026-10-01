export interface CanvasTableData {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
}

export function parseJsonTableData(value: string): CanvasTableData | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 1000
        || parsed.some(row => !row || typeof row !== 'object' || Array.isArray(row))) return null;
    const rows = parsed as Record<string, unknown>[];
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 50);
    return columns.length ? { columns, rows: rows.slice(0, 200), totalRows: rows.length } : null;
  } catch { return null; }
}

export function renderSafeMarkdown(value: string): string {
  const lines = value.split(/\r?\n/);
  const output: string[] = [];
  let paragraph: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let codeFence: { marker: string; lines: string[] } | null = null;
  const closeList = () => { if (list) output.push(`</${list}>`); list = null; };
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (codeFence) {
      if (fence && fence[1][0] === codeFence.marker[0] && fence[1].length >= codeFence.marker.length) {
        output.push(`<pre><code>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`);
        codeFence = null;
      } else codeFence.lines.push(line);
      continue;
    }
    if (fence) {
      flushParagraph(); closeList();
      codeFence = { marker: fence[1], lines: [] };
      continue;
    }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph(); closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (index + 1 < lines.length && line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      flushParagraph(); closeList();
      const headers = markdownCells(line);
      index++;
      const rows: string[][] = [];
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        rows.push(markdownCells(lines[++index]));
      }
      output.push(`<table><thead><tr>${headers.map(cell => `<th scope="col">${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${headers.map((_, column) => `<td>${renderInlineMarkdown(row[column] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const listItem = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      flushParagraph();
      const nextList = listItem[2] ? 'ol' : 'ul';
      if (list !== nextList) { closeList(); output.push(`<${nextList}>`); list = nextList; }
      output.push(`<li>${renderInlineMarkdown(listItem[3])}</li>`);
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) { flushParagraph(); closeList(); output.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`); continue; }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flushParagraph(); closeList(); output.push('<hr>'); continue; }
    closeList();
    paragraph.push(line.trim());
  }
  if (codeFence) output.push(`<pre><code>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`);
  flushParagraph(); closeList();
  return output.join('');
}

function markdownCells(line: string): string[] {
  const value = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return value.split('|').map(cell => cell.trim());
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function renderInlineMarkdown(source: string): string {
  const protectedHtml: string[] = [];
  let value = escapeHtml(source);
  const protect = (html: string) => {
    const index = protectedHtml.push(html) - 1;
    return `\u0000${index}\u0000`;
  };
  value = value.replace(/`([^`\n]+)`/g, (_match, code: string) => protect(`<code>${code}</code>`));
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, encodedHref: string) => {
    const href = encodedHref.replaceAll('&amp;', '&');
    if (!/^(?:https?:\/\/|mailto:)/i.test(href) || /[\u0000-\u0020]/.test(href)) return label;
    try {
      const parsed = new URL(href);
      if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return label;
    } catch { return label; }
    return protect(`<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`);
  });
  value = value.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_match, first: string, second: string) => `<strong>${first || second}</strong>`);
  value = value.replace(/~~(.+?)~~/g, '<del>$1</del>');
  value = value.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)/g,
    (_match, first: string, second: string) => `<em>${first || second}</em>`);
  return value.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => protectedHtml[Number(index)] || '');
}
