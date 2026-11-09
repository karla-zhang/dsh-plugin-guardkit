/**
 * Plugin Guardian — Host half.
 *
 * Watches the plugin inventory the Host already owns (`pluginManager`), turns it into a
 * snapshot of runtime state + scored risk findings, keeps an append-only timeline of every
 * state transition, and serves two same-origin JSON endpoints the browser half polls.
 *
 * Contract: ./CONTRACT.md (v1). The browser half is ./client.js.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const CONTRACT_VERSION = 1
const API_PREFIX = '/plugin-guardian/api'
const SNAPSHOT_ROUTE = `${API_PREFIX}/snapshot`
const ACTION_ROUTE = `${API_PREFIX}/action`

const SEVERITY_WEIGHT = { critical: 40, high: 20, medium: 8, low: 3, info: 0 }
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }

const INSTALL_SCRIPT_NAMES = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublishOnly']
// Install sources that never passed through a package registry.
const LOCAL_SOURCE_RE = /^(file:|link:|portal:|git\+|git:|github:|gitlab:|bitbucket:|\.{1,2}[\\/]|[a-zA-Z]:[\\/])/
const OFFICIAL_SCOPE = '@deepseek-ai/'

const DEFAULTS = {
  refreshMs: 12000,
  audit: true,
  auditDir: null,
  trusted: [],
  maxTimeline: 100,
}

/* ------------------------------------------------------------------ helpers */

function messageOf(error) {
  if (!error) return 'unknown error'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message) return error.message
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function normalizeConfig(config) {
  const source = config && typeof config === 'object' ? config : {}
  const refreshMs = Number(source.refreshMs)
  const maxTimeline = Number(source.maxTimeline)
  return {
    refreshMs: Number.isFinite(refreshMs) && refreshMs >= 3000 ? Math.min(refreshMs, 120000) : DEFAULTS.refreshMs,
    audit: source.audit === false ? false : DEFAULTS.audit,
    auditDir: typeof source.auditDir === 'string' && source.auditDir ? source.auditDir : DEFAULTS.auditDir,
    trusted: Array.isArray(source.trusted) ? source.trusted.filter((name) => typeof name === 'string') : [],
    maxTimeline:
      Number.isFinite(maxTimeline) && maxTimeline >= 10 ? Math.min(maxTimeline, 1000) : DEFAULTS.maxTimeline,
  }
}

function localize(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    for (const key of ['zh', 'en', 'title', 'label']) {
      const text = value[key]
      if (typeof text === 'string' && text) return text
    }
    const first = Object.values(value).find((entry) => typeof entry === 'string' && entry)
    return typeof first === 'string' ? first : null
  }
  return String(value)
}

function resolveMetaTitle(meta) {
  return localize(meta && meta.title)
}

function severityEmptyCounts() {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
}

function makeFinding(code, severity, scope, subject, bundle, data) {
  return {
    id: `${code}:${subject}`,
    code,
    severity,
    scope,
    subject,
    bundle: bundle || null,
    data: data && typeof data === 'object' ? data : {},
  }
}

function scoreFindings(findings) {
  const counts = severityEmptyCounts()
  let score = 0
  for (const finding of findings) {
    const severity = finding.severity in SEVERITY_WEIGHT ? finding.severity : 'info'
    counts[severity] += 1
    score += SEVERITY_WEIGHT[severity]
  }
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const level = clamped >= 40 ? 'high' : clamped >= 10 ? 'watch' : 'safe'
  return { score: clamped, level, counts }
}

function sortFindings(findings) {
  return findings
    .slice()
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
}

function ratio(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

function emptyMetrics() {
  return { transitions: 0, lastChangeAt: null, activeSince: null, phaseHistory: [] }
}

function emptyScan() {
  return {
    resolved: false,
    license: null,
    repository: null,
    postinstall: false,
    scripts: [],
    hasClient: false,
    hasTypert: false,
    bin: [],
    dependencyCount: 0,
    engines: null,
  }
}

/* ------------------------------------------------------------------- engine */

function createEngine(ctx, options) {
  const requireFromHere = createRequire(import.meta.url)
  const startedAt = Date.now()
  const auditDir =
    options.auditDir || join(process.env.DSH_HOME || join(process.cwd(), '.dsh'), 'plugin-guardian')
  const snapshotFile = join(auditDir, 'snapshot.json')
  const eventsFile = join(auditDir, 'timeline.ndjson')
  const hitsFile = join(auditDir, 'route-hits.ndjson')

  const state = {
    snapshot: null,
    lastError: null,
    lastSuccessfulAt: null,
    inflight: null,
    timer: null,
    started: false,
    timeline: [],
    actions: [],
    hits: [],
    prevPlugins: new Map(),
    prevBundles: new Map(),
    metrics: new Map(),
    scanCache: new Map(),
    lastPersisted: null,
    persistError: null,
    seenPending: new Set(),
  }

  function manager() {
    try {
      if (ctx.pluginManager) return ctx.pluginManager
    } catch {
      /* fall through */
    }
    try {
      const viaGet = typeof ctx.get === 'function' ? ctx.get('pluginManager') : null
      if (viaGet) return viaGet
    } catch {
      /* not ready yet */
    }
    return null
  }

  function report(text) {
    state.lastError = String(text || 'unknown error')
  }

  /* ------------------------------------------------------- package.json scan */

  async function readPackageManifest(name) {
    if (typeof name !== 'string' || !name) return null
    const cached = state.scanCache.get(name)
    if (cached) return cached
    const candidates = []
    const profileDir = process.env.DSH_PROFILE_DIR
    if (profileDir) candidates.push(join(profileDir, 'node_modules', name, 'package.json'))
    if (process.env.DSH_HOME) {
      const profile = process.env.DSH_PROFILE || 'desktop'
      candidates.push(join(process.env.DSH_HOME, 'profiles', profile, 'node_modules', name, 'package.json'))
    }
    try {
      candidates.push(requireFromHere.resolve(`${name}/package.json`))
    } catch {
      /* the package may not export its manifest */
    }
    for (const candidate of candidates) {
      try {
        const raw = await readFile(candidate, 'utf8')
        const manifest = JSON.parse(raw)
        if (manifest && typeof manifest === 'object') {
          state.scanCache.set(name, manifest)
          return manifest
        }
      } catch {
        /* try the next root */
      }
    }
    state.scanCache.set(name, null)
    return null
  }

  function scanManifest(manifest) {
    const scan = emptyScan()
    if (!manifest) return scan
    scan.resolved = true
    const dsh = manifest.dsh && typeof manifest.dsh === 'object' ? manifest.dsh : {}
    const scripts = manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {}
    for (const name of INSTALL_SCRIPT_NAMES) {
      if (typeof scripts[name] === 'string' && scripts[name]) scan.scripts.push(name)
    }
    scan.postinstall = scan.scripts.length > 0
    scan.hasClient = Boolean(dsh.client) || hasExport(manifest, './client')
    scan.hasTypert = hasExport(manifest, './typert') || hasExport(manifest, './remote')
    scan.bin = Array.isArray(manifest.bin)
      ? manifest.bin.filter((entry) => typeof entry === 'string')
      : manifest.bin && typeof manifest.bin === 'object'
        ? Object.keys(manifest.bin)
        : typeof manifest.bin === 'string'
          ? [manifest.bin]
          : []
    scan.dependencyCount =
      Object.keys(manifest.dependencies && typeof manifest.dependencies === 'object' ? manifest.dependencies : {})
        .length +
      Object.keys(manifest.peerDependencies && typeof manifest.peerDependencies === 'object' ? manifest.peerDependencies : {})
        .length
    scan.license = typeof manifest.license === 'string' && manifest.license ? manifest.license : null
    const repository = manifest.repository
    scan.repository =
      typeof repository === 'string'
        ? repository
        : repository && typeof repository === 'object' && typeof repository.url === 'string'
          ? repository.url
          : null
    const engines = manifest.engines
    scan.engines =
      engines && typeof engines === 'object' && typeof engines.node === 'string' ? engines.node : null
    return scan
  }

  function hasExport(manifest, key) {
    const exportsField = manifest && manifest.exports
    if (!exportsField || typeof exportsField !== 'object') return false
    return Boolean(exportsField[key])
  }

  /* ------------------------------------------------------------- observation */

  function isThirdParty(bundle) {
    if (!bundle || typeof bundle.name !== 'string') return false
    if (bundle.official === true) return false
    return !bundle.name.startsWith(OFFICIAL_SCOPE)
  }

  function bundleKeyOf(bundle) {
    return `b:${bundle && bundle.name ? bundle.name : 'unknown'}`
  }

  function pluginKeyOf(entry) {
    return `p:${entry && (entry.entryId || entry.moduleName) ? entry.entryId || entry.moduleName : 'unknown'}`
  }

  function noteHistory(key, phase, at) {
    const metrics = state.metrics.get(key) || emptyMetrics()
    metrics.phaseHistory.push({ at, phase })
    if (metrics.phaseHistory.length > 20) metrics.phaseHistory.splice(0, metrics.phaseHistory.length - 20)
    if (phase === 'active' && metrics.activeSince === null) metrics.activeSince = at
    if (phase !== 'active') metrics.activeSince = null
    state.metrics.set(key, metrics)
    return metrics
  }

  function bumpTransition(key, at) {
    const metrics = state.metrics.get(key) || emptyMetrics()
    metrics.transitions += 1
    metrics.lastChangeAt = at
    state.metrics.set(key, metrics)
    return metrics
  }

  function pushEvent(event) {
    state.timeline.unshift(event)
    if (state.timeline.length > options.maxTimeline) state.timeline.length = options.maxTimeline
    if (options.audit) {
      void appendFile(eventsFile, `${JSON.stringify(event)}\n`, 'utf8').catch((error) => {
        state.persistError = `timeline: ${messageOf(error)}`
      })
    }
  }

  function observePlugins(entries, at) {
    const seen = new Set()
    for (const entry of entries) {
      const key = pluginKeyOf(entry)
      seen.add(key)
      const phase = typeof entry.fiberPhase === 'string' ? entry.fiberPhase : null
      const enabled = entry.enabled !== false
      const previous = state.prevPlugins.get(key)
      if (!previous) {
        noteHistory(key, phase, at)
        state.prevPlugins.set(key, { phase, enabled })
        if (phase === 'pending') state.seenPending.add(key)
        continue
      }
      let changed = false
      if (previous.phase !== phase) {
        noteHistory(key, phase, at)
        bumpTransition(key, at)
        pushEvent({
          at,
          level: phase === 'failed' ? 'critical' : 'info',
          code: 'event.phase',
          subject: entry.moduleName || entry.entryId || key,
          data: { from: previous.phase, to: phase },
        })
        changed = true
        previous.phase = phase
        if (phase === 'pending') state.seenPending.add(key)
        else state.seenPending.delete(key)
      }
      if (previous.enabled !== enabled) {
        bumpTransition(key, at)
        pushEvent({
          at,
          level: 'info',
          code: 'event.enabled',
          subject: entry.moduleName || entry.entryId || key,
          data: { enabled },
        })
        changed = true
        previous.enabled = enabled
      }
      if (changed) state.prevPlugins.set(key, previous)
    }
    for (const key of Array.from(state.prevPlugins.keys())) {
      if (!seen.has(key)) {
        const previous = state.prevPlugins.get(key)
        state.prevPlugins.delete(key)
        state.seenPending.delete(key)
        pushEvent({
          at,
          level: 'low',
          code: 'event.phase',
          subject: key.slice(2),
          data: { from: previous ? previous.phase : null, to: 'removed' },
        })
      }
    }
    return seen
  }

  function observeBundles(bundles, at) {
    for (const bundle of bundles) {
      const key = bundleKeyOf(bundle)
      const previous = state.prevBundles.get(key)
      const version = typeof bundle.version === 'string' ? bundle.version : null
      const availability = typeof bundle.availability === 'string' ? bundle.availability : 'unknown'
      if (!previous) {
        state.prevBundles.set(key, { version, availability })
        continue
      }
      if (previous.version !== version) {
        bumpTransition(key, at)
        pushEvent({
          at,
          level: 'info',
          code: 'event.bundleVersion',
          subject: bundle.name,
          data: { from: previous.version, to: version },
        })
        previous.version = version
      }
      if (previous.availability !== availability) {
        bumpTransition(key, at)
        pushEvent({
          at,
          level: availability === 'missing' ? 'high' : 'info',
          code: 'event.bundleAvailability',
          subject: bundle.name,
          data: { from: previous.availability, to: availability },
        })
        previous.availability = availability
      }
      state.prevBundles.set(key, previous)
    }
  }

  /* ------------------------------------------------------------------- risk */

  function pluginFindings(entry, bundle, at) {
    const findings = []
    const subject = entry.moduleName || entry.entryId || 'unknown'
    const phase = typeof entry.fiberPhase === 'string' ? entry.fiberPhase : null
    const key = pluginKeyOf(entry)
    if (phase === 'failed') {
      findings.push(
        makeFinding('plugin.failed', 'critical', 'plugin', subject, bundle ? bundle.name : null, {
          diagnostic: typeof entry.diagnostic === 'string' ? entry.diagnostic : null,
        }),
      )
    }
    if (phase === 'pending' && state.seenPending.has(key) && state.prevPlugins.has(key)) {
      findings.push(makeFinding('plugin.pending', 'medium', 'plugin', subject, bundle ? bundle.name : null, {}))
    }
    if (phase === 'unloading') {
      findings.push(makeFinding('plugin.unloading', 'low', 'plugin', subject, bundle ? bundle.name : null, {}))
    }
    const readOnlyReason = typeof entry.readOnlyReason === 'string' ? entry.readOnlyReason : null
    if (readOnlyReason === 'management-required') {
      findings.push(makeFinding('plugin.readonly.management', 'medium', 'plugin', subject, null, {}))
    } else if (readOnlyReason === 'unaddressable') {
      findings.push(makeFinding('plugin.readonly.unaddressable', 'low', 'plugin', subject, null, {}))
    }
    if (entry.enabled === false) {
      findings.push(makeFinding('plugin.disabled', 'info', 'plugin', subject, bundle ? bundle.name : null, {}))
    }
    return findings
  }

  function bundleFindings(bundle, exemptions) {
    const findings = []
    const name = bundle.name || 'unknown'
    if (isThirdParty(bundle)) {
      findings.push(makeFinding('bundle.thirdParty', 'info', 'bundle', name, name, {}))
    }
    if (bundle.availability === 'missing') {
      findings.push(
        makeFinding('bundle.missing', 'high', 'bundle', name, name, { availability: bundle.availability }),
      )
    }
    if (bundle.error) {
      findings.push(
        makeFinding('bundle.error', 'high', 'bundle', name, name, {
          message: messageOf(bundle.error && bundle.error.message ? bundle.error.message : bundle.error),
        }),
      )
    }
    if (Array.isArray(bundle.overrides) && bundle.overrides.length > 0) {
      findings.push(
        makeFinding('bundle.overrides', 'medium', 'bundle', name, name, {
          overrides: bundle.overrides.filter((entry) => typeof entry === 'string').slice(0, 8),
        }),
      )
    }
    const exempted = exemptionFor(name, exemptions)
    if (exempted) {
      findings.push(
        makeFinding('bundle.versionExempt', 'high', 'bundle', name, name, {
          packageVersion: exempted.packageVersion,
          runtimeVersion: exempted.runtimeVersion,
        }),
      )
    }
    // Source location is a property of the wiring, not of the manifest, so it is
    // reported even when the package cannot be read from disk.
    const source = typeof bundle.source === 'string' ? bundle.source : null
    if (source && LOCAL_SOURCE_RE.test(source)) {
      findings.push(makeFinding('pkg.localSource', 'medium', 'bundle', name, name, { source }))
    }
    return findings
  }

  function exemptionFor(name, exemptions) {
    const map = exemptions && typeof exemptions.exemptions === 'object' ? exemptions.exemptions : null
    if (!map) return null
    if (Array.isArray(map[name])) {
      return { packageVersion: name, runtimeVersion: map[name].join(', ') }
    }
    for (const [key, value] of Object.entries(map)) {
      if (typeof key === 'string' && key.startsWith(name) && Array.isArray(value)) {
        return { packageVersion: key, runtimeVersion: value.join(', ') }
      }
    }
    return null
  }

  function packageFindings(bundle, scan, trusted) {
    const findings = []
    if (!scan || !scan.resolved) return findings
    const name = bundle.name || 'unknown'
    if (scan.postinstall) {
      findings.push(
        makeFinding('pkg.postinstall', 'high', 'bundle', name, name, { scripts: scan.scripts.slice(0, 6) }),
      )
    }
    if (scan.hasClient) {
      findings.push(makeFinding('pkg.clientInjection', 'medium', 'bundle', name, name, {}))
    }
    if (scan.hasTypert) {
      findings.push(makeFinding('pkg.typertRemotes', 'medium', 'bundle', name, name, {}))
    }
    if (scan.bin.length > 0) {
      findings.push(makeFinding('pkg.bin', 'low', 'bundle', name, name, { bin: scan.bin.slice(0, 6) }))
    }
    if (!scan.license) {
      findings.push(makeFinding('pkg.noLicense', 'low', 'bundle', name, name, {}))
    }
    if (trusted.has(name)) {
      return findings.filter((finding) => finding.severity === 'critical')
    }
    return findings
  }

  /* ---------------------------------------------------------------- assembly */

  async function collect() {
    const api = manager()
    if (!api) throw new Error('the plugin manager service is not available yet')
    const errors = []
    let entries = []
    let bundles = []
    let exemptions = { exemptions: {}, warnings: [] }
    try {
      entries = await api.listPlugins()
    } catch (error) {
      errors.push(`listPlugins: ${messageOf(error)}`)
    }
    try {
      bundles = await api.listBundles()
    } catch (error) {
      errors.push(`listBundles: ${messageOf(error)}`)
    }
    try {
      const result = await api.listVersionExemptions()
      if (result && typeof result === 'object') exemptions = result
    } catch (error) {
      errors.push(`listVersionExemptions: ${messageOf(error)}`)
    }
    if (!Array.isArray(entries)) entries = []
    if (!Array.isArray(bundles)) bundles = []
    return { entries, bundles, exemptions, errors }
  }

  function bundleForPlugin(entry, bundleIndex) {
    const moduleName = typeof entry.moduleName === 'string' ? entry.moduleName : null
    const entryId = typeof entry.entryId === 'string' ? entry.entryId : null
    if (moduleName && bundleIndex.byModule.has(moduleName)) return bundleIndex.byModule.get(moduleName)
    if (entryId && bundleIndex.byEntry.has(entryId)) return bundleIndex.byEntry.get(entryId)
    return null
  }

  async function buildSnapshot(collection) {
    const at = Date.now()
    const trusted = new Set(options.trusted)
    const { entries, bundles, exemptions, errors } = collection
    observePlugins(entries, at)
    observeBundles(bundles, at)

    const bundleIndex = { byModule: new Map(), byEntry: new Map() }
    for (const bundle of bundles) {
      for (const row of Array.isArray(bundle.rows) ? bundle.rows : []) {
        if (row && typeof row.moduleName === 'string') bundleIndex.byModule.set(row.moduleName, bundle)
        if (row && typeof row.entryId === 'string') bundleIndex.byEntry.set(row.entryId, bundle)
      }
    }

    const scans = new Map()
    for (const bundle of bundles) {
      if (typeof bundle.name !== 'string') continue
      if (bundle.availability === 'missing') {
        scans.set(bundle.name, emptyScan())
        continue
      }
      try {
        scans.set(bundle.name, scanManifest(await readPackageManifest(bundle.name)))
      } catch {
        scans.set(bundle.name, emptyScan())
      }
    }

    const pluginRows = []
    for (const entry of entries) {
      const bundle = bundleForPlugin(entry, bundleIndex)
      const findings = sortFindings(pluginFindings(entry, bundle, at))
      const risk = scoreFindings(findings)
      const metrics = state.metrics.get(pluginKeyOf(entry)) || emptyMetrics()
      pluginRows.push({
        entryId: typeof entry.entryId === 'string' ? entry.entryId : String(entry.entryId ?? ''),
        moduleName: typeof entry.moduleName === 'string' ? entry.moduleName : 'unknown',
        bundle: bundle ? bundle.name : null,
        title: resolveMetaTitle(bundle ? bundle.meta : null) || (typeof entry.moduleName === 'string' ? entry.moduleName : null),
        enabled: entry.enabled !== false,
        phase: typeof entry.fiberPhase === 'string' ? entry.fiberPhase : null,
        diagnostic: typeof entry.diagnostic === 'string' ? entry.diagnostic : null,
        managed: typeof entry.patchId === 'string' && Boolean(entry.patchId),
        readOnlyReason: typeof entry.readOnlyReason === 'string' ? entry.readOnlyReason : null,
        risk: { score: risk.score, level: risk.level, counts: risk.counts },
        findings,
        metrics: {
          transitions: metrics.transitions,
          lastChangeAt: metrics.lastChangeAt,
          activeSince: metrics.activeSince,
          phaseHistory: metrics.phaseHistory.slice(-20),
        },
      })
    }

    const bundleRows = []
    for (const bundle of bundles) {
      if (!bundle || typeof bundle.name !== 'string') continue
      const scan = scans.get(bundle.name) || emptyScan()
      const findings = sortFindings([
        ...bundleFindings(bundle, exemptions),
        ...packageFindings(bundle, scan, trusted),
      ])
      const risk = scoreFindings(findings)
      const metrics = state.metrics.get(bundleKeyOf(bundle)) || emptyMetrics()
      const rows = (Array.isArray(bundle.rows) ? bundle.rows : []).map((row) => {
        const match = entries.find(
          (entry) =>
            (row && row.entryId && entry.entryId === row.entryId) ||
            (row && row.moduleName && entry.moduleName === row.moduleName),
        )
        return {
          rowId: row && typeof row.rowId === 'string' ? row.rowId : '',
          moduleName: row && typeof row.moduleName === 'string' ? row.moduleName : '',
          entryId: row && typeof row.entryId === 'string' ? row.entryId : null,
          title: resolveMetaTitle(row ? row.meta : null),
          enabled: match ? match.enabled !== false : bundle.enabled !== false,
          phase: match && typeof match.fiberPhase === 'string' ? match.fiberPhase : null,
        }
      })
      bundleRows.push({
        name: bundle.name,
        official: bundle.official === true,
        thirdParty: isThirdParty(bundle),
        availability: typeof bundle.availability === 'string' ? bundle.availability : 'unknown',
        version: typeof bundle.version === 'string' ? bundle.version : null,
        title: resolveMetaTitle(bundle.meta) || bundle.name,
        description:
          localize(bundle.meta && bundle.meta.description) ||
          (typeof bundle.description === 'string' ? bundle.description : null),
        enabled: bundle.enabled !== false,
        installed: bundle.installed === true,
        removable: bundle.removable === true,
        updatable: bundle.updatable === true,
        readOnlyReason: typeof bundle.readOnlyReason === 'string' ? bundle.readOnlyReason : null,
        error: bundle.error ? messageOf(bundle.error && bundle.error.message ? bundle.error.message : bundle.error) : null,
        source: typeof bundle.source === 'string' ? bundle.source : null,
        risk: { score: risk.score, level: risk.level, counts: risk.counts },
        findings,
        metrics: {
          transitions: metrics.transitions,
          lastChangeAt: metrics.lastChangeAt,
          activeSince: metrics.activeSince,
          phaseHistory: metrics.phaseHistory.slice(-20),
        },
        package: scan,
        rows,
      })
    }

    const sortByRisk = (left, right) =>
      right.risk.score - left.risk.score || String(left.name || left.moduleName).localeCompare(String(right.name || right.moduleName))
    bundleRows.sort(sortByRisk)
    pluginRows.sort(sortByRisk)

    const allFindings = sortFindings([...bundleRows.flatMap((row) => row.findings), ...pluginRows.flatMap((row) => row.findings)])
    const counts = severityEmptyCounts()
    for (const finding of allFindings) {
      if (finding.severity in counts) counts[finding.severity] += 1
    }
    let riskScore = 0
    for (const row of [...bundleRows, ...pluginRows]) riskScore = Math.max(riskScore, row.risk.score)
    const thirdParty = bundleRows.filter((row) => row.thirdParty).length
    const phases = { active: 0, disabled: 0, failed: 0, pending: 0 }
    for (const row of pluginRows) {
      if (row.phase === 'active') phases.active += 1
      if (row.phase === 'failed') phases.failed += 1
      if (row.phase === 'pending') phases.pending += 1
      if (row.enabled === false) phases.disabled += 1
    }
    const ageMs = state.lastSuccessfulAt ? at - state.lastSuccessfulAt : 0
    if (state.lastSuccessfulAt && ageMs > options.refreshMs * 3) {
      allFindings.push(makeFinding('monitor.stale', 'medium', 'monitor', 'monitor', null, { ageMs }))
      counts.medium += 1
      riskScore = Math.max(riskScore, 28)
    }

    const snapshot = {
      v: CONTRACT_VERSION,
      at,
      host: {
        origin: currentOrigin(),
        node: process.version,
        platform: process.platform,
        profile: process.env.DSH_PROFILE || 'desktop',
        monitorStartedAt: startedAt,
        monitorUptimeMs: at - startedAt,
        refreshMs: options.refreshMs,
        auditFile: options.audit ? snapshotFile : null,
        lastError: state.lastError || (errors.length ? errors.join(' | ') : null),
      },
      summary: {
        riskScore,
        riskLevel: riskScore >= 40 ? 'high' : riskScore >= 10 ? 'watch' : 'safe',
        bundles: {
          total: bundleRows.length,
          thirdParty,
          official: bundleRows.filter((row) => row.official).length,
          installed: bundleRows.filter((row) => row.installed).length,
          missing: bundleRows.filter((row) => row.availability === 'missing').length,
        },
        plugins: {
          total: pluginRows.length,
          active: phases.active,
          disabled: phases.disabled,
          failed: phases.failed,
          pending: phases.pending,
        },
        counts,
        eventCount: state.timeline.length,
      },
      findings: sortFindings(allFindings).slice(0, 12),
      bundles: bundleRows,
      plugins: pluginRows,
      timeline: state.timeline.slice(0, options.maxTimeline),
      actions: state.actions.slice(0, 30),
    }
    return snapshot
  }

  let attachedWebServer = null
  let cachedOrigin = null
  function attachWebServer(webServer) {
    if (webServer && webServer !== attachedWebServer) {
      attachedWebServer = webServer
      cachedOrigin = null
    }
    return webServer
  }
  function currentOrigin() {
    if (cachedOrigin) return cachedOrigin
    const candidate = attachedWebServer || (ctx && ctx.webServer)
    try {
      if (candidate && typeof candidate.getOrigin === 'function') {
        const origin = candidate.getOrigin()
        if (typeof origin === 'string' && origin) cachedOrigin = origin
      }
    } catch {
      /* the web server may not be up yet */
    }
    return cachedOrigin || ''
  }

  async function persist(snapshot) {
    if (!options.audit) return
    try {
      await mkdir(auditDir, { recursive: true })
      const body = JSON.stringify(snapshot)
      if (body === state.lastPersisted) return
      state.lastPersisted = body
      await writeFile(snapshotFile, body, 'utf8')
      state.persistError = null
    } catch (error) {
      state.persistError = `audit: ${messageOf(error)}`
    }
  }

  async function refresh(reason) {
    if (state.inflight) return state.inflight
    const task = (async () => {
      try {
        const collection = await collect()
        const snapshot = await buildSnapshot(collection)
        state.snapshot = snapshot
        state.lastSuccessfulAt = snapshot.at
        if (!collection.errors.length) state.lastError = null
        await persist(snapshot)
        return snapshot
      } catch (error) {
        report(messageOf(error))
        return state.snapshot
      } finally {
        state.inflight = null
      }
    })()
    state.inflight = task
    return task
  }

  async function snapshotForRequest() {
    if (!state.snapshot) return (await refresh('request')) || state.snapshot
    const age = Date.now() - (state.lastSuccessfulAt || 0)
    if (age > options.refreshMs) {
      void refresh('stale')
    }
    return state.snapshot
  }

  /* ---------------------------------------------------------------- actions */

  async function runAction(body) {
    const action = body && typeof body.action === 'string' ? body.action : ''
    const entryId = body && typeof body.entryId === 'string' ? body.entryId : ''
    const name = body && typeof body.name === 'string' ? body.name : ''
    const api = manager()
    if (!api) return { ok: false, action, message: '插件管理器服务不可用', error: 'plugin manager unavailable' }
    if (!['disable-plugin', 'enable-plugin', 'disable-bundle', 'enable-bundle', 'refresh'].includes(action)) {
      return { ok: false, action, message: `未知操作：${action || '(empty)'}`, error: 'unknown action' }
    }
    if (action === 'refresh') {
      const snapshot = await refresh('manual')
      return { ok: true, action, message: '已刷新', snapshot: snapshot || state.snapshot }
    }
    try {
      if (action === 'disable-plugin' || action === 'enable-plugin') {
        if (!entryId) return { ok: false, action, message: '缺少 entryId', error: 'missing entryId' }
        const enabled = action === 'enable-plugin'
        const current = (state.snapshot ? state.snapshot.plugins : []).find((row) => row.entryId === entryId)
        if (current && current.managed === false) {
          return { ok: false, action, message: '该条目不可由本面板管理', error: 'not addressable' }
        }
        const result = await api.setPluginEnabled(entryId, enabled)
        const message = describeChange(result, enabled)
        const label = `${enabled ? '启用' : '隔离'} ${current ? current.moduleName : entryId}`
        recordAction({ ok: true, action, subject: current ? current.moduleName : entryId, message: label })
        const snapshot = await refresh('action')
        return { ok: true, action, message, snapshot: snapshot || state.snapshot }
      }
      if (!name) return { ok: false, action, message: '缺少插件包名', error: 'missing name' }
      const enabled = action === 'enable-bundle'
      const result = await api.setBundleEnabled(name, enabled)
      const message = describeChange(result, enabled)
      recordAction({ ok: true, action, subject: name, message: `${enabled ? '启用' : '隔离'} ${name}` })
      const snapshot = await refresh('action')
      return { ok: true, action, message, snapshot: snapshot || state.snapshot }
    } catch (error) {
      const message = messageOf(error)
      recordAction({ ok: false, action, subject: entryId || name || action, message })
      return { ok: false, action, message: `操作失败：${message}`, error: message }
    }
  }

  function describeChange(result, enabled) {
    if (!result || typeof result !== 'object') return enabled ? '已启用' : '已隔离'
    const application = typeof result.application === 'string' ? result.application : 'applied'
    if (application === 'applied') return enabled ? '已启用' : '已隔离'
    if (application === 'restart-required') {
      return `${enabled ? '已启用' : '已隔离'}，需要重启 DSH 后生效${
        result.restartReason ? `（${result.restartReason}）` : ''
      }`
    }
    if (application === 'overridden') return '该行被上层配置覆盖，变更未生效'
    if (application === 'cancelled') return '操作被取消'
    return `操作未完成${result.error && result.error.message ? `：${result.error.message}` : ''}`
  }

  function recordAction(entry) {
    const at = Date.now()
    const record = {
      at,
      ok: entry.ok === true,
      action: String(entry.action || 'action'),
      subject: String(entry.subject || ''),
      message: String(entry.message || ''),
    }
    state.actions.unshift(record)
    if (state.actions.length > 30) state.actions.length = 30
    pushEvent({
      at,
      level: record.ok ? 'info' : 'medium',
      code: 'event.action',
      subject: record.subject,
      data: { action: record.action, ok: record.ok, message: record.message },
    })
  }

  /* ----------------------------------------------------------------- routes */

  function sendJson(response, status, value) {
    let body
    try {
      body = JSON.stringify(value)
    } catch {
      body = JSON.stringify({ ok: false, message: 'failed to serialize response' })
      status = 500
    }
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(body)
  }

  function originAllowed(request) {
    const origin = request.headers && request.headers.origin
    if (!origin) return true
    try {
      const parsed = new URL(origin)
      const host = request.headers.host
      return !host || parsed.host === host
    } catch {
      return false
    }
  }

  function readJsonBody(request, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      request.on('data', (chunk) => {
        size += chunk.length
        if (size > limit) {
          reject(new Error('request body too large'))
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        if (chunks.length === 0) return resolve({})
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('invalid JSON body'))
        }
      })
      request.on('error', (error) => reject(error))
    })
  }

  function noteHit(request, route) {
    if (!options.audit) return
    const hit = {
      at: Date.now(),
      route,
      method: request.method || 'GET',
      agent: String((request.headers && request.headers['user-agent']) || '').slice(0, 120),
    }
    state.hits.unshift(hit)
    if (state.hits.length > 20) state.hits.length = 20
    void writeFile(hitsFile, `${state.hits.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8').catch(
      () => {},
    )
  }

  function serve(webServer) {
    if (!webServer || typeof webServer.register !== 'function') {
      throw new Error('webServer.register is not available')
    }
    attachWebServer(webServer)
    const disposers = []
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: SNAPSHOT_ROUTE,
        handler: async (request, response) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.writeHead(405, { allow: 'GET, HEAD' })
            response.end()
            return
          }
          if (!originAllowed(request)) {
            sendJson(response, 403, { ok: false, message: 'origin not allowed' })
            return
          }
          noteHit(request, 'snapshot')
          try {
            const snapshot = await snapshotForRequest()
            if (!snapshot) {
              sendJson(response, 503, { ok: false, message: state.lastError || 'snapshot not ready' })
              return
            }
            sendJson(response, 200, snapshot)
          } catch (error) {
            sendJson(response, 500, { ok: false, message: messageOf(error) })
          }
        },
      }),
    )
    disposers.push(
      webServer.register({
        kind: 'exact',
        path: ACTION_ROUTE,
        handler: async (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' })
            response.end()
            return
          }
          if (!originAllowed(request)) {
            sendJson(response, 403, { ok: false, message: 'origin not allowed' })
            return
          }
          noteHit(request, 'action')
          let body
          try {
            body = await readJsonBody(request)
          } catch (error) {
            sendJson(response, 400, { ok: false, action: '', message: messageOf(error) })
            return
          }
          const result = await runAction(body)
          sendJson(response, result.ok ? 200 : 400, result)
        },
      }),
    )
    return () => {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch {
          /* already gone */
        }
      }
    }
  }

  function start() {
    if (state.started) return
    state.started = true
    void mkdir(auditDir, { recursive: true }).catch(() => {})
    void refresh('boot')
    state.timer = setInterval(() => {
      void refresh('poll')
    }, options.refreshMs)
    if (state.timer && typeof state.timer.unref === 'function') state.timer.unref()
  }

  function stop() {
    state.started = false
    if (state.timer) {
      clearInterval(state.timer)
      state.timer = null
    }
  }

  return { start, stop, serve, refresh, runAction, state }
}

/* --------------------------------------------------------------------- apply */

export function apply(ctx, config) {
  const options = normalizeConfig(config)
  const engine = createEngine(ctx, options)

  ctx.effect(() => {
    engine.start()
    return () => engine.stop()
  })

  ctx.inject(['webServer'], (web) => {
    web.effect(() => {
      try {
        return engine.serve(web.webServer)
      } catch (error) {
        engine.state.lastError = `route registration failed: ${messageOf(error)}`
        return () => {}
      }
    })
  })
}
