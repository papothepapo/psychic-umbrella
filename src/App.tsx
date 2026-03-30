import { useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';
import type { DiffResult, ProjectMeta, SavePoint } from './lib/types';

/**
 * Primary application shell.
 *
 * This file intentionally contains high-level UI orchestration so contributors can
 * quickly understand state flow from project selection -> editor -> timeline/diff.
 */
export function App() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectMeta | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [timeline, setTimeline] = useState<SavePoint[]>([]);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [saveMessage, setSaveMessage] = useState('');
  const [showSavePointModal, setShowSavePointModal] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initial boot: load projects and open the most recently modified one.
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

  // Debounced autosave every 2 seconds of inactivity.
  useEffect(() => {
    if (!activeProject) return;

    const timer = setTimeout(() => {
      void api.saveDocument(activeProject.id, content).catch((err) => {
        setError(`Autosave failed: ${String(err)}`);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [activeProject, content]);

  async function openProject(project: ProjectMeta) {
    setActiveProject(project);
    setTitle(project.title);

    const [doc, savePoints] = await Promise.all([
      api.loadDocument(project.id),
      api.getTimeline(project.id)
    ]);

    setContent(doc);
    setTimeline(savePoints);
    setDiffResult(null);
    setShowDiff(false);
  }

  async function createProject() {
    const newTitle = window.prompt('New project title', 'Untitled Project');
    if (!newTitle) return;

    const created = await api.createProject(newTitle);
    const next = await api.listProjects();
    setProjects(next);
    await openProject(created);
  }

  async function createSavePoint() {
    if (!activeProject) return;

    await api.saveDocument(activeProject.id, content);
    const saved = await api.createSavePoint(activeProject.id, saveMessage);
    setTimeline((prev) => [...prev, saved]);
    setSaveMessage('');
    setShowSavePointModal(false);
  }

  async function computeLatestDiff() {
    if (!activeProject) return;

    if (timeline.length === 0) {
      setDiffResult({ blocks: [] });
      return;
    }

    const latest = timeline[timeline.length - 1];
    const diff = await api.computeDiff(activeProject.id, latest.hash, 'current');
    setDiffResult(diff);
    setShowDiff(true);
  }

  const wordCount = useMemo(() => {
    const raw = content.trim();
    if (!raw) return 0;
    return raw.split(/\s+/).length;
  }, [content]);

  if (loading) {
    return <div className="state-screen">Loading Diff…</div>;
  }

  if (!activeProject) {
    return (
      <div className="state-screen">
        <h1>Diff</h1>
        <p>Create your first project to start writing.</p>
        <button className="primary" onClick={() => void createProject()}>
          New Project
        </button>

        {projects.length > 0 && (
          <div className="project-list">
            {projects.map((project) => (
              <button key={project.id} className="project-card" onClick={() => void openProject(project)}>
                <div>{project.title}</div>
                <small>{project.wordCount} words</small>
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
        <input
          aria-label="Document title"
          className="title-input"
          value={title}
          onChange={(event) => {
            const nextTitle = event.target.value;
            setTitle(nextTitle);
            void api.renameProject(activeProject.id, nextTitle).catch((err) => setError(String(err)));
          }}
        />
        <span className="word-count">{wordCount} words</span>

        <div className="actions">
          <button className="icon-button" onClick={() => setShowSavePointModal(true)}>
            Save Point
          </button>
          <button className="icon-button" onClick={() => setShowTimeline((open) => !open)}>
            Timeline
          </button>
          <button className="icon-button" onClick={() => void computeLatestDiff()}>
            Diff
          </button>
          <button className="icon-button" onClick={() => void createProject()}>
            New
          </button>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <main className={showDiff ? 'editor-layout split' : 'editor-layout'}>
        <section className="editor-pane">
          <textarea
            aria-label="Editor"
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="editor"
            placeholder="Start writing..."
          />
        </section>

        {showDiff && (
          <section className="editor-pane diff-pane">
            <div className="pane-header">Paragraph Diff (last save point → current)</div>
            {!diffResult || diffResult.blocks.length === 0 ? (
              <p className="diff-placeholder">No diff blocks yet.</p>
            ) : (
              <div className="diff-block-list">
                {diffResult.blocks.map((block, idx) => (
                  <article key={`${block.type}-${idx}`} className={`diff-block diff-${block.type}`}>
                    <h4>{block.type.toUpperCase()}</h4>
                    {block.leftContent && <pre>{block.leftContent}</pre>}
                    {block.rightContent && block.rightContent !== block.leftContent && <pre>{block.rightContent}</pre>}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {showTimeline && (
        <footer className="timeline-bar">
          {timeline.length === 0 ? (
            <p>No save points yet. Press Cmd+S to create one.</p>
          ) : (
            <div className="timeline-row">
              {timeline.map((point) => (
                <button key={point.hash} className="timeline-dot" title={`${point.message} • ${point.timestamp}`}>
                  <span className="sr-only">{point.message}</span>
                </button>
              ))}
            </div>
          )}
        </footer>
      )}

      {showSavePointModal && (
        <div className="save-point-modal" role="dialog" aria-modal="true">
          <h2>Name this save point...</h2>
          <input
            value={saveMessage}
            onChange={(event) => setSaveMessage(event.target.value)}
            placeholder='e.g. "Rewrote intro"'
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
              Save
            </button>
            <button onClick={() => setShowSavePointModal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
