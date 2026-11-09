# Plugin Guardian — data contract v1

Written by the Lead. The Host half (`index.js`) produces exactly this JSON; the browser half
(`client.js`) renders it. Neither side may change the shape without bumping `v`.

Two HTTP endpoints live on the DSH web server (same origin as the page):

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/plugin-guardian/api/snapshot` | – | `Snapshot` |
| POST | `/plugin-guardian/api/action` | `ActionRequest` | `ActionResult` |

Both answer `application/json; charset=utf-8`, `cache-control: no-store`.

## Snapshot

```ts
interface Snapshot {
  v: 1
  at: number                    // ms epoch of this reading
  host: HostInfo
  summary: Summary
  findings: Finding[]           // top findings, severity desc, max 12
  bundles: BundleRow[]          // sorted: risky first, then name
  plugins: PluginRow[]          // sorted: risky first, then moduleName
  timeline: TimelineEvent[]     // newest first, max 100
  actions: ActionLog[]          // newest first, max 30 (audit of what the panel did)
}

interface HostInfo {
  origin: string                // e.g. "http://127.0.0.1:60723"
  node: string                  // e.g. "v22.14.0"
  platform: string              // "win32"
  profile: string               // "desktop"
  monitorStartedAt: number
  monitorUptimeMs: number
  refreshMs: number             // suggested client poll interval (ms)
  auditFile: string | null      // absolute path of the on-disk snapshot, or null
  lastError: string | null      // last engine error, null when healthy
}

interface Summary {
  riskScore: number             // 0..100, higher is worse
  riskLevel: 'safe' | 'watch' | 'high'
  bundles: { total: number; thirdParty: number; official: number; installed: number; missing: number }
  plugins: { total: number; active: number; disabled: number; failed: number; pending: number }
  counts: { critical: number; high: number; medium: number; low: number; info: number }
  eventCount: number
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
type Level = 'safe' | 'watch' | 'high'

interface Finding {
  id: string                    // unique, stable per subject+code
  code: string                  // see dictionary below
  severity: Severity
  scope: 'plugin' | 'bundle' | 'monitor'
  subject: string               // plugin moduleName, bundle name, or 'monitor'
  bundle: string | null         // owning bundle when known
  data: Record<string, unknown> // code-specific payload, see dictionary
}

interface RiskSummary {
  score: number                 // 0..100 for this subject
  level: Level
  counts: { critical: number; high: number; medium: number; low: number; info: number }
}

interface PackageScan {
  resolved: boolean             // false when the package.json could not be read
  license: string | null
  repository: string | null
  postinstall: boolean          // any of preinstall/install/postinstall/prepare ran at install time
  scripts: string[]             // install-time script names found
  hasClient: boolean            // ships a browser half (dsh.client / ./client export)
  hasTypert: boolean            // exports a typert/remote surface
  bin: string[]
  dependencyCount: number
  engines: string | null
}

interface Metrics {
  transitions: number           // state changes observed since the monitor started
  lastChangeAt: number | null
  activeSince: number | null    // ms epoch when it entered 'active'
  phaseHistory: { at: number; phase: string }[]  // max 20, oldest first
}

interface BundleRow {
  name: string
  official: boolean
  thirdParty: boolean
  availability: 'installation' | 'profile' | 'missing' | 'unknown'
  version: string | null
  title: string | null
  description: string | null
  enabled: boolean
  installed: boolean
  removable: boolean
  updatable: boolean
  readOnlyReason: string | null
  error: string | null
  source: string | null
  risk: RiskSummary
  findings: Finding[]
  metrics: Metrics
  package: PackageScan | null
  rows: {
    rowId: string
    moduleName: string
    entryId: string | null
    title: string | null
    enabled: boolean
    phase: string | null
  }[]
}

interface PluginRow {
  entryId: string
  moduleName: string
  bundle: string | null
  title: string | null
  enabled: boolean
  phase: string | null          // 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null
  diagnostic: string | null
  managed: boolean              // true when the panel may enable/disable it
  readOnlyReason: string | null
  risk: RiskSummary
  findings: Finding[]
  metrics: Metrics
}

interface TimelineEvent {
  at: number
  level: Severity
  code: string                  // see dictionary below
  subject: string
  data: Record<string, unknown>
}

interface ActionLog {
  at: number
  ok: boolean
  action: string
  subject: string
  message: string               // human text produced by the Host (already localized to zh)
}

interface ActionRequest {
  action: 'disable-plugin' | 'enable-plugin' | 'disable-bundle' | 'enable-bundle' | 'refresh'
  entryId?: string              // required for *-plugin
  name?: string                 // required for *-bundle
}

interface ActionResult {
  ok: boolean
  action: string
  message: string               // human text (zh) from the Host
  snapshot?: Snapshot           // fresh snapshot after the action, absent on failure
  error?: string
}
```

## Finding dictionary (client owns all copy, both zh and en)

| code | data | meaning |
|---|---|---|
| `plugin.failed` | `{diagnostic}` | entry fiber failed to load/apply |
| `plugin.pending` | `{}` | still pending after being seen pending before |
| `plugin.unloading` | `{}` | currently unloading |
| `plugin.readonly.management` | `{}` | managed elsewhere; cannot be toggled here |
| `plugin.readonly.unaddressable` | `{}` | Loader entry not addressable |
| `plugin.disabled` | `{}` | entry disabled by config |
| `bundle.thirdParty` | `{}` | not shipped by DeepSeek; runs with full Host privileges |
| `bundle.missing` | `{availability}` | declared but its package is missing |
| `bundle.error` | `{message}` | plugin manager reported a management error |
| `bundle.overrides` | `{overrides: string[]}` | bundle patch overrides other rows |
| `bundle.versionExempt` | `{packageVersion, runtimeVersion}` | engines check bypassed |
| `pkg.postinstall` | `{scripts: string[]}` | install-time scripts executed code |
| `pkg.bin` | `{bin: string[]}` | package puts executables on PATH |
| `pkg.clientInjection` | `{}` | ships a browser half, so it can render UI |
| `pkg.typertRemotes` | `{}` | exposes remote methods to the client |
| `pkg.noLicense` | `{}` | package declares no license |
| `pkg.localSource` | `{source}` | not installed from a registry |
| `monitor.stale` | `{ageMs}` | snapshot is older than 3× refreshMs |

## Timeline code dictionary

| code | data | level |
|---|---|---|
| `event.phase` | `{from, to}` | critical when `to === 'failed'`, else info |
| `event.enabled` | `{enabled}` | info |
| `event.bundleVersion` | `{from, to}` | info |
| `event.bundleAvailability` | `{from, to}` | high |
| `event.action` | `{action, ok, message}` | info when ok, medium otherwise |
| `event.monitorReset` | `{}` | low |

## UI specification

Mount point: a new tab in **Settings → Plugins**, registered from the client bundle as

```js
ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
  { name: 'settings.plugins.tab', id: 'guardian', order: 40, label: () => label() },
  GuardianPanel,
))
```

Layout (top to bottom), all inside one scrollable column:

1. **Status bar** — big risk level chip (`安全` / `留意` / `高风险`, color from level), risk score
   `0–100` with a thin bar, then compact counters: 插件 total/active/disabled/failed, 第三方 bundles,
   and `更新于 …` relative time. Right side: `刷新` button + auto-refresh toggle (default on, 8s).
2. **Top findings** — list of up to 8 `Finding`s as severity-colored rows. Each row shows severity dot,
   title (from the dictionary), the subject as a monospace chip, one-line detail, and the advice line
   in dim text. Clicking a row scrolls to that bundle/plugin card (use `element.scrollIntoView`).
   When there are none: a calm green "未发现风险" line.
3. **第三方插件** section — one card per `BundleRow`. Header: title or name, `版本`, official /
   third-party chip, risk chip, `启用/已停用` state, and buttons: `隔离` (disable-bundle) when
   enabled+removable, `恢复` (enable-bundle) when disabled+removable. Body: description, the package
   scan facts as small chips (`安装脚本`, `浏览器界面`, `远程接口`, `可执行文件`, `无许可证`),
   the bundle's findings, and a compact table of its `rows` with phase dots.
   Expanding a card (`详情`) reveals its `metrics` (transitions, last change, active since) and the
   raw package facts.
4. **运行时条目** section — a dense table of `plugins` (moduleName, phase dot + label, enabled,
   risk chip, transitions, last change) with the same 隔离/恢复 buttons per row when `managed`.
5. **事件时间线** section — the `timeline` list, newest first: time (`HH:MM:SS`), level dot,
   code-derived sentence, subject chip. Plus `actions` entries appended as an audit strip.

Behaviour:

* Poll `GET /plugin-guardian/api/snapshot` every `host.refreshMs` ms while mounted, plus one immediate
  fetch on mount. Abort/ignore late responses after unmount (keep a `cancelled` flag).
* Actions: `POST` the `ActionRequest`, disable the triggering button while in flight, replace state with
  `result.snapshot` when present, otherwise show the error text inline for 6s.
* Loading state: a skeleton line. Network/HTTP error: a warn row with the error text and a `重试` button.
  Never let an exception escape the component — wrap everything that can throw.
* Empty sections collapse to a single dim line.

## Hard constraints (from the DSH client plugin rules)

* File is `client.js`, a plain script starting with
  `window.__ModuleLoader__.load({ id: 'dsh-plugin-guardkit', factory(require) { … } })`.
  No `import`, no `export`, no JSX, no TypeScript, no Node built-ins, no bundler.
* React comes from `require('react')`. Use `React.createElement` (alias `h`), `useState`, `useEffect`,
  `useMemo`, `useCallback`, `useRef`. No other module may be required.
* Return `{ inject: ['slots'], apply(ctx) { … } }` from the factory. Register the slot inside
  `ctx.slots.inject(...)` / `ctx.slots.register(...)` exactly as shown above.
* Styling: inject one `<style>` element once (see `ensureStyles()` below) and use only these CSS
  custom properties, which exist in both themes:
  `--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1/2/3`, `--dsw-alias-bg-overlay`,
  `--dsw-alias-border-l1/l2/l3/l4`, `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`,
  `--dsw-alias-label-tertiary`, `--dsw-alias-label-dimmed`, `--dsw-alias-brand-primary`,
  `--dsw-alias-link`, `--dsw-alias-interactive-bg-hover`, `--dsw-alias-settings-card-fill`,
  `--dsw-alias-settings-card-stroke`, `--dsw-alias-state-error-primary`,
  `--dsw-alias-state-warn-primary`, `--dsw-alias-state-success-primary`,
  `--dsw-alias-state-success-tertiary`, `--dsw-alias-state-warn-tertiary`,
  `--dsw-alias-button-primary-fill`, `--dsw-alias-label-primary-foreground`.
  No literal colors except inside the risk palette fallbacks (write
  `var(--dsw-alias-state-error-primary, #d93f3f)` style fallbacks). Every class name starts with
  `pgx-` and every selector is scoped under `.pgx-root`.
* Copy: every visible string goes through `t(zh, en)`, which returns the string for
  `navigator.language` starting with `zh`, else the English one.
* Must work in a light and a dark theme, in a panel roughly 900px wide, and must not overflow
  horizontally at 640px.
* The component must never read another plugin's DOM, never call `document.write`, never use `innerHTML`.

Style skeleton to copy:

```js
function ensureStyles() {
  if (ensureStyles.done) return
  ensureStyles.done = true
  const css = `.pgx-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 32px;
    color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
    /* … all rules scoped under .pgx-root … */`
  const el = document.createElement('style')
  el.setAttribute('data-pgx', 'plugin-guardian')
  el.textContent = css
  document.head.appendChild(el)
}
```

Call it once inside the factory body, before returning the plugin object.
