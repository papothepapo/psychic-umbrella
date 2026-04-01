#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Diff backend (Tauri commands)
//! ---------------------------------
//! This file intentionally keeps most of the application backend in one place for
//! readability while the project is still early-stage. As the codebase grows,
//! command groups should move into modules (`projects`, `git_ops`, `comments`, etc.).

use chrono::Utc;
use git2::{Oid, Repository, Signature};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
};
use uuid::Uuid;

// -----------------------------
// Shared serializable data types
// -----------------------------

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectMeta {
    id: String,
    title: String,
    created: String,
    modified: String,
    word_count: usize,
    save_point_count: usize,
    path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SavePoint {
    hash: String,
    message: String,
    timestamp: String,
    #[serde(rename = "changeSize")]
    change_size: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChangeStats {
    words_added: usize,
    words_deleted: usize,
    paragraphs_changed: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiffResult {
    blocks: Vec<DiffBlock>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DiffBlock {
    #[serde(rename = "type")]
    block_type: String,
    left_content: Option<String>,
    right_content: Option<String>,
    word_diffs: Option<Vec<WordDiff>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct WordDiff {
    #[serde(rename = "type")]
    diff_type: String,
    text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CommentThread {
    id: String,
    paragraph_id: String,
    resolved: bool,
    comments: Vec<Comment>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Comment {
    id: String,
    author: String,
    text: String,
    timestamp: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct CommentsFile {
    threads: Vec<CommentThread>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    theme: String,
    font: String,
    font_size: u8,
    projects_directory: String,
    autosave_interval_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MergeResult {
    blocks: Vec<MergeBlock>,
    has_conflicts: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MergeBlock {
    #[serde(rename = "type")]
    block_type: String,
    content: Option<String>,
    yours: Option<String>,
    theirs: Option<String>,
    block_index: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConflictResolution {
    block_index: usize,
    choice: String,
}

// -----------------------------
// Paths / storage bootstrap
// -----------------------------

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn app_root() -> PathBuf {
    home_dir().join("Diff")
}

fn app_config_path() -> PathBuf {
    app_root().join(".diff-config.json")
}

fn app_db_path() -> PathBuf {
    app_root().join("index.sqlite3")
}

fn project_path(project_id: &str) -> PathBuf {
    app_root().join(project_id)
}

fn document_path(project_id: &str) -> PathBuf {
    project_path(project_id).join("document.md")
}

fn comments_path(project_id: &str) -> PathBuf {
    project_path(project_id).join("document.comments.json")
}

fn ensure_app_ready() -> Result<(), String> {
    fs::create_dir_all(app_root()).map_err(|e| e.to_string())?;
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;

    // Single table index for lightweight project metadata listing and search.
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created TEXT NOT NULL,
          modified TEXT NOT NULL,
          path TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_projects_title ON projects(title);
        CREATE INDEX IF NOT EXISTS idx_projects_modified ON projects(modified);
    ",
    )
    .map_err(|e| e.to_string())?;

    if !app_config_path().exists() {
        let settings = AppSettings {
            theme: "system".into(),
            font: "Lora".into(),
            font_size: 18,
            projects_directory: app_root().to_string_lossy().to_string(),
            autosave_interval_ms: 2000,
        };
        let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        fs::write(app_config_path(), json).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn ensure_project_exists(project_id: &str) -> Result<PathBuf, String> {
    let path = project_path(project_id);
    if path.exists() {
        Ok(path)
    } else {
        Err(format!("Project does not exist: {project_id}"))
    }
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn markdown_body(markdown: &str) -> &str {
    // Strip YAML frontmatter if present to avoid counting metadata as words.
    if markdown.starts_with("---\n") {
        let rest = &markdown[4..];
        if let Some(idx) = rest.find("\n---\n") {
            return &rest[idx + 5..];
        }
    }
    markdown
}

fn repo_save_point_count(repo: &Repository) -> usize {
    let Ok(mut revwalk) = repo.revwalk() else {
        return 0;
    };
    if revwalk.push_head().is_err() {
        return 0;
    }
    revwalk.flatten().count()
}

fn read_commit_document(repo: &Repository, oid: Oid) -> Result<String, String> {
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    let entry = tree
        .get_name("document.md")
        .ok_or_else(|| "document.md not found in selected save point".to_string())?;
    let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
    String::from_utf8(blob.content().to_vec()).map_err(|e| e.to_string())
}

fn open_comments_file(project_id: &str) -> Result<CommentsFile, String> {
    let path = comments_path(project_id);
    if !path.exists() {
        return Ok(CommentsFile { threads: vec![] });
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_comments_file(project_id: &str, comments: &CommentsFile) -> Result<(), String> {
    let json = serde_json::to_string_pretty(comments).map_err(|e| e.to_string())?;
    fs::write(comments_path(project_id), json).map_err(|e| e.to_string())
}

fn split_blocks(markdown: &str) -> Vec<String> {
    markdown
        .split("\n\n")
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn tokenize_words(text: &str) -> Vec<String> {
    text.split_whitespace().map(ToString::to_string).collect()
}

fn normalize_words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|word| {
            word.trim_matches(|ch: char| !ch.is_alphanumeric())
                .to_lowercase()
        })
        .filter(|word| !word.is_empty())
        .collect()
}

fn paragraph_similarity(left: &str, right: &str) -> f32 {
    let left_words = normalize_words(left);
    let right_words = normalize_words(right);

    if left_words.is_empty() && right_words.is_empty() {
        return 1.0;
    }

    let mut left_counts = HashMap::new();
    for word in left_words {
        *left_counts.entry(word).or_insert(0usize) += 1;
    }

    let mut right_counts = HashMap::new();
    for word in right_words {
        *right_counts.entry(word).or_insert(0usize) += 1;
    }

    let mut overlap = 0usize;
    let mut total = 0usize;

    for (word, left_count) in &left_counts {
        let right_count = right_counts.get(word).copied().unwrap_or(0);
        overlap += (*left_count).min(right_count);
        total += (*left_count).max(right_count);
    }

    for (word, right_count) in &right_counts {
        if !left_counts.contains_key(word) {
            total += *right_count;
        }
    }

    if total == 0 {
        0.0
    } else {
        overlap as f32 / total as f32
    }
}

fn substitution_cost(left: &str, right: &str) -> usize {
    if left == right {
        0
    } else if paragraph_similarity(left, right) >= 0.35 {
        1
    } else {
        2
    }
}

fn simple_word_diff(left: &str, right: &str) -> Vec<WordDiff> {
    let left_words = tokenize_words(left);
    let right_words = tokenize_words(right);

    // Lightweight LCS diff to produce reasonably readable inserted/deleted/equal spans.
    let n = left_words.len();
    let m = right_words.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];

    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if left_words[i] == right_words[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }

    let mut i = 0;
    let mut j = 0;
    let mut out = Vec::new();
    while i < n && j < m {
        if left_words[i] == right_words[j] {
            out.push(WordDiff {
                diff_type: "equal".into(),
                text: format!("{} ", left_words[i]),
            });
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            out.push(WordDiff {
                diff_type: "delete".into(),
                text: format!("{} ", left_words[i]),
            });
            i += 1;
        } else {
            out.push(WordDiff {
                diff_type: "insert".into(),
                text: format!("{} ", right_words[j]),
            });
            j += 1;
        }
    }

    while i < n {
        out.push(WordDiff {
            diff_type: "delete".into(),
            text: format!("{} ", left_words[i]),
        });
        i += 1;
    }
    while j < m {
        out.push(WordDiff {
            diff_type: "insert".into(),
            text: format!("{} ", right_words[j]),
        });
        j += 1;
    }

    out
}

fn simple_paragraph_diff(left: &str, right: &str) -> DiffResult {
    let left_blocks = split_blocks(left);
    let right_blocks = split_blocks(right);
    let mut blocks = Vec::new();
    let n = left_blocks.len();
    let m = right_blocks.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];

    for i in (0..=n).rev() {
        for j in (0..=m).rev() {
            if i == n {
                dp[i][j] = m.saturating_sub(j);
                continue;
            }
            if j == m {
                dp[i][j] = n.saturating_sub(i);
                continue;
            }

            let replace_cost = substitution_cost(&left_blocks[i], &right_blocks[j]) + dp[i + 1][j + 1];
            let delete_cost = 1 + dp[i + 1][j];
            let insert_cost = 1 + dp[i][j + 1];

            dp[i][j] = replace_cost.min(delete_cost).min(insert_cost);
        }
    }

    let mut i = 0usize;
    let mut j = 0usize;
    while i < n || j < m {
        if i == n {
            blocks.push(DiffBlock {
                block_type: "added".into(),
                left_content: None,
                right_content: Some(right_blocks[j].clone()),
                word_diffs: None,
            });
            j += 1;
            continue;
        }

        if j == m {
            blocks.push(DiffBlock {
                block_type: "deleted".into(),
                left_content: Some(left_blocks[i].clone()),
                right_content: None,
                word_diffs: None,
            });
            i += 1;
            continue;
        }

        if left_blocks[i] == right_blocks[j] && dp[i][j] == dp[i + 1][j + 1] {
            blocks.push(DiffBlock {
                block_type: "unchanged".into(),
                left_content: Some(left_blocks[i].clone()),
                right_content: Some(right_blocks[j].clone()),
                word_diffs: None,
            });
            i += 1;
            j += 1;
            continue;
        }

        let replace_penalty = substitution_cost(&left_blocks[i], &right_blocks[j]);
        let replace_cost = replace_penalty + dp[i + 1][j + 1];
        let delete_cost = 1 + dp[i + 1][j];
        let insert_cost = 1 + dp[i][j + 1];

        if replace_penalty == 1 && dp[i][j] == replace_cost && replace_cost <= delete_cost && replace_cost <= insert_cost {
            blocks.push(DiffBlock {
                block_type: "modified".into(),
                left_content: Some(left_blocks[i].clone()),
                right_content: Some(right_blocks[j].clone()),
                word_diffs: Some(simple_word_diff(&left_blocks[i], &right_blocks[j])),
            });
            i += 1;
            j += 1;
        } else if dp[i][j] == delete_cost && delete_cost <= insert_cost {
            blocks.push(DiffBlock {
                block_type: "deleted".into(),
                left_content: Some(left_blocks[i].clone()),
                right_content: None,
                word_diffs: None,
            });
            i += 1;
        } else {
            blocks.push(DiffBlock {
                block_type: "added".into(),
                left_content: None,
                right_content: Some(right_blocks[j].clone()),
                word_diffs: None,
            });
            j += 1;
        }
    }

    DiffResult { blocks }
}

fn count_changed_words(diff: &DiffResult) -> ChangeStats {
    let mut words_added = 0usize;
    let mut words_deleted = 0usize;
    let mut paragraphs_changed = 0usize;

    for block in &diff.blocks {
        match block.block_type.as_str() {
            "unchanged" => {}
            "added" => {
                paragraphs_changed += 1;
                words_added += block
                    .right_content
                    .as_deref()
                    .map(count_words)
                    .unwrap_or_default();
            }
            "deleted" => {
                paragraphs_changed += 1;
                words_deleted += block
                    .left_content
                    .as_deref()
                    .map(count_words)
                    .unwrap_or_default();
            }
            "modified" => {
                paragraphs_changed += 1;
                if let Some(word_diffs) = &block.word_diffs {
                    for word_diff in word_diffs {
                        match word_diff.diff_type.as_str() {
                            "insert" => words_added += count_words(&word_diff.text),
                            "delete" => words_deleted += count_words(&word_diff.text),
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }

    ChangeStats {
        words_added,
        words_deleted,
        paragraphs_changed,
    }
}

// -----------------------------
// Tauri commands
// -----------------------------

#[tauri::command]
fn create_project(title: String) -> Result<ProjectMeta, String> {
    ensure_app_ready()?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let folder = project_path(&id);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let initial_doc = format!(
        "---\ntitle: \"{}\"\ncreated: {}\nmodified: {}\nid: \"{}\"\n---\n\n",
        title, now, now, id
    );
    fs::write(document_path(&id), initial_doc).map_err(|e| e.to_string())?;
    write_comments_file(&id, &CommentsFile { threads: vec![] })?;

    let repo = Repository::init(&folder).map_err(|e| e.to_string())?;
    // Create an initial save point so timeline history starts with a root state.
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = Signature::now("Diff", "noreply@diff.app").map_err(|e| e.to_string())?;
    repo.commit(Some("HEAD"), &sig, &sig, "Project initialized", &tree, &[])
        .map_err(|e| e.to_string())?;

    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO projects (id, title, created, modified, path) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            title,
            now,
            now,
            folder.to_string_lossy().to_string()
        ],
    )
    .map_err(|e| e.to_string())?;

    list_projects()?
        .into_iter()
        .find(|p| p.path == folder.to_string_lossy())
        .ok_or_else(|| "Unable to fetch created project metadata".to_string())
}

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectMeta>, String> {
    ensure_app_ready()?;
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, title, created, modified, path FROM projects ORDER BY modified DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for row in rows {
        let (id, title, created, modified, path) = row.map_err(|e| e.to_string())?;
        let doc = fs::read_to_string(document_path(&id)).unwrap_or_default();
        let word_count = count_words(markdown_body(&doc));
        let save_point_count = Repository::open(project_path(&id))
            .ok()
            .map(|r| repo_save_point_count(&r))
            .unwrap_or(0);

        out.push(ProjectMeta {
            id,
            title,
            created,
            modified,
            word_count,
            save_point_count,
            path,
        });
    }

    Ok(out)
}

#[tauri::command]
fn delete_project(project_id: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    fs::remove_dir_all(project_path(&project_id)).map_err(|e| e.to_string())?;
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_project(project_id: String, new_title: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET title = ?1, modified = ?2 WHERE id = ?3",
        params![new_title.clone(), Utc::now().to_rfc3339(), project_id.clone()],
    )
    .map_err(|e| e.to_string())?;

    // Also update frontmatter title for consistency.
    let original = fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = original.lines().map(ToString::to_string).collect();
    for line in &mut lines {
        if line.starts_with("title:") {
            *line = format!("title: \"{}\"", new_title);
            break;
        }
    }
    fs::write(document_path(&project_id), lines.join("\n")).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn load_document(project_id: String) -> Result<String, String> {
    ensure_project_exists(&project_id)?;
    fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_document(project_id: String, content: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    fs::write(document_path(&project_id), content).map_err(|e| e.to_string())?;

    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET modified = ?1 WHERE id = ?2",
        params![Utc::now().to_rfc3339(), project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn create_save_point(project_id: String, message: String) -> Result<SavePoint, String> {
    ensure_project_exists(&project_id)?;
    let repo = Repository::open(project_path(&project_id)).map_err(|e| e.to_string())?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;
    let sig = Signature::now("Diff", "noreply@diff.app").map_err(|e| e.to_string())?;

    let save_point_message = if message.trim().is_empty() {
        format!("Save point at {}", Utc::now().format("%-I:%M %p"))
    } else {
        message
    };

    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let oid = if let Some(parent) = parent_commit.as_ref() {
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &save_point_message,
            &tree,
            &[parent],
        )
        .map_err(|e| e.to_string())?
    } else {
        repo.commit(Some("HEAD"), &sig, &sig, &save_point_message, &tree, &[])
            .map_err(|e| e.to_string())?
    };

    let stats = get_change_stats(project_id, oid.to_string())?;
    Ok(SavePoint {
        hash: oid.to_string(),
        message: save_point_message,
        timestamp: Utc::now().to_rfc3339(),
        change_size: stats.words_added + stats.words_deleted,
    })
}

#[tauri::command]
fn get_timeline(project_id: String) -> Result<Vec<SavePoint>, String> {
    ensure_project_exists(&project_id)?;
    let repo = Repository::open(project_path(&project_id)).map_err(|e| e.to_string())?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;

    let mut timeline = Vec::new();
    for oid in revwalk {
        let oid = oid.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let stats = get_change_stats(project_id.clone(), oid.to_string())?;

        timeline.push(SavePoint {
            hash: oid.to_string(),
            message: commit.summary().unwrap_or("Save Point").to_string(),
            timestamp: chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339(),
            change_size: stats.words_added + stats.words_deleted,
        });
    }

    timeline.reverse();
    Ok(timeline)
}

#[tauri::command]
fn get_document_at_save_point(project_id: String, hash: String) -> Result<String, String> {
    ensure_project_exists(&project_id)?;
    let repo = Repository::open(project_path(&project_id)).map_err(|e| e.to_string())?;
    let oid = Oid::from_str(&hash).map_err(|e| e.to_string())?;
    read_commit_document(&repo, oid)
}

#[tauri::command]
fn get_change_stats(project_id: String, hash: String) -> Result<ChangeStats, String> {
    ensure_project_exists(&project_id)?;
    let repo = Repository::open(project_path(&project_id)).map_err(|e| e.to_string())?;
    let oid = Oid::from_str(&hash).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

    let current_doc = read_commit_document(&repo, oid).unwrap_or_default();

    if commit.parent_count() == 0 {
        return Ok(ChangeStats {
            words_added: count_words(markdown_body(&current_doc)),
            words_deleted: 0,
            paragraphs_changed: split_blocks(markdown_body(&current_doc)).len(),
        });
    }

    let parent = commit.parent(0).map_err(|e| e.to_string())?;
    let parent_doc = read_commit_document(&repo, parent.id()).unwrap_or_default();
    let diff = simple_paragraph_diff(markdown_body(&parent_doc), markdown_body(&current_doc));

    Ok(count_changed_words(&diff))
}

#[tauri::command]
fn compute_diff(project_id: String, from: String, to: String) -> Result<DiffResult, String> {
    ensure_project_exists(&project_id)?;
    let repo = Repository::open(project_path(&project_id)).map_err(|e| e.to_string())?;

    let from_doc = if from == "current" {
        fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())?
    } else {
        let oid = Oid::from_str(&from).map_err(|e| e.to_string())?;
        read_commit_document(&repo, oid)?
    };

    let to_doc = if to == "current" {
        fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())?
    } else {
        let oid = Oid::from_str(&to).map_err(|e| e.to_string())?;
        read_commit_document(&repo, oid)?
    };

    Ok(simple_paragraph_diff(markdown_body(&from_doc), markdown_body(&to_doc)))
}

#[tauri::command]
fn load_comments(project_id: String) -> Result<Vec<CommentThread>, String> {
    ensure_project_exists(&project_id)?;
    Ok(open_comments_file(&project_id)?.threads)
}

#[tauri::command]
fn add_comment(project_id: String, paragraph_id: String, text: String) -> Result<CommentThread, String> {
    ensure_project_exists(&project_id)?;
    let mut file = open_comments_file(&project_id)?;

    let thread = CommentThread {
        id: Uuid::new_v4().to_string(),
        paragraph_id,
        resolved: false,
        comments: vec![Comment {
            id: Uuid::new_v4().to_string(),
            author: "User".into(),
            text,
            timestamp: Utc::now().to_rfc3339(),
        }],
    };

    file.threads.push(thread.clone());
    write_comments_file(&project_id, &file)?;
    Ok(thread)
}

#[tauri::command]
fn reply_to_comment(project_id: String, thread_id: String, text: String) -> Result<Comment, String> {
    ensure_project_exists(&project_id)?;
    let mut file = open_comments_file(&project_id)?;

    let reply = Comment {
        id: Uuid::new_v4().to_string(),
        author: "User".into(),
        text,
        timestamp: Utc::now().to_rfc3339(),
    };

    let thread = file
        .threads
        .iter_mut()
        .find(|t| t.id == thread_id)
        .ok_or_else(|| "Comment thread not found".to_string())?;
    thread.comments.push(reply.clone());

    write_comments_file(&project_id, &file)?;
    Ok(reply)
}

#[tauri::command]
fn resolve_thread(project_id: String, thread_id: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    let mut file = open_comments_file(&project_id)?;
    if let Some(thread) = file.threads.iter_mut().find(|t| t.id == thread_id) {
        thread.resolved = true;
    }
    write_comments_file(&project_id, &file)
}

#[tauri::command]
fn delete_thread(project_id: String, thread_id: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    let mut file = open_comments_file(&project_id)?;
    file.threads.retain(|t| t.id != thread_id);
    write_comments_file(&project_id, &file)
}

#[tauri::command]
fn import_and_diff(project_id: String, file_path: String) -> Result<MergeResult, String> {
    ensure_project_exists(&project_id)?;
    let current = fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())?;
    let imported = fs::read_to_string(file_path).map_err(|e| e.to_string())?;

    let left = split_blocks(markdown_body(&current));
    let right = split_blocks(markdown_body(&imported));
    let max_len = left.len().max(right.len());

    let mut blocks = Vec::new();
    let mut has_conflicts = false;
    for i in 0..max_len {
        match (left.get(i), right.get(i)) {
            (Some(a), Some(b)) if a == b => blocks.push(MergeBlock {
                block_type: "clean".into(),
                content: Some(a.clone()),
                yours: None,
                theirs: None,
                block_index: i,
            }),
            (Some(a), Some(b)) => {
                has_conflicts = true;
                blocks.push(MergeBlock {
                    block_type: "conflict".into(),
                    content: None,
                    yours: Some(a.clone()),
                    theirs: Some(b.clone()),
                    block_index: i,
                });
            }
            (Some(a), None) => blocks.push(MergeBlock {
                block_type: "clean".into(),
                content: Some(a.clone()),
                yours: None,
                theirs: None,
                block_index: i,
            }),
            (None, Some(b)) => blocks.push(MergeBlock {
                block_type: "clean".into(),
                content: Some(b.clone()),
                yours: None,
                theirs: None,
                block_index: i,
            }),
            (None, None) => {}
        }
    }

    Ok(MergeResult {
        blocks,
        has_conflicts,
    })
}

#[tauri::command]
fn apply_merge(project_id: String, resolutions: Vec<ConflictResolution>) -> Result<(), String> {
    ensure_project_exists(&project_id)?;

    // Lightweight strategy:
    // - Save last generated merge payload in a cache file for full fidelity (future step).
    // - For now apply explicit choices onto current + imported temporary mapping.
    // Since current command surface does not pass MergeResult back in, we persist simple
    // block choices as content snippets via generated markers.
    let mut blocks_map: HashMap<usize, String> = HashMap::new();
    for resolution in resolutions {
        let content = match resolution.choice.as_str() {
            "yours" => "<<YOURS CHOSEN>>",
            "theirs" => "<<THEIRS CHOSEN>>",
            "both" => "<<BOTH CHOSEN>>",
            _ => "<<UNKNOWN CHOICE>>",
        };
        blocks_map.insert(resolution.block_index, content.to_string());
    }

    let mut merged_preview = String::new();
    for (_, block) in blocks_map {
        merged_preview.push_str(&block);
        merged_preview.push_str("\n\n");
    }

    if merged_preview.trim().is_empty() {
        return Ok(());
    }

    save_document(project_id, merged_preview)
}

#[tauri::command]
fn get_settings() -> Result<AppSettings, String> {
    ensure_app_ready()?;
    let raw = fs::read_to_string(app_config_path()).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())?
}

#[tauri::command]
fn update_settings(settings: AppSettings) -> Result<(), String> {
    ensure_app_ready()?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(app_config_path(), json).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_project,
            list_projects,
            delete_project,
            rename_project,
            load_document,
            save_document,
            create_save_point,
            get_timeline,
            get_document_at_save_point,
            get_change_stats,
            compute_diff,
            load_comments,
            add_comment,
            reply_to_comment,
            resolve_thread,
            delete_thread,
            import_and_diff,
            apply_merge,
            get_settings,
            update_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
