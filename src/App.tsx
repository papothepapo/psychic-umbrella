import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api';
import type {
  AppSettings,
  BackupEntry,
  DiffBlock,
  DiffResult,
  ExportFormat,
  ProjectMeta,
  SavePoint,
  StorageOverview,
  WordDiff
} from './lib/types';

type CompareRef = 'current' | string;
type DiffGranularity = 'paragraphs' | 'lines';
type ParsedDocument = {
  meta: Record<string, string>;
  body: string;
};

const BRAND_NAME = 'Inkline';
const ACTIVE_PROJECT_KEY = 'inkline-active-project';
const EMPTY_DIFF: DiffResult = { blocks: [] };

const FONT_OPTIONS = [
  'Lora',
  'Source Serif 4',
  'IBM Plex Serif',
  'Fraunces',
  'Newsreader',
  'Libre Baskerville'
];

const FONT_SIZE_OPTIONS = [16, 18, 20, 22, 24, 26, 28];
const LINE_HEIGHT_OPTIONS = [1.45, 1.6, 1.75, 1.9, 2.05];
const WIDTH_OPTIONS = [720, 820, 900, 980, 1080];
const AUTOSAVE_OPTIONS = [500, 1000, 1500, 3000, 5000];
const BACKUP_OPTIONS = [60000, 300000, 900000, 1800000];
const EXPORT_OPTIONS: ExportFormat[] = ['inkline', 'docx', 'md', 'txt'];

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'mist',
  font: 'Lora',
  fontSize: 18,
  lineHeight: 1.8,
  editorWidth: 860,
  showRuler: true,
  showWordCount: true,
  showCharacterCount: true,
  showReadingTime: true,
  showStatusBar: true,
  showSpellcheck: true,
  focusMode: false,
  highlightMatches: true,
  projectsDirectory: '',
  backupsDirectory: '',
  exportsDirectory: '',
  autosaveIntervalMs: 1500,
  backupIntervalMs: 300000,
  defaultExportFormat: 'inkline'
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

function countWords(text: string) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function countCharacters(text: string) {
  return text.length;
}

function readingTimeLabel(words: number) {
  if (!words) return '0 min read';
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function normalizeSettings(settings?: Partial<AppSettings> | null): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    theme:
      settings?.theme === 'light' || settings?.theme === 'mist' || settings?.theme === 'system'
        ? settings.theme
        : DEFAULT_SETTINGS.theme,
    font: settings?.font || DEFAULT_SETTINGS.font,
    fontSize: Number(settings?.fontSize ?? DEFAULT_SETTINGS.fontSize),
    lineHeight: Number(settings?.lineHeight ?? DEFAULT_SETTINGS.lineHeight),
    editorWidth: Number(settings?.editorWidth ?? DEFAULT_SETTINGS.editorWidth),
    showRuler: settings?.showRuler ?? DEFAULT_SETTINGS.showRuler,
    showWordCount: settings?.showWordCount ?? DEFAULT_SETTINGS.showWordCount,
    showCharacterCount: settings?.showCharacterCount ?? DEFAULT_SETTINGS.showCharacterCount,
    showReadingTime: settings?.showReadingTime ?? DEFAULT_SETTINGS.showReadingTime,
    showStatusBar: settings?.showStatusBar ?? DEFAULT_SETTINGS.showStatusBar,
    showSpellcheck: settings?.showSpellcheck ?? DEFAULT_SETTINGS.showSpellcheck,
    focusMode: settings?.focusMode ?? DEFAULT_SETTINGS.focusMode,
    highlightMatches: settings?.highlightMatches ?? DEFAULT_SETTINGS.highlightMatches,
    projectsDirectory: settings?.projectsDirectory || DEFAULT_SETTINGS.projectsDirectory,
    backupsDirectory: settings?.backupsDirectory || DEFAULT_SETTINGS.backupsDirectory,
    exportsDirectory: settings?.exportsDirectory || DEFAULT_SETTINGS.exportsDirectory,
    autosaveIntervalMs: Number(settings?.autosaveIntervalMs ?? DEFAULT_SETTINGS.autosaveIntervalMs),
    backupIntervalMs: Number(settings?.backupIntervalMs ?? DEFAULT_SETTINGS.backupIntervalMs),
    defaultExportFormat:
      settings?.defaultExportFormat === 'md' ||
      settings?.defaultExportFormat === 'txt' ||
      settings?.defaultExportFormat === 'docx' ||
      settings?.defaultExportFormat === 'inkline'
        ? settings.defaultExportFormat
        : DEFAULT_SETTINGS.defaultExportFormat
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
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
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    meta[key] = value;
  }

  return {
    meta,
    body: raw.slice(frontmatterEnd + 5).replace(/^\n/, '')
  };
}

function formatFrontmatterValue(value: string) {
  if (/^[A-Za-z0-9._:/+-]+$/.test(value)) {
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

  if (!nextMeta.created) {
    nextMeta.created = new Date().toISOString();
  }

  const orderedKeys = ['title', 'created', 'modified', 'id'];
  const keys = [
    ...orderedKeys.filter((key) => key in nextMeta),
    ...Object.keys(nextMeta).filter((key) => !orderedKeys.includes(key))
  ];

  const frontmatter = keys.map((key) => `${key}: ${formatFrontmatterValue(nextMeta[key])}`).join('\n');
  return `---\n${frontmatter}\n---\n\n${body.replace(/^\n+/, '')}`;
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
      blocks.push({ type: 'added', rightContent: rightBlocks[j] });
      j += 1;
      continue;
    }

    if (j === m) {
      blocks.push({ type: 'deleted', leftContent: leftBlocks[i] });
      i += 1;
      continue;
    }

    if (leftBlocks[i] === rightBlocks[j] && dp[i][j] === dp[i + 1][j + 1]) {
      blocks.push({
        type: 'unchanged',
        leftContent: leftBlocks[i],
        rightContent: rightBlocks[j]
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
      blocks.push({ type: 'deleted', leftContent: leftBlocks[i] });
      i += 1;
    } else {
      blocks.push({ type: 'added', rightContent: rightBlocks[j] });
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

function renderWordDiff(wordDiffs: WordDiff[], side: 'left' | 'right') {
  return wordDiffs.map((wordDiff, index) => {
    const hidden =
      (side === 'left' && wordDiff.type === 'insert') || (side === 'right' && wordDiff.type === 'delete');

    if (hidden) {
      return null;
    }

    const className =
      wordDiff.type === 'insert'
        ? 'diff-token token-insert'
        : wordDiff.type === 'delete'
          ? 'diff-token token-delete'
          : 'diff-token token-equal';

    return (
      <span key={`${side}-${wordDiff.type}-${index}`} className={className}>
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

function projectById(projects: ProjectMeta[], projectId: string | null) {
  return projects.find((project) => project.id === projectId) ?? null;
}

export function App() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [documentMeta, setDocumentMeta] = useState<Record<string, string>>({});
  const [body, setBody] = useState('');
  const [timeline, setTimeline] = useState<SavePoint[]>([]);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [changesOpen, setChangesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compareRef, setCompareRef] = useState<CompareRef>('current');
  const [diffGranularity, setDiffGranularity] = useState<DiffGranularity>('paragraphs');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult>(EMPTY_DIFF);
  const [diffLoading, setDiffLoading] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documentCacheRef = useRef<Record<string, string>>({});
  const lastSavedDocumentRef = useRef('');
  const lastSavedSettingsRef = useRef('');
  const lastRenamedTitleRef = useRef('');

  const activeProject = useMemo(() => projectById(projects, activeProjectId), [projects, activeProjectId]);
  const wordCount = useMemo(() => countWords(body), [body]);
  const characterCount = useMemo(() => countCharacters(body), [body]);
  const diffSummary = useMemo(() => summarizeDiff(diffResult), [diffResult]);
  const visibleDiffBlocks = useMemo(
    () => (showUnchanged ? diffResult.blocks : diffResult.blocks.filter((block) => block.type !== 'unchanged')),
    [diffResult.blocks, showUnchanged]
  );
  const searchMatches = useMemo(() => {
    const query = findQuery.trim().toLowerCase();
    if (!query) return [];

    const matches: Array<{ start: number; end: number }> = [];
    const haystack = body.toLowerCase();
    let index = 0;

    while (index < haystack.length) {
      const found = haystack.indexOf(query, index);
      if (found === -1) break;
      matches.push({ start: found, end: found + query.length });
      index = found + query.length;
    }

    return matches;
  }, [body, findQuery]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setLoading(true);
        const [projectList, storedSettings, storageOverview] = await Promise.all([
          api.listProjects(),
          api.getSettings().catch(() => DEFAULT_SETTINGS),
          api.getStorageOverview().catch(() => null)
        ]);

        if (cancelled) return;

        const nextSettings = normalizeSettings(storedSettings);
        setProjects(projectList);
        setSettings(nextSettings);
        setStorage(storageOverview);
        lastSavedSettingsRef.current = JSON.stringify(nextSettings);

        const rememberedProjectId = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
        const initialProject = projectById(projectList, rememberedProjectId) ?? projectList[0] ?? null;

        if (initialProject) {
          await openProject(initialProject, true);
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
      void flushDocumentSave(activeProject);
    }, settings.autosaveIntervalMs);

    return () => window.clearTimeout(timer);
  }, [activeProject, body, documentMeta, settings.autosaveIntervalMs, title]);

  useEffect(() => {
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
        .catch((err) => {
          setError(`Settings sync failed: ${String(err)}`);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [settings]);

  useEffect(() => {
    if (!activeProject) return;

    const trimmedTitle = title.trim() || 'Untitled Project';
    if (trimmedTitle === lastRenamedTitleRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      void api
        .renameProject(activeProject.id, trimmedTitle)
        .then(() => {
          lastRenamedTitleRef.current = trimmedTitle;
          setProjects((prev) =>
            prev.map((project) =>
              project.id === activeProject.id ? { ...project, title: trimmedTitle, modified: new Date().toISOString() } : project
            )
          );
        })
        .catch((err) => {
          setError(`Rename failed: ${String(err)}`);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeProject, title]);

  useEffect(() => {
    if (!changesOpen || !activeProject || compareRef === 'current') {
      setDiffResult(EMPTY_DIFF);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        setDiffLoading(true);
        const previousDocument = await loadSourceBody(activeProject.id, compareRef);
        if (cancelled) return;
        setDiffResult(buildDiff(previousDocument, body, diffGranularity));
      } catch (err) {
        if (!cancelled) {
          setError(`Changes view failed: ${String(err)}`);
          setDiffResult(EMPTY_DIFF);
        }
      } finally {
        if (!cancelled) {
          setDiffLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProject, body, changesOpen, compareRef, diffGranularity]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [findQuery]);

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

  async function flushDocumentSave(project: ProjectMeta | null) {
    if (!project) return;

    const nextDocument = composeDocument(documentMeta, title, body);
    if (nextDocument === lastSavedDocumentRef.current) {
      return;
    }

    try {
      setSaveState('saving');
      await api.saveDocument(project.id, nextDocument);
      lastSavedDocumentRef.current = nextDocument;
      setSaveState('saved');
      setProjects((prev) =>
        prev.map((item) => (item.id === project.id ? { ...item, modified: new Date().toISOString() } : item))
      );
    } catch (err) {
      setSaveState('error');
      setError(`Save failed: ${String(err)}`);
    }
  }

  async function openProject(project: ProjectMeta, skipFlush = false) {
    try {
      if (!skipFlush) {
        await flushDocumentSave(activeProject);
      }

      setLoading(true);
      setError(null);
      documentCacheRef.current = {};

      const [rawDocument, savePoints, backupEntries] = await Promise.all([
        api.loadDocument(project.id),
        api.getTimeline(project.id),
        api.listBackups(project.id).catch(() => [])
      ]);

      const parsed = parseDocument(rawDocument);
      const latestSnapshot = savePoints[savePoints.length - 1] ?? null;
      const nextTitle = project.title || parsed.meta.title || 'Untitled Project';

      setActiveProjectId(project.id);
      setTitle(nextTitle);
      setDocumentMeta(parsed.meta);
      setBody(parsed.body);
      setTimeline(savePoints);
      setBackups(backupEntries);
      setCompareRef(latestSnapshot?.hash ?? 'current');
      setChangesOpen(false);
      setSettingsOpen(false);
      lastSavedDocumentRef.current = rawDocument;
      lastRenamedTitleRef.current = nextTitle;
      window.localStorage.setItem(ACTIVE_PROJECT_KEY, project.id);
      setNotice(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshProjects(activeId?: string) {
    const projectList = await api.listProjects();
    setProjects(projectList);
    if (activeId && !projectById(projectList, activeId) && projectList[0]) {
      await openProject(projectList[0], true);
    }
  }

  async function handleCreateProject() {
    const requestedTitle = window.prompt('New project title', 'Untitled Project');
    if (!requestedTitle) return;

    try {
      const created = await api.createProject(requestedTitle.trim() || 'Untitled Project');
      const nextProjects = await api.listProjects();
      setProjects(nextProjects);
      await openProject(created, true);
    } catch (err) {
      setError(`Project creation failed: ${String(err)}`);
    }
  }

  async function handleDeleteProject() {
    if (!activeProject) return;
    const confirmed = window.confirm(`Delete "${activeProject.title}" and its local backups?`);
    if (!confirmed) return;

    try {
      await api.deleteProject(activeProject.id);
      const nextProjects = await api.listProjects();
      setProjects(nextProjects);
      setBackups([]);
      setTimeline([]);
      setBody('');
      setTitle('');
      setDocumentMeta({});
      const nextProject = nextProjects[0] ?? null;
      if (nextProject) {
        await openProject(nextProject, true);
      } else {
        setActiveProjectId(null);
      }
    } catch (err) {
      setError(`Delete failed: ${String(err)}`);
    }
  }

  async function handleSnapshot() {
    if (!activeProject) return;

    try {
      await flushDocumentSave(activeProject);
      const savePoint = await api.createSavePoint(activeProject.id, '');
      const [nextTimeline, nextProjects, nextBackups] = await Promise.all([
        api.getTimeline(activeProject.id),
        api.listProjects(),
        api.listBackups(activeProject.id).catch(() => [])
      ]);

      documentCacheRef.current[savePoint.hash] = body;
      setTimeline(nextTimeline);
      setProjects(nextProjects);
      setBackups(nextBackups);
      setCompareRef(savePoint.hash);
      setChangesOpen(true);
      setNotice(`Snapshot created: ${savePoint.message}`);
    } catch (err) {
      setError(`Snapshot failed: ${String(err)}`);
    }
  }

  async function handleBackup() {
    if (!activeProject) return;

    try {
      await flushDocumentSave(activeProject);
      const created = await api.createBackup(activeProject.id);
      setBackups(await api.listBackups(activeProject.id));
      setNotice(`Backup written to ${created.path}`);
    } catch (err) {
      setError(`Backup failed: ${String(err)}`);
    }
  }

  async function handleExport(format?: ExportFormat) {
    if (!activeProject) return;

    try {
      await flushDocumentSave(activeProject);
      const exported = await api.exportProject(activeProject.id, format ?? settings.defaultExportFormat);
      setNotice(`Exported ${exported.format.toUpperCase()} to ${exported.path}`);
    } catch (err) {
      setError(`Export failed: ${String(err)}`);
    }
  }

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const lowerName = file.name.toLowerCase();
      const isDocx = lowerName.endsWith('.docx');
      const content = isDocx ? bytesToBase64(new Uint8Array(await file.arrayBuffer())) : await file.text();
      const imported = await api.importProject(file.name, content, isDocx ? 'base64' : 'utf8');
      const nextProjects = await api.listProjects();
      setProjects(nextProjects);
      await openProject(imported, true);
      setNotice(`Imported ${file.name}`);
    } catch (err) {
      setError(`Import failed: ${String(err)}`);
    } finally {
      if (event.target) {
        event.target.value = '';
      }
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
    const replacement = lines
      .map((line) => {
        if (!line.trim()) return line;
        return allPrefixed ? line.replace(prefix, '') : `${prefix}${line}`;
      })
      .join('\n');

    const nextBody = `${body.slice(0, lineStart)}${replacement}${body.slice(lineEnd)}`;
    updateTextareaSelection(replacement, lineStart, lineStart + replacement.length, nextBody);
  }

  function insertSceneBreak() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const replacement = '\n\n* * *\n\n';
    const nextBody = `${body.slice(0, start)}${replacement}${body.slice(textarea.selectionEnd)}`;
    updateTextareaSelection(replacement, start + replacement.length, start + replacement.length, nextBody);
  }

  function jumpToMatch(direction: 1 | -1) {
    if (!searchMatches.length || !textareaRef.current) return;

    const nextIndex =
      (activeMatchIndex + direction + searchMatches.length) % searchMatches.length;
    const match = searchMatches[nextIndex];
    setActiveMatchIndex(nextIndex);
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(match.start, match.end);
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

    if (key === 'f') {
      event.preventDefault();
      const selected = body.slice(textareaRef.current?.selectionStart ?? 0, textareaRef.current?.selectionEnd ?? 0).trim();
      if (selected) {
        setFindQuery(selected);
      }
    }
  }

  const themeClass = settings.theme === 'light' ? 'theme-light' : settings.theme === 'system' ? 'theme-system' : 'theme-mist';
  const shellClass = `app-shell ${themeClass} ${settings.focusMode ? 'focus-mode' : ''}`;

  if (loading) {
    return (
      <div className={`state-screen ${themeClass}`}>
        <div className="brand-lockup">
          <span className="brand-mark">{BRAND_NAME}</span>
          <h1>Loading your writing studio…</h1>
        </div>
      </div>
    );
  }

  if (!activeProject) {
    return (
      <div className={`state-screen ${themeClass}`}>
        <div className="brand-lockup">
          <span className="brand-mark">{BRAND_NAME}</span>
          <h1>A sharper desktop writing studio.</h1>
          <p>Thin ribbon controls, snapshots that compare properly, and backups you can move between machines.</p>
        </div>

        <div className="welcome-actions">
          <button className="primary-button" onClick={() => void handleCreateProject()}>
            New project
          </button>
          <button className="secondary-button" onClick={() => fileInputRef.current?.click()}>
            Import file
          </button>
        </div>

        {projects.length > 0 && (
          <div className="project-grid">
            {projects.map((project) => (
              <button key={project.id} className="project-card" onClick={() => void openProject(project, true)}>
                <strong>{project.title}</strong>
                <span>
                  {project.wordCount} words · {project.savePointCount} snapshots
                </span>
              </button>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept=".docx,.md,.txt,.markdown,.inkline,.json"
          onChange={(event) => void handleImport(event)}
        />
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept=".docx,.md,.txt,.markdown,.inkline,.json"
        onChange={(event) => void handleImport(event)}
      />

      <header className="window-header">
        <div className="brand-lockup inline">
          <span className="brand-mark">{BRAND_NAME}</span>
          <p>Write, compare, recover.</p>
        </div>

        <div className="header-actions">
          <span className={`save-pill state-${saveState}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Save error' : 'Ready'}</span>
          <button className="secondary-button" onClick={() => setSettingsOpen((open) => !open)}>
            Settings
          </button>
          <button className="secondary-button" onClick={() => setChangesOpen((open) => !open)}>
            Changes
          </button>
          <button className="primary-button" onClick={() => void handleSnapshot()}>
            Snapshot
          </button>
        </div>
      </header>

      <section className="ribbon-shell">
        <div className="ribbon-tabs">
          <span className="tab active">Home</span>
          <span className="tab">Review</span>
          <span className="tab">View</span>
          <span className="tab">File</span>
        </div>

        <div className="ribbon">
          <div className="ribbon-group">
            <label className="field">
              <span>Project</span>
              <select
                value={activeProject.id}
                onChange={(event) => {
                  const nextProject = projectById(projects, event.target.value);
                  if (nextProject) {
                    void openProject(nextProject);
                  }
                }}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button className="icon-button" onClick={() => void handleCreateProject()}>
                New
              </button>
              <button className="icon-button" onClick={() => fileInputRef.current?.click()}>
                Import
              </button>
              <button className="icon-button" onClick={() => void handleExport()}>
                Export
              </button>
            </div>
            <span className="group-label">Project</span>
          </div>

          <div className="ribbon-group">
            <div className="button-row">
              <button className="icon-button strong" onClick={() => wrapSelection('**')}>
                B
              </button>
              <button className="icon-button italic" onClick={() => wrapSelection('*')}>
                I
              </button>
              <button className="icon-button" onClick={() => wrapSelection('<u>', '</u>')}>
                U
              </button>
              <button className="icon-button" onClick={() => toggleLinePrefix('> ')}>
                Quote
              </button>
              <button className="icon-button" onClick={() => toggleLinePrefix('- ')}>
                List
              </button>
              <button className="icon-button" onClick={insertSceneBreak}>
                Break
              </button>
            </div>
            <span className="group-label">Format</span>
          </div>

          <div className="ribbon-group">
            <div className="compact-grid">
              <label className="field">
                <span>Font</span>
                <select value={settings.font} onChange={(event) => setSettings((prev) => ({ ...prev, font: event.target.value }))}>
                  {FONT_OPTIONS.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Size</span>
                <select
                  value={settings.fontSize}
                  onChange={(event) => setSettings((prev) => ({ ...prev, fontSize: Number(event.target.value) }))}
                >
                  {FONT_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Width</span>
                <select
                  value={settings.editorWidth}
                  onChange={(event) => setSettings((prev) => ({ ...prev, editorWidth: Number(event.target.value) }))}
                >
                  {WIDTH_OPTIONS.map((width) => (
                    <option key={width} value={width}>
                      {width}px
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Leading</span>
                <select
                  value={settings.lineHeight}
                  onChange={(event) => setSettings((prev) => ({ ...prev, lineHeight: Number(event.target.value) }))}
                >
                  {LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                    <option key={lineHeight} value={lineHeight}>
                      {lineHeight}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <span className="group-label">Page</span>
          </div>

          <div className="ribbon-group">
            <div className="button-row wrap">
              <button
                className={`toggle-chip ${settings.showRuler ? 'active' : ''}`}
                onClick={() => setSettings((prev) => ({ ...prev, showRuler: !prev.showRuler }))}
              >
                Ruler
              </button>
              <button
                className={`toggle-chip ${settings.showSpellcheck ? 'active' : ''}`}
                onClick={() => setSettings((prev) => ({ ...prev, showSpellcheck: !prev.showSpellcheck }))}
              >
                Spellcheck
              </button>
              <button
                className={`toggle-chip ${settings.highlightMatches ? 'active' : ''}`}
                onClick={() => setSettings((prev) => ({ ...prev, highlightMatches: !prev.highlightMatches }))}
              >
                Matches
              </button>
              <button
                className={`toggle-chip ${settings.focusMode ? 'active' : ''}`}
                onClick={() => setSettings((prev) => ({ ...prev, focusMode: !prev.focusMode }))}
              >
                Focus
              </button>
            </div>
            <span className="group-label">View</span>
          </div>

          <div className="ribbon-group grow">
            <div className="search-strip">
              <label className="search-field">
                <span>Find</span>
                <input value={findQuery} onChange={(event) => setFindQuery(event.target.value)} placeholder="Find in draft" />
              </label>
              <span className="match-pill">
                {searchMatches.length ? `${activeMatchIndex + 1}/${searchMatches.length}` : '0 matches'}
              </span>
              <button className="icon-button" onClick={() => jumpToMatch(-1)} disabled={!searchMatches.length}>
                Prev
              </button>
              <button className="icon-button" onClick={() => jumpToMatch(1)} disabled={!searchMatches.length}>
                Next
              </button>
            </div>
            <span className="group-label">Find</span>
          </div>
        </div>
      </section>

      <main className="workspace">
        <section className="editor-shell">
          <div className="document-header">
            <input
              className="title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                if (!title.trim()) {
                  setTitle('Untitled Project');
                }
              }}
            />

            <div className="document-meta">
              <span>{activeProject.savePointCount} snapshots</span>
              <span>Modified {formatTimestamp(activeProject.modified)}</span>
              <span>{readingTimeLabel(wordCount)}</span>
            </div>
          </div>

          {settings.showRuler && (
            <div className="ruler">
              {Array.from({ length: 12 }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
          )}

          <div className="editor-surface" style={{ maxWidth: settings.editorWidth }}>
            <textarea
              ref={textareaRef}
              className="editor"
              value={body}
              spellCheck={settings.showSpellcheck}
              onBlur={() => void flushDocumentSave(activeProject)}
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              placeholder="Start writing…"
              style={{
                fontFamily: settings.font,
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight
              }}
            />
          </div>
        </section>

        {settingsOpen && (
          <aside className="side-panel settings-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Settings</span>
                <h2>Writing controls</h2>
              </div>
              <button className="icon-button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>

            <section className="panel-section">
              <h3>Drafting</h3>
              <div className="settings-grid">
                <label className="field">
                  <span>Autosave</span>
                  <select
                    value={settings.autosaveIntervalMs}
                    onChange={(event) => setSettings((prev) => ({ ...prev, autosaveIntervalMs: Number(event.target.value) }))}
                  >
                    {AUTOSAVE_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value / 1000}s
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Backup cadence</span>
                  <select
                    value={settings.backupIntervalMs}
                    onChange={(event) => setSettings((prev) => ({ ...prev, backupIntervalMs: Number(event.target.value) }))}
                  >
                    {BACKUP_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {Math.round(value / 60000)} min
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Theme</span>
                  <select value={settings.theme} onChange={(event) => setSettings((prev) => ({ ...prev, theme: event.target.value as AppSettings['theme'] }))}>
                    <option value="mist">Mist</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </select>
                </label>
                <label className="field">
                  <span>Default export</span>
                  <select
                    value={settings.defaultExportFormat}
                    onChange={(event) => setSettings((prev) => ({ ...prev, defaultExportFormat: event.target.value as ExportFormat }))}
                  >
                    {EXPORT_OPTIONS.map((format) => (
                      <option key={format} value={format}>
                        {format.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <section className="panel-section">
              <h3>Interface</h3>
              <div className="toggle-list">
                <button className={`toggle-row ${settings.showWordCount ? 'active' : ''}`} onClick={() => setSettings((prev) => ({ ...prev, showWordCount: !prev.showWordCount }))}>
                  Word count
                </button>
                <button className={`toggle-row ${settings.showCharacterCount ? 'active' : ''}`} onClick={() => setSettings((prev) => ({ ...prev, showCharacterCount: !prev.showCharacterCount }))}>
                  Character count
                </button>
                <button className={`toggle-row ${settings.showReadingTime ? 'active' : ''}`} onClick={() => setSettings((prev) => ({ ...prev, showReadingTime: !prev.showReadingTime }))}>
                  Reading time
                </button>
                <button className={`toggle-row ${settings.showStatusBar ? 'active' : ''}`} onClick={() => setSettings((prev) => ({ ...prev, showStatusBar: !prev.showStatusBar }))}>
                  Status bar
                </button>
              </div>
            </section>

            <section className="panel-section">
              <h3>Backups and transfer</h3>
              <div className="path-list">
                <div>
                  <span>Workspace</span>
                  <code>{storage?.appRoot || settings.projectsDirectory}</code>
                </div>
                <div>
                  <span>Backups</span>
                  <code>{storage?.backupsDirectory || settings.backupsDirectory}</code>
                </div>
                <div>
                  <span>Exports</span>
                  <code>{storage?.exportsDirectory || settings.exportsDirectory}</code>
                </div>
              </div>
              <div className="button-row wrap">
                <button className="secondary-button" onClick={() => void handleBackup()}>
                  Create backup now
                </button>
                <button className="secondary-button" onClick={() => void handleExport('inkline')}>
                  Export portable bundle
                </button>
                <button className="secondary-button" onClick={() => fileInputRef.current?.click()}>
                  Import Word or text
                </button>
              </div>
            </section>

            <section className="panel-section">
              <h3>Project maintenance</h3>
              <div className="button-row wrap">
                <button className="secondary-button" onClick={() => void refreshProjects(activeProject.id)}>
                  Refresh project list
                </button>
                <button className="danger-button" onClick={() => void handleDeleteProject()}>
                  Delete project
                </button>
              </div>
            </section>
          </aside>
        )}
      </main>

      <aside className={`changes-drawer ${changesOpen ? 'open' : ''}`}>
        <div className="changes-header">
          <div>
            <span className="panel-kicker">Changes</span>
            <h2>Snapshot compare</h2>
          </div>
          <button className="icon-button" onClick={() => setChangesOpen(false)}>
            Close
          </button>
        </div>

        <div className="changes-toolbar">
          <label className="field">
            <span>Compare from</span>
            <select value={compareRef} onChange={(event) => setCompareRef(event.target.value)}>
              <option value="current">Current draft</option>
              {[...timeline].reverse().map((point) => (
                <option key={point.hash} value={point.hash}>
                  {point.message} · {formatTimestamp(point.timestamp)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Granularity</span>
            <select
              value={diffGranularity}
              onChange={(event) => setDiffGranularity(event.target.value as DiffGranularity)}
            >
              <option value="paragraphs">Paragraphs</option>
              <option value="lines">Lines</option>
            </select>
          </label>
          <button className={`toggle-chip ${showUnchanged ? 'active' : ''}`} onClick={() => setShowUnchanged((value) => !value)}>
            Show unchanged
          </button>
        </div>

        <div className="changes-layout">
          <div className="snapshot-rail">
            {[...timeline].reverse().map((point) => (
              <button
                key={point.hash}
                className={`snapshot-card ${compareRef === point.hash ? 'active' : ''}`}
                onClick={() => setCompareRef(point.hash)}
              >
                <strong>{point.message}</strong>
                <span>{formatTimestamp(point.timestamp)}</span>
                <small>{point.changeSize} changed words</small>
              </button>
            ))}
          </div>

          <div className="diff-stage">
            <div className="diff-summary">
              <span className="summary-pill added">{diffSummary.added} added</span>
              <span className="summary-pill modified">{diffSummary.modified} modified</span>
              <span className="summary-pill deleted">{diffSummary.deleted} deleted</span>
            </div>

            {diffLoading ? (
              <div className="empty-panel">Loading diff…</div>
            ) : compareRef === 'current' ? (
              <div className="empty-panel">Pick a snapshot from the rail to compare against the live draft.</div>
            ) : visibleDiffBlocks.length === 0 ? (
              <div className="empty-panel">No visible changes for this selection.</div>
            ) : (
              <div className="diff-grid">
                {visibleDiffBlocks.map((block, index) => (
                  <div key={`${block.type}-${index}`} className={`diff-row ${block.type}`}>
                    <div className="diff-pane left">{renderDiffSide(block, 'left')}</div>
                    <div className="diff-pane right">{renderDiffSide(block, 'right')}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>

      {settings.showStatusBar && (
        <footer className="status-bar">
          <div className="status-left">
            {settings.showWordCount && <span>{wordCount} words</span>}
            {settings.showCharacterCount && <span>{characterCount} chars</span>}
            {settings.showReadingTime && <span>{readingTimeLabel(wordCount)}</span>}
            <span>{backups.length} backups</span>
          </div>
          <div className="status-right">
            {notice && <span className="notice-text">{notice}</span>}
            {error && <span className="error-text">{error}</span>}
          </div>
        </footer>
      )}
    </div>
  );
}
