# page_to_page — Design Spec

**Date:** 2026-04-20
**Status:** Draft (awaiting user review)
**Author:** Aleksej Moskalev, drafted via Claude Code brainstorm

## 1. Problem

Migrating a site from Angular to Next.js currently requires the user to eyeball each page, manually describe visual deltas to Claude, and iterate. This is slow, error-prone, and does not scale past trivially small sites.

Goal: an inspection tool that systematically walks every page of the origin site, compares it against the Next.js port at pixel and DOM-style level, and produces structured fix proposals that Claude (in-session) can apply — page by page, until the port matches the original.

Non-goal: pixel-perfect reproduction at all costs. The target is "visually and stylistically equivalent", respecting design tokens (fonts, spacing scale, colors) rather than chasing zero-pixel-diff.

## 2. Solution at a glance

A local MCP server, `@noders/page-to-page`, installed per target Next.js project. Claude consumes it via tools (`init_migration`, `next_page`, `diff_current`, `get_fix_proposals`, `verify_current`, `mark_matched`, `skip_current`, `status`, `resume`). The server orchestrates Playwright (capture), pixelmatch + a DOM-style differ (compare), and a JSON state store (progress, resumability).

```
Claude session  ──MCP tools──>  page_to_page server
                                       │
                              ┌────────┼────────┐
                              ▼        ▼        ▼
                         Playwright  Diff    State +
                         (2 contexts) engine  artifacts
                              │
                        ┌─────┴─────┐
                        ▼           ▼
                   Angular site   Next.js site
                   (origin)       (localhost:3000)
```

Claude never calls Playwright directly; it only speaks to the MCP. Claude does edit Next.js source files (via Edit tool) using the structured fix proposals returned by `get_fix_proposals()`.

## 3. Decisions (locked in during brainstorm)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Page discovery | sitemap.xml → crawler fallback → manual routes override via config | SPAs often have incomplete sitemaps; we need guaranteed coverage without requiring Angular source access |
| 2 | Diff method | Pixel diff (pixelmatch) + DOM-style diff in parallel; overlay viewer as optional artifact | Pixel tells *where*, DOM tells *why*. Overlay is for human spot-checks, not automation |
| 3 | Fix loop | Semi-automatic: MCP emits structured fix proposals; Claude applies them via Edit; MCP re-verifies | Angular→Next.js migration is more than CSS — auto-apply is unsafe |
| 4 | Viewports | Default `{mobile: 375×812, tablet: 768×1024, desktop: 1440×900}`; overridable per project via config | Covers 90% of sites with sane defaults |
| 5 | Auth | Auto-login via `.env` credentials; on failure, open headful browser and wait up to 5 min for manual login; persist `storage-state.json` | Survives 2FA / OAuth / captcha without blocking automation |
| 6 | Form factor | Pure MCP server (no standalone CLI) | User confirmed reuse outside Claude is not a requirement; keeps codebase small |
| 7 | Dynamic content | Stabilization (freeze animations, mock `Date.now` / `Math.random`, wait `networkidle`) + user-defined masks via config | Automatic stabilization handles ~70% of noise; masks cover the rest (personalized content, A/B tests, carousels) |
| 8 | State | JSON state file (`page-to-page.state.json`) + artifacts folder (`page-to-page-artifacts/`) committed to git as migration audit trail; atomic writes with `.bak` fallback | Human-readable, git-friendly, resumable across sessions |

## 4. Components

Six modules, each with a single responsibility.

### 4.1 `PageDiscoverer`

- Input: `origin_url`, `config.extra_routes[]`
- Algorithm: fetch `/sitemap.xml` → parse URLs → if empty or absent, breadth-first crawl from origin (max depth 3, same-origin only) → union with `extra_routes` → deduplicate
- Output: `Page[] = { path, priority, auth_required, source: 'sitemap' | 'crawl' | 'manual' }`

### 4.2 `AuthManager`

- If `config.auth` unset → no-op.
- If set → launch Playwright, POST credentials from `.env` against `config.auth.login_url`.
- Detect success: presence of `config.auth.success_selector` or URL change away from login.
- On failure: reopen browser headful, print login URL to stderr, wait up to 5 min for `success_selector`, save `storage-state.json`.
- `PageCapturer` always loads storage state before navigation.

### 4.3 `PageCapturer`

- For each viewport in `config.viewports`:
  1. Launch 2 browser contexts (origin + target) loaded with auth storage state
  2. Inject stabilization script (CSS `*{animation:none!important}`, override `Date.now`, seed `Math.random` to `0.5`, block specified ad/tracking domains)
  3. Navigate both; wait for `networkidle` + explicit `img` load promise
  4. Apply mask selectors from config: replace matched elements with solid-gray boxes before capture
  5. Take full-page screenshot → `artifacts/<slug>/<viewport>/{origin,target}.png`
  6. Take DOM snapshot: serialized tree with computed styles for whitelisted properties (`font-family`, `font-size`, `font-weight`, `line-height`, `color`, `background-color`, `padding`, `margin`, `border`, `width`, `height`, `display`, `flex-*`, `grid-*`, `position`, `text-align`)
- Concurrency: worker pool of 4 across viewport × site pairs.

### 4.4 `DiffEngine`

**Pixel diff** — pixelmatch on origin vs target PNGs; emit `diff.png` with red overlay + `diff_percent` float.

**DOM-style diff** — this is the riskiest subsystem. See §7.

- Normalize both DOM snapshots into "visual regions" keyed by `(bounding_box_bucket, text_content_hash, tag_family)` rather than raw selector
- For each region pair, compare whitelisted computed styles
- Emit `StyleIssue[] = { region_id, bbox, property, expected, actual, severity, origin_crop_path, target_crop_path }`

Severity:
- `critical` — region present in origin, missing in target (or vice versa)
- `style` — same region, differing CSS property
- `minor` — sub-pixel rounding, color deltas within ΔE < 2

Output: `artifacts/<slug>/<viewport>/report.json`

### 4.5 `StateStore`

- Single file: `page-to-page.state.json` at project root
- Schema:
  ```ts
  {
    version: 1,
    started_at: ISOString,
    origin_url: string,
    target_url: string,
    pages: Array<{
      path: string,
      status: 'pending' | 'in_progress' | 'matched' | 'has_issues' | 'skipped' | 'error',
      source: 'sitemap' | 'crawl' | 'manual',
      last_run_at?: ISOString,
      issues_count?: number,
      skip_reason?: string,
      fix_history: Array<{ at: ISOString, description: string }>
    }>,
    current?: string // path of in_progress page
  }
  ```
- Writes: serialize to `page-to-page.state.json.tmp` → fsync → rename over target. Copy previous good file to `page-to-page.state.json.bak` post-success.
- On load: if primary fails to parse, attempt `.bak`; if also fails, throw with recovery instructions.

### 4.6 `MCPTools` (the Claude-facing surface)

| Tool | Purpose | Returns |
|---|---|---|
| `init_migration({origin_url, target_url, config_path})` | First-run: discover pages, set up auth, create state | `{discovered: n, auth: 'ok'\|'manual_required', estimated_time}` |
| `next_page()` | Pop next `pending`, mark `in_progress` | `{path, viewports}` or `{done: true}` |
| `diff_current()` | Capture + diff across all viewports for `current` page | `{total_issues, critical, style, by_viewport, artifacts_dir}` |
| `get_fix_proposals()` | Structured fix list for Claude | `FixProposal[]` (see §5.2) |
| `verify_current()` | Re-capture + diff after Claude's edits | `{status: 'matched'}` or `{remaining_issues: [...]}` |
| `mark_matched()` | Accept current page | `{pages_remaining}` |
| `skip_current({reason})` | Drop current page with reason | `{pages_remaining}` |
| `status()` | Overall progress | `{total, matched, has_issues, pending, in_progress}` |
| `resume()` | Load existing state | `{done, pending, has_issues, next_path}` |

## 5. Data flow

### 5.1 Typical session

```
1. init_migration → discovery + auth → state created, 47 pages pending
2. loop:
   a. next_page            → page X becomes in_progress
   b. diff_current         → capture × 3 viewports, diff, write artifacts
   c. get_fix_proposals    → structured list to Claude
   d. Claude edits Next.js source via Edit tool
   e. verify_current       → matched? → mark_matched
                             still issues? → back to (c) or skip_current
3. next session: resume → continue from last in_progress
```

### 5.2 `FixProposal` shape

```ts
type FixProposal = {
  region_id: string
  viewport: 'mobile' | 'tablet' | 'desktop' | string
  property: string
  expected: string
  actual: string
  severity: 'critical' | 'style' | 'minor'
  origin_crop_path: string    // artifact PNG Claude can load
  target_crop_path: string
  text_content_sample?: string // first 80 chars, to help grep Next.js source
  suggested_search_terms: string[] // e.g. ["hero", "h1", "text-5xl"]
}
```

Claude does NOT receive "edit this file at this line". It receives enough context to grep the Next.js codebase itself. This is by design: the mapping from origin DOM → Next.js component is Claude's job, not the tool's.

## 6. Error handling

| Component | Failure | Response |
|---|---|---|
| `PageDiscoverer` | Empty sitemap + crawler finds nothing | Throw with advice to add `extra_routes` in config |
| `AuthManager` | Autologin timeout | Auto-escalate to headful; if user fails too, `init_migration` errors with clear next steps |
| `PageCapturer` | Target (localhost) unreachable | 3 retries with backoff → mark page `error` in state → continue to next |
| `PageCapturer` | 4xx/5xx on origin or target | Record as `critical` issue; no diff attempted |
| `DiffEngine` | Region matching fails (confidence below threshold) | Fall back to pixel-only report for that page; flag in output |
| `StateStore` | Write fails mid-flight | Atomic rename guarantees old-or-new, never partial |
| `StateStore` | Primary state corrupt | Auto-load `.bak`; if also corrupt, stop with recovery instructions |
| `MCPTools` | Tool called out of order (e.g. `verify_current` without `next_page`) | Return structured `{error_code, message, suggested_action}` |

Principle: no silent swallowing. Every failure surfaces as structured MCP output so Claude can either self-correct or surface to the user.

## 7. Known risks

### 7.1 DOM matching across frameworks (HIGH risk)

The same visual `<h1>` will have entirely different class names, wrapper divs, and attribute sets between Angular and Next.js. Matching by selector is dead on arrival.

Mitigation: match by `(bounding_box_bucket, text_content_hash, tag_family)` with tunable fuzziness. Requires empirical tuning on real migration data.

**This must be the first prototyping task in the implementation plan.** If the matching heuristic does not achieve >85% correct pairing on a representative sample, DOM-diff is not viable and we fall back to pixel-only + structural region detection (blocks defined by bounding box, not DOM).

### 7.2 Full-page screenshot flakiness (MEDIUM)

Lazy-loaded images, scroll-triggered animations, and viewport-aware components can yield different content on full-page capture vs per-fold capture.

Mitigation: scroll-to-bottom, wait for `networkidle`, then scroll-to-top before capture. Tested in integration harness.

### 7.3 Large sites (MEDIUM)

47 pages × 3 viewports × 2 sites = 282 captures per full pass. A 50-page site with 3 re-verifies per page ≈ 850 captures. Must be bounded in CPU/IO.

Mitigation: worker pool cap of 4, configurable via `config.concurrency` (default 4, valid range 1–8). Estimated total time surfaced in `init_migration` response so user can plan session length.

## 8. Testing strategy

- **Unit (Vitest, ≥80% coverage on pure logic)** — DOM normalizer, CSS property extractor, pixel-diff wrapper, mask applier, state transitions, region-matching heuristic
- **Integration** — MCP server against two Express-served fixture sites (`/test-fixtures/origin-angular-like/`, `/test-fixtures/target-nextjs-like/`) with known intentional deltas; verify full `init → discover → capture → diff → report` cycle
- **Snapshot** — lock JSON shape of `report.json` and `FixProposal[]` output so Claude-side prompts stay stable
- **Smoke (manual)** — one scripted run against real Vercel preview clones with injected deltas; not in CI

## 9. Delivery

- **Package**: `@noders/page-to-page` (npm, scope decision pending)
- **Binary**: `page-to-page-mcp` (stdio MCP)
- **Install in target project**:
  ```bash
  npm i -D @noders/page-to-page
  npx page-to-page init
  ```
- `init` creates `page-to-page.config.json`, registers server in `.mcp.json`, and appends to `.gitignore`: `page-to-page-artifacts/` and `page-to-page.state.json.bak` (the primary `page-to-page.state.json` is committed as audit trail; the backup is local-only)

### 9.1 Monorepo layout

```
page_to_page/
├── packages/
│   ├── core/              # discoverer, capturer, diff, state (framework-agnostic)
│   └── mcp-server/        # thin MCP wrapper over core
├── test-fixtures/
│   ├── origin-angular-like/
│   └── target-nextjs-like/
├── docs/superpowers/specs/
├── package.json           # npm workspaces
└── README.md
```

Rationale for monorepo with `core` extracted: insurance against a future form-factor change (CLI, CI visual-regression runner, alternate frontend) without a rewrite. Cheap now, expensive to retrofit later.

### 9.2 Stack

- TypeScript (strict), Node 20+
- Playwright, pixelmatch, pngjs
- `@modelcontextprotocol/sdk`
- Vitest, tsx

## 10. Out of scope for v1

- Auto-applying fixes (semi-auto only)
- CLI / CI runner (monorepo keeps it possible, not delivered)
- Web dashboard / HTML report viewer (artifacts are raw PNGs + JSON)
- Non-visual diffs (accessibility tree, ARIA, keyboard nav)
- Multi-origin comparison (only one origin ↔ one target per project)
- Cloud-hosted runs

## 11. Open questions for implementation plan

1. What's the exact heuristic for `bounding_box_bucket`? Rounding to nearest 10px? Nearest 5% of viewport width?
2. For `text_content_hash` — exact match, or normalized (lowercase, collapsed whitespace)?
3. What confidence threshold for region matching before falling back to pixel-only?
4. Should `FixProposal` crops be individual PNGs on disk, or base64-embedded in MCP response? (Disk is cheaper for large sites; base64 is more ergonomic for Claude.)
5. Should `FixProposal.suggested_search_terms` be derived from origin class names, text content, or tag context? (Affects how reliably Claude can grep Next.js source.)

These get resolved in the writing-plans phase.
