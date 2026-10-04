import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/ui/sidebar/markdown';

test('renderMarkdown renders common markdown and escapes raw HTML', () => {
  const html = renderMarkdown(
    '# Title\n\n**bold** *em* `code`\n\n- a\n- b\n\n> note\n\n```\n<script>x</script>\n```'
  );
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>em<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<li>a<\/li>/);
  assert.match(html, /<blockquote>note<\/blockquote>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
