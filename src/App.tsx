import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api';
import type { AppSettings, DiffBlock, DiffResult, ProjectMeta, SavePoint, WordDiff } from './lib/types';

type DiffViewMode = 'split' | 'unified';
type DiffGranularity = 'paragraphs' | 'lines';
type DiffTone = 'classic' | 'ink' | 'warm';
type CompareRef = 'current' | string;

type ParsedDocument = {
  meta: Record<string, string>;
  body: string;
};

const BRAND_NAME = 'Inkline';
const WALKTHROUGH_KEY = 'inkline-walkthrough-v1';
const EMPTY_DIFF: DiffResult = { blocks: [] };

const FONT_OPTIONS = [
  { value: 'Lora', label: 'Lora' },
  { value: 'Source Serif 4', label: 'Source Serif 4' },
  { value: 'Fraunces', label: 'Fraunces' },
  { value: 'IBM Plex Serif', label: 'IBM Plex Serif' }
];

const FONT_SIZE_OPTIONS = [16, 17, 18, 20, 22, 24];
const LINE_HEIGHT_OPTIONS = [1.5, 1.65, 1.8, 1.95, 2.1];
const WIDTH_OPTIONS = [
  { value: 700, label: 'Narrow' },
  { value: 820, label: 'Standard' },
  { value: 940, label: 'Wide' }
];
const AUTOSAVE_OPTIONS = [
  { value: 1000, label: '1s' },
  { value: 2000, label: '2s' },
  { value: 5000, label: '5s' }
];

const SETTINGS_DEFAULTS: AppSettings = {
  theme: 'mist',
  font: 'Lora',
  fontSize: 18,
  lineHeight: 1.8,
  editorWidth: 820,
  showRuler: true,
  projectsDirectory: '',
  autosaveIntervalMs: 2000
};

function formatTimestamp(timestamp: string) {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

function getLatestSavePoint(savePoints: SavePoint[]) {
  return savePoints[savePoints.length - 1] ?? null;
}

function countWords(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function normalizeSettings(settings?: Partial<AppSettings> | null): AppSettings {
  return {
    ...SETTINGS_DEFAULTS,
    ...settings,
    theme:
      settings?.theme === 'light' || settings?.theme === 'mist' || settings?.theme === 'system'
        ? settings.theme
        : SETTINGS_DEFAULTS.theme,
    font: settings?.font || SETTINGS_DEFAULTS.font,
    fontSize: Number(settings?.fontSize ?? SETTINGS_DEFAULTS.fontSize),
    lineHeight: Number(settings?.lineHeight ?? SETTINGS_DEFAULTS.lineHeight),
    editorWidth: Number(settings?.editorWidth ?? SETTINGS_DEFAULTS.editorWidth),
    showRuler: settings?.showRuler ?? SETTINGS_DEFAULTS.showRuler,
    autosaveIntervalMs: Number(settings?.autosaveIntervalMs ?? SETTINGS_DEFAULTS.autosaveIntervalMs),
    projectsDirectory: settings?.projectsDirectory || SETTINGS_DEFAULTS.projectsDirectory
  };
}

function parseDocument(raw: string): ParsedDocument {
  if (!raw.startsWith('---\n')) {
    return { meta: {}, body: raw };
  }

  const frontmatterEnd = raw.indexOf('\n---\n');
  if (frontmatterEnd === -1) {
    return { meta: {}, body: raw };
  }

  const frontmatter = raw.slice(4, frontmatterEnd).split('\n');
  const meta: Record<string, string> = {};

  for (const line of frontmatter) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    meta[key] = value;
  }

  return {
    meta,
    body: raw.slice(frontmatterEnd + 5).replace(/^\n/, '')
  };
}

function formatFrontmatterValue(value: string) {
  if (/^[A-Za-z0-9._:/-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function composeDocument(meta: Record<string, string>, title: string, body: string) {
  const nextMeta: Record<string, string> = {
    ...meta,
    title: title.trim() || 'Untitled Project',
    modified: new Date().toISOString()
  };

  const orderedKeys = ['title', 'created', 'modified', 'id'];
  const keys = [
    ...orderedKeys.filter((key) => key in nextMeta),
    ...Object.keys(nextMeta).filter((key) => !orderedKeys.includes(key))
  ];

  if (keys.length === 0) {
    return body;
  }

  const frontmatter = keys.map((key) => `${key}: ${formatFrontmatterValue(nextMeta[key])}`).join('\n');
  const normalizedBody = body.replace(/^\n+/, '');

  return `---\n${frontmatter}\n---\n\n${normalizedBody}`;
}

function normalizeTokens(text: string) {
  return text
    .split(/\s+/)
    .map((token) => token.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase())
    .filter(Boolean);
}

function similarity(left: string, right: string) {
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
  return similarity(left, right) >= 0.35 ? 1 : 2;
}

function simpleWordDiff(left: string, right: string): WordDiff[] {
  const leftWords = left.split(/\s+/).filter(Boolean);
  const rightWords = right.split(/\s+/).filter(Boolean);
  const n = leftWords.length;
  const m = rightWords.length;
  const dp = Array.from({ length: n + 1 }, () => Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] =
        leftWords[i] === rightWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const output: WordDiff[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (leftWords[i] === rightWords[j]) {
      output.push({ type: 'equal', text: `${leftWords[i]} ` });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      output.push({ type: 'delete', text: `${leftWords[i]} ` });
      i += 1;
    } else {
      output.push({ type: 'insert', text: `${rightWords[j]} ` });
      j += 1;
    }
  }

  while (i < n) {
    output.push({ type: 'delete', text: `${leftWords[i]} ` });
    i += 1;
  }

  while (j < m) {
    output.push({ type: 'insert', text: `${rightWords[j]} ` });
    j += 1;
  }

  return output;
}

function splitIntoUnits(text: string, granularity: DiffGranularity) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return [];
  }

  if (granularity === 'lines') {
    return normalized.split('\n');
  }

  return normalized
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean);
}

function buildDiff(leftText: string, rightText: string, granularity: DiffGranularity): DiffResult {
  const leftBlocks = splitIntoUnits(leftText, granularity);
  const rightBlocks = splitIntoUnits(rightText, granularity);
  const n = leftBlocks.length;
  const m = rightBlocks.length;
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

      const replaceCost = substitutionCost(leftBlocks[i], rightBlocks[j]) + dp[i + 1][j + 1];
      const deleteCost = 1 + dp[i + 1][j];
      const insertCost = 1 + dp[i][j + 1];
      dp[i][j] = Math.min(replaceCost, deleteCost, insertCost);
    }
  }

  const blocks: DiffBlock[] = [];
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i === n) {
      blocks.push({ type: 'added', leftContent: undefined, rightContent: rightBlocks[j], wordDiffs: undefined });
      j += 1;
      continue;
    }

    if (j === m) {
      blocks.push({ type: 'deleted', leftContent: leftBlocks[i], rightContent: undefined, wordDiffs: undefined });
      i += 1;
      continue;
    }

    if (leftBlocks[i] === rightBlocks[j] && dp[i][j] === dp[i + 1][j + 1]) {
      blocks.push({
        type: 'unchanged',
        leftContent: leftBlocks[i],
        rightContent: rightBlocks[j],
        wordDiffs: undefined
      });
      i += 1;
      j += 1;
      continue;
    }

    const replacePenalty = substitutionCost(leftBlocks[i], rightBlocks[j]);
    const replaceCost = replacePenalty + dp[i + 1][j + 1];
    const deleteCost = 1 + dp[i + 1][j];
    const insertCost = 1 + dp[i][j + 1];

    if (replacePenalty === 1 && dp[i][j] === replaceCost && replaceCost <= deleteCost && replaceCost <= insertCost) {
      blocks.push({
        type: 'modified',
        leftContent: leftBlocks[i],
        rightContent: rightBlocks[j],
        wordDiffs: simpleWordDiff(leftBlocks[i], rightBlocks[j])
      });
      i += 1;
      j += 1;
    } else if (dp[i][j] === deleteCost && deleteCost <= insertCost) {
      blocks.push({ type: 'deleted', leftContent: leftBlocks[i], rightContent: undefined, wordDiffs: undefined });
      i += 1;
    } else {
      blocks.push({ type: 'added', leftContent: undefined, rightContent: rightBlocks[j], wordDiffs: undefined });
      j += 1;
    }
  }

  return { blocks };
}

function summarizeDiff(diff: DiffResult) {
  return diff.blocks.reduce(
    (summary, block) => {
      if (block.type === 'added') summary.added += 1;
      if (block.type === 'deleted') summary.deleted += 1;
      if (block.type === 'modified') summary.modified += 1;
      return summary;
    },
    { added: 0, deleted: 0, modified: 0 }
  );
}

function sourceLabel(reference: CompareRef, timeline: SavePoint[]) {
  if (reference === 'current') {
    return 'Current draft';
  }

  return timeline.find((point) => point.hash === reference)?.message || 'Snapshot';
}

function sourceTimestamp(reference: CompareRef, timeline: SavePoint[]) {
  if (reference === 'current') {
    return 'Live manuscript';
  }

  const match = timeline.find((point) => point.hash === reference);
  return match ? formatTimestamp(match.timestamp) : 'Saved snapshot';
}

function renderWordDiff(wordDiffs: WordDiff[], side: 'left' | 'right') {
  return wordDiffs.map((wordDiff, index) => {
    const hidden =
      (side === 'left' && wordDiff.type === 'insert') ||
      (side === 'right' && wordDiff.type === 'delete');

    if (hidden) {
      return null;
    }

    const tokenClass =
      wordDiff.type === 'insert'
        ? 'diff-token token-insert'
        : wordDiff.type === 'delete'
          ? 'diff-token token-delete'
          : 'diff-token token-equal';

    return (
      <span key={`${side}-${wordDiff.type}-${index}`} className={tokenClass}>
        {wordDiff.text}
      </span>
    );
  });
}

function renderDiffSide(block: DiffBlock, side: 'left' | 'right') {
  if (block.type === 'modified' && block.wordDiffs) {
    return <span className="diff-copy">{renderWordDiff(block.wordDiffs, side)}</span>;
  }

  const content = side === 'left' ? block.leftContent : block.rightContent;
  if (!content) {
    return <span className="diff-empty">No matching passage</span>;
  }

  return <span className="diff-copy">{content}</span>;
}

type CompareTimelineProps = {
  label: string;
  description: string;
  selectedRef: CompareRef;
  timeline: SavePoint[];
  onSelect: (reference: CompareRef) => void;
};

function CompareTimeline({ label, description, selectedRef, timeline, onSelect }: CompareTimelineProps) {
  const reversed = [...timeline].reverse();

  return (
    <section className="compare-track">
      <div className="compare-track-header">
        <span className="ribbon-caption">{label}</span>
        <p>{description}</p>
      </div>

      <div className="compare-options">
        <button
          className={`compare-node ${selectedRef === 'current' ? 'selected' : ''}`}
          onClick={() => onSelect('current')}
          title="Compare against the current live draft"
        >
          <span className="compare-node-dot current" aria-hidden="true" />
          <div>
            <strong>Current draft</strong>
            <small>Live manuscript</small>
          </div>
        </button>

        {reversed.map((point) => (
          <button
            key={point.hash}
            className={`compare-node ${selectedRef === point.hash ? 'selected' : ''}`}
            onClick={() => onSelect(point.hash)}
            title={`${point.message} • ${formatTimestamp(point.timestamp)}`}
          >
            <span className="compare-node-dot" aria-hidden="true" />
            <div>
              <strong>{point.message || 'Untitled snapshot'}</strong>
              <small>
                {formatTimestamp(point.timestamp)} · {point.changeSize} changed words
              </small>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectMeta | null>(null);
  const [title, setTitle] = useState('');
  const [documentMeta, setDocumentMeta] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [timeline, setTimeline] = useState<SavePoint[]>([]);
  const [compareLeftRef, setCompareLeftRef] = useState<CompareRef>('current');
  const [compareRightRef, setCompareRightRef] = useState<CompareRef>('current');
  const [diffResult, setDiffResult] = useState<DiffResult>(EMPTY_DIFF);
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('split');
  const [diffGranularity, setDiffGranularity] = useState<DiffGranularity>('paragraphs');
  const [diffTone, setDiffTone] = useState<DiffTone>('classic');
  const [showUnchanged, setShowUnchanged] = useState(true);
  const [showCompareSources, setShowCompareSources] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [showSavePointModal, setShowSavePointModal] = useState(false);
  const [showStudio, setShowStudio] = useState(false);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [settings, setSettings] = useState<AppSettings>(SETTINGS_DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [isCreatingSavePoint, setIsCreatingSavePoint] = useState(false);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const documentCacheRef = useRef<Record<string, string>>({});
  const lastSavedDocumentRef = useRef('');
  const lastSavedSettingsRef = useRef('');
  const lastRenamedTitleRef = useRef('');
  const settingsReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        const [projectList, storedSettings] = await Promise.all([
          api.listProjects(),
          api.getSettings().catch(() => SETTINGS_DEFAULTS)
        ]);

        if (cancelled) return;

        const nextSettings = normalizeSettings(storedSettings);
        setProjects(projectList);
        setSettings(nextSettings);
        lastSavedSettingsRef.current = JSON.stringify(nextSettings);
        settingsReadyRef.current = true;
        setShowWalkthrough(window.localStorage.getItem(WALKTHROUGH_KEY) !== 'done');

        if (projectList.length > 0) {
          await openProject(projectList[0]);
        }
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
    if (!activeProject) return;

    const nextDocument = composeDocument(documentMeta, title, body);
    if (nextDocument === lastSavedDocumentRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void api
        .saveDocument(activeProject.id, nextDocument)
        .then(() => {
          lastSavedDocumentRef.current = nextDocument;
          setProjects((prev) =>
            prev.map((project) =>
              project.id === activeProject.id ? { ...project, modified: new Date().toISOString() } : project
            )
          );
        })
        .catch((err) => {
          setError(`Autosave failed: ${String(err)}`);
        });
    }, settings.autosaveIntervalMs);

    return () => window.clearTimeout(timer);
  }, [activeProject, body, documentMeta, settings.autosaveIntervalMs, title]);

  useEffect(() => {
    if (!activeProject) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle || trimmedTitle === lastRenamedTitleRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void api
        .renameProject(activeProject.id, trimmedTitle)
        .then(() => {
          lastRenamedTitleRef.current = trimmedTitle;
          setActiveProject((prev) => (prev ? { ...prev, title: trimmedTitle } : prev));
          setProjects((prev) =>
            prev.map((project) => (project.id === activeProject.id ? { ...project, title: trimmedTitle } : project))
          );
        })
        .catch((err) => setError(`Rename failed: ${String(err)}`));
    }, 350);

    return () => window.clearTimeout(timer);
  }, [activeProject, title]);

  useEffect(() => {
    if (!activeProject || !settingsReadyRef.current) return;

    const serialized = JSON.stringify(settings);
    if (serialized === lastSavedSettingsRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void api
        .updateSettings(settings)
        .then(() => {
          lastSavedSettingsRef.current = serialized;
        })
        .catch((err) => setError(`Settings sync failed: ${String(err)}`));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeProject, settings]);

  useEffect(() => {
    if (!activeProject || !showChanges) return;

    let cancelled = false;

    void (async () => {
      try {
        setIsDiffLoading(true);

        const [leftBody, rightBody] = await Promise.all([
          loadSourceBody(activeProject.id, compareLeftRef),
          loadSourceBody(activeProject.id, compareRightRef)
        ]);

        if (cancelled) return;

        setDiffResult(buildDiff(leftBody, rightBody, diffGranularity));
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(`Changes view failed: ${String(err)}`);
          setDiffResult(EMPTY_DIFF);
        }
      } finally {
        if (!cancelled) {
          setIsDiffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProject, body, compareLeftRef, compareRightRef, diffGranularity, showChanges]);

  async function loadSourceBody(projectId: string, reference: CompareRef) {
    if (reference === 'current') {
      return body;
    }

    if (documentCacheRef.current[reference]) {
      return documentCacheRef.current[reference];
    }

    const raw = await api.getDocumentAtSavePoint(projectId, reference);
    const parsed = parseDocument(raw);
    documentCacheRef.current[reference] = parsed.body;
    return parsed.body;
  }

  async function openProject(project: ProjectMeta) {
    try {
      setLoading(true);
      setError(null);
      documentCacheRef.current = {};
      setActiveProject(project);

      const [rawDocument, savePoints] = await Promise.all([api.loadDocument(project.id), api.getTimeline(project.id)]);
      const parsed = parseDocument(rawDocument);
      const latestSavePoint = getLatestSavePoint(savePoints);
      const nextTitle = project.title || parsed.meta.title || 'Untitled Project';

      setTitle(nextTitle);
      setDocumentMeta(parsed.meta);
      setBody(parsed.body);
      setTimeline(savePoints);
      setCompareLeftRef(latestSavePoint?.hash ?? 'current');
      setCompareRightRef('current');
      setShowChanges(true);
      setShowCompareSources(true);
      lastSavedDocumentRef.current = rawDocument;
      lastRenamedTitleRef.current = nextTitle;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function createProject() {
    const requestedTitle = window.prompt('New project title', 'Untitled Project');
    if (!requestedTitle) return;

    const trimmedTitle = requestedTitle.trim();
    if (!trimmedTitle) return;

    try {
      const created = await api.createProject(trimmedTitle);
      const nextProjects = await api.listProjects();
      setProjects(nextProjects);
      await openProject(created);
    } catch (err) {
      setError(`Project creation failed: ${String(err)}`);
    }
  }

  async function createSavePoint() {
    if (!activeProject || isCreatingSavePoint) return;

    try {
      setIsCreatingSavePoint(true);
      setError(null);

      const latestDocument = composeDocument(documentMeta, title, body);
      await api.saveDocument(activeProject.id, latestDocument);
      lastSavedDocumentRef.current = latestDocument;

      const saved = await api.createSavePoint(activeProject.id, saveMessage);
      documentCacheRef.current[saved.hash] = body;

      const [nextProjects, nextTimeline] = await Promise.all([
        api.listProjects(),
        api.getTimeline(activeProject.id)
      ]);

      setProjects(nextProjects);
      setTimeline(nextTimeline);
      setCompareLeftRef(saved.hash);
      setCompareRightRef('current');
      setSaveMessage('');
      setShowSavePointModal(false);
      setShowChanges(true);
      setShowCompareSources(true);
    } catch (err) {
      setError(`Snapshot failed: ${String(err)}`);
    } finally {
      setIsCreatingSavePoint(false);
    }
  }

  function updateTextareaSelection(replacement: string, selectionStart: number, selectionEnd: number, nextBody: string) {
    setBody(nextBody);
    window.requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(selectionStart, selectionEnd);
    });
  }

  function wrapSelection(prefix: string, suffix = prefix, fallback = 'text') {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = body.slice(start, end) || fallback;
    const replacement = `${prefix}${selected}${suffix}`;
    const nextBody = `${body.slice(0, start)}${replacement}${body.slice(end)}`;
    updateTextareaSelection(replacement, start + prefix.length, start + prefix.length + selected.length, nextBody);
  }

  function toggleLinePrefix(prefix: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const lineStart = body.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
    const nextBreak = body.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? body.length : nextBreak;
    const segment = body.slice(lineStart, lineEnd);
    const lines = segment.split('\n');
    const allPrefixed = lines.every((line) => !line.trim() || line.startsWith(prefix));
    const updatedLines = lines.map((line) => {
      if (!line.trim()) return line;
      return allPrefixed ? line.replace(prefix, '') : `${prefix}${line}`;
    });

    const replacement = updatedLines.join('\n');
    const nextBody = `${body.slice(0, lineStart)}${replacement}${body.slice(lineEnd)}`;
    updateTextareaSelection(replacement, lineStart, lineStart + replacement.length, nextBody);
  }

  function insertSceneBreak() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const insertion = '\n\n* * *\n\n';
    const nextBody = `${body.slice(0, start)}${insertion}${body.slice(textarea.selectionEnd)}`;
    updateTextareaSelection(insertion, start + insertion.length, start + insertion.length, nextBody);
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;

    const key = event.key.toLowerCase();
    if (key === 'b') {
      event.preventDefault();
      wrapSelection('**');
    }

    if (key === 'i') {
      event.preventDefault();
      wrapSelection('*');
    }

    if (key === 'u') {
      event.preventDefault();
      wrapSelection('<u>', '</u>');
    }
  }

  const wordCount = useMemo(() => countWords(body), [body]);
  const diffSummary = useMemo(() => summarizeDiff(diffResult), [diffResult]);
  const visibleBlocks = useMemo(() => {
    if (showUnchanged) return diffResult.blocks;
    return diffResult.blocks.filter((block) => block.type !== 'unchanged');
  }, [diffResult.blocks, showUnchanged]);

  const leftLabel = sourceLabel(compareLeftRef, timeline);
  const rightLabel = sourceLabel(compareRightRef, timeline);
  const themeClass = settings.theme === 'light' ? 'theme-light' : 'theme-mist';

  if (loading) {
    return (
      <div className="state-screen">
        <img src="/inkline-icon.svg" alt="" className="brand-icon large" />
        <div className="brand-lockup">
          <span className="brand-mark">{BRAND_NAME}</span>
          <h1>Loading your studio…</h1>
        </div>
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className={`state-screen ${themeClass}`}>
        <img src="/inkline-icon.svg" alt="" className="brand-icon large" />
        <div className="brand-lockup">
          <span className="brand-mark">{BRAND_NAME}</span>
          <h1>A writing studio built around snapshots.</h1>
          <p>Set your page the way you like it, write in a clean white canvas, and compare any two moments in the draft.</p>
        </div>

        <button className="primary" onClick={() => void createProject()}>
          New Project
        </button>

        {projects.length > 0 && (
          <div className="project-list">
            {projects.map((project) => (
              <button key={project.id} className="project-card" onClick={() => void openProject(project)}>
                <div className="project-card-title">{project.title}</div>
                <small>
                  {project.wordCount} words · {project.savePointCount} snapshots
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`app-shell ${themeClass}`}>
      <header className="top-bar">
        <div className="top-bar-copy">
          <div className="brand-lockup inline">
            <img src="/inkline-icon.svg" alt="" className="brand-icon" />
            <div>
              <span className="brand-mark">{BRAND_NAME}</span>
              <p className="brand-subtitle">Clean drafting. Fast comparisons.</p>
            </div>
          </div>

          <input
            aria-label="Document title"
            className="title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              if (!title.trim()) {
                setTitle('Untitled Project');
              }
            }}
          />

          <div className="top-bar-meta">
            <span>{wordCount} words</span>
            <span>{timeline.length} snapshots</span>
            <span>
              {leftLabel} → {rightLabel}
            </span>
          </div>
        </div>

        <div className="actions">
          <button
            className="icon-button"
            onClick={() => setShowSavePointModal(true)}
            title="Create a named snapshot of the current manuscript"
          >
            Snapshot
          </button>
          <button
            className="icon-button"
            onClick={() => setShowChanges((open) => !open)}
            title="Show or hide the Changes panel"
          >
            {showChanges ? 'Hide Changes' : 'Show Changes'}
          </button>
          <button
            className="icon-button"
            onClick={() => setShowStudio((open) => !open)}
            title="Open deeper preferences like autosave and page guides"
          >
            Studio
          </button>
          <button
            className="icon-button"
            onClick={() => setShowWalkthrough(true)}
            title="Open the quick walkthrough again"
          >
            Guide
          </button>
          <button className="primary" onClick={() => void createProject()} title="Create a fresh manuscript project">
            New
          </button>
        </div>
      </header>

      <section className="ribbon">
        <div className="ribbon-group">
          <div className="ribbon-controls">
            <button className="tool-button strong" onClick={() => wrapSelection('**')} title="Bold the selected text (Ctrl/Cmd+B)">
              B
            </button>
            <button className="tool-button italic" onClick={() => wrapSelection('*')} title="Italicize the selected text (Ctrl/Cmd+I)">
              I
            </button>
            <button
              className="tool-button underline"
              onClick={() => wrapSelection('<u>', '</u>')}
              title="Underline the selected text (Ctrl/Cmd+U)"
            >
              U
            </button>
            <button className="tool-button" onClick={() => toggleLinePrefix('> ')} title="Turn the current lines into a block quote">
              Quote
            </button>
            <button className="tool-button" onClick={() => toggleLinePrefix('- ')} title="Toggle a bullet list for the selected lines">
              List
            </button>
            <button className="tool-button" onClick={insertSceneBreak} title="Insert a scene break">
              Break
            </button>
          </div>
          <span className="ribbon-caption">Format</span>
        </div>

        <div className="ribbon-group">
          <div className="ribbon-controls">
            <label className="ribbon-field" title="Choose the page font for drafting">
              <span>Font</span>
              <select
                value={settings.font}
                onChange={(event) => setSettings((prev) => ({ ...prev, font: event.target.value }))}
              >
                {FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="ribbon-field" title="Adjust the manuscript font size">
              <span>Size</span>
              <select
                value={settings.fontSize}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, fontSize: Number(event.target.value) }))
                }
              >
                {FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </label>

            <label className="ribbon-field" title="Set line spacing for the manuscript">
              <span>Spacing</span>
              <select
                value={settings.lineHeight}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, lineHeight: Number(event.target.value) }))
                }
              >
                {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                  <option key={lineHeight} value={lineHeight}>
                    {lineHeight.toFixed(2)}
                  </option>
                ))}
              </select>
            </label>

            <label className="ribbon-field" title="Choose the page width for the writing canvas">
              <span>Page</span>
              <select
                value={settings.editorWidth}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, editorWidth: Number(event.target.value) }))
                }
              >
                {WIDTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <span className="ribbon-caption">Page</span>
        </div>

        <div className="ribbon-group">
          <div className="ribbon-controls">
            <button
              className={`tool-button ${showCompareSources ? 'active' : ''}`}
              onClick={() => setShowCompareSources((open) => !open)}
              title="Show or hide the left and right snapshot timelines"
            >
              Timelines
            </button>
            <button
              className={`tool-button ${settings.showRuler ? 'active' : ''}`}
              onClick={() => setSettings((prev) => ({ ...prev, showRuler: !prev.showRuler }))}
              title="Show or hide the page ruler"
            >
              Ruler
            </button>
            <button
              className={`tool-button ${showUnchanged ? 'active' : ''}`}
              onClick={() => setShowUnchanged((value) => !value)}
              title="Keep unchanged passages visible in the Changes panel"
            >
              Matches
            </button>
          </div>
          <span className="ribbon-caption">Review</span>
        </div>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <main className={`workspace-shell ${showChanges ? 'with-changes' : ''}`}>
        <section className="editor-panel">
          <div className="editor-panel-header">
            <div>
              <span className="ribbon-caption">Draft</span>
              <p>Plain white page, autosaved as you write.</p>
            </div>
            <span className="editor-status">Autosave every {settings.autosaveIntervalMs / 1000}s</span>
          </div>

          <div className="editor-stage">
            <div className="editor-page" style={{ maxWidth: `${settings.editorWidth}px` }}>
              {settings.showRuler && (
                <div className="page-ruler" aria-hidden="true">
                  <span>0</span>
                  <span>15</span>
                  <span>30</span>
                  <span>45</span>
                  <span>60</span>
                </div>
              )}

              <textarea
                ref={textareaRef}
                aria-label="Writing editor"
                className="editor"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={handleEditorKeyDown}
                placeholder="Start writing..."
                style={{
                  fontFamily: `"${settings.font}", serif`,
                  fontSize: `${settings.fontSize}px`,
                  lineHeight: String(settings.lineHeight)
                }}
              />
            </div>
          </div>
        </section>

        {showChanges && (
          <aside className={`changes-pane changes-tone-${diffTone}`}>
            <div className="changes-header">
              <div>
                <span className="ribbon-caption">Changes</span>
                <h2>
                  {leftLabel} → {rightLabel}
                </h2>
                <p>{diffGranularity === 'paragraphs' ? 'Paragraph-aware comparison' : 'Line-by-line comparison'}</p>
              </div>

              <div className="changes-controls">
                <div className="view-switcher" role="tablist" aria-label="Changes view mode">
                  <button
                    className={`view-chip ${diffViewMode === 'split' ? 'active' : ''}`}
                    onClick={() => setDiffViewMode('split')}
                  >
                    Split
                  </button>
                  <button
                    className={`view-chip ${diffViewMode === 'unified' ? 'active' : ''}`}
                    onClick={() => setDiffViewMode('unified')}
                  >
                    Unified
                  </button>
                </div>

                <label className="compact-field" title="Switch between paragraph and line-based comparisons">
                  <span>Mode</span>
                  <select
                    value={diffGranularity}
                    onChange={(event) => setDiffGranularity(event.target.value as DiffGranularity)}
                  >
                    <option value="paragraphs">Paragraphs</option>
                    <option value="lines">Lines</option>
                  </select>
                </label>

                <label className="compact-field" title="Change how additions and deletions are colored">
                  <span>Color</span>
                  <select value={diffTone} onChange={(event) => setDiffTone(event.target.value as DiffTone)}>
                    <option value="classic">Classic</option>
                    <option value="ink">Ink</option>
                    <option value="warm">Warm</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="diff-summary">
              <span>{diffSummary.modified} edited</span>
              <span>{diffSummary.added} added</span>
              <span>{diffSummary.deleted} removed</span>
            </div>

            {showCompareSources && (
              <div className="compare-grid">
                <CompareTimeline
                  label="Left"
                  description={`${sourceLabel(compareLeftRef, timeline)} · ${sourceTimestamp(compareLeftRef, timeline)}`}
                  selectedRef={compareLeftRef}
                  timeline={timeline}
                  onSelect={setCompareLeftRef}
                />
                <CompareTimeline
                  label="Right"
                  description={`${sourceLabel(compareRightRef, timeline)} · ${sourceTimestamp(compareRightRef, timeline)}`}
                  selectedRef={compareRightRef}
                  timeline={timeline}
                  onSelect={setCompareRightRef}
                />
              </div>
            )}

            {isDiffLoading ? (
              <p className="diff-placeholder">Loading changes…</p>
            ) : visibleBlocks.length === 0 ? (
              <p className="diff-placeholder">No meaningful differences between the two selected sources.</p>
            ) : diffViewMode === 'unified' ? (
              <div className="diff-unified-list">
                {visibleBlocks.map((block, index) => (
                  <article key={`${block.type}-${index}`} className={`unified-block diff-${block.type}`}>
                    <div className="unified-header">
                      <span>{diffGranularity === 'paragraphs' ? `Passage ${index + 1}` : `Line ${index + 1}`}</span>
                      <strong>{block.type}</strong>
                    </div>
                    <div className="unified-columns">
                      <div className="unified-column">
                        <span className="unified-label">{leftLabel}</span>
                        <div className="diff-copy">{renderDiffSide(block, 'left')}</div>
                      </div>
                      <div className="unified-column">
                        <span className="unified-label">{rightLabel}</span>
                        <div className="diff-copy">{renderDiffSide(block, 'right')}</div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="split-diff-table">
                <div className="split-diff-head">{leftLabel}</div>
                <div className="split-diff-head">{rightLabel}</div>

                {visibleBlocks.map((block, index) => (
                  <div key={`${block.type}-${index}`} className={`split-diff-row diff-${block.type}`}>
                    <div className={`split-diff-cell split-left ${block.type === 'added' ? 'is-empty-cell' : ''}`}>
                      <span className="diff-line-number">{index + 1}</span>
                      <div className="diff-cell-copy">{renderDiffSide(block, 'left')}</div>
                    </div>
                    <div className={`split-diff-cell split-right ${block.type === 'deleted' ? 'is-empty-cell' : ''}`}>
                      <span className="diff-line-number">{index + 1}</span>
                      <div className="diff-cell-copy">{renderDiffSide(block, 'right')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </main>

      {showSavePointModal && (
        <div className="overlay">
          <div className="floating-panel save-point-modal" role="dialog" aria-modal="true">
            <span className="ribbon-caption">Create Snapshot</span>
            <h2>Name this moment</h2>
            <p>The name becomes part of both timelines, so keep it quick and descriptive.</p>
            <input
              value={saveMessage}
              onChange={(event) => setSaveMessage(event.target.value)}
              placeholder='e.g. "Sharpened chapter opening"'
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void createSavePoint();
                }
                if (event.key === 'Escape') {
                  setShowSavePointModal(false);
                }
              }}
            />
            <div className="modal-actions">
              <button className="primary" onClick={() => void createSavePoint()}>
                {isCreatingSavePoint ? 'Saving…' : 'Save Snapshot'}
              </button>
              <button className="icon-button" onClick={() => setShowSavePointModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showStudio && (
        <div className="overlay">
          <aside className="floating-panel studio-panel" role="dialog" aria-modal="true">
            <div className="panel-header">
              <div>
                <span className="ribbon-caption">Studio</span>
                <h2>Less-used preferences</h2>
              </div>
              <button className="icon-button" onClick={() => setShowStudio(false)}>
                Close
              </button>
            </div>

            <label className="settings-field">
              <span>Shell theme</span>
              <select
                value={settings.theme}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, theme: event.target.value as AppSettings['theme'] }))
                }
              >
                <option value="mist">Mist</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </label>

            <label className="settings-field">
              <span>Autosave</span>
              <select
                value={settings.autosaveIntervalMs}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, autosaveIntervalMs: Number(event.target.value) }))
                }
              >
                {AUTOSAVE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.showRuler}
                onChange={(event) => setSettings((prev) => ({ ...prev, showRuler: event.target.checked }))}
              />
              <span>Show the page ruler</span>
            </label>

            <div className="settings-field static">
              <span>Projects directory</span>
              <strong>{settings.projectsDirectory || 'Managed automatically by the desktop app'}</strong>
            </div>
          </aside>
        </div>
      )}

      {showWalkthrough && (
        <div className="overlay">
          <div className="floating-panel walkthrough-panel" role="dialog" aria-modal="true">
            <span className="ribbon-caption">Quick Tour</span>
            <h2>Three things to know</h2>
            <div className="walkthrough-grid">
              <article>
                <strong>Set the page first</strong>
                <p>Use the ribbon to choose your font, size, spacing, and page width before you settle in.</p>
              </article>
              <article>
                <strong>Capture snapshots often</strong>
                <p>The Snapshot button stores named moments so you can compare structure, pacing, or edits later.</p>
              </article>
              <article>
                <strong>Use Changes to compare</strong>
                <p>Pick any left and right sources, switch between paragraph and line mode, and change the color style if needed.</p>
              </article>
            </div>
            <div className="modal-actions">
              <button
                className="primary"
                onClick={() => {
                  window.localStorage.setItem(WALKTHROUGH_KEY, 'done');
                  setShowWalkthrough(false);
                }}
              >
                Start Writing
              </button>
              <button className="icon-button" onClick={() => setShowWalkthrough(false)}>
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
