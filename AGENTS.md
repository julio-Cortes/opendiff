# OpenDiff

OpenDiff is a standalone full-screen TUI for browsing diffs from the OpenCode V2 API.

## Development

- Use Bun for package management and scripts.
- Run `bun run typecheck` before completing a change.
- Keep changes in small, independently reviewable slices.
- Implement only the behavior requested for the current slice.
- Use the OpenCode V2 client instead of invoking Git directly.
- Preserve the existing OpenTUI and SolidJS stack.
- Pin OpenCode beta package versions exactly.
