# page_to_page

MCP server for Angular → Next.js visual migration. Walks every page of an origin site, captures screenshots across mobile/tablet/desktop viewports, pixel-diffs against the Next.js port, and tracks progress in a resumable state file.

## Install

    npm install --save-dev @noders/page-to-page
    npx page-to-page init https://origin.example.com http://localhost:3000

This creates:
- `page-to-page.config.json` — edit viewports, masks, extraRoutes
- `.mcp.json` entry registering the server for Claude Code
- `.gitignore` additions for artifacts and state backup

## Claude Code tools

- `init_migration({configPath})` — discovery + state bootstrap
- `resume({configPath})` — resume from existing state
- `next_page()` — advance to next pending page
- `diff_current()` — capture + pixel-diff across viewports
- `verify_current()` — re-diff after edits
- `get_fix_proposals()` — return structured `FixProposal[]` for current page (requires prior `diff_current()`)
- `mark_matched()` — accept current page
- `skip_current({reason})` — skip current with note
- `status()` — progress summary

## Phase scope

- **Phase 1 (shipped):** pixel-diff, full MCP surface, state, discovery, bootstrap
- **Phase 2 (shipped):** pixel-first DOM analysis — cluster extraction, `FixProposal[]` with `kind: 'style_mismatch' | 'missing_block' | 'unknown'`, offline elementAtPoint, style diff over whitelist
- **Phase 3 (future):** auth flow (autologin + headful fallback), real-site smoke, iframe support, design-token awareness

## Development

    npm install
    npx playwright install chromium
    npm test

See `docs/superpowers/specs/2026-04-20-page-to-page-design.md` for the full design and `docs/superpowers/plans/2026-04-20-page-to-page-phase1.md` for the implementation plan.
