//
// The little markdown renderer the issue dialog reads bodies with.
//
// An issue body is hostile input — it is text from a GitHub API answer, and
// GitHub's own markdown allows raw HTML in it — so nothing here ever passes
// markup through. The text is ESCAPED FIRST, once, and every rule below then
// works on that escaped string: a `<script>` in a body is already `&lt;script&gt;`
// before this file decides what a line means, so no rule can resurrect it.
//
// It renders the small grammar an issue body actually uses — the `## Spec`
// headings, fenced code, lists, inline code, bold, italic and links — and
// leaves everything else as the text it was. It is not a markdown engine and is
// not trying to be one: a body that wants the full grammar has the external
// link button, one click away, on the page that owns the grammar.
//

import { esc } from './format.js';

// Links are restricted to the two schemes a browser may navigate safely.
// `javascript:` and `data:` are the reason this check exists at all — the
// bracket syntax is the one place a body supplies an attribute VALUE rather
// than text, and an unchecked one would be a hole the escaping cannot close.
const SAFE_HREF = /^https?:\/\//i;

/** The inline grammar, applied to an already-escaped line. */
const inline = (text) => text
  // Code first: what is inside a span of backticks is literal, and running the
  // emphasis rules over it would eat the asterisks in a code sample.
  .split(/(`[^`]+`)/)
  .map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return `<code>${part.slice(1, -1)}</code>`;
    }
    // Built anchors are stashed behind a NUL sentinel while the emphasis rules
    // run — an href may legitimately contain asterisks, and the emphasis pass
    // must never see markup it built. Escaped text cannot contain NUL, so the
    // sentinel cannot collide with body content.
    const anchors = [];
    return part
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
        if (!SAFE_HREF.test(href)) return whole;
        anchors.push(`<a href="${href}" target="_blank" rel="noopener">${label}</a>`);
        return `\u0000${anchors.length - 1}\u0000`;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/\u0000(\d+)\u0000/g, (match, index) => anchors[Number(index)]);
  })
  .join('');

/**
 * One issue body as safe markup.
 *
 * @param {string} text - the raw body from the API
 * @returns {string} markup — '' for an empty body, so the caller can say what
 *   an empty body means in its own words
 */
export const renderMarkdown = (text) => {
  const source = String(text === null || text === undefined ? '' : text);
  if (!source.trim()) return '';

  const lines = esc(source.replace(/\r\n/g, '\n')).split('\n');
  const out = [];
  let paragraph = [];
  let list = null;
  let code = null;

  const closeParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const closeBlocks = () => { closeParagraph(); closeList(); };

  for (const line of lines) {
    // A fence swallows everything until the next one — inside it, no rule but
    // "this is literal" applies.
    const fence = /^\s*```/.test(line);
    if (code !== null) {
      if (fence) {
        out.push(`<pre class="p-2 rounded"><code>${code.join('\n')}</code></pre>`);
        code = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (fence) {
      closeBlocks();
      code = [];
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeBlocks();
      // The dialog is a card, not a document: its headings start below the
      // dialog's own title rather than competing with it.
      const level = Math.min(heading[1].length + 3, 6);
      out.push(`<h${level} class="h6 mt-3 mb-2">${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      closeParagraph();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) closeList();
      list = list || { tag, items: [] };
      list.items.push((bullet || numbered)[1]);
      continue;
    }

    if (!line.trim()) {
      closeBlocks();
      continue;
    }
    closeList();
    paragraph.push(line);
  }

  // An unterminated fence is still content — render what it holds rather than
  // dropping the rest of the body on the floor.
  if (code !== null) out.push(`<pre class="p-2 rounded"><code>${code.join('\n')}</code></pre>`);
  closeBlocks();

  return out.join('');
};
