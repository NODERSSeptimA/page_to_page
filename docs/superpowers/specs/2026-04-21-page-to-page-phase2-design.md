# page_to_page Phase 2 — Design Spec

**Date:** 2026-04-21
**Status:** Draft (awaiting user review)
**Author:** Aleksej Moskalev, drafted via Claude Code brainstorm
**Supersedes:** Phase 2 scope from `2026-04-20-page-to-page-design.md` §4.4 DOM-diff subsystem and §7.1 "DOM matching across frameworks" risk

## 1. Problem

Phase 1 ships pixel diff only. Agent sees *where* two pages differ but not *why* — no CSS-level diagnosis, no structured fix proposals. The original Phase 2 plan (per §4.4 / §7.1) relied on matching DOM trees across frameworks using `(bounding_box_bucket, text_hash, tag_family)` — flagged as CRITICAL risk because Angular and Next.js render the same visual block with completely different tag nesting and class names.

Goal: a working fix-proposal pipeline that survives the Angular↔Next.js framework boundary without fragile DOM-tree matching.

## 2. Key insight: pivot to pixel-first, DOM-at-coordinates

Instead of matching DOM trees, use **physical screen coordinates** as the match key — they are identical across frameworks because both render into the same viewport dimensions.

Pipeline:
1. Pixel-diff (as Phase 1) produces a diff.png
2. Cluster red pixels into bounding boxes (one cluster = one visual issue)
3. For each cluster, sample 6 points (centroid + 4 corners + bbox center)
4. At each point, find the element underneath via `elementAtPoint(x, y)` on **both** origin and target DOM snapshots
5. Majority-vote → one element per side per cluster
6. Compare computed styles of the matched pair → emit `FixProposal`

This inverts the Phase 1 proposal: rather than *find which block corresponds to which*, use coordinates that are already correspondent, and ask *what's at this coordinate*.

## 3. Decisions (locked in during brainstorm)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Matching strategy | Pixel-first → DOM-at-coordinates | Sidesteps cross-framework DOM divergence; coordinates are framework-agnostic |
| 2 | Cluster extraction | Connected components (flood-fill) + merge close clusters | Intuitive "visual block" grouping; single tunable `mergeDistance` |
| 3 | In-cluster sampling | 6 points (centroid + 4 corners + bbox center) + majority vote | Robust to transparent overlays, padding hits, AA noise; still cheap (in-memory DOM) |
| 4 | CSS property scope | Wide whitelist (~40 props) captured, diff-only in output | Capture enough to explain any visible delta; output stays noise-free |
| 5 | Missing-block representation | Unified `FixProposal[]` with `kind` discriminator (`style_mismatch` / `missing_block` / `unknown`) | Tagged-union pattern; clean typing for agent |
| 6 | MCP integration | New `get_fix_proposals()` tool; `diff_current` summary unchanged | Cheap-vs-expensive split; proposals can be re-read without re-capture |
| 7 | Crop delivery | Disk paths in FixProposal, not base64 | Lazy loading — agent reads crops via Read tool only when needed, saves context tokens |
| 8 | DOM capture timing | Snapshot-first: serialize DOM to JSON at capture time, analyze offline | Decouples capture from analysis; `get_fix_proposals` is pure offline; enables future heuristic tuning without re-capture |
| 9 | `suggestedSearchTerms` content | Text + tag + semantic attrs (role/aria-label) + alt/title | Text is the most stable anchor across migrations; semantic attrs cover text-less elements |

## 4. Architecture

Phase 2 adds an **offline analysis layer** over Phase 1's pixel pipeline. No changes to Phase 1 MCP tool surface semantics; new artifacts and one new tool.

```
CAPTURE (Phase 1 + extended)       ANALYZE (Phase 2)              PROPOSE (Phase 2)
────────────────────────           ────────────────────           ──────────────────────
PageCapturer                       ClusterExtractor               FixProposalGenerator
  screenshot.png (unchanged)         diff.png → clusters.json       reads all artifacts
  + dom.json (NEW)                                                  → fix-proposals.json

                                   ElementAtPoint (offline)        
                                     dom.json + (x,y) → Element    

                                   StyleComparator                 
                                     two Elements → StyleDiff[]    
```

**Per-page artifact layout after Phase 2:**

```
page-to-page-artifacts/<slug>/<viewport>/
  origin.png                (Phase 1)
  target.png                (Phase 1)
  diff.png                  (Phase 1)
  report.json               (Phase 1, unchanged shape)
  origin.dom.json           (Phase 2)
  target.dom.json           (Phase 2)
  clusters.json             (Phase 2)
  fix-proposals.json        (Phase 2)
  crops/
    issue-<id>-origin.png   (Phase 2)
    issue-<id>-target.png   (Phase 2)
```

**MCP tool surface:**
- All 9 Phase 1 tools unchanged
- **New:** `get_fix_proposals()` → reads `fix-proposals.json` of current page, returns `FixProposal[]`. Throws if no diff has been run.

**Backward compatibility:** A Phase 1 client that reads only `diff_current`'s summary output continues to work. New artifacts are additive on disk.

## 5. Components

Five new modules under `packages/core/src/`. Each has one responsibility, ≤300 lines, unit-testable in isolation (except DomSnapshotter which needs a browser).

### 5.1 `DomSnapshotter` (`capture/dom-snapshot.ts`)

- Runs inside Playwright via `page.evaluate()`
- For each element in the document: `{tag, text (textContent truncated to 200 chars), attrs, bbox, computedStyles, parentIndex}`
- `attrs` includes: `id`, `class`, `role`, `aria-label`, `aria-labelledby`, `alt`, `title`, `name`, `data-testid`
- `computedStyles` is a whitelist of ~40 properties (see §5.4)
- Result stored as `DomSnapshot = { pagePath, viewport, elements: Element[], capturedAt, truncated?: true, error?: string }` — `error` populated when capture failed partway and `elements` may be empty
- **Soft cap**: 15000 elements. When hit, returns partial snapshot with `truncated: true` flag.
- Integrated into `PageCapturer.captureSite()` immediately after screenshot; writes `<side>.dom.json` adjacent to PNG.

### 5.2 `ClusterExtractor` (`diff/clusters.ts`)

- Input: diff.png byte buffer + `{mergeDistance?, minClusterArea?}` config
- Step 1 — Flood-fill: identify connected components of non-zero pixels (any channel > 0). Use iterative algorithm (queue-based, not recursive) to avoid stack overflow on large clusters.
- Step 2 — Produce bounding boxes per component: `{x, y, width, height, pixelCount}`.
- Step 3 — Merge: if two bboxes have manhattan distance between nearest points ≤ `mergeDistance` (default 30px), combine into one bbox covering both. Repeat until no more merges.
- Step 4 — Filter: drop clusters with `pixelCount < minClusterArea` (default 64 — 8×8 pixels).
- Output: `Cluster[] = { id, bbox, pixelCount }` where `id = "c-<n>"`.
- Pure function, no I/O in core logic. Test with synthetic diff PNGs.

### 5.3 `ElementAtPoint` (`analysis/element-at-point.ts`)

- Offline analog of `document.elementFromPoint`
- Input: `DomSnapshot`, point `{x, y}`
- Algorithm:
  1. Filter elements where `x/y` falls within `bbox` (inclusive on left/top, exclusive on right/bottom)
  2. From the filtered set, select the one deepest in the parent chain (traverse `parentIndex` to root, pick element with longest chain)
  3. Tie-break ties by bbox area — smaller area wins (leaf-like elements)
- Returns element index or `undefined`
- O(n) per lookup at n elements; acceptable for ≤15000 elements

### 5.4 `StyleComparator` (`analysis/style-compare.ts`)

- Input: two `Element` (origin + target), whitelist
- Output: `StyleDiff[] = { property, origin, target }` — only properties where values differ
- **Whitelist (~40):** `font-family`, `font-size`, `font-weight`, `font-style`, `line-height`, `letter-spacing`, `text-transform`, `text-align`, `text-decoration`, `color`, `background-color`, `background-image`, `opacity`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left`, `margin-top`, `margin-right`, `margin-bottom`, `margin-left`, `border-top`, `border-right`, `border-bottom`, `border-left`, `border-radius`, `width`, `height`, `min-width`, `min-height`, `max-width`, `max-height`, `display`, `position`, `flex-direction`, `justify-content`, `align-items`, `gap`, `box-shadow`, `transform`
- **Normalization**: colors compared in a canonical form (`rgb(r,g,b)` / `rgba(r,g,b,a)`) — `#ff0000` and `rgb(255,0,0)` are treated as equal. Units are NOT normalized (`1em` vs `16px` stays a real diff — it matters in practice).
- Missing-on-one-side property is a diff (origin has value, target has empty string, or vice versa).

### 5.5 `FixProposalGenerator` (`analysis/fix-proposals.ts`)

The orchestrator. Pure function over on-disk artifacts.

**Input:** `{originSnapshot, targetSnapshot, clusters, originPng, targetPng, diffPng, artifactsDir}`
**Output:** `FixProposal[]` (also writes `fix-proposals.json` + crops)

**Per cluster:**
1. Sample 6 points:
   - centroid of red pixels inside bbox (computed from diffPng)
   - 4 corners of bbox (clamped inside)
   - geometric center of bbox
2. Call `ElementAtPoint(originSnapshot, p)` and `ElementAtPoint(targetSnapshot, p)` for each of 6 points
3. Majority vote on each side → `originElement`, `targetElement` (one per side, or `undefined`). Tiebreak when no majority: pick the element appearing at the centroid point. If still tied, pick the element with the smallest bbox area (most specific).
4. **Classify `kind`**:
   - If both elements are `undefined` → `kind: 'unknown'`
   - If one element is `undefined`, OR one has bbox area > 50% viewport area while the other does not, OR one element's tag is `html`/`body` while the other has a different tag → `kind: 'missing_block'` with `side` indicating which side *has* the real (non-root, non-oversized) element
   - Otherwise → `kind: 'style_mismatch'`, run `StyleComparator` on the pair
5. **Crop**: extract bbox region from `origin.png` and `target.png` (clamped to image bounds) → write to `crops/issue-<id>-origin.png` and `crops/issue-<id>-target.png`
6. **Extract `suggestedSearchTerms`** (for `style_mismatch` / `missing_block`):
   - First: `element.text.slice(0, 80)` if non-empty
   - Then: `element.tag`
   - Then: `element.attrs['aria-label']`, `element.attrs.role`, `element.attrs.alt`, `element.attrs.title` — each as separate term if present
   - Deduplicate, preserve order (most specific first)

**FixProposal shape (canonical):**

```ts
type FixProposalBase = {
  clusterId: string;
  viewport: string;
  bbox: { x: number; y: number; width: number; height: number };
  originCropPath: string;
  targetCropPath: string;
};

type StyleMismatchProposal = FixProposalBase & {
  kind: 'style_mismatch';
  styleDiffs: Array<{ property: string; origin: string; target: string }>;
  suggestedSearchTerms: string[];
  originTextSample?: string;
};

type MissingBlockProposal = FixProposalBase & {
  kind: 'missing_block';
  side: 'origin_only' | 'target_only';
  missingElementSummary: string;       // e.g. "h1.team with text 'Our Team'"
  suggestedSearchTerms: string[];
};

type UnknownProposal = FixProposalBase & {
  kind: 'unknown';
  warning: string;                      // "Pixel diff detected but DOM at point failed on both sides"
  suggestedSearchTerms: [];
};

type FixProposal = StyleMismatchProposal | MissingBlockProposal | UnknownProposal;
```

## 6. Data flow (typical session)

```
1. Agent: diff_current()
   MCP: PageCapturer (extended) for each viewport:
     - origin.png, target.png, diff.png    [Phase 1]
     - origin.dom.json, target.dom.json     [Phase 2]
   MCP: DiffEngine:
     - clusters.json                         [Phase 2]
     - crops/*.png + fix-proposals.json     [Phase 2]
   MCP: Writes report.json                   [Phase 1 — summary unchanged]
   Returns: { totalIssues, byViewport, artifactsDir }

2. Agent: get_fix_proposals()
   MCP: Reads fix-proposals.json for current page across all viewports
   Returns: FixProposal[]

3. Agent iterates proposals:
   - For style_mismatch: grep Next.js source by suggestedSearchTerms, edit matching component
   - For missing_block: find Angular source, decide whether to port or skip
   - For unknown: read crops via Read tool, use vision, edit

4. Agent: verify_current()
   MCP: Re-run full pipeline (capture + diff + analyze)
   Returns summary. Agent re-calls get_fix_proposals if issues remain.

5. Agent: mark_matched() | mark_has_issues() | skip_current()
   (As Phase 1.)
```

## 7. Error handling & edge cases

| Component | Failure | Response |
|---|---|---|
| `DomSnapshotter` | `page.evaluate` throws (CSP, navigation mid-snapshot) | Catch, log, write empty `{elements: []}` with `error` field. `FixProposalGenerator` detects empty snapshot → emits `kind: 'unknown'` for all clusters with explicit warning. |
| `DomSnapshotter` | DOM >15000 elements | Truncate, return partial with `truncated: true`. Generator propagates as warning in affected proposals. |
| `ClusterExtractor` | diff.png empty (all zeros) | Return `[]` — valid, means page matched at pixel level. |
| `ClusterExtractor` | diff.png corrupt | Throw with path + underlying error. |
| `ElementAtPoint` | No element covers point | Returns `undefined`. Classification sees this → proposal `kind` becomes `unknown` or `missing_block` depending on other side. |
| `StyleComparator` | Missing property on one side | Treat as diff with empty-string placeholder. |
| `FixProposalGenerator` | Crop bbox exceeds image bounds | Clamp to intersection with image; do not throw. |
| `get_fix_proposals` | `fix-proposals.json` missing | Throw: "No fix proposals for current page. Call diff_current() first." |
| `get_fix_proposals` | `fix-proposals.json` corrupt | Throw: "fix-proposals.json corrupt at <path>. Re-run diff_current to regenerate." |

**Principle:** Phase 2 analysis degrades to pixel-only (Phase 1 behavior) when DOM data is unavailable — it never halts the migration on a single unusual page.

## 8. Testing strategy

- **Unit (Vitest):**
  - `ClusterExtractor`: synthetic diff PNGs with known red patches, assert bbox coordinates and merge behavior
  - `ElementAtPoint`: hand-crafted `DomSnapshot` fixtures, assert element selection for boundary, overlap, and no-hit cases
  - `StyleComparator`: pairs of elements with known-different properties, assert the diff set
  - `FixProposalGenerator`: inject mock snapshots + clusters + PNGs, assert resulting FixProposal[]
- **Integration:**
  - Extend `test-fixtures/` with one new page that triggers a predictable `style_mismatch` (different font-size on a heading) and one that triggers `missing_block` (origin has a section, target doesn't)
  - Run MCP server against fixtures, assert `get_fix_proposals` output matches expected `FixProposal[]` exactly
- **E2E:**
  - Extend existing E2E test: after `diff_current` on `/` and `/about`, call `get_fix_proposals`, assert shape and basic content (number of proposals, kinds present)

Target: ≥80% line coverage on all new pure logic modules.

## 9. Delivery & scope boundaries

### In scope

- 5 new core modules (§5)
- 1 new MCP tool (`get_fix_proposals`)
- Extended `PageCapturer.captureSite()` to write DOM snapshot
- Extended `MigrationEngine.diffPath()` to invoke cluster extraction + proposal generation
- New exports from `@noders/page-to-page-core`: `FixProposal` and sub-types, `Cluster`, `DomSnapshot`, `Element`
- Expanded test fixtures (one page per new FixProposal kind)
- Unit + integration + E2E tests
- README update documenting `get_fix_proposals`

### Explicitly out of scope (defer to later phases)

- **Proposal regeneration without re-capture** — architecture supports it (all inputs are on disk) but the `{regenerate: true}` flag and offline CLI are Phase 2.1
- **Automatic fix application** — agent proposes, human (or Claude in session) applies via Edit tool
- **Design-token awareness** — e.g., "font-size:56px → text-5xl" in Tailwind — raw CSS only for now
- **Original `(bbox_bucket, text_hash, tag_family)` DOM-tree matching** from Phase 1 spec §4.4 — replaced entirely by pixel-first approach
- **Semantic diff** — "block moved" vs "block deleted and re-added elsewhere" is not detected; both appear as one missing + one extra
- **Accessibility / ARIA analysis as proposals** — ARIA attrs are used only to build `suggestedSearchTerms`, not flagged as their own issues
- **Auth-gated pages** — still Phase 3 as per Phase 1 scope

### Dependencies

No new external packages. Uses already-installed `playwright`, `pngjs`, `zod`. Flood-fill and `elementAtPoint` are bespoke, small (tens of lines each).

### Changes to Phase 1 files

- `packages/core/src/capture/capturer.ts` — add DOM snapshot step
- `packages/core/src/engine/migration.ts` — add cluster + proposal generation to `diffPath`
- `packages/core/src/types.ts` — add Phase 2 type exports
- `packages/core/src/index.ts` — add exports
- `packages/mcp-server/src/server.ts` — add `get_fix_proposals` case
- `packages/mcp-server/src/tools/*.ts` — add handler for new tool
- `packages/mcp-server/src/index.ts` — add TOOLS entry

### Estimated scope

- ~12 new files (5 modules + 5 test files + 1 tool handler + 1 fixture page extension)
- ~10–15 tasks in the implementation plan
- ~3 file edits in Phase 1 integration points

## 10. Open questions for implementation plan

1. What exact `mergeDistance` default value? (Suggested 30px — tunable per-project in config.)
2. What exact `minClusterArea` default? (Suggested 64px² — 8×8.)
3. Should the DOM snapshot include iframes? (Probably not for v2.0; defer.)
4. Does `elementAtPoint` need to handle `pointer-events: none` elements? (Phase 1 pixel diff already captures what's visible; for lookup purposes, treat pointer-events as irrelevant — match whatever is painted at that coordinate.)
5. For `missing_block.missingElementSummary` string — precise format? (Suggested `<tag><.class or #id if short> with text "<first 40 chars>"`, e.g. `h1.hero with text "Welcome to Our Site"`.)

Resolved in writing-plans phase.
