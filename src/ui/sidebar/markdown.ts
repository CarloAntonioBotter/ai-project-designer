/**
 * Minimal, dependency-free Markdown -> HTML renderer for the sidebar preview.
 *
 * Self-contained (no module references) so its source can be embedded into the
 * webview via `.toString()`. Escapes all input, so it is safe on untrusted text.
 */
export function renderMarkdown(markdown: string): string {
  const escapeHtml = (value: string): string =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const inline = (text: string): string =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  let inCode = false;
  let listType: 'ul' | 'ol' | '' = '';
  const closeList = (): void => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = '';
    }
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      html.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      html.push(escapeHtml(line));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const type = bullet ? 'ul' : 'ol';
      if (listType !== type) {
        closeList();
        html.push(`<${type}>`);
        listType = type;
      }
      html.push(`<li>${inline((bullet ?? ordered)![1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim()) {
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  if (inCode) {
    html.push('</code></pre>');
  }
  return html.join('\n');
}
