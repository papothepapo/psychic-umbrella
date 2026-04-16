#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use git2::{Oid, Repository, Signature, Time};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

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
struct BackupEntry {
    file_name: String,
    path: String,
    timestamp: String,
    kind: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExportedFile {
    path: String,
    format: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StorageOverview {
    app_root: String,
    backups_directory: String,
    exports_directory: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
#[serde(rename_all = "camelCase", default)]
struct AppSettings {
    app_theme: String,
    follow_system_theme: bool,
    default_font: String,
    default_font_size: u8,
    default_line_spacing: String,
    custom_line_spacing: f32,
    default_text_alignment: String,
    paragraph_spacing: u8,
    default_page_width: String,
    language: String,
    spell_check: bool,
    grammar_check: bool,
    auto_correct: bool,
    smart_quotes: bool,
    auto_capitalize_sentences: bool,
    show_word_count: bool,
    show_character_count: bool,
    show_paragraph_count: bool,
    show_reading_time: bool,
    show_word_goal: bool,
    word_goal_target: u32,
    word_goal_display: String,
    focus_mode: bool,
    typewriter_scrolling: bool,
    show_formatting_marks: bool,
    highlight_current_line: bool,
    cursor_style: String,
    cursor_blink: bool,
    double_click_selects_word: bool,
    triple_click_selects_paragraph: bool,
    paste_plain_text_by_default: bool,
    auto_snapshots_enabled: bool,
    auto_snapshot_frequency: String,
    auto_snapshot_custom_minutes: u16,
    snapshot_only_when_changes_exist: bool,
    auto_snapshot_naming: bool,
    keep_snapshots_for: String,
    custom_retention_days: u16,
    maximum_snapshots_enabled: bool,
    maximum_snapshots: u16,
    snapshot_limit_behavior: String,
    hidden_snapshot_hashes: Vec<String>,
    canvas_width: String,
    canvas_shadow: bool,
    show_page_ruler: bool,
    paragraph_indent_style: String,
    deletion_color: String,
    addition_color: String,
    use_patterns_instead_of_color: bool,
    diff_highlight_opacity: u8,
    animation_speed: String,
    reduce_motion: bool,
    include_document_title_in_export: bool,
    include_page_numbers_in_pdf: bool,
    pdf_page_size: String,
    pdf_margins: String,
    include_author_name_in_export: bool,
    author_name: String,
    export_with_comparison_markup: bool,
    import_mode: String,
    font_scaling: u16,
    high_contrast_mode: bool,
    screen_reader_support: bool,
    keyboard_navigation: bool,
    tooltip_delay: u16,
    focus_indicators: String,
    dyslexia_friendly_font: bool,
    line_focus_highlight: bool,
    projects_directory: String,
    backups_directory: String,
    exports_directory: String,
    backup_interval_ms: u64,
    default_export_format: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            app_theme: "light".into(),
            follow_system_theme: false,
            default_font: "Georgia".into(),
            default_font_size: 16,
            default_line_spacing: "1.5".into(),
            custom_line_spacing: 1.75,
            default_text_alignment: "left".into(),
            paragraph_spacing: 12,
            default_page_width: "medium".into(),
            language: "en-US".into(),
            spell_check: true,
            grammar_check: true,
            auto_correct: true,
            smart_quotes: true,
            auto_capitalize_sentences: true,
            show_word_count: true,
            show_character_count: false,
            show_paragraph_count: false,
            show_reading_time: false,
            show_word_goal: false,
            word_goal_target: 80_000,
            word_goal_display: "fraction".into(),
            focus_mode: false,
            typewriter_scrolling: false,
            show_formatting_marks: false,
            highlight_current_line: false,
            cursor_style: "line".into(),
            cursor_blink: true,
            double_click_selects_word: true,
            triple_click_selects_paragraph: true,
            paste_plain_text_by_default: false,
            auto_snapshots_enabled: true,
            auto_snapshot_frequency: "15m".into(),
            auto_snapshot_custom_minutes: 15,
            snapshot_only_when_changes_exist: true,
            auto_snapshot_naming: true,
            keep_snapshots_for: "forever".into(),
            custom_retention_days: 30,
            maximum_snapshots_enabled: false,
            maximum_snapshots: 100,
            snapshot_limit_behavior: "deleteOldestAuto".into(),
            hidden_snapshot_hashes: Vec::new(),
            canvas_width: "medium".into(),
            canvas_shadow: true,
            show_page_ruler: false,
            paragraph_indent_style: "block".into(),
            deletion_color: "#DC2626".into(),
            addition_color: "#16A34A".into(),
            use_patterns_instead_of_color: false,
            diff_highlight_opacity: 60,
            animation_speed: "normal".into(),
            reduce_motion: false,
            include_document_title_in_export: true,
            include_page_numbers_in_pdf: true,
            pdf_page_size: "A4".into(),
            pdf_margins: "normal".into(),
            include_author_name_in_export: false,
            author_name: String::new(),
            export_with_comparison_markup: false,
            import_mode: "newDocument".into(),
            font_scaling: 100,
            high_contrast_mode: false,
            screen_reader_support: true,
            keyboard_navigation: true,
            tooltip_delay: 500,
            focus_indicators: "default".into(),
            dyslexia_friendly_font: false,
            line_focus_highlight: false,
            projects_directory: app_root().to_string_lossy().to_string(),
            backups_directory: backups_root().to_string_lossy().to_string(),
            exports_directory: exports_root().to_string_lossy().to_string(),
            backup_interval_ms: 300000,
            default_export_format: "inkline".into(),
        }
    }
}

impl AppSettings {
    fn normalized(mut self) -> Self {
        if !matches!(self.app_theme.as_str(), "light" | "dark" | "sepia") {
            self.app_theme = "light".into();
        }

        if self.default_font.trim().is_empty() {
            self.default_font = "Georgia".into();
        }

        if !matches!(
            self.default_line_spacing.as_str(),
            "single" | "1.15" | "1.5" | "double" | "custom"
        ) {
            self.default_line_spacing = "1.5".into();
        }

        if !matches!(
            self.default_text_alignment.as_str(),
            "left" | "center" | "right" | "justify"
        ) {
            self.default_text_alignment = "left".into();
        }

        if !matches!(
            self.default_page_width.as_str(),
            "narrow" | "medium" | "wide"
        ) {
            self.default_page_width = "medium".into();
        }

        if !matches!(
            self.word_goal_display.as_str(),
            "bar" | "percentage" | "fraction"
        ) {
            self.word_goal_display = "fraction".into();
        }

        if !matches!(self.cursor_style.as_str(), "line" | "block" | "underline") {
            self.cursor_style = "line".into();
        }

        if !matches!(
            self.auto_snapshot_frequency.as_str(),
            "1m" | "5m" | "15m" | "30m" | "1h" | "custom"
        ) {
            self.auto_snapshot_frequency = "15m".into();
        }

        if !matches!(
            self.keep_snapshots_for.as_str(),
            "forever" | "7d" | "30d" | "90d" | "1y" | "custom"
        ) {
            self.keep_snapshots_for = "forever".into();
        }

        if !matches!(
            self.snapshot_limit_behavior.as_str(),
            "deleteOldestAuto" | "prompt"
        ) {
            self.snapshot_limit_behavior = "deleteOldestAuto".into();
        }

        if !matches!(self.canvas_width.as_str(), "narrow" | "medium" | "wide") {
            self.canvas_width = "medium".into();
        }

        if !matches!(
            self.paragraph_indent_style.as_str(),
            "none" | "firstLine" | "block"
        ) {
            self.paragraph_indent_style = "block".into();
        }

        if !matches!(self.animation_speed.as_str(), "normal" | "slow" | "fast" | "off") {
            self.animation_speed = "normal".into();
        }

        if !matches!(self.pdf_page_size.as_str(), "A4" | "Letter" | "A5") {
            self.pdf_page_size = "A4".into();
        }

        if !matches!(self.pdf_margins.as_str(), "normal" | "narrow" | "wide") {
            self.pdf_margins = "normal".into();
        }

        if !matches!(self.import_mode.as_str(), "newDocument" | "newSnapshot") {
            self.import_mode = "newDocument".into();
        }

        if !matches!(self.focus_indicators.as_str(), "default" | "high" | "off") {
            self.focus_indicators = "default".into();
        }

        self.default_font_size = self.default_font_size.clamp(8, 72);
        self.custom_line_spacing = self.custom_line_spacing.clamp(1.0, 3.0);
        self.paragraph_spacing = self.paragraph_spacing.clamp(0, 40);
        self.word_goal_target = self.word_goal_target.clamp(1, 9_999_999);
        self.auto_snapshot_custom_minutes = self.auto_snapshot_custom_minutes.clamp(1, 1440);
        self.custom_retention_days = self.custom_retention_days.clamp(1, 3650);
        self.maximum_snapshots = self.maximum_snapshots.clamp(1, 10_000);
        self.diff_highlight_opacity = self.diff_highlight_opacity.clamp(0, 100);
        self.font_scaling = self.font_scaling.clamp(80, 150);
        self.tooltip_delay = self.tooltip_delay.clamp(0, 1000);
        self.backup_interval_ms = self.backup_interval_ms.clamp(1000, 86_400_000);

        if self.projects_directory.trim().is_empty() {
            self.projects_directory = app_root().to_string_lossy().to_string();
        }
        if self.backups_directory.trim().is_empty() {
            self.backups_directory = backups_root().to_string_lossy().to_string();
        }
        if self.exports_directory.trim().is_empty() {
            self.exports_directory = exports_root().to_string_lossy().to_string();
        }

        if !matches!(
            self.default_export_format.as_str(),
            "pdf" | "md" | "txt" | "inkline" | "docx"
        ) {
            self.default_export_format = "inkline".into();
        }

        self
    }
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

#[derive(Debug, Serialize, Deserialize, Clone)]
struct BundleProject {
    title: String,
    document: String,
    comments: CommentsFile,
    snapshots: Vec<BundleSnapshot>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BundleSnapshot {
    message: String,
    timestamp: String,
    document: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProjectBundle {
    app: String,
    version: u8,
    exported_at: String,
    project: BundleProject,
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn preferred_app_root() -> PathBuf {
    home_dir().join("Inkline")
}

fn legacy_app_root() -> PathBuf {
    home_dir().join("Diff")
}

fn app_root() -> PathBuf {
    let preferred = preferred_app_root();
    if preferred.exists() {
        preferred
    } else {
        let legacy = legacy_app_root();
        if legacy.exists() {
            legacy
        } else {
            preferred
        }
    }
}

fn backups_root() -> PathBuf {
    app_root().join("Backups")
}

fn exports_root() -> PathBuf {
    app_root().join("Exports")
}

fn app_config_path() -> PathBuf {
    let root = app_root();
    let preferred = root.join(".inkline-config.json");
    if preferred.exists() {
        preferred
    } else {
        let legacy = root.join(".diff-config.json");
        if legacy.exists() {
            legacy
        } else {
            preferred
        }
    }
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

fn backups_path(project_id: &str) -> PathBuf {
    backups_root().join(project_id)
}

fn ensure_app_ready() -> Result<(), String> {
    let preferred_root = preferred_app_root();
    let legacy_root = legacy_app_root();
    if !preferred_root.exists() && legacy_root.exists() {
        let _ = fs::rename(&legacy_root, &preferred_root);
    }

    fs::create_dir_all(app_root()).map_err(|e| e.to_string())?;
    fs::create_dir_all(backups_root()).map_err(|e| e.to_string())?;
    fs::create_dir_all(exports_root()).map_err(|e| e.to_string())?;

    let legacy_config = app_root().join(".diff-config.json");
    let preferred_config = app_root().join(".inkline-config.json");
    if !preferred_config.exists() && legacy_config.exists() {
        let _ = fs::rename(&legacy_config, &preferred_config);
    }

    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
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
        let settings = AppSettings::default().normalized();
        write_settings_file(&settings)?;
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

fn read_settings_file() -> Result<AppSettings, String> {
    ensure_app_ready()?;
    let raw = fs::read_to_string(app_config_path()).map_err(|e| e.to_string())?;
    serde_json::from_str::<AppSettings>(&raw)
        .map(|settings| settings.normalized())
        .map_err(|e| e.to_string())
}

fn write_settings_file(settings: &AppSettings) -> Result<(), String> {
    let normalized = settings.clone().normalized();
    let json = serde_json::to_string_pretty(&normalized).map_err(|e| e.to_string())?;
    atomic_write(&app_config_path(), &json)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    atomic_write_bytes(path, content.as_bytes())
}

fn atomic_write_bytes(path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| {
        format!(
            "Cannot write file without parent directory: {}",
            path.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file")
        .to_string();

    let temp_path = parent.join(format!(".{file_name}.tmp-{}", Uuid::new_v4()));
    let mut temp_file = File::create(&temp_path).map_err(|e| e.to_string())?;
    temp_file.write_all(content).map_err(|e| e.to_string())?;
    temp_file.sync_all().map_err(|e| e.to_string())?;

    if path.exists() {
        let swap_path = parent.join(format!(".{file_name}.swap-{}", Uuid::new_v4()));
        fs::rename(path, &swap_path).map_err(|e| e.to_string())?;

        if let Err(err) = fs::rename(&temp_path, path) {
            let _ = fs::rename(&swap_path, path);
            let _ = fs::remove_file(&temp_path);
            return Err(err.to_string());
        }

        let _ = fs::remove_file(&swap_path);
    } else {
        fs::rename(&temp_path, path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn update_project_timestamp(project_id: &str, modified: &str) -> Result<(), String> {
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET modified = ?1 WHERE id = ?2",
        params![modified, project_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn markdown_body(markdown: &str) -> &str {
    if markdown.starts_with("---\n") {
        let rest = &markdown[4..];
        if let Some(idx) = rest.find("\n---\n") {
            return &rest[idx + 5..];
        }
    }
    markdown
}

fn decode_html_entity(entity: &str) -> Option<String> {
    match entity {
        "amp" => Some("&".into()),
        "lt" => Some("<".into()),
        "gt" => Some(">".into()),
        "quot" => Some("\"".into()),
        "apos" => Some("'".into()),
        "nbsp" => Some(" ".into()),
        _ if entity.starts_with("#x") || entity.starts_with("#X") => u32::from_str_radix(&entity[2..], 16)
            .ok()
            .and_then(char::from_u32)
            .map(|ch| ch.to_string()),
        _ if entity.starts_with('#') => entity[1..]
            .parse::<u32>()
            .ok()
            .and_then(char::from_u32)
            .map(|ch| ch.to_string()),
        _ => None,
    }
}

fn decode_html_entities(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '&' {
            output.push(ch);
            continue;
        }

        let mut entity = String::new();
        while let Some(next) = chars.peek().copied() {
            chars.next();
            if next == ';' {
                break;
            }
            entity.push(next);
            if entity.len() > 12 {
                break;
            }
        }

        if let Some(decoded) = decode_html_entity(&entity) {
            output.push_str(&decoded);
        } else {
            output.push('&');
            output.push_str(&entity);
            if entity.len() <= 12 {
                output.push(';');
            }
        }
    }

    output
}

fn html_body_to_plain_text(html: &str) -> String {
    let mut prepared = html
        .replace("\r\n", "\n")
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n");

    for tag in [
        "p",
        "div",
        "li",
        "blockquote",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
    ] {
        prepared = prepared.replace(&format!("</{tag}>"), "\n\n");
        prepared = prepared.replace(&format!("</{tag} >"), "\n\n");
    }

    let mut output = String::with_capacity(prepared.len());
    let mut inside_tag = false;

    for ch in prepared.chars() {
        match ch {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => output.push(ch),
            _ => {}
        }
    }

    let mut cleaned = decode_html_entities(&output)
        .replace('\u{00a0}', " ")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");

    while cleaned.contains("\n\n\n") {
        cleaned = cleaned.replace("\n\n\n", "\n\n");
    }

    cleaned.trim().to_string()
}

fn document_plain_text(document: &str) -> String {
    let body = markdown_body(document);
    if body.contains('<') && body.contains('>') {
        html_body_to_plain_text(body)
    } else {
        decode_html_entities(body).trim().to_string()
    }
}

fn extract_frontmatter(markdown: &str) -> (HashMap<String, String>, String) {
    if !markdown.starts_with("---\n") {
        return (HashMap::new(), markdown.to_string());
    }

    let Some(end) = markdown[4..].find("\n---\n") else {
        return (HashMap::new(), markdown.to_string());
    };

    let frontmatter = &markdown[4..4 + end];
    let body = markdown[(4 + end + 5)..]
        .trim_start_matches('\n')
        .to_string();
    let mut meta = HashMap::new();

    for line in frontmatter.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        meta.insert(
            key.trim().to_string(),
            value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string(),
        );
    }

    (meta, body)
}

fn format_frontmatter_value(value: &str) -> String {
    if value.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | ':' | '/' | '-' | 'T' | 'Z' | '+')
    }) {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
    }
}

fn compose_document(title: &str, id: &str, created: &str, modified: &str, body: &str) -> String {
    let metadata = [
        format!("title: {}", format_frontmatter_value(title)),
        format!("created: {}", format_frontmatter_value(created)),
        format!("modified: {}", format_frontmatter_value(modified)),
        format!("id: {}", format_frontmatter_value(id)),
    ]
    .join("\n");

    format!("---\n{metadata}\n---\n\n{}", body.trim_start_matches('\n'))
}

fn ensure_document_metadata(project_id: &str, title: &str, content: &str) -> String {
    let now = Utc::now().to_rfc3339();
    let (mut meta, body) = extract_frontmatter(content);
    meta.insert("title".into(), title.to_string());
    meta.entry("created".into()).or_insert_with(|| now.clone());
    meta.insert("modified".into(), now);
    meta.insert("id".into(), project_id.to_string());

    let ordered_keys = ["title", "created", "modified", "id"];
    let mut lines = Vec::new();
    for key in ordered_keys {
        if let Some(value) = meta.remove(key) {
            lines.push(format!("{key}: {}", format_frontmatter_value(&value)));
        }
    }
    for (key, value) in meta {
        lines.push(format!("{key}: {}", format_frontmatter_value(&value)));
    }

    format!(
        "---\n{}\n---\n\n{}",
        lines.join("\n"),
        body.trim_start_matches('\n')
    )
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

fn current_project_title(project_id: &str) -> Result<String, String> {
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT title FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get::<_, String>(0),
    )
    .map_err(|e| e.to_string())
}

fn current_project_meta(project_id: &str) -> Result<ProjectMeta, String> {
    list_projects()?
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| "Project metadata not found".to_string())
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
    atomic_write(&comments_path(project_id), &json)
}

fn split_blocks(markdown: &str) -> Vec<String> {
    markdown
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
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

    let mut i = 0usize;
    let mut j = 0usize;
    let mut output = Vec::new();

    while i < n && j < m {
        if left_words[i] == right_words[j] {
            output.push(WordDiff {
                diff_type: "equal".into(),
                text: format!("{} ", left_words[i]),
            });
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            output.push(WordDiff {
                diff_type: "delete".into(),
                text: format!("{} ", left_words[i]),
            });
            i += 1;
        } else {
            output.push(WordDiff {
                diff_type: "insert".into(),
                text: format!("{} ", right_words[j]),
            });
            j += 1;
        }
    }

    while i < n {
        output.push(WordDiff {
            diff_type: "delete".into(),
            text: format!("{} ", left_words[i]),
        });
        i += 1;
    }

    while j < m {
        output.push(WordDiff {
            diff_type: "insert".into(),
            text: format!("{} ", right_words[j]),
        });
        j += 1;
    }

    output
}

fn simple_paragraph_diff(left: &str, right: &str) -> DiffResult {
    let left_blocks = split_blocks(left);
    let right_blocks = split_blocks(right);
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

            let replace_cost =
                substitution_cost(&left_blocks[i], &right_blocks[j]) + dp[i + 1][j + 1];
            let delete_cost = 1 + dp[i + 1][j];
            let insert_cost = 1 + dp[i][j + 1];
            dp[i][j] = replace_cost.min(delete_cost).min(insert_cost);
        }
    }

    let mut blocks = Vec::new();
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

        if replace_penalty == 1
            && dp[i][j] == replace_cost
            && replace_cost <= delete_cost
            && replace_cost <= insert_cost
        {
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

fn sanitize_file_stem(value: &str) -> String {
    let mut sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else if ch.is_whitespace() {
                '-'
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    while sanitized.contains("--") {
        sanitized = sanitized.replace("--", "-");
    }

    if sanitized.is_empty() {
        "project".into()
    } else {
        sanitized
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn markdown_to_docx_bytes(markdown: &str, title: &str) -> Result<Vec<u8>, String> {
    let body = document_plain_text(markdown);
    let paragraphs = if body.trim().is_empty() {
        vec![String::new()]
    } else {
        split_blocks(&body)
    };

    let body_xml = paragraphs
        .iter()
        .map(|paragraph| {
            let lines = if paragraph.is_empty() {
                vec![""]
            } else {
                paragraph.lines().collect::<Vec<_>>()
            };

            let mut runs = String::new();
            for (index, line) in lines.iter().enumerate() {
                if index > 0 {
                    runs.push_str("<w:r><w:br/></w:r>");
                }

                let preserve = if line.starts_with(' ')
                    || line.ends_with(' ')
                    || line.contains("  ")
                {
                    " xml:space=\"preserve\""
                } else {
                    ""
                };

                runs.push_str(&format!(
                    "<w:r><w:t{preserve}>{}</w:t></w:r>",
                    xml_escape(line)
                ));
            }

            format!("<w:p>{runs}</w:p>")
        })
        .collect::<String>();

    let document_xml = format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<w:document xmlns:wpc=\"http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas\" ",
            "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" ",
            "xmlns:o=\"urn:schemas-microsoft-com:office:office\" ",
            "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ",
            "xmlns:m=\"http://schemas.openxmlformats.org/officeDocument/2006/math\" ",
            "xmlns:v=\"urn:schemas-microsoft-com:vml\" ",
            "xmlns:wp14=\"http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing\" ",
            "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" ",
            "xmlns:w10=\"urn:schemas-microsoft-com:office:word\" ",
            "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" ",
            "xmlns:w14=\"http://schemas.microsoft.com/office/word/2010/wordml\" ",
            "xmlns:w15=\"http://schemas.microsoft.com/office/word/2012/wordml\" ",
            "xmlns:wpg=\"http://schemas.microsoft.com/office/word/2010/wordprocessingGroup\" ",
            "xmlns:wpi=\"http://schemas.microsoft.com/office/word/2010/wordprocessingInk\" ",
            "xmlns:wne=\"http://schemas.microsoft.com/office/word/2006/wordml\" ",
            "xmlns:wps=\"http://schemas.microsoft.com/office/word/2010/wordprocessingShape\" ",
            "mc:Ignorable=\"w14 w15 wp14\">",
            "<w:body>{body_xml}<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/>",
            "<w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" ",
            "w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>"
        ),
        body_xml = body_xml
    );

    let now = Utc::now().to_rfc3339();
    let core_xml = format!(
        concat!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
            "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" ",
            "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" ",
            "xmlns:dcterms=\"http://purl.org/dc/terms/\" ",
            "xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" ",
            "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">",
            "<dc:title>{}</dc:title><dc:creator>Inkline</dc:creator>",
            "<cp:lastModifiedBy>Inkline</cp:lastModifiedBy>",
            "<dcterms:created xsi:type=\"dcterms:W3CDTF\">{}</dcterms:created>",
            "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">{}</dcterms:modified>",
            "</cp:coreProperties>"
        ),
        xml_escape(title),
        now,
        now
    );

    let content_types_xml = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">",
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>",
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>",
        "<Override PartName=\"/word/document.xml\" ",
        "ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>",
        "<Override PartName=\"/docProps/core.xml\" ",
        "ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>",
        "</Types>"
    );

    let rels_xml = concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>",
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId1\" ",
        "Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" ",
        "Target=\"word/document.xml\"/>",
        "<Relationship Id=\"rId2\" ",
        "Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" ",
        "Target=\"docProps/core.xml\"/>",
        "</Relationships>"
    );

    let mut writer = ZipWriter::new(Cursor::new(Vec::<u8>::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    writer
        .start_file("[Content_Types].xml", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(content_types_xml.as_bytes())
        .map_err(|e| e.to_string())?;
    writer
        .add_directory("_rels/", options)
        .map_err(|e| e.to_string())?;
    writer
        .start_file("_rels/.rels", options)
        .map_err(|e| e.to_string())?;
    writer.write_all(rels_xml.as_bytes()).map_err(|e| e.to_string())?;
    writer
        .add_directory("docProps/", options)
        .map_err(|e| e.to_string())?;
    writer
        .start_file("docProps/core.xml", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(core_xml.as_bytes())
        .map_err(|e| e.to_string())?;
    writer
        .add_directory("word/", options)
        .map_err(|e| e.to_string())?;
    writer
        .start_file("word/document.xml", options)
        .map_err(|e| e.to_string())?;
    writer
        .write_all(document_xml.as_bytes())
        .map_err(|e| e.to_string())?;

    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|e| e.to_string())
}

fn docx_bytes_to_markdown(bytes: &[u8]) -> Result<String, String> {
    let cursor = Cursor::new(bytes.to_vec());
    let mut archive = ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut document_xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|e| e.to_string())?
        .read_to_string(&mut document_xml)
        .map_err(|e| e.to_string())?;

    let document = roxmltree::Document::parse(&document_xml).map_err(|e| e.to_string())?;
    let mut paragraphs = Vec::new();

    for paragraph in document
        .descendants()
        .filter(|node| node.is_element() && node.tag_name().name() == "p")
    {
        let mut content = String::new();

        for node in paragraph.descendants() {
            if node.is_text() {
                let is_text_run = node
                    .parent()
                    .map(|parent| parent.is_element() && parent.tag_name().name() == "t")
                    .unwrap_or(false);
                if is_text_run {
                    content.push_str(node.text().unwrap_or_default());
                }
            } else if node.is_element() {
                match node.tag_name().name() {
                    "br" | "cr" => content.push('\n'),
                    "tab" => content.push('\t'),
                    _ => {}
                }
            }
        }

        let trimmed = content.trim_end_matches('\n').to_string();
        if !trimmed.is_empty() || !paragraphs.is_empty() {
            paragraphs.push(trimmed);
        }
    }

    if paragraphs.is_empty() {
        Ok(String::new())
    } else {
        Ok(paragraphs.join("\n\n"))
    }
}

fn decode_import_content(content: &str, content_encoding: Option<&str>) -> Result<Vec<u8>, String> {
    match content_encoding {
        Some("base64") => BASE64.decode(content).map_err(|e| e.to_string()),
        _ => Ok(content.as_bytes().to_vec()),
    }
}

fn iso_from_system_time(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339()
}

fn build_backup_entry(path: &Path, kind: &str) -> Result<BackupEntry, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let timestamp = metadata
        .modified()
        .map(iso_from_system_time)
        .unwrap_or_else(|_| Utc::now().to_rfc3339());

    Ok(BackupEntry {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string(),
        path: path.to_string_lossy().to_string(),
        timestamp,
        kind: kind.into(),
    })
}

fn latest_snapshot_backup_time(project_id: &str) -> Result<Option<SystemTime>, String> {
    let directory = backups_path(project_id);
    if !directory.exists() {
        return Ok(None);
    }

    let mut latest = None;
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name == "latest.md" {
            continue;
        }

        let modified = entry
            .metadata()
            .map_err(|e| e.to_string())?
            .modified()
            .map_err(|e| e.to_string())?;

        latest = match latest {
            Some(existing) if existing >= modified => Some(existing),
            _ => Some(modified),
        };
    }

    Ok(latest)
}

fn create_backup_snapshot(
    project_id: &str,
    title: &str,
    content: &str,
    force: bool,
) -> Result<BackupEntry, String> {
    ensure_project_exists(project_id)?;
    let settings = read_settings_file()?;
    let backup_dir = backups_path(project_id);
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let latest_path = backup_dir.join("latest.md");
    atomic_write(&latest_path, content)?;

    let now = SystemTime::now();
    let should_write_snapshot = if force {
        true
    } else if let Some(last_snapshot) = latest_snapshot_backup_time(project_id)? {
        now.duration_since(last_snapshot)
            .unwrap_or_else(|_| Duration::from_millis(settings.backup_interval_ms))
            >= Duration::from_millis(settings.backup_interval_ms)
    } else {
        true
    };

    let newest_path = if should_write_snapshot {
        let timestamp = Utc::now().format("%Y%m%d-%H%M%S");
        let path = backup_dir.join(format!("{timestamp}-{}.md", sanitize_file_stem(title)));
        atomic_write(&path, content)?;
        path
    } else {
        latest_path
    };

    build_backup_entry(
        &newest_path,
        if should_write_snapshot {
            "snapshot"
        } else {
            "latest"
        },
    )
}

fn list_backup_entries_for_project(project_id: &str) -> Result<Vec<BackupEntry>, String> {
    ensure_project_exists(project_id)?;
    let backup_dir = backups_path(project_id);
    if !backup_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(backup_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let kind = if path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|name| name == "latest.md")
            .unwrap_or(false)
        {
            "latest"
        } else {
            "snapshot"
        };

        entries.push(build_backup_entry(&path, kind)?);
    }

    entries.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    Ok(entries)
}

fn commit_current_document(
    repo: &Repository,
    message: &str,
    timestamp: &str,
) -> Result<Oid, String> {
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    let tree_id = index.write_tree().map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_id).map_err(|e| e.to_string())?;

    let when = DateTime::parse_from_rfc3339(timestamp)
        .map(|date| Time::new(date.timestamp(), 0))
        .unwrap_or_else(|_| Time::new(Utc::now().timestamp(), 0));
    let signature =
        Signature::new("Inkline", "noreply@inkline.app", &when).map_err(|e| e.to_string())?;
    let parent_commit = repo.head().ok().and_then(|head| head.peel_to_commit().ok());

    if let Some(parent) = parent_commit.as_ref() {
        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &[parent],
        )
        .map_err(|e| e.to_string())
    } else {
        repo.commit(Some("HEAD"), &signature, &signature, message, &tree, &[])
            .map_err(|e| e.to_string())
    }
}

fn create_project_record(
    title: &str,
    document: &str,
    initial_message: &str,
) -> Result<ProjectMeta, String> {
    ensure_app_ready()?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let folder = project_path(&id);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let prepared = ensure_document_metadata(&id, title, document);
    atomic_write(&document_path(&id), &prepared)?;
    write_comments_file(&id, &CommentsFile { threads: vec![] })?;

    let repo = Repository::init(&folder).map_err(|e| e.to_string())?;
    commit_current_document(&repo, initial_message, &now)?;

    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO projects (id, title, created, modified, path) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, title, now, now, folder.to_string_lossy().to_string()],
    )
    .map_err(|e| e.to_string())?;

    let meta = current_project_meta(
        &folder
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default()
            .to_string(),
    )?;
    let _ = create_backup_snapshot(&meta.id, title, &prepared, true);
    Ok(meta)
}

fn build_storage_overview() -> Result<StorageOverview, String> {
    ensure_app_ready()?;
    Ok(StorageOverview {
        app_root: app_root().to_string_lossy().to_string(),
        backups_directory: backups_root().to_string_lossy().to_string(),
        exports_directory: exports_root().to_string_lossy().to_string(),
    })
}

fn project_bundle(project_id: &str) -> Result<ProjectBundle, String> {
    ensure_project_exists(project_id)?;
    let title = current_project_title(project_id)?;
    let document = fs::read_to_string(document_path(project_id)).map_err(|e| e.to_string())?;
    let comments = open_comments_file(project_id)?;
    let repo = Repository::open(project_path(project_id)).map_err(|e| e.to_string())?;

    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.push_head().map_err(|e| e.to_string())?;

    let mut commits = revwalk
        .map(|oid| oid.map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    commits.reverse();

    let snapshots = commits
        .into_iter()
        .map(|oid| {
            let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
            let timestamp = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339();
            Ok(BundleSnapshot {
                message: commit.summary().unwrap_or("Snapshot").to_string(),
                timestamp,
                document: read_commit_document(&repo, oid)?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(ProjectBundle {
        app: "Inkline".into(),
        version: 1,
        exported_at: Utc::now().to_rfc3339(),
        project: BundleProject {
            title,
            document,
            comments,
            snapshots,
        },
    })
}

fn import_bundle_project(bundle: ProjectBundle) -> Result<ProjectMeta, String> {
    ensure_app_ready()?;

    let id = Uuid::new_v4().to_string();
    let title = bundle.project.title.trim().to_string();
    let safe_title = if title.is_empty() {
        "Imported Project".to_string()
    } else {
        title
    };
    let folder = project_path(&id);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let repo = Repository::init(&folder).map_err(|e| e.to_string())?;

    let created = bundle
        .project
        .snapshots
        .first()
        .map(|snapshot| snapshot.timestamp.clone())
        .unwrap_or_else(|| Utc::now().to_rfc3339());

    if bundle.project.snapshots.is_empty() {
        let prepared = ensure_document_metadata(&id, &safe_title, &bundle.project.document);
        atomic_write(&document_path(&id), &prepared)?;
        commit_current_document(&repo, "Project imported", &created)?;
    } else {
        for snapshot in &bundle.project.snapshots {
            let prepared = ensure_document_metadata(&id, &safe_title, &snapshot.document);
            atomic_write(&document_path(&id), &prepared)?;
            commit_current_document(&repo, &snapshot.message, &snapshot.timestamp)?;
        }

        let latest_snapshot = bundle
            .project
            .snapshots
            .last()
            .map(|snapshot| snapshot.document.clone())
            .unwrap_or_default();
        if latest_snapshot != bundle.project.document {
            let prepared = ensure_document_metadata(&id, &safe_title, &bundle.project.document);
            atomic_write(&document_path(&id), &prepared)?;
        }
    }

    let comments = bundle.project.comments;
    let json = serde_json::to_string_pretty(&comments).map_err(|e| e.to_string())?;
    atomic_write(&comments_path(&id), &json)?;

    let modified = Utc::now().to_rfc3339();
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO projects (id, title, created, modified, path) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            safe_title,
            created,
            modified,
            folder.to_string_lossy().to_string()
        ],
    )
    .map_err(|e| e.to_string())?;

    let content = fs::read_to_string(document_path(&id)).map_err(|e| e.to_string())?;
    let _ = create_backup_snapshot(&id, &safe_title, &content, true);
    current_project_meta(&id)
}

fn infer_title_from_filename(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Imported Project");
    stem.replace(['_', '-'], " ").trim().to_string()
}

fn import_text_project(file_name: &str, content: &str) -> Result<ProjectMeta, String> {
    let inferred_title = infer_title_from_filename(file_name);
    let title = if inferred_title.is_empty() {
        "Imported Project".to_string()
    } else {
        inferred_title
    };

    let prepared = if content.starts_with("---\n") {
        ensure_document_metadata("placeholder", &title, content)
            .replace("id: placeholder", "id: placeholder")
    } else {
        compose_document(
            "placeholder",
            "placeholder",
            &Utc::now().to_rfc3339(),
            &Utc::now().to_rfc3339(),
            content,
        )
    };

    create_project_record(&title, &prepared, "Project imported")
}

fn import_docx_project(file_name: &str, bytes: &[u8]) -> Result<ProjectMeta, String> {
    let markdown = docx_bytes_to_markdown(bytes)?;
    import_text_project(file_name, &markdown)
}

#[tauri::command]
fn create_project(title: String) -> Result<ProjectMeta, String> {
    let trimmed = title.trim();
    let final_title = if trimmed.is_empty() {
        "Untitled Project"
    } else {
        trimmed
    };
    create_project_record(final_title, "", "Project initialized")
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

    let mut output = Vec::new();
    for row in rows {
        let (id, title, created, modified, path) = row.map_err(|e| e.to_string())?;
        let document = fs::read_to_string(document_path(&id)).unwrap_or_default();
        let word_count = count_words(markdown_body(&document));
        let save_point_count = Repository::open(project_path(&id))
            .ok()
            .map(|repo| repo_save_point_count(&repo))
            .unwrap_or(0);

        output.push(ProjectMeta {
            id,
            title,
            created,
            modified,
            word_count,
            save_point_count,
            path,
        });
    }

    Ok(output)
}

#[tauri::command]
fn delete_project(project_id: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    fs::remove_dir_all(project_path(&project_id)).map_err(|e| e.to_string())?;
    if backups_path(&project_id).exists() {
        fs::remove_dir_all(backups_path(&project_id)).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![project_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn rename_project(project_id: String, new_title: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    let title = if new_title.trim().is_empty() {
        "Untitled Project".to_string()
    } else {
        new_title.trim().to_string()
    };
    let modified = Utc::now().to_rfc3339();

    let original = fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())?;
    let updated = ensure_document_metadata(&project_id, &title, &original);
    atomic_write(&document_path(&project_id), &updated)?;

    let conn = Connection::open(app_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET title = ?1, modified = ?2 WHERE id = ?3",
        params![title.clone(), modified, project_id.clone()],
    )
    .map_err(|e| e.to_string())?;

    let _ = create_backup_snapshot(&project_id, &title, &updated, true);
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
    let title = current_project_title(&project_id)?;
    let prepared = ensure_document_metadata(&project_id, &title, &content);
    atomic_write(&document_path(&project_id), &prepared)?;

    let modified = Utc::now().to_rfc3339();
    update_project_timestamp(&project_id, &modified)?;
    let _ = create_backup_snapshot(&project_id, &title, &prepared, false);
    Ok(())
}

#[tauri::command]
fn create_save_point(project_id: String, message: String) -> Result<SavePoint, String> {
    ensure_project_exists(&project_id)?;
    let repo = Repository::open(project_path(&project_id)).map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let save_point_message = if message.trim().is_empty() {
        format!("Snapshot {}", Utc::now().format("%b %-d, %-I:%M %p"))
    } else {
        message.trim().to_string()
    };

    let oid = commit_current_document(&repo, &save_point_message, &now)?;
    update_project_timestamp(&project_id, &now)?;

    let title = current_project_title(&project_id)?;
    let document = fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())?;
    let _ = create_backup_snapshot(&project_id, &title, &document, true);

    let stats = get_change_stats(project_id.clone(), oid.to_string())?;
    Ok(SavePoint {
        hash: oid.to_string(),
        message: save_point_message,
        timestamp: now,
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

    Ok(simple_paragraph_diff(
        markdown_body(&from_doc),
        markdown_body(&to_doc),
    ))
}

#[tauri::command]
fn load_comments(project_id: String) -> Result<Vec<CommentThread>, String> {
    ensure_project_exists(&project_id)?;
    Ok(open_comments_file(&project_id)?.threads)
}

#[tauri::command]
fn add_comment(
    project_id: String,
    paragraph_id: String,
    text: String,
) -> Result<CommentThread, String> {
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
fn reply_to_comment(
    project_id: String,
    thread_id: String,
    text: String,
) -> Result<Comment, String> {
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
        .find(|thread| thread.id == thread_id)
        .ok_or_else(|| "Comment thread not found".to_string())?;
    thread.comments.push(reply.clone());

    write_comments_file(&project_id, &file)?;
    Ok(reply)
}

#[tauri::command]
fn resolve_thread(project_id: String, thread_id: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    let mut file = open_comments_file(&project_id)?;
    if let Some(thread) = file
        .threads
        .iter_mut()
        .find(|thread| thread.id == thread_id)
    {
        thread.resolved = true;
    }
    write_comments_file(&project_id, &file)
}

#[tauri::command]
fn delete_thread(project_id: String, thread_id: String) -> Result<(), String> {
    ensure_project_exists(&project_id)?;
    let mut file = open_comments_file(&project_id)?;
    file.threads.retain(|thread| thread.id != thread_id);
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
    for index in 0..max_len {
        match (left.get(index), right.get(index)) {
            (Some(a), Some(b)) if a == b => blocks.push(MergeBlock {
                block_type: "clean".into(),
                content: Some(a.clone()),
                yours: None,
                theirs: None,
                block_index: index,
            }),
            (Some(a), Some(b)) => {
                has_conflicts = true;
                blocks.push(MergeBlock {
                    block_type: "conflict".into(),
                    content: None,
                    yours: Some(a.clone()),
                    theirs: Some(b.clone()),
                    block_index: index,
                });
            }
            (Some(a), None) => blocks.push(MergeBlock {
                block_type: "clean".into(),
                content: Some(a.clone()),
                yours: None,
                theirs: None,
                block_index: index,
            }),
            (None, Some(b)) => blocks.push(MergeBlock {
                block_type: "clean".into(),
                content: Some(b.clone()),
                yours: None,
                theirs: None,
                block_index: index,
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
    let mut merged = String::new();

    for resolution in resolutions {
        let line = match resolution.choice.as_str() {
            "yours" => "<<YOURS CHOSEN>>",
            "theirs" => "<<THEIRS CHOSEN>>",
            "both" => "<<BOTH CHOSEN>>",
            _ => "<<UNKNOWN CHOICE>>",
        };
        merged.push_str(line);
        merged.push_str("\n\n");
    }

    if merged.trim().is_empty() {
        return Ok(());
    }

    save_document(project_id, merged)
}

#[tauri::command]
fn get_settings() -> Result<AppSettings, String> {
    read_settings_file()
}

#[tauri::command]
fn update_settings(settings: AppSettings) -> Result<(), String> {
    write_settings_file(&settings)
}

#[tauri::command]
fn get_storage_overview() -> Result<StorageOverview, String> {
    build_storage_overview()
}

#[tauri::command]
fn list_backups(project_id: String) -> Result<Vec<BackupEntry>, String> {
    list_backup_entries_for_project(&project_id)
}

#[tauri::command]
fn create_backup(project_id: String) -> Result<BackupEntry, String> {
    ensure_project_exists(&project_id)?;
    let title = current_project_title(&project_id)?;
    let content = fs::read_to_string(document_path(&project_id)).map_err(|e| e.to_string())?;
    create_backup_snapshot(&project_id, &title, &content, true)
}

fn normalized_export_format(format: String) -> String {
    match format.as_str() {
        "md" | "txt" | "inkline" | "docx" => format,
        _ => "inkline".into(),
    }
}

fn export_extension(format: &str) -> &str {
    match format {
        "md" => "md",
        "txt" => "txt",
        "docx" => "docx",
        _ => "inkline",
    }
}

fn export_path_with_extension(path: PathBuf, format: &str) -> PathBuf {
    let expected = export_extension(format);
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|extension| extension.eq_ignore_ascii_case(expected))
        .unwrap_or(false)
    {
        path
    } else {
        path.with_extension(expected)
    }
}

fn write_project_export(project_id: &str, format: String, output_path: Option<String>) -> Result<ExportedFile, String> {
    ensure_project_exists(project_id)?;
    ensure_app_ready()?;

    let normalized_format = normalized_export_format(format);
    let title = current_project_title(project_id)?;
    let slug = sanitize_file_stem(&title);
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let document = fs::read_to_string(document_path(project_id)).map_err(|e| e.to_string())?;

    let path = if let Some(output_path) = output_path {
        let requested = PathBuf::from(output_path.trim());
        if requested.as_os_str().is_empty() {
            exports_root().join(format!("{slug}-{stamp}.{}", export_extension(&normalized_format)))
        } else if requested.is_dir() {
            requested.join(format!("{slug}-{stamp}.{}", export_extension(&normalized_format)))
        } else {
            export_path_with_extension(requested, &normalized_format)
        }
    } else {
        exports_root().join(format!("{slug}-{stamp}.{}", export_extension(&normalized_format)))
    };

    if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    match normalized_format.as_str() {
        "md" => atomic_write(&path, &document)?,
        "txt" => atomic_write(&path, &document_plain_text(&document))?,
        "docx" => {
            let bytes = markdown_to_docx_bytes(&document, &title)?;
            atomic_write_bytes(&path, &bytes)?;
        }
        _ => {
            let bundle = project_bundle(project_id)?;
            let content = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())?;
            atomic_write(&path, &content)?;
        }
    }

    Ok(ExportedFile {
        path: path.to_string_lossy().to_string(),
        format: normalized_format,
    })
}

#[tauri::command]
fn export_project(project_id: String, format: String) -> Result<ExportedFile, String> {
    write_project_export(&project_id, format, None)
}

#[tauri::command]
fn export_project_to_path(
    project_id: String,
    format: String,
    output_path: String,
) -> Result<ExportedFile, String> {
    write_project_export(&project_id, format, Some(output_path))
}

#[tauri::command]
fn import_project(
    file_name: String,
    content: String,
    content_encoding: Option<String>,
) -> Result<ProjectMeta, String> {
    ensure_app_ready()?;

    let lower_name = file_name.to_lowercase();
    if lower_name.ends_with(".inkline")
        || lower_name.ends_with(".inkline.json")
        || lower_name.ends_with(".json")
    {
        if let Ok(bundle) = serde_json::from_str::<ProjectBundle>(&content) {
            return import_bundle_project(bundle);
        }
    }

    if lower_name.ends_with(".md")
        || lower_name.ends_with(".txt")
        || lower_name.ends_with(".markdown")
    {
        return import_text_project(&file_name, &content);
    }

    if lower_name.ends_with(".docx") {
        let bytes = decode_import_content(&content, content_encoding.as_deref())?;
        return import_docx_project(&file_name, &bytes);
    }

    Err("Unsupported file format. Use .docx, .md, .txt, or .inkline exports.".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            update_settings,
            get_storage_overview,
            list_backups,
            create_backup,
            export_project,
            export_project_to_path,
            import_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
