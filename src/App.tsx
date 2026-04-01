import { useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';
import type { DiffBlock, DiffResult, ProjectMeta, SavePoint, WordDiff } from './lib/types';

type DiffViewMode = 'split' | 'focus' | 'unified';

const EMPTY_DIFF: DiffResult = { blocks: [] };

const DIFF_VIEW_OPTIONS: Array<{ mode: DiffViewMode; label: string }> = [
  { mode: 'split', label: 'Split' },
  { mode: 'focus', label: 'Changes' },
  { mode: 'unified', label: 'Unified' }
];

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
    return <span className="diff-empty">No matching paragraph</span>;
  }

  return <span className="diff-copy">{content}</span>;
}

export function App() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectMeta | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [timeline, setTimeline] = useState<SavePoint[]>([]);
  const [selectedSavePoint, setSelectedSavePoint] = useState<SavePoint | null>(null);
  const [diffResult, setDiffResult] = useState<DiffResult>(EMPTY_DIFF);
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('split');
  const [saveMessage, setSaveMessage] = useState('');
  const [showSavePointModal, setShowSavePointModal] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showDiff, setShowDiff] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isCreatingSavePoint, setIsCreatingSavePoint] = useState(false);
  const [isDiffLoading, setIsDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const list = await api.listProjects();
        setProjects(list);
        if (list.length > 0) {
          await openProject(list[0]);
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!activeProject) return;

    const timer = setTimeout(() => {
      void api.saveDocument(activeProject.id, content).catch((err) => {
        setError(`Autosave failed: ${String(err)}`);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [activeProject, content]);

  async function compareAgainstSavePoint(projectId: string, savePoint: SavePoint) {
    setSelectedSavePoint(savePoint);
    setShowDiff(true);

    try {
      setIsDiffLoading(true);
      const diff = await api.computeDiff(projectId, savePoint.hash, 'current');
      setDiffResult(diff);
      setError(null);
    } catch (err) {
      setError(`Diff failed: ${String(err)}`);
      setDiffResult(EMPTY_DIFF);
    } finally {
      setIsDiffLoading(false);
    }
  }

  async function openProject(project: ProjectMeta) {
    try {
      setLoading(true);
      setError(null);
      setActiveProject(project);
      setTitle(project.title);

      const [doc, savePoints] = await Promise.all([api.loadDocument(project.id), api.getTimeline(project.id)]);
      const latestSavePoint = getLatestSavePoint(savePoints);

      setContent(doc);
      setTimeline(savePoints);
      setSelectedSavePoint(latestSavePoint);
      setShowTimeline(true);

      if (latestSavePoint) {
        await compareAgainstSavePoint(project.id, latestSavePoint);
      } else {
        setDiffResult(EMPTY_DIFF);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function createProject() {
    const newTitle = window.prompt('New project title', 'Untitled Project');
    if (!newTitle) return;
    const trimmedTitle = newTitle.trim();
    if (!trimmedTitle) return;

    try {
      const created = await api.createProject(trimmedTitle);
      const next = await api.listProjects();
      setProjects(next);
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

      await api.saveDocument(activeProject.id, content);
      const saved = await api.createSavePoint(activeProject.id, saveMessage);
      const [nextProjects, nextTimeline] = await Promise.all([
        api.listProjects(),
        api.getTimeline(activeProject.id)
      ]);

      const nextSelected =
        nextTimeline.find((point) => point.hash === saved.hash) ??
        getLatestSavePoint(nextTimeline) ??
        saved;

      setProjects(nextProjects);
      setTimeline(nextTimeline);
      setSaveMessage('');
      setShowSavePointModal(false);
      setShowTimeline(true);

      await compareAgainstSavePoint(activeProject.id, nextSelected);
    } catch (err) {
      setError(`Save point failed: ${String(err)}`);
    } finally {
      setIsCreatingSavePoint(false);
    }
  }

  async function compareSelectedSavePoint() {
    if (!activeProject) return;

    const target = selectedSavePoint ?? getLatestSavePoint(timeline);
    if (!target) {
      setDiffResult(EMPTY_DIFF);
      setShowDiff(true);
      return;
    }

    await compareAgainstSavePoint(activeProject.id, target);
  }

  const wordCount = useMemo(() => {
    const raw = content.trim();
    if (!raw) return 0;
    return raw.split(/\s+/).length;
  }, [content]);

  const visibleBlocks = useMemo(() => {
    if (diffViewMode === 'focus') {
      return diffResult.blocks.filter((block) => block.type !== 'unchanged');
    }

    return diffResult.blocks;
  }, [diffResult.blocks, diffViewMode]);

  const diffSummary = useMemo(() => {
    return diffResult.blocks.reduce(
      (summary, block) => {
        if (block.type === 'added') summary.added += 1;
        if (block.type === 'deleted') summary.deleted += 1;
        if (block.type === 'modified') summary.modified += 1;
        return summary;
      },
      { added: 0, deleted: 0, modified: 0 }
    );
  }, [diffResult.blocks]);

  if (loading) {
    return <div className="state-screen">Loading Psychic Umbrella…</div>;
  }

  if (!activeProject) {
    return (
      <div className="state-screen">
        <span className="brand-mark">Psychic Umbrella</span>
        <h1>Write with save points, not files.</h1>
        <p>Create your first project to open the editor and compare revisions paragraph by paragraph.</p>
        <button className="primary" onClick={() => void createProject()}>
          New Project
        </button>

        {projects.length > 0 && (
          <div className="project-list">
            {projects.map((project) => (
              <button key={project.id} className="project-card" onClick={() => void openProject(project)}>
                <div>{project.title}</div>
                <small>
                  {project.wordCount} words · {project.savePointCount} save points
                </small>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-copy">
          <span className="brand-mark">Psychic Umbrella</span>
          <input
            aria-label="Document title"
            className="title-input"
            value={title}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              setProjects((prev) =>
                prev.map((project) => (project.id === activeProject.id ? { ...project, title: nextTitle } : project))
              );
              setActiveProject((prev) => (prev ? { ...prev, title: nextTitle } : prev));
              void api.renameProject(activeProject.id, nextTitle).catch((err) => setError(String(err)));
            }}
          />
          <div className="top-bar-meta">
            <span>{wordCount} words</span>
            <span>{timeline.length} save points</span>
          </div>
        </div>

        <div className="actions">
          <button className="icon-button" onClick={() => setShowSavePointModal(true)}>
            Save Point
          </button>
          <button className="icon-button" onClick={() => setShowTimeline((open) => !open)}>
            {showTimeline ? 'Hide Timeline' : 'Show Timeline'}
          </button>
          <button className="icon-button" onClick={() => void compareSelectedSavePoint()}>
            Refresh Diff
          </button>
          <button className="icon-button" onClick={() => setShowDiff((open) => !open)}>
            {showDiff ? 'Hide Diff' : 'Show Diff'}
          </button>
          <button className="primary" onClick={() => void createProject()}>
            New
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className={`workspace-shell ${showTimeline ? 'with-timeline' : ''} ${showDiff ? 'with-diff' : ''}`}>
        {showTimeline && (
          <aside className="timeline-sidebar">
            <div className="sidebar-header">
              <span className="sidebar-label">Save Points</span>
              <span className="sidebar-caption">Select a moment to compare against the current draft.</span>
            </div>

            {timeline.length === 0 ? (
              <p className="sidebar-empty">No save points yet. Create one to start the timeline.</p>
            ) : (
              <div className="timeline-track">
                {timeline.map((point, index) => {
                  const isSelected = selectedSavePoint?.hash === point.hash;
                  const isLast = index === timeline.length - 1;

                  return (
                    <button
                      key={point.hash}
                      className={`timeline-node ${isSelected ? 'selected' : ''}`}
                      title={`${point.message} • ${formatTimestamp(point.timestamp)}`}
                      onClick={() => void compareAgainstSavePoint(activeProject.id, point)}
                    >
                      {!isLast && <span className="timeline-stem" aria-hidden="true" />}
                      <span className="timeline-dot" aria-hidden="true" />
                      <span className="timeline-label">{point.message || 'Untitled save point'}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <article className="savepoint-card">
              <span className="sidebar-label">Selected Save Point</span>
              {selectedSavePoint ? (
                <>
                  <strong>{selectedSavePoint.message}</strong>
                  <p>{formatTimestamp(selectedSavePoint.timestamp)}</p>
                  <div className="savepoint-stats">
                    <span>{selectedSavePoint.changeSize} changed words</span>
                    <span>Compared to current draft</span>
                  </div>
                </>
              ) : (
                <p>Pick a save point to see the side-by-side paragraph diff.</p>
              )}
            </article>
          </aside>
        )}

        <section className="editor-stage">
          <div className="editor-surface">
            <div className="editor-header">
              <span className="editor-label">Current Draft</span>
              <span className="editor-caption">Autosaves after a short pause.</span>
            </div>
            <textarea
              aria-label="Editor"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="editor"
              placeholder="Start writing..."
            />
          </div>
        </section>

        {showDiff && (
          <aside className="diff-pane">
            <div className="diff-toolbar">
              <div>
                <span className="sidebar-label">Paragraph Diff</span>
                <h2>{selectedSavePoint ? selectedSavePoint.message : 'Current draft only'}</h2>
                <p className="diff-caption">GitHub-inspired review layout with paragraph pairing and word-level highlights.</p>
              </div>

              <div className="diff-view-switcher" role="tablist" aria-label="Diff view options">
                {DIFF_VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.mode}
                    className={`view-chip ${diffViewMode === option.mode ? 'active' : ''}`}
                    aria-pressed={diffViewMode === option.mode}
                    onClick={() => setDiffViewMode(option.mode)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="diff-summary">
              <span>{diffSummary.modified} edited</span>
              <span>{diffSummary.added} added</span>
              <span>{diffSummary.deleted} removed</span>
            </div>

            {isDiffLoading ? (
              <p className="diff-placeholder">Loading comparison…</p>
            ) : visibleBlocks.length === 0 ? (
              <p className="diff-placeholder">No paragraph changes between the selected save point and the current draft.</p>
            ) : diffViewMode === 'unified' ? (
              <div className="diff-unified-list">
                {visibleBlocks.map((block, index) => (
                  <article key={`${block.type}-${index}`} className={`unified-block diff-${block.type}`}>
                    <div className="unified-header">
                      <span>Paragraph {index + 1}</span>
                      <strong>{block.type}</strong>
                    </div>
                    <div className="unified-columns">
                      <div className="unified-column">
                        <span className="unified-label">Selected</span>
                        <div className="diff-copy">{renderDiffSide(block, 'left')}</div>
                      </div>
                      <div className="unified-column">
                        <span className="unified-label">Current</span>
                        <div className="diff-copy">{renderDiffSide(block, 'right')}</div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="split-diff-table">
                <div className="split-diff-head">Selected save point</div>
                <div className="split-diff-head">Current draft</div>

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
      </div>

      {showSavePointModal && (
        <div className="save-point-modal" role="dialog" aria-modal="true">
          <span className="sidebar-label">Create Save Point</span>
          <h2>Name this save point</h2>
          <input
            value={saveMessage}
            onChange={(event) => setSaveMessage(event.target.value)}
            placeholder='e.g. "Rewrote opening section"'
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
              {isCreatingSavePoint ? 'Saving…' : 'Save'}
            </button>
            <button className="icon-button" onClick={() => setShowSavePointModal(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
