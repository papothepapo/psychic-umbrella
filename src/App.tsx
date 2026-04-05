import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react';
import { api } from './lib/api';
import type {
  AppSettings,
  AutoSnapshotFrequency,
  BackupEntry,
  DefaultExportFormat,
  ExportFormat,
  PageWidthPreset,
  ProjectMeta,
  SavePoint,
  SnapshotRetention,
  StorageOverview,
  TextAlignment,
  WordGoalDisplay
} from './lib/types';

type AppMode = 'writing' | 'edit' | 'comparison';
type SaveState = 'ready' | 'saving' | 'saved' | 'error';
type SettingsCategory =
  | 'General'
  | 'Writing'
  | 'Snapshots'
  | 'Appearance'
  | 'Export & Import'
  | 'Accessibility'
  | 'About';
type SnapshotKind = 'manual' | 'auto';
type InlineDiffOp = {
  id: string;
  type: 'equal' | 'insert' | 'delete';
  text: string;
};
type ComparisonBlock = {
  id: string;
  type: 'unchanged' | 'added' | 'deleted' | 'modified';
  baseText: string;
  currentText: string;
  ops: InlineDiffOp[];
};
type SnapshotPreview = {
  raw: string;
  html: string;
  text: string;
};
type ToolbarState = {
  visible: boolean;
  top: number;
  left: number;
};

const BRAND_NAME = 'Inkline';
const DEFAULT_TITLE = 'Untitled Document';
const SETTINGS_CATEGORIES: SettingsCategory[] = [
  'General',
  'Writing',
  'Snapshots',
  'Appearance',
  'Export & Import',
  'Accessibility',
  'About'
];

const FONT_OPTIONS = [
  'Georgia',
  'Times New Roman',
  'Palatino',
  'Garamond',
  'Merriweather',
  'Arial',
  'Helvetica',
  'Inter'
];

const LANGUAGE_OPTIONS = [
  'en-US',
  'en-GB',
  'es-ES',
  'fr-FR',
  'de-DE',
  'it-IT',
  'pt-BR',
  'nl-NL',
  'sv-SE',
  'fi-FI',
  'da-DK',
  'no-NO',
  'pl-PL',
  'cs-CZ',
  'hu-HU',
  'tr-TR',
  'ru-RU',
  'uk-UA',
  'hi-IN',
  'ja-JP',
  'ko-KR',
  'zh-CN'
];

const CANVAS_WIDTHS: Record<PageWidthPreset, number> = {
  narrow: 560,
  medium: 720,
  wide: 900
};

const FREQUENCY_TO_MINUTES: Record<Exclude<AutoSnapshotFrequency, 'custom'>, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60
};

const RETENTION_TO_DAYS: Record<Exclude<SnapshotRetention, 'custom' | 'forever'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365
};

const ALIGNMENT_OPTIONS: Array<{ value: TextAlignment; label: string }> = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justify' }
];

const DEFAULT_SETTINGS: AppSettings = {
  appTheme: 'light',
  followSystemTheme: false,
  defaultFont: 'Georgia',
  defaultFontSize: 16,
  defaultLineSpacing: '1.5',
  customLineSpacing: 1.75,
  defaultTextAlignment: 'left',
  paragraphSpacing: 12,
  defaultPageWidth: 'medium',
  language: 'en-US',
  spellCheck: true,
  grammarCheck: true,
  autoCorrect: true,
  smartQuotes: true,
  autoCapitalizeSentences: true,
  focusMode: false,
  typewriterScrolling: false,
  showFormattingMarks: false,
  showWordCount: true,
  showCharacterCount: false,
  showParagraphCount: false,
  showReadingTime: false,
  showWordGoal: false,
  wordGoalTarget: 80000,
  wordGoalDisplay: 'fraction',
  highlightCurrentLine: false,
  cursorStyle: 'line',
  cursorBlink: true,
  doubleClickSelectsWord: true,
  tripleClickSelectsParagraph: true,
  pastePlainTextByDefault: false,
  autoSnapshotsEnabled: true,
  autoSnapshotFrequency: '15m',
  autoSnapshotCustomMinutes: 15,
  snapshotOnlyWhenChangesExist: true,
  autoSnapshotNaming: true,
  keepSnapshotsFor: 'forever',
  customRetentionDays: 30,
  maximumSnapshotsEnabled: false,
  maximumSnapshots: 100,
  snapshotLimitBehavior: 'deleteOldestAuto',
  hiddenSnapshotHashes: [],
  canvasWidth: 'medium',
  canvasShadow: true,
  showPageRuler: false,
  paragraphIndentStyle: 'block',
  deletionColor: '#DC2626',
  additionColor: '#16A34A',
  usePatternsInsteadOfColor: false,
  diffHighlightOpacity: 60,
  animationSpeed: 'normal',
  reduceMotion: false,
  includeDocumentTitleInExport: true,
  includePageNumbersInPdf: true,
  pdfPageSize: 'A4',
  pdfMargins: 'normal',
  includeAuthorNameInExport: false,
  authorName: '',
  exportWithComparisonMarkup: false,
  importMode: 'newDocument',
  fontScaling: 100,
  highContrastMode: false,
  screenReaderSupport: true,
  keyboardNavigation: true,
  tooltipDelay: 500,
  focusIndicators: 'default',
  dyslexiaFriendlyFont: false,
  lineFocusHighlight: false,
  projectsDirectory: '',
  backupsDirectory: '',
  exportsDirectory: '',
  defaultExportFormat: 'inkline'
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(input?: Partial<AppSettings> | null): AppSettings {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...input
  };

  const font = FONT_OPTIONS.includes(settings.defaultFont) ? settings.defaultFont : DEFAULT_SETTINGS.defaultFont;
  const pageWidth = settings.defaultPageWidth;
  const canvasWidth = settings.canvasWidth;

  return {
    ...settings,
    appTheme: ['light', 'dark', 'sepia'].includes(settings.appTheme) ? settings.appTheme : DEFAULT_SETTINGS.appTheme,
    defaultFont: font,
    defaultFontSize: clamp(Number(settings.defaultFontSize || DEFAULT_SETTINGS.defaultFontSize), 8, 72),
    customLineSpacing: clamp(Number(settings.customLineSpacing || DEFAULT_SETTINGS.customLineSpacing), 1, 3),
    paragraphSpacing: clamp(Number(settings.paragraphSpacing || DEFAULT_SETTINGS.paragraphSpacing), 0, 40),
    defaultPageWidth: ['narrow', 'medium', 'wide'].includes(pageWidth) ? pageWidth : DEFAULT_SETTINGS.defaultPageWidth,
    language: LANGUAGE_OPTIONS.includes(settings.language) ? settings.language : DEFAULT_SETTINGS.language,
    wordGoalTarget: clamp(Number(settings.wordGoalTarget || DEFAULT_SETTINGS.wordGoalTarget), 1, 9999999),
    autoSnapshotCustomMinutes: clamp(
      Number(settings.autoSnapshotCustomMinutes || DEFAULT_SETTINGS.autoSnapshotCustomMinutes),
      1,
      1440
    ),
    customRetentionDays: clamp(Number(settings.customRetentionDays || DEFAULT_SETTINGS.customRetentionDays), 1, 3650),
    maximumSnapshots: clamp(Number(settings.maximumSnapshots || DEFAULT_SETTINGS.maximumSnapshots), 1, 10000),
    hiddenSnapshotHashes: Array.isArray(settings.hiddenSnapshotHashes) ? settings.hiddenSnapshotHashes : [],
    canvasWidth: ['narrow', 'medium', 'wide'].includes(canvasWidth) ? canvasWidth : DEFAULT_SETTINGS.canvasWidth,
    diffHighlightOpacity: clamp(Number(settings.diffHighlightOpacity || DEFAULT_SETTINGS.diffHighlightOpacity), 0, 100),
    fontScaling: clamp(Number(settings.fontScaling || DEFAULT_SETTINGS.fontScaling), 80, 150),
    tooltipDelay: clamp(Number(settings.tooltipDelay || DEFAULT_SETTINGS.tooltipDelay), 0, 1000),
    deletionColor: settings.deletionColor || DEFAULT_SETTINGS.deletionColor,
    additionColor: settings.additionColor || DEFAULT_SETTINGS.additionColor,
    defaultExportFormat: (['pdf', 'docx', 'txt', 'md', 'inkline'] as DefaultExportFormat[]).includes(
      settings.defaultExportFormat
    )
      ? settings.defaultExportFormat
      : DEFAULT_SETTINGS.defaultExportFormat
  };
}

function parseDocument(raw: string) {
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

function composeDocument(meta: Record<string, string>, title: string, body: string) {
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

function textToHtml(text: string) {
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

function normalizeStoredHtml(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return looksLikeHtml(trimmed) ? trimmed : textToHtml(value);
}

function htmlToText(html: string) {
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

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function countCharacters(text: string) {
  return text.length;
}

function countParagraphs(text: string) {
  return text.trim() ? text.split(/\n{2,}/).filter((paragraph) => paragraph.trim()).length : 0;
}

function readingTime(words: number) {
  return words === 0 ? '~0 min read' : `~${Math.max(1, Math.round(words / 200))} min read`;
}

function formatDateTime(timestamp: string) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

function formatRelativeTime(timestamp: string, now: number) {
  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) return timestamp;

  const deltaMinutes = Math.round((now - parsed) / 60000);
  if (deltaMinutes <= 0) return 'just now';
  if (deltaMinutes === 1) return '1 minute ago';
  if (deltaMinutes < 60) return `${deltaMinutes} minutes ago`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours === 1) return '1 hour ago';
  if (deltaHours < 24) return `${deltaHours} hours ago`;
  const deltaDays = Math.round(deltaHours / 24);
  if (deltaDays === 1) return '1 day ago';
  return `${deltaDays} days ago`;
}

function pageWidthToPixels(width: PageWidthPreset) {
  return CANVAS_WIDTHS[width];
}

function currentLineSpacing(settings: AppSettings) {
  switch (settings.defaultLineSpacing) {
    case 'single':
      return 1;
    case '1.15':
      return 1.15;
    case '1.5':
      return 1.5;
    case 'double':
      return 2;
    case 'custom':
      return settings.customLineSpacing;
    default:
      return 1.5;
  }
}

function animationMultiplier(settings: AppSettings) {
  if (settings.reduceMotion || settings.animationSpeed === 'off') {
    return 0;
  }

  if (settings.animationSpeed === 'slow') return 1.45;
  if (settings.animationSpeed === 'fast') return 0.7;
  return 1;
}

function getAutoSnapshotMinutes(settings: AppSettings) {
  return settings.autoSnapshotFrequency === 'custom'
    ? settings.autoSnapshotCustomMinutes
    : FREQUENCY_TO_MINUTES[settings.autoSnapshotFrequency];
}

function isAutoSnapshot(snapshot: SavePoint) {
  return snapshot.message.toLowerCase().startsWith('auto snapshot');
}

function snapshotKind(snapshot: SavePoint): SnapshotKind {
  return isAutoSnapshot(snapshot) ? 'auto' : 'manual';
}

function autoSnapshotLabel() {
  return `Auto snapshot — ${formatDateTime(new Date().toISOString())}`;
}

function manualSnapshotLabel(name: string) {
  return name.trim() || formatDateTime(new Date().toISOString());
}

function normalizeEditorHtml(html: string) {
  const normalized = html
    .replace(/<div><br><\/div>/gi, '')
    .replace(/<div>/gi, '<p>')
    .replace(/<\/div>/gi, '</p>')
    .replace(/<p><\/p>/gi, '')
    .trim();

  return htmlToText(normalized).trim() ? normalized : '';
}

function tokenizeForInlineDiff(text: string) {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function normalizeTokens(text: string) {
  return text
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
    .filter(Boolean);
}

function paragraphSimilarity(left: string, right: string) {
  const leftTokens = normalizeTokens(left);
  const rightTokens = normalizeTokens(right);

  if (leftTokens.length === 0 && rightTokens.length === 0) {
    return 1;
  }

  const leftCounts = new Map<string, number>();
  const rightCounts = new Map<string, number>();

  for (const token of leftTokens) {
    leftCounts.set(token, (leftCounts.get(token) ?? 0) + 1);
  }

  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  let total = 0;

  for (const [token, count] of leftCounts.entries()) {
    const rightCount = rightCounts.get(token) ?? 0;
    overlap += Math.min(count, rightCount);
    total += Math.max(count, rightCount);
  }

  for (const [token, count] of rightCounts.entries()) {
    if (!leftCounts.has(token)) {
      total += count;
    }
  }

  return total === 0 ? 0 : overlap / total;
}

function substitutionCost(left: string, right: string) {
  if (left === right) return 0;
  return paragraphSimilarity(left, right) >= 0.35 ? 1 : 2;
}

function buildInlineDiff(left: string, right: string, blockId: string): InlineDiffOp[] {
  const leftTokens = tokenizeForInlineDiff(left);
  const rightTokens = tokenizeForInlineDiff(right);
  const n = leftTokens.length;
  const m = rightTokens.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        leftTokens[i] === rightTokens[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: InlineDiffOp[] = [];
  let i = 0;
  let j = 0;
  let index = 0;

  while (i < n && j < m) {
    if (leftTokens[i] === rightTokens[j]) {
      ops.push({ id: `${blockId}-equal-${index}`, type: 'equal', text: leftTokens[i] });
      i += 1;
      j += 1;
      index += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ id: `${blockId}-delete-${index}`, type: 'delete', text: leftTokens[i] });
      i += 1;
      index += 1;
    } else {
      ops.push({ id: `${blockId}-insert-${index}`, type: 'insert', text: rightTokens[j] });
      j += 1;
      index += 1;
    }
  }

  while (i < n) {
    ops.push({ id: `${blockId}-delete-${index}`, type: 'delete', text: leftTokens[i] });
    i += 1;
    index += 1;
  }

  while (j < m) {
    ops.push({ id: `${blockId}-insert-${index}`, type: 'insert', text: rightTokens[j] });
    j += 1;
    index += 1;
  }

  return ops;
}

function splitParagraphs(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function buildComparisonBlocks(baseText: string, currentText: string) {
  const baseParagraphs = splitParagraphs(baseText);
  const currentParagraphs = splitParagraphs(currentText);
  const n = baseParagraphs.length;
  const m = currentParagraphs.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));

  for (let i = n; i >= 0; i -= 1) {
    for (let j = m; j >= 0; j -= 1) {
      if (i === n) {
        dp[i][j] = m - j;
        continue;
      }
      if (j === m) {
        dp[i][j] = n - i;
        continue;
      }

      const replaceCost = substitutionCost(baseParagraphs[i], currentParagraphs[j]) + dp[i + 1][j + 1];
      const deleteCost = 1 + dp[i + 1][j];
      const insertCost = 1 + dp[i][j + 1];
      dp[i][j] = Math.min(replaceCost, deleteCost, insertCost);
    }
  }

  const blocks: ComparisonBlock[] = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    const id = `block-${i}-${j}`;

    if (i === n) {
      blocks.push({
        id,
        type: 'added',
        baseText: '',
        currentText: currentParagraphs[j],
        ops: [{ id: `${id}-insert`, type: 'insert', text: currentParagraphs[j] }]
      });
      j += 1;
      continue;
    }

    if (j === m) {
      blocks.push({
        id,
        type: 'deleted',
        baseText: baseParagraphs[i],
        currentText: '',
        ops: [{ id: `${id}-delete`, type: 'delete', text: baseParagraphs[i] }]
      });
      i += 1;
      continue;
    }

    if (baseParagraphs[i] === currentParagraphs[j] && dp[i][j] === dp[i + 1][j + 1]) {
      blocks.push({
        id,
        type: 'unchanged',
        baseText: baseParagraphs[i],
        currentText: currentParagraphs[j],
        ops: [{ id: `${id}-equal`, type: 'equal', text: currentParagraphs[j] }]
      });
      i += 1;
      j += 1;
      continue;
    }

    const replacePenalty = substitutionCost(baseParagraphs[i], currentParagraphs[j]);
    const replaceCost = replacePenalty + dp[i + 1][j + 1];
    const deleteCost = 1 + dp[i + 1][j];
    const insertCost = 1 + dp[i][j + 1];

    if (replacePenalty === 1 && dp[i][j] === replaceCost && replaceCost <= deleteCost && replaceCost <= insertCost) {
      blocks.push({
        id,
        type: 'modified',
        baseText: baseParagraphs[i],
        currentText: currentParagraphs[j],
        ops: buildInlineDiff(baseParagraphs[i], currentParagraphs[j], id)
      });
      i += 1;
      j += 1;
    } else if (dp[i][j] === deleteCost && deleteCost <= insertCost) {
      blocks.push({
        id,
        type: 'deleted',
        baseText: baseParagraphs[i],
        currentText: '',
        ops: [{ id: `${id}-delete`, type: 'delete', text: baseParagraphs[i] }]
      });
      i += 1;
    } else {
      blocks.push({
        id,
        type: 'added',
        baseText: '',
        currentText: currentParagraphs[j],
        ops: [{ id: `${id}-insert`, type: 'insert', text: currentParagraphs[j] }]
      });
      j += 1;
    }
  }

  return blocks;
}

function applyComparisonAction(
  blocks: ComparisonBlock[],
  targetBlockId: string,
  targetOpId: string | null,
  action: 'restore' | 'remove'
) {
  const paragraphs: string[] = [];

  for (const block of blocks) {
    if (block.type === 'unchanged') {
      paragraphs.push(block.currentText);
      continue;
    }

    if (block.type === 'added') {
      if (!(block.id === targetBlockId && action === 'remove')) {
        paragraphs.push(block.currentText);
      }
      continue;
    }

    if (block.type === 'deleted') {
      if (block.id === targetBlockId && action === 'restore') {
        paragraphs.push(block.baseText);
      }
      continue;
    }

    let paragraph = '';
    for (const op of block.ops) {
      if (op.type === 'equal') {
        paragraph += op.text;
      } else if (op.type === 'insert') {
        if (!(block.id === targetBlockId && op.id === targetOpId && action === 'remove')) {
          paragraph += op.text;
        }
      } else if (op.type === 'delete') {
        if (block.id === targetBlockId && op.id === targetOpId && action === 'restore') {
          paragraph += op.text;
        }
      }
    }

    const cleaned = paragraph.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (cleaned) {
      paragraphs.push(cleaned);
    }
  }

  return paragraphs.join('\n\n');
}

function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function exportFormatExtension(format: ExportFormat) {
  return format === 'inkline' ? 'inkline' : format;
}

function fileTitleFromName(name: string) {
  const stripped = name.replace(/\.[^.]+$/, '').trim();
  return stripped || DEFAULT_TITLE;
}

function buildWordGoalLabel(words: number, goal: number, display: WordGoalDisplay) {
  const percentage = goal > 0 ? Math.round((words / goal) * 100) : 0;

  if (display === 'percentage') {
    return `${percentage}% of ${goal.toLocaleString()}`;
  }

  if (display === 'bar') {
    return `${words.toLocaleString()} / ${goal.toLocaleString()}`;
  }

  return `${words.toLocaleString()} / ${goal.toLocaleString()} (${percentage}%)`;
}

function downloadTextFile(name: string, content: string, format: ExportFormat) {
  const blob = new Blob([content], { type: format === 'txt' ? 'text/plain' : 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.${exportFormatExtension(format)}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function EditorToolbarButton({
  label,
  onClick,
  active = false
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button type="button" className={`toolbar-button${active ? ' active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      {label}
    </button>
  );
}

function SettingRow({
  label,
  description,
  stacked = false,
  children
}: {
  label: string;
  description?: string;
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`setting-row${stacked ? ' stacked' : ''}`}>
      <div className="setting-copy">
        <div className="setting-label">{label}</div>
        {description ? <div className="setting-description">{description}</div> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={`toggle${checked ? ' checked' : ''}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-thumb" />
      {label ? <span>{label}</span> : null}
    </button>
  );
}

function NumberStepper({
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(value - step, min, max))}>
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(clamp(Number(event.target.value || value), min, max))}
      />
      <button type="button" onClick={() => onChange(clamp(value + step, min, max))}>
        +
      </button>
    </div>
  );
}

export function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('ready');
  const [mode, setMode] = useState<AppMode>('writing');
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [documentMeta, setDocumentMeta] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [documentHtml, setDocumentHtml] = useState('');
  const [timeline, setTimeline] = useState<SavePoint[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('General');
  const [saveSnapshotOpen, setSaveSnapshotOpen] = useState(false);
  const [snapshotNameDraft, setSnapshotNameDraft] = useState('');
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [comparisonSnapshotId, setComparisonSnapshotId] = useState<string | null>(null);
  const [selectedSnapshotPreview, setSelectedSnapshotPreview] = useState<SnapshotPreview | null>(null);
  const [syncScroll, setSyncScroll] = useState(false);
  const [toolbar, setToolbar] = useState<ToolbarState>({ visible: false, top: 0, left: 0 });
  const [toolbarFontStep, setToolbarFontStep] = useState(3);
  const [activeParagraphElement, setActiveParagraphElement] = useState<HTMLElement | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());

  const editorRef = useRef<HTMLDivElement | null>(null);
  const leftPaneRef = useRef<HTMLDivElement | null>(null);
  const previewPaneRef = useRef<HTMLDivElement | null>(null);
  const saveSnapshotInputRef = useRef<HTMLInputElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const syncScrollGuardRef = useRef(false);
  const snapshotCacheRef = useRef<Record<string, SnapshotPreview>>({});
  const lastSavedDocumentRef = useRef('');
  const lastSavedSettingsRef = useRef(JSON.stringify(DEFAULT_SETTINGS));
  const lastRenamedTitleRef = useRef(DEFAULT_TITLE);
  const lastSnapshotTextRef = useRef('');

  const currentPlainText = useMemo(() => htmlToText(documentHtml), [documentHtml]);
  const wordCount = useMemo(() => countWords(currentPlainText), [currentPlainText]);
  const characterCount = useMemo(() => countCharacters(currentPlainText), [currentPlainText]);
  const paragraphCount = useMemo(() => countParagraphs(currentPlainText), [currentPlainText]);
  const latestSnapshot = useMemo(() => timeline[timeline.length - 1] ?? null, [timeline]);
  const visibleTimeline = useMemo(
    () => timeline.filter((snapshot) => !settings.hiddenSnapshotHashes.includes(snapshot.hash)),
    [settings.hiddenSnapshotHashes, timeline]
  );
  const selectedSnapshot = useMemo(
    () => visibleTimeline.find((snapshot) => snapshot.hash === selectedSnapshotId) ?? null,
    [selectedSnapshotId, visibleTimeline]
  );
  const comparisonSnapshot = useMemo(
    () => visibleTimeline.find((snapshot) => snapshot.hash === comparisonSnapshotId) ?? null,
    [comparisonSnapshotId, visibleTimeline]
  );
  const comparisonBlocks = useMemo(
    () =>
      comparisonSnapshot
        ? buildComparisonBlocks(
            snapshotCacheRef.current[comparisonSnapshot.hash]?.text || selectedSnapshotPreview?.text || '',
            currentPlainText
          )
        : [],
    [comparisonSnapshot, currentPlainText, selectedSnapshotPreview?.text]
  );

  const statusIsCurrent = currentPlainText === lastSnapshotTextRef.current;
  const snapshotCount = visibleTimeline.length;
  const goalProgress =
    settings.showWordGoal && settings.wordGoalTarget > 0
      ? Math.min(100, Math.round((wordCount / settings.wordGoalTarget) * 100))
      : 0;

  const shellTheme = settings.followSystemTheme ? 'light' : settings.appTheme;
  const appStyle = {
    '--canvas-width': `${pageWidthToPixels(settings.canvasWidth)}px`,
    '--canvas-font': settings.dyslexiaFriendlyFont ? '"OpenDyslexic", Georgia, serif' : `"${settings.defaultFont}", serif`,
    '--canvas-font-size': `${settings.defaultFontSize}px`,
    '--canvas-line-height': String(currentLineSpacing(settings)),
    '--paragraph-spacing': `${settings.paragraphSpacing}px`,
    '--font-scale': `${settings.fontScaling / 100}`,
    '--deletion-color': settings.deletionColor,
    '--addition-color': settings.additionColor,
    '--diff-alpha': `${settings.diffHighlightOpacity / 100}`,
    '--motion-scale': `${animationMultiplier(settings)}`
  } as CSSProperties;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);

        const [projects, incomingSettings, storageOverview] = await Promise.all([
          api.listProjects(),
          api.getSettings().catch(() => DEFAULT_SETTINGS),
          api.getStorageOverview().catch(() => null)
        ]);

        if (cancelled) return;

        const nextSettings = normalizeSettings(incomingSettings);
        setSettings(nextSettings);
        lastSavedSettingsRef.current = JSON.stringify(nextSettings);
        setStorage(storageOverview);

        const activeProject = projects[0] ?? (await api.createProject(DEFAULT_TITLE));
        if (cancelled) return;

        await openProject(activeProject, nextSettings);
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 5200);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.innerHTML === documentHtml) return;
    editor.innerHTML = documentHtml;
  }, [documentHtml]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    Array.from(editor.children).forEach((child) => {
      child.classList.toggle('active-focus', child === activeParagraphElement);
    });

    if (settings.typewriterScrolling && activeParagraphElement && leftPaneRef.current) {
      const pane = leftPaneRef.current;
      const paneRect = pane.getBoundingClientRect();
      const targetRect = activeParagraphElement.getBoundingClientRect();
      const delta = targetRect.top - (paneRect.top + paneRect.height / 2) + targetRect.height / 2;
      pane.scrollBy({ top: delta, behavior: settings.reduceMotion ? 'auto' : 'smooth' });
    }
  }, [activeParagraphElement, documentHtml, settings.reduceMotion, settings.typewriterScrolling]);

  useEffect(() => {
    const serialized = JSON.stringify(settings);
    if (serialized === lastSavedSettingsRef.current) return;

    const timer = window.setTimeout(() => {
      void api
        .updateSettings(settings)
        .then(() => {
          lastSavedSettingsRef.current = serialized;
        })
        .catch((err) => setError(`Settings could not be saved: ${String(err)}`));
    }, 200);

    return () => window.clearTimeout(timer);
  }, [settings]);

  useEffect(() => {
    if (!project) return;

    const nextDocument = composeDocument(documentMeta, title, documentHtml);
    if (nextDocument === lastSavedDocumentRef.current) return;

    const timer = window.setTimeout(() => {
      void flushDocumentSave();
    }, 450);

    return () => window.clearTimeout(timer);
  }, [documentHtml, documentMeta, project, title]);

  useEffect(() => {
    if (!project) return;

    const nextTitle = title.trim() || DEFAULT_TITLE;
    if (nextTitle === lastRenamedTitleRef.current) return;

    const timer = window.setTimeout(() => {
      void api
        .renameProject(project.id, nextTitle)
        .then(() => {
          setProject((current) => (current ? { ...current, title: nextTitle, modified: new Date().toISOString() } : current));
          lastRenamedTitleRef.current = nextTitle;
        })
        .catch((err) => setError(`Title update failed: ${String(err)}`));
    }, 200);

    return () => window.clearTimeout(timer);
  }, [project, title]);

  useEffect(() => {
    if (!saveSnapshotOpen) return;
    const timer = window.setTimeout(() => saveSnapshotInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [saveSnapshotOpen]);

  useEffect(() => {
    function handleSelectionChange() {
      if (mode === 'comparison' || settingsOpen || saveSnapshotOpen) {
        setToolbar((current) => ({ ...current, visible: false }));
        return;
      }

      const selection = window.getSelection();
      const editor = editorRef.current;

      if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !editor) {
        setToolbar((current) => ({ ...current, visible: false }));
        return;
      }

      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) {
        setToolbar((current) => ({ ...current, visible: false }));
        return;
      }

      const rect = range.getBoundingClientRect();
      setToolbar({
        visible: true,
        top: rect.top + window.scrollY - 50,
        left: rect.left + window.scrollX + rect.width / 2
      });
      updateActiveParagraph();
    }

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, [mode, saveSnapshotOpen, settingsOpen]);

  useEffect(() => {
    if (!syncScroll) return;

    const left = leftPaneRef.current;
    const right = previewPaneRef.current;
    if (!left || !right) return;

    function sync(from: HTMLDivElement, to: HTMLDivElement) {
      if (syncScrollGuardRef.current) return;
      syncScrollGuardRef.current = true;
      const ratio = from.scrollHeight <= from.clientHeight ? 0 : from.scrollTop / (from.scrollHeight - from.clientHeight);
      to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight);
      window.requestAnimationFrame(() => {
        syncScrollGuardRef.current = false;
      });
    }

    const onLeft = () => sync(left, right);
    const onRight = () => sync(right, left);
    left.addEventListener('scroll', onLeft);
    right.addEventListener('scroll', onRight);

    return () => {
      left.removeEventListener('scroll', onLeft);
      right.removeEventListener('scroll', onRight);
    };
  }, [syncScroll, selectedSnapshotId]);

  useEffect(() => {
    if (!settings.maximumSnapshotsEnabled || settings.snapshotLimitBehavior !== 'deleteOldestAuto') return;

    const visible = timeline.filter((snapshot) => !settings.hiddenSnapshotHashes.includes(snapshot.hash));
    if (visible.length <= settings.maximumSnapshots) return;

    const overflow = visible.length - settings.maximumSnapshots;
    const removable = visible.filter(isAutoSnapshot).slice(0, overflow).map((snapshot) => snapshot.hash);
    if (removable.length === 0) return;

    setSettings((current) => ({
      ...current,
      hiddenSnapshotHashes: Array.from(new Set([...current.hiddenSnapshotHashes, ...removable]))
    }));
  }, [
    settings.hiddenSnapshotHashes,
    settings.maximumSnapshots,
    settings.maximumSnapshotsEnabled,
    settings.snapshotLimitBehavior,
    timeline
  ]);

  useEffect(() => {
    const retention = settings.keepSnapshotsFor;
    if (retention === 'forever') return;

    const days = retention === 'custom' ? settings.customRetentionDays : RETENTION_TO_DAYS[retention];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const expired = timeline
      .filter((snapshot) => new Date(snapshot.timestamp).getTime() < cutoff)
      .map((snapshot) => snapshot.hash)
      .filter((hash) => !settings.hiddenSnapshotHashes.includes(hash));

    if (expired.length === 0) return;

    setSettings((current) => ({
      ...current,
      hiddenSnapshotHashes: Array.from(new Set([...current.hiddenSnapshotHashes, ...expired]))
    }));
  }, [settings.customRetentionDays, settings.hiddenSnapshotHashes, settings.keepSnapshotsFor, timeline]);

  useEffect(() => {
    if (!project || !settings.autoSnapshotsEnabled) return;
    if (currentPlainText.trim().length === 0) return;
    if (settings.snapshotOnlyWhenChangesExist && currentPlainText === lastSnapshotTextRef.current) return;

    const timer = window.setTimeout(() => {
      void createSnapshot(settings.autoSnapshotNaming ? autoSnapshotLabel() : '', 'auto');
    }, getAutoSnapshotMinutes(settings) * 60 * 1000);

    return () => window.clearTimeout(timer);
  }, [
    currentPlainText,
    project,
    settings.autoSnapshotNaming,
    settings.autoSnapshotCustomMinutes,
    settings.autoSnapshotFrequency,
    settings.autoSnapshotsEnabled,
    settings.snapshotOnlyWhenChangesExist
  ]);

  useEffect(() => {
    if (!selectedSnapshotId || snapshotCount === 0) return;
    if (!visibleTimeline.some((snapshot) => snapshot.hash === selectedSnapshotId)) {
      const replacement = visibleTimeline[visibleTimeline.length - 1]?.hash ?? null;
      setSelectedSnapshotId(replacement);
      setComparisonSnapshotId(replacement);
    }
  }, [selectedSnapshotId, snapshotCount, visibleTimeline]);

  async function openProject(nextProject: ProjectMeta, incomingSettings = settings) {
    const [rawDocument, savePoints, backupEntries] = await Promise.all([
      api.loadDocument(nextProject.id),
      api.getTimeline(nextProject.id),
      api.listBackups(nextProject.id).catch(() => []),
      api.getStorageOverview().catch(() => null)
    ]).then(([raw, timelineData, backupData, storageOverview]) => {
      setStorage(storageOverview);
      return [raw, timelineData, backupData] as const;
    });

    const parsed = parseDocument(rawDocument);
    const nextHtml = normalizeStoredHtml(parsed.body);
    const nextPlainText = htmlToText(nextHtml);

    setProject(nextProject);
    setDocumentMeta(parsed.meta);
    setTitle(parsed.meta.title || nextProject.title || DEFAULT_TITLE);
    setDocumentHtml(nextHtml);
    setTimeline(savePoints);
    setBackups(backupEntries);
    setMode('writing');
    setSelectedSnapshotId(savePoints[savePoints.length - 1]?.hash ?? null);
    setComparisonSnapshotId(savePoints[savePoints.length - 1]?.hash ?? null);
    setSelectedSnapshotPreview(null);
    snapshotCacheRef.current = {};
    lastSavedDocumentRef.current = rawDocument;
    lastRenamedTitleRef.current = parsed.meta.title || nextProject.title || DEFAULT_TITLE;
    lastSnapshotTextRef.current = nextPlainText;

    const latest = savePoints[savePoints.length - 1];
    if (latest) {
      await loadSnapshotPreview(latest.hash);
      lastSnapshotTextRef.current = snapshotCacheRef.current[latest.hash]?.text || nextPlainText;
    } else {
      lastSnapshotTextRef.current = nextPlainText;
    }

    const normalized = normalizeSettings(incomingSettings);
    if (normalized.defaultPageWidth !== normalized.canvasWidth) {
      setSettings((current) => ({ ...current, canvasWidth: current.defaultPageWidth }));
    }
  }

  async function flushDocumentSave() {
    if (!project) return;

    const nextDocument = composeDocument(documentMeta, title, documentHtml);
    if (nextDocument === lastSavedDocumentRef.current) return;

    try {
      setSaveState('saving');
      await api.saveDocument(project.id, nextDocument);
      lastSavedDocumentRef.current = nextDocument;
      setSaveState('saved');
      setProject((current) => (current ? { ...current, modified: new Date().toISOString() } : current));
    } catch (err) {
      setSaveState('error');
      setError(`Document could not be saved: ${String(err)}`);
    }
  }

  async function loadSnapshotPreview(hash: string) {
    if (!project) return null;
    if (snapshotCacheRef.current[hash]) {
      setSelectedSnapshotPreview(snapshotCacheRef.current[hash]);
      return snapshotCacheRef.current[hash];
    }

    const raw = await api.getDocumentAtSavePoint(project.id, hash);
    const parsed = parseDocument(raw);
    const html = normalizeStoredHtml(parsed.body);
    const preview = {
      raw,
      html,
      text: htmlToText(html)
    };

    snapshotCacheRef.current[hash] = preview;
    setSelectedSnapshotPreview(preview);
    return preview;
  }

  async function selectSnapshot(hash: string) {
    setSelectedSnapshotId(hash);
    setComparisonSnapshotId(hash);
    await loadSnapshotPreview(hash);
  }

  async function createSnapshot(name: string, kind: SnapshotKind) {
    if (!project) return;

    await flushDocumentSave();

    try {
      const label = kind === 'auto' ? name || autoSnapshotLabel() : manualSnapshotLabel(name);
      const created = await api.createSavePoint(project.id, label);

      snapshotCacheRef.current[created.hash] = {
        raw: composeDocument(documentMeta, title, documentHtml),
        html: documentHtml,
        text: currentPlainText
      };

      const nextTimeline = [...timeline, created];
      setTimeline(nextTimeline);
      setSelectedSnapshotId(created.hash);
      setComparisonSnapshotId(created.hash);
      setSelectedSnapshotPreview(snapshotCacheRef.current[created.hash]);
      lastSnapshotTextRef.current = currentPlainText;

      if (kind === 'manual') {
        setMode('edit');
        setNotice(`Snapshot saved as "${label}".`);
      }
    } catch (err) {
      setError(`Snapshot could not be created: ${String(err)}`);
    }
  }

  function updateEditorFromDom() {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = normalizeEditorHtml(editor.innerHTML);
    setDocumentHtml(nextHtml);
    updateActiveParagraph();
  }

  function updateActiveParagraph() {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!selection || !editor || selection.rangeCount === 0) {
      setActiveParagraphElement(null);
      return;
    }

    const node = selection.anchorNode;
    if (!node || !editor.contains(node)) {
      setActiveParagraphElement(null);
      return;
    }

    const element = node instanceof HTMLElement ? node : node.parentElement;
    const paragraph = element?.closest('p, div, li, blockquote') as HTMLElement | null;
    setActiveParagraphElement(paragraph ?? null);
  }

  function applyEditorCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    updateEditorFromDom();
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      applyEditorCommand('bold');
    }

    if (modifier && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      applyEditorCommand('italic');
    }

    if (modifier && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      applyEditorCommand('underline');
    }

    if (settings.smartQuotes && event.key === '"') {
      event.preventDefault();
      document.execCommand('insertText', false, '“');
      updateEditorFromDom();
    }

    if (settings.autoCapitalizeSentences && /^[a-z]$/.test(event.key)) {
      const selection = window.getSelection();
      const text = currentPlainText;
      if (selection && selection.anchorOffset === 0 && (!text || /[.!?]\s*$/.test(text))) {
        event.preventDefault();
        document.execCommand('insertText', false, event.key.toUpperCase());
        updateEditorFromDom();
      }
    }
  }

  function handleEditorPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (!settings.pastePlainTextByDefault) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    updateEditorFromDom();
  }

  function handleEnterComparisonMode() {
    if (!selectedSnapshotId) return;
    setComparisonSnapshotId(selectedSnapshotId);
    setMode('comparison');
  }

  function handleChangesButton() {
    if (mode === 'comparison') {
      setMode('writing');
      return;
    }

    if (mode === 'edit') {
      setMode('writing');
      return;
    }

    setMode('edit');
  }

  function handleComparisonAction(blockId: string, opId: string | null, action: 'restore' | 'remove') {
    const nextText = applyComparisonAction(comparisonBlocks, blockId, opId, action);
    const nextHtml = textToHtml(nextText);
    setDocumentHtml(nextHtml);
    setMode('writing');
    setNotice(action === 'restore' ? 'Previous wording restored into the document.' : 'Selected wording removed.');
  }

  function handleExportCurrent(format: ExportFormat) {
    if (!project) return;

    if (format === 'pdf') {
      window.print();
      return;
    }

    void flushDocumentSave()
      .then(() => api.exportProject(project.id, format))
      .then((exported) => setNotice(`Exported ${exported.format.toUpperCase()} to ${exported.path}`))
      .catch((err) => setError(`Export failed: ${String(err)}`));
  }

  async function handleExportSnapshot() {
    const targetId = selectedSnapshotId ?? comparisonSnapshotId;
    if (!targetId || !project) {
      setNotice('Select a snapshot from the Changes panel first.');
      return;
    }

    const preview = await loadSnapshotPreview(targetId);
    if (!preview) return;

    downloadTextFile((title.trim() || DEFAULT_TITLE).replace(/\s+/g, '-').toLowerCase(), preview.raw, 'inkline');
    setNotice('Snapshot exported as an .inkline file.');
  }

  function handleImportDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    void (async () => {
      try {
        const contents = await file.text();
        const nextTitle = fileTitleFromName(file.name);

        if (settings.importMode === 'newDocument') {
          if (currentPlainText.trim() && !window.confirm('Replace the current document with the imported file?')) {
            return;
          }

          setTitle(nextTitle);
          setDocumentHtml(normalizeStoredHtml(contents));
          setNotice(`Imported ${file.name} into the current document.`);
          return;
        }

        setTitle(nextTitle);
        setDocumentHtml(normalizeStoredHtml(contents));
        await flushDocumentSave();
        await createSnapshot(`Imported — ${file.name}`, 'manual');
      } catch (err) {
        setError(`Import failed: ${String(err)}`);
      } finally {
        event.target.value = '';
      }
    })();
  }

  function handleDeleteAutoSnapshots() {
    const autoHashes = visibleTimeline.filter(isAutoSnapshot).map((snapshot) => snapshot.hash);
    if (autoHashes.length === 0) {
      setNotice('There are no automatic snapshots to clear.');
      return;
    }

    if (!window.confirm('Hide all automatic snapshots from the timeline?')) {
      return;
    }

    setSettings((current) => ({
      ...current,
      hiddenSnapshotHashes: Array.from(new Set([...current.hiddenSnapshotHashes, ...autoHashes]))
    }));
  }

  function handleNavigateComparison(direction: 1 | -1) {
    if (!comparisonSnapshotId) return;

    const currentIndex = visibleTimeline.findIndex((snapshot) => snapshot.hash === comparisonSnapshotId);
    if (currentIndex === -1) return;

    const nextSnapshot = visibleTimeline[currentIndex + direction];
    if (!nextSnapshot) return;

    void selectSnapshot(nextSnapshot.hash).then(() => {
      setComparisonSnapshotId(nextSnapshot.hash);
    });
  }

  function applyThemeSelection(value: AppSettings['appTheme']) {
    setSettings((current) => ({ ...current, appTheme: value }));
  }

  const selectedSnapshotIndex = selectedSnapshotId
    ? visibleTimeline.findIndex((snapshot) => snapshot.hash === selectedSnapshotId)
    : -1;

  const comparisonSnapshotIndex = comparisonSnapshotId
    ? visibleTimeline.findIndex((snapshot) => snapshot.hash === comparisonSnapshotId)
    : -1;

  const snapshotStorageBytes = visibleTimeline.reduce((total, snapshot) => {
    const preview = snapshotCacheRef.current[snapshot.hash];
    return total + (preview?.raw.length ?? snapshot.message.length);
  }, 0);

  const statusSegments = [
    settings.showWordCount ? `${wordCount.toLocaleString()} words` : null,
    settings.showCharacterCount ? `${characterCount.toLocaleString()} characters` : null,
    settings.showParagraphCount ? `${paragraphCount.toLocaleString()} paragraphs` : null,
    settings.showReadingTime ? readingTime(wordCount) : null,
    settings.showWordGoal ? buildWordGoalLabel(wordCount, settings.wordGoalTarget, settings.wordGoalDisplay) : null
  ].filter(Boolean) as string[];

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <span>{BRAND_NAME}</span>
          <h1>Loading your writing surface</h1>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`inkline-shell theme-${shellTheme} mode-${mode}${settings.highContrastMode ? ' high-contrast' : ''}`}
      style={appStyle}
    >
      <input
        ref={importInputRef}
        hidden
        type="file"
        accept=".txt,.md,.markdown,.inkline,.html"
        onChange={handleImportDocument}
      />

      <header className="top-bar">
        <div className="top-bar-left">
          <div className="brand-wordmark">{BRAND_NAME}</div>
          <div className="top-bar-divider" />
          <input
            className="document-title-input"
            value={title}
            maxLength={80}
            placeholder={DEFAULT_TITLE}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={handleTitleKeyDown}
          />
        </div>

        <div className="top-bar-right">
          <button type="button" className="ghost-action" onClick={() => setSaveSnapshotOpen(true)}>
            <span className="icon-only">◉</span>
            <span className="responsive-label">Save Snapshot</span>
          </button>
          <button type="button" className="primary-action" onClick={handleChangesButton}>
            Changes
            {snapshotCount > 0 ? <span className="snapshot-badge">{snapshotCount}</span> : null}
          </button>
          <div className="top-bar-divider" />
          <button type="button" className="icon-action" aria-label="Open settings" onClick={() => setSettingsOpen(true)}>
            ⚙
          </button>
        </div>
      </header>

      {notice ? <div className="toast-banner">{notice}</div> : null}
      {error ? <div className="toast-banner error">{error}</div> : null}

      <main className="workspace">
        <section className="canvas-stage">
          <div className="canvas-pane" ref={leftPaneRef}>
            {mode === 'comparison' && comparisonSnapshot ? (
              <div className="comparison-banner">
                <span>
                  Comparing with: "{comparisonSnapshot.message}" — {formatDateTime(comparisonSnapshot.timestamp)}
                </span>
                <button type="button" onClick={() => setMode('writing')}>
                  Exit
                </button>
              </div>
            ) : null}

            {settings.showPageRuler ? (
              <div className="page-ruler">
                {Array.from({ length: 16 }).map((_, index) => (
                  <span key={index} className={index % 4 === 0 ? 'major' : ''} />
                ))}
              </div>
            ) : null}

            <div
              className={`canvas-paper${settings.canvasShadow ? ' with-shadow' : ''}${mode === 'comparison' ? ' comparison-paper' : ''}`}
            >
              {mode === 'comparison' && comparisonSnapshot ? (
                <div className={`comparison-document${mode === 'comparison' ? ' visible' : ''}`}>
                  {comparisonBlocks.length === 0 ? <p className="empty-comparison">No changes to compare yet.</p> : null}
                  {comparisonBlocks.map((block) => (
                    <p key={block.id} className={`comparison-paragraph block-${block.type}`}>
                      {block.type === 'added' ? (
                        <span className="token added-token token-run">
                          {block.currentText}
                          <button type="button" className="token-action remove" onClick={() => handleComparisonAction(block.id, null, 'remove')}>
                            Remove
                          </button>
                        </span>
                      ) : block.type === 'deleted' ? (
                        <span className="token deleted-token token-run">
                          {block.baseText}
                          <button type="button" className="token-action restore" onClick={() => handleComparisonAction(block.id, null, 'restore')}>
                            Restore
                          </button>
                        </span>
                      ) : block.type === 'unchanged' ? (
                        <span>{block.currentText}</span>
                      ) : (
                        block.ops.map((op) =>
                          op.type === 'equal' ? (
                            <span key={op.id}>{op.text}</span>
                          ) : (
                            <span
                              key={op.id}
                              className={`token token-run ${op.type === 'insert' ? 'added-token' : 'deleted-token'}`}
                            >
                              {op.text}
                              <button
                                type="button"
                                className={`token-action ${op.type === 'insert' ? 'remove' : 'restore'}`}
                                onClick={() => handleComparisonAction(block.id, op.id, op.type === 'insert' ? 'remove' : 'restore')}
                              >
                                {op.type === 'insert' ? 'Remove' : 'Restore'}
                              </button>
                            </span>
                          )
                        )
                      )}
                    </p>
                  ))}
                </div>
              ) : (
                <div
                  ref={editorRef}
                  className={`editor-body align-${settings.defaultTextAlignment}${settings.showFormattingMarks ? ' show-formatting-marks' : ''}${settings.focusMode ? ' focus-mode' : ''}${settings.highlightCurrentLine || settings.lineFocusHighlight ? ' highlight-current-line' : ''}${settings.cursorBlink ? '' : ' no-cursor-blink'}`}
                  contentEditable
                  spellCheck={settings.spellCheck}
                  suppressContentEditableWarning
                  data-placeholder="Start writing here…"
                  data-empty={!currentPlainText}
                  onInput={updateEditorFromDom}
                  onKeyDown={handleEditorKeyDown}
                  onPaste={handleEditorPaste}
                  onClick={updateActiveParagraph}
                  onKeyUp={updateActiveParagraph}
                  style={{
                    textAlign: settings.defaultTextAlignment,
                    paddingBottom: settings.paragraphIndentStyle === 'block' ? 80 : 80
                  }}
                />
              )}
            </div>
          </div>

          <aside className="snapshot-panel">
            <div className="snapshot-panel-header">
              <button type="button" className="plain-header-action" onClick={() => setMode('writing')}>
                × Close
              </button>
              <button type="button" className="comparison-action" disabled={!selectedSnapshotId} onClick={handleEnterComparisonMode}>
                Comparison Mode
              </button>
            </div>

            <div className="snapshot-panel-body">
              <div className="timeline-strip">
                <button
                  type="button"
                  className="timeline-nav"
                  onClick={() => selectedSnapshotIndex >= 0 && selectSnapshot(visibleTimeline[selectedSnapshotIndex + 1].hash)}
                  disabled={selectedSnapshotIndex >= visibleTimeline.length - 1 || selectedSnapshotIndex === -1}
                >
                  ^
                </button>
                <div className="timeline-track">
                  <div className="timeline-line" />
                  {visibleTimeline.map((snapshot) => {
                    const selected = snapshot.hash === selectedSnapshotId;
                    return (
                      <button
                        key={snapshot.hash}
                        type="button"
                        className={`timeline-dot ${snapshotKind(snapshot)}${selected ? ' selected' : ''}`}
                        data-tooltip={`${snapshot.message}\n${formatDateTime(snapshot.timestamp)}`}
                        onClick={() => void selectSnapshot(snapshot.hash)}
                      />
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="timeline-nav"
                  onClick={() => selectedSnapshotIndex > 0 && selectSnapshot(visibleTimeline[selectedSnapshotIndex - 1].hash)}
                  disabled={selectedSnapshotIndex <= 0}
                >
                  v
                </button>
              </div>

              <div className="snapshot-preview">
                <div className="snapshot-preview-header">
                  <div>
                    {selectedSnapshot
                      ? `${selectedSnapshot.message} — ${formatDateTime(selectedSnapshot.timestamp)}`
                      : 'Select a snapshot from the timeline'}
                  </div>
                  <button type="button" className={`sync-toggle${syncScroll ? ' on' : ''}`} onClick={() => setSyncScroll((value) => !value)}>
                    Sync scroll
                  </button>
                </div>

                <div className="snapshot-preview-body" ref={previewPaneRef}>
                  {selectedSnapshotPreview ? (
                    <div className={`canvas-paper preview-paper${settings.canvasShadow ? ' with-shadow' : ''}`}>
                      <div
                        className={`preview-document align-${settings.defaultTextAlignment}`}
                        dangerouslySetInnerHTML={{ __html: selectedSnapshotPreview.html }}
                      />
                    </div>
                  ) : (
                    <div className="snapshot-preview-empty">Select a snapshot from the timeline</div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </section>
      </main>

      {toolbar.visible ? (
        <div className="floating-toolbar" style={{ top: toolbar.top, left: toolbar.left }}>
          <EditorToolbarButton label="B" onClick={() => applyEditorCommand('bold')} />
          <EditorToolbarButton label="I" onClick={() => applyEditorCommand('italic')} />
          <EditorToolbarButton label="U" onClick={() => applyEditorCommand('underline')} />
          <EditorToolbarButton label="S" onClick={() => applyEditorCommand('strikeThrough')} />
          <span className="toolbar-divider" />
          <EditorToolbarButton label="L" onClick={() => applyEditorCommand('justifyLeft')} />
          <EditorToolbarButton label="C" onClick={() => applyEditorCommand('justifyCenter')} />
          <EditorToolbarButton label="R" onClick={() => applyEditorCommand('justifyRight')} />
          <span className="toolbar-divider" />
          <EditorToolbarButton
            label="A−"
            onClick={() => {
              const next = clamp(toolbarFontStep - 1, 1, 7);
              setToolbarFontStep(next);
              applyEditorCommand('fontSize', String(next));
            }}
          />
          <EditorToolbarButton
            label="A+"
            onClick={() => {
              const next = clamp(toolbarFontStep + 1, 1, 7);
              setToolbarFontStep(next);
              applyEditorCommand('fontSize', String(next));
            }}
          />
          <span className="toolbar-divider" />
          <div className="toolbar-swatch-row">
            {['#FDE68A', '#BFDBFE', '#DDD6FE'].map((color) => (
              <button
                key={color}
                type="button"
                className="swatch-button"
                style={{ background: color }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyEditorCommand('hiliteColor', color)}
              />
            ))}
          </div>
          <span className="toolbar-caret" />
        </div>
      ) : null}

      {mode === 'comparison' && comparisonSnapshot ? (
        <div className="comparison-nav">
          <button type="button" disabled={comparisonSnapshotIndex >= visibleTimeline.length - 1} onClick={() => handleNavigateComparison(1)}>
            ^ Newer
          </button>
          <span>
            {comparisonSnapshot.message} — {formatDateTime(comparisonSnapshot.timestamp)}
          </span>
          <button type="button" disabled={comparisonSnapshotIndex <= 0} onClick={() => handleNavigateComparison(-1)}>
            Older v
          </button>
        </div>
      ) : null}

      <footer className="status-bar">
        <div className="status-left">
          {statusSegments.map((segment) => (
            <span key={segment}>{segment}</span>
          ))}
          {settings.showWordGoal && settings.wordGoalDisplay === 'bar' ? (
            <div className="goal-bar" aria-label={`${goalProgress}% toward the word goal`}>
              <div style={{ width: `${goalProgress}%` }} />
            </div>
          ) : null}
        </div>

        <button type="button" className="status-right" onClick={() => setMode('edit')}>
          <span className={`status-dot ${statusIsCurrent ? 'current' : 'pending'}`} />
          <span>
            {latestSnapshot
              ? `Last snapshot: ${statusIsCurrent ? `"${latestSnapshot.message}"` : formatRelativeTime(latestSnapshot.timestamp, nowTick)}`
              : 'No snapshots yet'}
          </span>
        </button>
      </footer>

      {saveSnapshotOpen ? (
        <div className="modal-overlay" onClick={() => setSaveSnapshotOpen(false)}>
          <div className="snapshot-dialog" onClick={(event) => event.stopPropagation()}>
            <h2>Save Snapshot</h2>
            <label className="modal-field">
              <span>Name this snapshot:</span>
              <input
                ref={saveSnapshotInputRef}
                value={snapshotNameDraft}
                placeholder="e.g. Before the big rewrite"
                onChange={(event) => setSnapshotNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSaveSnapshotOpen(false);
                    setSnapshotNameDraft('');
                  }

                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void createSnapshot(snapshotNameDraft, 'manual').then(() => {
                      setSaveSnapshotOpen(false);
                      setSnapshotNameDraft('');
                    });
                  }
                }}
              />
            </label>
            <p>Leaving it blank will use the current date and time.</p>
            <div className="modal-actions">
              <button type="button" className="outline-button" onClick={() => setSaveSnapshotOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="gradient-button"
                onClick={() =>
                  void createSnapshot(snapshotNameDraft, 'manual').then(() => {
                    setSaveSnapshotOpen(false);
                    setSnapshotNameDraft('');
                  })
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen ? (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-header">
              <h2>Settings</h2>
              <button type="button" className="icon-action dark" onClick={() => setSettingsOpen(false)}>
                ×
              </button>
            </div>

            <div className="settings-body">
              <aside className="settings-sidebar">
                {SETTINGS_CATEGORIES.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`settings-tab${settingsCategory === category ? ' active' : ''}`}
                    onClick={() => setSettingsCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </aside>

              <section className="settings-content">
                {settingsCategory === 'General' ? (
                  <>
                    <h3>Document Defaults</h3>
                    <SettingRow label="Default font" description="Sets the writing surface font.">
                      <select value={settings.defaultFont} onChange={(event) => setSettings((current) => ({ ...current, defaultFont: event.target.value }))}>
                        {FONT_OPTIONS.map((font) => (
                          <option key={font} value={font}>
                            {font}
                          </option>
                        ))}
                      </select>
                    </SettingRow>
                    <SettingRow label="Default font size">
                      <NumberStepper value={settings.defaultFontSize} min={8} max={72} onChange={(value) => setSettings((current) => ({ ...current, defaultFontSize: value }))} />
                    </SettingRow>
                    <SettingRow label="Default line spacing">
                      <select
                        value={settings.defaultLineSpacing}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            defaultLineSpacing: event.target.value as AppSettings['defaultLineSpacing']
                          }))
                        }
                      >
                        <option value="single">Single (1.0)</option>
                        <option value="1.15">1.15</option>
                        <option value="1.5">1.5</option>
                        <option value="double">Double (2.0)</option>
                        <option value="custom">Custom</option>
                      </select>
                    </SettingRow>
                    {settings.defaultLineSpacing === 'custom' ? (
                      <SettingRow label="Custom line spacing">
                        <NumberStepper value={settings.customLineSpacing} min={1} max={3} step={0.05} onChange={(value) => setSettings((current) => ({ ...current, customLineSpacing: value }))} />
                      </SettingRow>
                    ) : null}
                    <SettingRow label="Default text alignment">
                      <div className="segmented-control">
                        {ALIGNMENT_OPTIONS.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            className={settings.defaultTextAlignment === option.value ? 'active' : ''}
                            onClick={() => setSettings((current) => ({ ...current, defaultTextAlignment: option.value }))}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </SettingRow>
                    <SettingRow label="Paragraph spacing">
                      <NumberStepper value={settings.paragraphSpacing} min={0} max={40} onChange={(value) => setSettings((current) => ({ ...current, paragraphSpacing: value }))} />
                    </SettingRow>
                    <SettingRow label="Default page width">
                      <select value={settings.defaultPageWidth} onChange={(event) => setSettings((current) => ({ ...current, defaultPageWidth: event.target.value as PageWidthPreset, canvasWidth: event.target.value as PageWidthPreset }))}>
                        <option value="narrow">Narrow (560px)</option>
                        <option value="medium">Medium (720px)</option>
                        <option value="wide">Wide (900px)</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Language">
                      <select value={settings.language} onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value }))}>
                        {LANGUAGE_OPTIONS.map((language) => (
                          <option key={language} value={language}>
                            {language}
                          </option>
                        ))}
                      </select>
                    </SettingRow>
                    <SettingRow label="Spell check">
                      <Toggle checked={settings.spellCheck} onChange={(checked) => setSettings((current) => ({ ...current, spellCheck: checked }))} />
                    </SettingRow>
                    <SettingRow label="Grammar check">
                      <Toggle checked={settings.grammarCheck} onChange={(checked) => setSettings((current) => ({ ...current, grammarCheck: checked }))} />
                    </SettingRow>
                    <SettingRow label="Auto-correct">
                      <Toggle checked={settings.autoCorrect} onChange={(checked) => setSettings((current) => ({ ...current, autoCorrect: checked }))} />
                    </SettingRow>
                    <SettingRow label="Smart quotes">
                      <Toggle checked={settings.smartQuotes} onChange={(checked) => setSettings((current) => ({ ...current, smartQuotes: checked }))} />
                    </SettingRow>
                    <SettingRow label="Auto-capitalize sentences">
                      <Toggle checked={settings.autoCapitalizeSentences} onChange={(checked) => setSettings((current) => ({ ...current, autoCapitalizeSentences: checked }))} />
                    </SettingRow>
                  </>
                ) : null}

                {settingsCategory === 'Writing' ? (
                  <>
                    <h3>Writing Experience</h3>
                    <SettingRow label="Focus mode">
                      <Toggle checked={settings.focusMode} onChange={(checked) => setSettings((current) => ({ ...current, focusMode: checked }))} />
                    </SettingRow>
                    <SettingRow label="Typewriter scrolling">
                      <Toggle checked={settings.typewriterScrolling} onChange={(checked) => setSettings((current) => ({ ...current, typewriterScrolling: checked }))} />
                    </SettingRow>
                    <SettingRow label="Show formatting marks">
                      <Toggle checked={settings.showFormattingMarks} onChange={(checked) => setSettings((current) => ({ ...current, showFormattingMarks: checked }))} />
                    </SettingRow>
                    <SettingRow label="Word count in status bar">
                      <Toggle checked={settings.showWordCount} onChange={(checked) => setSettings((current) => ({ ...current, showWordCount: checked }))} />
                    </SettingRow>
                    <SettingRow label="Character count in status bar">
                      <Toggle checked={settings.showCharacterCount} onChange={(checked) => setSettings((current) => ({ ...current, showCharacterCount: checked }))} />
                    </SettingRow>
                    <SettingRow label="Paragraph count in status bar">
                      <Toggle checked={settings.showParagraphCount} onChange={(checked) => setSettings((current) => ({ ...current, showParagraphCount: checked }))} />
                    </SettingRow>
                    <SettingRow label="Reading time estimate">
                      <Toggle checked={settings.showReadingTime} onChange={(checked) => setSettings((current) => ({ ...current, showReadingTime: checked }))} />
                    </SettingRow>
                    <SettingRow label="Show word count goal">
                      <Toggle checked={settings.showWordGoal} onChange={(checked) => setSettings((current) => ({ ...current, showWordGoal: checked }))} />
                    </SettingRow>
                    {settings.showWordGoal ? (
                      <>
                        <SettingRow label="Word count goal target">
                          <NumberStepper value={settings.wordGoalTarget} min={1} max={9999999} onChange={(value) => setSettings((current) => ({ ...current, wordGoalTarget: value }))} />
                        </SettingRow>
                        <SettingRow label="Word count goal progress">
                          <select value={settings.wordGoalDisplay} onChange={(event) => setSettings((current) => ({ ...current, wordGoalDisplay: event.target.value as WordGoalDisplay }))}>
                            <option value="bar">Bar in status bar</option>
                            <option value="percentage">Percentage</option>
                            <option value="fraction">Fraction</option>
                          </select>
                        </SettingRow>
                      </>
                    ) : null}
                    <SettingRow label="Highlight current line">
                      <Toggle checked={settings.highlightCurrentLine} onChange={(checked) => setSettings((current) => ({ ...current, highlightCurrentLine: checked }))} />
                    </SettingRow>
                    <SettingRow label="Cursor style">
                      <select value={settings.cursorStyle} onChange={(event) => setSettings((current) => ({ ...current, cursorStyle: event.target.value as AppSettings['cursorStyle'] }))}>
                        <option value="line">Line</option>
                        <option value="block">Block</option>
                        <option value="underline">Underline</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Cursor blink">
                      <Toggle checked={settings.cursorBlink} onChange={(checked) => setSettings((current) => ({ ...current, cursorBlink: checked }))} />
                    </SettingRow>
                    <SettingRow label="Double-click selects word">
                      <Toggle checked={settings.doubleClickSelectsWord} onChange={(checked) => setSettings((current) => ({ ...current, doubleClickSelectsWord: checked }))} />
                    </SettingRow>
                    <SettingRow label="Triple-click selects paragraph">
                      <Toggle checked={settings.tripleClickSelectsParagraph} onChange={(checked) => setSettings((current) => ({ ...current, tripleClickSelectsParagraph: checked }))} />
                    </SettingRow>
                    <SettingRow label="Paste as plain text by default">
                      <Toggle checked={settings.pastePlainTextByDefault} onChange={(checked) => setSettings((current) => ({ ...current, pastePlainTextByDefault: checked }))} />
                    </SettingRow>
                  </>
                ) : null}

                {settingsCategory === 'Snapshots' ? (
                  <>
                    <h3>Auto-Snapshots</h3>
                    <SettingRow label="Enable auto-snapshots">
                      <Toggle checked={settings.autoSnapshotsEnabled} onChange={(checked) => setSettings((current) => ({ ...current, autoSnapshotsEnabled: checked }))} />
                    </SettingRow>
                    <SettingRow label="Auto-snapshot frequency">
                      <div className="radio-grid">
                        {[
                          ['1m', 'Every 1 minute'],
                          ['5m', 'Every 5 minutes'],
                          ['15m', 'Every 15 minutes'],
                          ['30m', 'Every 30 minutes'],
                          ['1h', 'Every hour'],
                          ['custom', 'Custom']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={settings.autoSnapshotFrequency === value ? 'active' : ''}
                            onClick={() => setSettings((current) => ({ ...current, autoSnapshotFrequency: value as AutoSnapshotFrequency }))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </SettingRow>
                    {settings.autoSnapshotFrequency === 'custom' ? (
                      <SettingRow label="Custom frequency input">
                        <NumberStepper value={settings.autoSnapshotCustomMinutes} min={1} max={1440} onChange={(value) => setSettings((current) => ({ ...current, autoSnapshotCustomMinutes: value }))} />
                      </SettingRow>
                    ) : null}
                    <SettingRow label="Only snapshot when changes exist">
                      <Toggle checked={settings.snapshotOnlyWhenChangesExist} onChange={(checked) => setSettings((current) => ({ ...current, snapshotOnlyWhenChangesExist: checked }))} />
                    </SettingRow>
                    <SettingRow label="Auto-snapshot naming">
                      <Toggle checked={settings.autoSnapshotNaming} onChange={(checked) => setSettings((current) => ({ ...current, autoSnapshotNaming: checked }))} />
                    </SettingRow>

                    <h3>Snapshot History</h3>
                    <SettingRow label="Keep snapshots for">
                      <div className="radio-grid">
                        {[
                          ['forever', 'Forever'],
                          ['7d', '7 days'],
                          ['30d', '30 days'],
                          ['90d', '90 days'],
                          ['1y', '1 year'],
                          ['custom', 'Custom']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={settings.keepSnapshotsFor === value ? 'active' : ''}
                            onClick={() => setSettings((current) => ({ ...current, keepSnapshotsFor: value as SnapshotRetention }))}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </SettingRow>
                    {settings.keepSnapshotsFor === 'custom' ? (
                      <SettingRow label="Custom retention input">
                        <NumberStepper value={settings.customRetentionDays} min={1} max={3650} onChange={(value) => setSettings((current) => ({ ...current, customRetentionDays: value }))} />
                      </SettingRow>
                    ) : null}
                    <SettingRow label="Maximum number of snapshots">
                      <div className="inline-controls">
                        <Toggle checked={settings.maximumSnapshotsEnabled} onChange={(checked) => setSettings((current) => ({ ...current, maximumSnapshotsEnabled: checked }))} />
                        {settings.maximumSnapshotsEnabled ? (
                          <NumberStepper value={settings.maximumSnapshots} min={1} max={10000} onChange={(value) => setSettings((current) => ({ ...current, maximumSnapshots: value }))} />
                        ) : null}
                      </div>
                    </SettingRow>
                    <SettingRow label="When limit is reached">
                      <div className="segmented-control">
                        <button
                          type="button"
                          className={settings.snapshotLimitBehavior === 'deleteOldestAuto' ? 'active' : ''}
                          onClick={() => setSettings((current) => ({ ...current, snapshotLimitBehavior: 'deleteOldestAuto' }))}
                        >
                          Delete oldest auto-snapshots first
                        </button>
                        <button
                          type="button"
                          className={settings.snapshotLimitBehavior === 'prompt' ? 'active' : ''}
                          onClick={() => setSettings((current) => ({ ...current, snapshotLimitBehavior: 'prompt' }))}
                        >
                          Prompt me
                        </button>
                      </div>
                    </SettingRow>
                    <SettingRow label="Storage used by snapshots">
                      <div className="readonly-value">Snapshots are using {bytesLabel(snapshotStorageBytes)}</div>
                    </SettingRow>
                    <SettingRow label="Delete all auto-snapshots">
                      <button type="button" className="outline-button" onClick={handleDeleteAutoSnapshots}>
                        Clear automatic history
                      </button>
                    </SettingRow>
                  </>
                ) : null}

                {settingsCategory === 'Appearance' ? (
                  <>
                    <h3>Theme</h3>
                    <SettingRow label="App theme">
                      <div className="theme-grid">
                        {[
                          ['light', 'Light'],
                          ['dark', 'Dark'],
                          ['sepia', 'Sepia']
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            className={`theme-chip ${settings.appTheme === value ? 'active' : ''}`}
                            onClick={() => applyThemeSelection(value as AppSettings['appTheme'])}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </SettingRow>
                    <SettingRow label="Follow system theme">
                      <Toggle checked={settings.followSystemTheme} onChange={(checked) => setSettings((current) => ({ ...current, followSystemTheme: checked }))} />
                    </SettingRow>

                    <h3>Canvas</h3>
                    <SettingRow label="Canvas width">
                      <select value={settings.canvasWidth} onChange={(event) => setSettings((current) => ({ ...current, canvasWidth: event.target.value as PageWidthPreset }))}>
                        <option value="narrow">Narrow (560px)</option>
                        <option value="medium">Medium (720px)</option>
                        <option value="wide">Wide (900px)</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Canvas shadow">
                      <Toggle checked={settings.canvasShadow} onChange={(checked) => setSettings((current) => ({ ...current, canvasShadow: checked }))} />
                    </SettingRow>
                    <SettingRow label="Show page ruler">
                      <Toggle checked={settings.showPageRuler} onChange={(checked) => setSettings((current) => ({ ...current, showPageRuler: checked }))} />
                    </SettingRow>
                    <SettingRow label="Paragraph indent style">
                      <select value={settings.paragraphIndentStyle} onChange={(event) => setSettings((current) => ({ ...current, paragraphIndentStyle: event.target.value as AppSettings['paragraphIndentStyle'] }))}>
                        <option value="none">None</option>
                        <option value="firstLine">First-line indent</option>
                        <option value="block">Block</option>
                      </select>
                    </SettingRow>

                    <h3>Comparison Colors</h3>
                    <SettingRow label="Deletion color">
                      <input type="color" value={settings.deletionColor} onChange={(event) => setSettings((current) => ({ ...current, deletionColor: event.target.value }))} />
                    </SettingRow>
                    <SettingRow label="Addition color">
                      <input type="color" value={settings.additionColor} onChange={(event) => setSettings((current) => ({ ...current, additionColor: event.target.value }))} />
                    </SettingRow>
                    <SettingRow label="Use patterns instead of color">
                      <Toggle checked={settings.usePatternsInsteadOfColor} onChange={(checked) => setSettings((current) => ({ ...current, usePatternsInsteadOfColor: checked }))} />
                    </SettingRow>
                    <SettingRow label="Background highlight opacity">
                      <NumberStepper value={settings.diffHighlightOpacity} min={0} max={100} onChange={(value) => setSettings((current) => ({ ...current, diffHighlightOpacity: value }))} />
                    </SettingRow>

                    <h3>Animations</h3>
                    <SettingRow label="Animation speed">
                      <select value={settings.animationSpeed} onChange={(event) => setSettings((current) => ({ ...current, animationSpeed: event.target.value as AppSettings['animationSpeed'] }))}>
                        <option value="normal">Normal</option>
                        <option value="slow">Slow</option>
                        <option value="fast">Fast</option>
                        <option value="off">Off</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Reduce motion">
                      <Toggle checked={settings.reduceMotion} onChange={(checked) => setSettings((current) => ({ ...current, reduceMotion: checked }))} />
                    </SettingRow>
                  </>
                ) : null}

                {settingsCategory === 'Export & Import' ? (
                  <>
                    <h3>Export</h3>
                    <SettingRow label="Export current version" stacked>
                      <div className="button-grid">
                        {(['pdf', 'docx', 'txt', 'md', 'inkline'] as ExportFormat[]).map((format) => (
                          <button key={format} type="button" className="outline-button" onClick={() => handleExportCurrent(format)}>
                            {format.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </SettingRow>
                    <SettingRow label="Export a specific snapshot">
                      <button type="button" className="outline-button" onClick={() => void handleExportSnapshot()}>
                        Export selected snapshot
                      </button>
                    </SettingRow>
                    <SettingRow label="Include document title in export">
                      <Toggle checked={settings.includeDocumentTitleInExport} onChange={(checked) => setSettings((current) => ({ ...current, includeDocumentTitleInExport: checked }))} />
                    </SettingRow>
                    <SettingRow label="Include page numbers in PDF">
                      <Toggle checked={settings.includePageNumbersInPdf} onChange={(checked) => setSettings((current) => ({ ...current, includePageNumbersInPdf: checked }))} />
                    </SettingRow>
                    <SettingRow label="PDF page size">
                      <select value={settings.pdfPageSize} onChange={(event) => setSettings((current) => ({ ...current, pdfPageSize: event.target.value as AppSettings['pdfPageSize'] }))}>
                        <option value="A4">A4</option>
                        <option value="Letter">Letter</option>
                        <option value="A5">A5</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="PDF margins">
                      <select value={settings.pdfMargins} onChange={(event) => setSettings((current) => ({ ...current, pdfMargins: event.target.value as AppSettings['pdfMargins'] }))}>
                        <option value="normal">Normal</option>
                        <option value="narrow">Narrow</option>
                        <option value="wide">Wide</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Include author name in export">
                      <div className="inline-controls">
                        <Toggle checked={settings.includeAuthorNameInExport} onChange={(checked) => setSettings((current) => ({ ...current, includeAuthorNameInExport: checked }))} />
                        {settings.includeAuthorNameInExport ? (
                          <input value={settings.authorName} placeholder="Author name" onChange={(event) => setSettings((current) => ({ ...current, authorName: event.target.value }))} />
                        ) : null}
                      </div>
                    </SettingRow>
                    <SettingRow label="Export with comparison markup">
                      <Toggle checked={settings.exportWithComparisonMarkup} onChange={(checked) => setSettings((current) => ({ ...current, exportWithComparisonMarkup: checked }))} />
                    </SettingRow>

                    <h3>Import</h3>
                    <SettingRow label="Import document">
                      <button type="button" className="outline-button" onClick={() => importInputRef.current?.click()}>
                        Choose file
                      </button>
                    </SettingRow>
                    <SettingRow label="Import mode">
                      <div className="segmented-control">
                        <button
                          type="button"
                          className={settings.importMode === 'newDocument' ? 'active' : ''}
                          onClick={() => setSettings((current) => ({ ...current, importMode: 'newDocument' }))}
                        >
                          Import as new document
                        </button>
                        <button
                          type="button"
                          className={settings.importMode === 'newSnapshot' ? 'active' : ''}
                          onClick={() => setSettings((current) => ({ ...current, importMode: 'newSnapshot' }))}
                        >
                          Import as snapshot
                        </button>
                      </div>
                    </SettingRow>
                  </>
                ) : null}

                {settingsCategory === 'Accessibility' ? (
                  <>
                    <h3>Accessibility</h3>
                    <SettingRow label="Font scaling">
                      <NumberStepper value={settings.fontScaling} min={80} max={150} onChange={(value) => setSettings((current) => ({ ...current, fontScaling: value }))} />
                    </SettingRow>
                    <SettingRow label="High contrast mode">
                      <Toggle checked={settings.highContrastMode} onChange={(checked) => setSettings((current) => ({ ...current, highContrastMode: checked }))} />
                    </SettingRow>
                    <SettingRow label="Screen reader support">
                      <Toggle checked={settings.screenReaderSupport} onChange={(checked) => setSettings((current) => ({ ...current, screenReaderSupport: checked }))} />
                    </SettingRow>
                    <SettingRow label="Keyboard navigation">
                      <Toggle checked={settings.keyboardNavigation} onChange={(checked) => setSettings((current) => ({ ...current, keyboardNavigation: checked }))} />
                    </SettingRow>
                    <SettingRow label="Tooltip delay">
                      <NumberStepper value={settings.tooltipDelay} min={0} max={1000} onChange={(value) => setSettings((current) => ({ ...current, tooltipDelay: value }))} />
                    </SettingRow>
                    <SettingRow label="Focus indicators">
                      <select value={settings.focusIndicators} onChange={(event) => setSettings((current) => ({ ...current, focusIndicators: event.target.value as AppSettings['focusIndicators'] }))}>
                        <option value="default">Default</option>
                        <option value="high">High visibility</option>
                        <option value="off">Off</option>
                      </select>
                    </SettingRow>
                    <SettingRow label="Dyslexia-friendly font">
                      <Toggle checked={settings.dyslexiaFriendlyFont} onChange={(checked) => setSettings((current) => ({ ...current, dyslexiaFriendlyFont: checked }))} />
                    </SettingRow>
                    <SettingRow label="Line focus highlight">
                      <Toggle checked={settings.lineFocusHighlight} onChange={(checked) => setSettings((current) => ({ ...current, lineFocusHighlight: checked }))} />
                    </SettingRow>
                    <SettingRow label="Use patterns instead of color in comparisons">
                      <Toggle checked={settings.usePatternsInsteadOfColor} onChange={(checked) => setSettings((current) => ({ ...current, usePatternsInsteadOfColor: checked }))} />
                    </SettingRow>
                  </>
                ) : null}

                {settingsCategory === 'About' ? (
                  <>
                    <h3>About Inkline</h3>
                    <div className="about-stack">
                      <p>Inkline is a calm writing studio built around snapshots, quick comparison, and immediate writing feedback.</p>
                      <p>Version: 0.2.0</p>
                      <p>Build date: {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date())}</p>
                      <button type="button" className="link-button">Check for updates</button>
                      <button type="button" className="link-button">View licenses</button>
                      <button type="button" className="link-button">Privacy policy</button>
                      <button type="button" className="link-button">Report a bug</button>
                      {storage ? (
                        <div className="about-storage">
                          <div>Workspace: {storage.appRoot}</div>
                          <div>Backups: {storage.backupsDirectory}</div>
                          <div>Exports: {storage.exportsDirectory}</div>
                          <div>Backup entries: {backups.length}</div>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                <div className="settings-footer">
                  <button type="button" className="gradient-button" onClick={() => setSettingsOpen(false)}>
                    Close
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
