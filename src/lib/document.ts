export const DEFAULT_TITLE = 'Untitled Document';

export function parseDocument(raw: string) {
  if (!raw.startsWith('---\n')) {
    return { meta: {} as Record<string, string>, body: raw };
  }

  const end = raw.indexOf('\n---\n');
  if (end === -1) {
    return { meta: {} as Record<string, string>, body: raw };
  }

  const metaLines = raw.slice(4, end).split('\n');
  const meta: Record<string, string> = {};

  for (const line of metaLines) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    meta[key] = value;
  }

  return {
    meta,
    body: raw.slice(end + 5).replace(/^\n/, '')
  };
}

function formatFrontmatterValue(value: string) {
  return /^[A-Za-z0-9._:/+-]+$/.test(value) ? value : JSON.stringify(value);
}

export function composeDocument(meta: Record<string, string>, title: string, body: string) {
  const nextMeta: Record<string, string> = {
    ...meta,
    title: title.trim() || DEFAULT_TITLE,
    modified: new Date().toISOString()
  };

  if (!nextMeta.created) {
    nextMeta.created = new Date().toISOString();
  }

  const keys = [
    ...['title', 'created', 'modified', 'id'].filter((key) => key in nextMeta),
    ...Object.keys(nextMeta).filter((key) => !['title', 'created', 'modified', 'id'].includes(key))
  ];

  const frontmatter = keys.map((key) => `${key}: ${formatFrontmatterValue(nextMeta[key])}`).join('\n');
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function textToHtml(text: string) {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trimEnd())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return '';
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function looksLikeHtml(value: string) {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

export function normalizeStoredHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return looksLikeHtml(trimmed) ? trimmed : textToHtml(value);
}

export function htmlToText(html: string) {
  if (!html.trim()) {
    return '';
  }

  const container = document.createElement('div');
  container.innerHTML = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote)>/gi, '\n\n')
    .replace(/<(ul|ol)[^>]*>/gi, '\n');

  return (container.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function countCharacters(text: string) {
  return text.length;
}

export function countParagraphs(text: string) {
  return text.trim() ? text.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).length : 0;
}

export function readingTime(words: number) {
  return words === 0 ? '~0 min read' : `~${Math.max(1, Math.round(words / 200))} min read`;
}

export function normalizeEditorHtml(html: string) {
  const normalized = html
    .replace(/<div><br><\/div>/gi, '<p><br></p>')
    .replace(/<div>/gi, '<p>')
    .replace(/<\/div>/gi, '</p>')
    .replace(/<p>(\s|&nbsp;)*<\/p>/gi, '<p><br></p>')
    .trim();

  return htmlToText(normalized).trim() || /<br\s*\/?>/i.test(normalized) ? normalized : '';
}

export function fileTitleFromName(name: string) {
  const stripped = name.replace(/\.[^.]+$/, '').trim();
  return stripped || DEFAULT_TITLE;
}
