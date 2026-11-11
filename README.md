# Plugin Guardian · 插件卫士

npm: https://www.npmjs.com/package/dsh-plugin-guardkit · source: https://github.com/karla-zhang/dsh-plugin-guardkit

Watches every plugin installed in this DeepSeek Harness profile, scores its runtime
risk, and lets you contain it from one panel inside **Plugins → 监控**.

Built for the question "what is this third-party plugin actually doing?" — the panel is
driven by the Host's live Cordis topology, not by a static list scraped at build time.

## What it shows

| Area | Detail |
| --- | --- |
| Health bar | overall risk score / level, plugin counts by fiber phase, bundle counts, snapshot age |
| Top findings | every raised finding, sorted critical → info, with subject and evidence |
| Bundle cards | per plugin bundle: third-party vs official, install source, version, license, repository, install scripts, declared bin, client/typert injection, overrides, version exemptions |
| Runtime table | per Cordis entry: module, owning bundle, enabled, fiber phase, transitions, last change, diagnostic |
| Timeline | phase transitions, enable/disable, version and availability changes, guardian actions |
| Actions | enable/disable a single plugin entry, enable/disable a whole bundle (one-click containment) |

## Risk model

Each finding carries a severity; the plugin score is the sum of weights, clamped to 100:

`critical 40 · high 20 · medium 8 · low 3 · info 0`

Levels: `≥ 40 high`, `≥ 10 watch`, otherwise `safe`.

Findings include: failed/unloading/stuck entries, read-only entries, disabled entries,
third-party bundles, missing or errored bundles, patch overrides, DSH version exemptions,
install scripts (`preinstall`/`install`/`postinstall`/`prepare`), declared `bin`,
client-bundle or typert remote injection, missing license, local/git install sources, and
stale monitoring.

## Data flow

The Host half collects from the `pluginManager` service (`listPlugins`, `listBundles`,
`listVersionExemptions`), reads each installed package's `package.json` from the profile,
diffs the inventory on every refresh to build the timeline, and serves a read-only JSON
snapshot on same-origin routes:

- `GET  /plugin-guardian/api/snapshot`
- `POST /plugin-guardian/api/action` — `{ action, entryId?, name? }`

The browser half is a React component registered into the Plugins page tab row
(`plugins.tab`) and, where that page exists, the Settings → Plugins tab row
(`settings.plugins.tab`): it polls the snapshot, renders everything with
`--dsw-alias-*` theme tokens, and posts actions.
All copy is owned by the client (zh/en), so the panel follows the UI language.

Route safety: responses are `no-store`; cross-site requests are rejected by comparing the
`Origin` host with the `Host` header; action bodies are capped at 64 KiB and validated.

## Configuration

All keys are optional and live in the profile's Cordis patch row for `plugin-guardian`:

```yaml
- id: plugin-guardian
  name: dsh-plugin-guardkit
  config:
    refreshMs: 12000   # 3000..120000
    audit: true        # write snapshot.json / timeline.ndjson / route-hits.ndjson
    auditDir: null     # defaults to <DSH_HOME>/plugin-guardian
    trusted: []        # extra Origins allowed to call the action route
    maxTimeline: 100   # timeline ring size
```

Audit files (`<DSH_HOME>/plugin-guardian/`):

- `snapshot.json` — last snapshot (useful for offline inspection)
- `timeline.ndjson` — append-only event log, one JSON object per line
- `route-hits.ndjson` — last 20 API requests (method, path, status, time)

## Install

In the DSH desktop app open **Settings → Plugins** and install it from the plugin market,
or install this directory and restart the app. From a terminal (use the real profile name;
the desktop app's profile is `desktop`):

```sh
dsh plugin --profile desktop add dsh-plugin-guardkit                       # from npm
dsh plugin --profile desktop add github:karla-zhang/dsh-plugin-guardkit   # straight from GitHub
dsh plugin --profile desktop add /path/to/plugin-guardian                 # local directory
```

Restart DSH afterwards: adding a bundle changes the Host boot graph.

Uninstall with `dsh plugin --profile desktop remove dsh-plugin-guardkit`, or from the same
**Settings → Plugins** page.

## Notes

- Read-only entries (`management-required`, `unaddressable`) are reported, never silently
  treated as healthy; toggling them returns the Host's own explanation.
- Containment uses the Host `pluginManager` API, so a change that needs a restart is
  reported as such instead of pretending it applied.
- The panel never throws: a failed fetch renders an error banner and keeps the last snapshot.
