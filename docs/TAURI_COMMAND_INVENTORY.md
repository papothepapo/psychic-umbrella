# Tauri Command Inventory

This inventory records the command surface as of the Phase 1 refactor. It is intended to keep backend cleanup deliberate instead of deleting unfinished features by accident.

## Used By The Frontend

These commands are called through `src/lib/api.ts` and should be kept unless the UI path changes:

1. `create_project`
2. `list_projects`
3. `delete_project`
4. `rename_project`
5. `load_document`
6. `save_document`
7. `create_save_point`
8. `get_timeline`
9. `get_document_at_save_point`
10. `get_settings`
11. `update_settings`
12. `get_storage_overview`
13. `list_backups`
14. `create_backup`
15. `export_project_to_path`
16. `import_project`

## Command-Exposed But Not Called By The Frontend

These commands are currently registered with Tauri but have no frontend wrapper or UI caller:

1. `get_change_stats`
   This is also used internally by backend timeline/snapshot code, so do not remove the implementation without first separating the internal helper from the command registration.

2. `compute_diff`
   The frontend currently computes comparison blocks locally in `src/lib/comparison.ts`.

3. `load_comments`
4. `add_comment`
5. `reply_to_comment`
6. `resolve_thread`
7. `delete_thread`
   These look like planned review/comment features.

8. `import_and_diff`
9. `apply_merge`
   These look like planned merge/import comparison features.

10. `export_project`
   The UI now uses `export_project_to_path` after the native save dialog. Keep only if a default-location export shortcut is intentionally planned.

## Recommended Backend Cleanup

1. Split internal helpers from Tauri command functions where a command is only registered for convenience.

2. For planned features, add frontend wrappers and a roadmap note.

3. For abandoned features, remove command registration, command functions, related structs, and frontend types in one backend-focused commit.

4. Run a native Tauri build after Rust/Cargo is available locally or in CI.
