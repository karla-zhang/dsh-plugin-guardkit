/* Plugin Guardian — browser half of the DSH Web UI plugin.
 * Contract: plugin-guardian/CONTRACT.md v1 (Snapshot / ActionRequest / ActionResult).
 * Loaded as a plain browser script by window.__ModuleLoader__; React 18 via require('react').
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-guardian',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    const ZH = String(navigator.language || '').toLowerCase().startsWith('zh');
    const t = (zh, en) => (ZH ? zh : en);
    const API_BASE = '/plugin-guardian/api';
    const DEFAULT_REFRESH = 8000, TOAST_MS = 6000, MAX_FINDINGS = 8, MAX_TIMELINE = 30, MAX_ACTIONS = 10;

    const SEV_TONE = { critical: 'crit', high: 'high', medium: 'med', low: 'low', info: 'info' };
    const SEV_LABEL = {
      critical: ['严重', 'Critical'], high: ['高', 'High'], medium: ['中', 'Medium'], low: ['低', 'Low'], info: ['提示', 'Info'],
    };
    const LEVELS = ['safe', 'watch', 'high'];
    const LEVEL_LABEL = { safe: ['安全', 'Safe'], watch: ['留意', 'Watch'], high: ['高风险', 'High risk'] };
    const PHASES = ['pending', 'loading', 'active', 'failed', 'unloading'];
    const PHASE_LABEL = {
      pending: ['等待中', 'pending'], loading: ['加载中', 'loading'], active: ['运行中', 'active'],
      failed: ['失败', 'failed'], unloading: ['卸载中', 'unloading'],
    };
    const ACTION_LABEL = {
      'disable-plugin': ['隔离插件', 'Disable plugin'], 'enable-plugin': ['恢复插件', 'Enable plugin'],
      'disable-bundle': ['隔离捆绑包', 'Disable bundle'], 'enable-bundle': ['恢复捆绑包', 'Enable bundle'],
      refresh: ['刷新', 'Refresh'],
    };

    const FINDING_COPY = {
      'plugin.failed': { title: ['插件加载失败', 'Plugin failed to load'], advice: ['查看诊断并重启 Host，或在此隔离该插件。', 'Read the diagnostic, restart the Host, or quarantine the plugin.'], detail: (d) => t('诊断：' + text(d.diagnostic), 'Diagnostic: ' + text(d.diagnostic)) },
      'plugin.pending': { title: ['插件停留在加载中', 'Plugin stuck loading'], advice: ['检查它的依赖与 Host 日志。', 'Check its dependencies and the Host log.'], detail: ['该条目已有一段时间处于 pending 状态。', 'This entry has stayed pending for a while.'] },
      'plugin.unloading': { title: ['插件正在卸载', 'Plugin unloading'], advice: ['等待卸载完成后再次操作。', 'Wait for it to finish before acting on it again.'], detail: ['该条目当前处于 unloading 阶段。', 'This entry is currently unloading.'] },
      'plugin.readonly.management': { title: ['由其他位置管理', 'Managed elsewhere'], advice: ['在对应插件或配置中调整它。', 'Adjust it in the owning plugin or configuration.'], detail: ['该条目由其他管理入口控制。', 'This entry is controlled elsewhere.'] },
      'plugin.readonly.unaddressable': { title: ['Loader 条目不可寻址', 'Loader entry not addressable'], advice: ['改用捆绑包级别操作或修改配置。', 'Use the bundle level or edit the configuration.'], detail: ['Loader 没有暴露可操作的条目句柄。', 'The Loader exposes no actionable entry handle.'] },
      'plugin.disabled': { title: ['配置中已停用', 'Disabled by configuration'], advice: ['需要时在此或配置中恢复。', 'Re-enable it here or in the configuration when needed.'], detail: ['该条目被配置停用，不会加载。', 'The entry is disabled in configuration and does not load.'] },
      'bundle.thirdParty': { title: ['第三方捆绑包', 'Third-party bundle'], advice: ['只保留你信任来源的捆绑包。', 'Keep only bundles from sources you trust.'], detail: ['并非 DeepSeek 官方发布，以完整 Host 权限运行。', 'Not published by DeepSeek; it runs with full Host privileges.'] },
      'bundle.missing': { title: ['捆绑包缺失', 'Bundle missing'], advice: ['重新安装该捆绑包或移除这条声明。', 'Reinstall the bundle or remove the declaration.'], detail: (d) => t('可用性为 ' + text(d.availability) + '，包文件无法解析。', 'Availability is ' + text(d.availability) + '; the package cannot be resolved.') },
      'bundle.error': { title: ['插件管理报错', 'Plugin manager error'], advice: ['修复错误后再启用该捆绑包。', 'Fix the error before enabling the bundle.'], detail: (d) => text(d.message) },
      'bundle.overrides': { title: ['覆盖其他插件行', 'Overrides other plugin rows'], advice: ['确认这些覆盖是你预期内的。', 'Confirm these overrides are intended.'], detail: (d) => t('覆盖：' + listOf(d.overrides), 'Overrides: ' + listOf(d.overrides)) },
      'bundle.versionExempt': { title: ['跳过版本检查', 'Version check bypassed'], advice: ['确认兼容后再继续使用。', 'Verify compatibility before continuing.'], detail: (d) => t('包 ' + text(d.packageVersion) + '，运行时 ' + text(d.runtimeVersion) + '。', 'Package ' + text(d.packageVersion) + ', runtime ' + text(d.runtimeVersion) + '.') },
      'pkg.postinstall': { title: ['安装脚本', 'Install scripts'], advice: ['审查脚本内容，否则隔离它。', 'Review the scripts, or quarantine it.'], detail: (d) => t('安装时执行：' + listOf(d.scripts), 'Runs at install time: ' + listOf(d.scripts)) },
      'pkg.bin': { title: ['提供可执行文件', 'Ships executables'], advice: ['不需要时隔离该捆绑包。', 'Quarantine it if you do not need it.'], detail: (d) => t('写入 PATH：' + listOf(d.bin), 'Adds to PATH: ' + listOf(d.bin)) },
      'pkg.clientInjection': { title: ['注入浏览器界面', 'Injects browser UI'], advice: ['确认来源可信。', 'Make sure the source is trustworthy.'], detail: ['包含浏览器端代码，可在 Web 设置页渲染界面。', 'Ships client code that can render UI in the web settings page.'] },
      'pkg.typertRemotes': { title: ['暴露远程接口', 'Exposes remote methods'], advice: ['只在可信来源上启用。', 'Enable only from a trusted source.'], detail: ['向客户端暴露了 typert/remote 方法。', 'Exposes typert/remote methods to the client.'] },
      'pkg.noLicense': { title: ['未声明许可证', 'No license'], advice: ['使用前确认授权。', 'Confirm authorization before use.'], detail: ['package.json 中没有 license 字段。', 'package.json declares no license field.'] },
      'pkg.localSource': { title: ['本地来源', 'Local source'], advice: ['本地修改可能随更新丢失，注意保留。', 'Local changes can be lost on update; keep a copy.'], detail: (d) => t('来源：' + text(d.source), 'Source: ' + text(d.source)) },
      'monitor.stale': { title: ['监控数据过期', 'Monitor data stale'], advice: ['检查 Host 监控循环是否仍在运行。', 'Check that the Host monitor loop is still running.'], detail: (d) => t('数据已 ' + duration(d.ageMs) + ' 未更新。', 'Data is ' + duration(d.ageMs) + ' old.') },
    };

    /* helpers */
    const arr = (v) => (Array.isArray(v) ? v : []);
    const text = (v, fb) => (v === null || v === undefined || v === '' ? (fb === undefined ? '—' : fb) : String(v));
    const chipText = (v, fb) => (typeof v === 'string' || typeof v === 'number' ? String(v) : (fb === undefined ? '' : fb));
    const listOf = (v) => { const a = arr(v); return a.length ? a.map((x) => chipText(x, '?')).join(', ') : '—'; };
    const numText = (v) => { const n = Number(v); return isFinite(n) ? String(Math.round(n)) : '0'; };
    const clampScore = (v) => { const n = Number(v); return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; };
    const normLevel = (v) => (LEVELS.indexOf(v) >= 0 ? v : 'watch');
    const normSev = (v) => (SEV_TONE[v] ? v : 'info');
    const normPhase = (v) => (PHASES.indexOf(v) >= 0 ? v : null);
    const pairText = (p, fb) => (Array.isArray(p) ? t(String(p[0]), String(p[1])) : fb);
    const sevLabel = (v) => pairText(SEV_LABEL[normSev(v)], '—');
    const levelLabel = (v) => pairText(LEVEL_LABEL[normLevel(v)], '—');
    const sevTone = (v) => SEV_TONE[normSev(v)];
    const phaseLabel = (v) => pairText(PHASE_LABEL[v], v ? String(v) : '—');
    const phaseTone = (p) => (p === 'active' ? 'ok' : p === 'failed' ? 'crit' : p === 'pending' ? 'high' : p === 'loading' ? 'med' : 'info');
    const actionLabel = (v) => pairText(ACTION_LABEL[v], text(v));
    const safeRisk = (r) => { const x = r && typeof r === 'object' ? r : {}; return { score: clampScore(x.score), level: normLevel(x.level) }; };
    const errText = (e) => (!e ? t('未知错误', 'Unknown error') : typeof e === 'string' ? e : typeof e.message === 'string' && e.message ? e.message : String(e));
    const pad2 = (n) => (n < 10 ? '0' + n : String(n));
    const clock = (ms) => { const d = new Date(typeof ms === 'number' ? ms : Date.now()); return isNaN(d.getTime()) ? '--:--:--' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); };
    const relTime = (ms, now) => {
      if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return '—';
      const s = Math.floor(Math.max(0, (typeof now === 'number' ? now : Date.now()) - ms) / 1000), m = Math.floor(s / 60);
      if (s < 60) return t(s + ' 秒前', s + 's ago');
      if (m < 60) return t(m + ' 分钟前', m + 'm ago');
      const hh = Math.floor(m / 60);
      return hh < 24 ? t(hh + ' 小时前', hh + 'h ago') : t(Math.floor(hh / 24) + ' 天前', Math.floor(hh / 24) + 'd ago');
    };
    const duration = (ms) => {
      const n = Number(ms), s = Math.round(n / 1000);
      if (!isFinite(n) || n < 0) return '—';
      if (s < 60) return t(s + ' 秒', s + 's');
      const m = Math.floor(s / 60);
      if (m < 60) return t(m + ' 分 ' + (s % 60) + ' 秒', m + 'm ' + (s % 60) + 's');
      return t(Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分', Math.floor(m / 60) + 'h ' + (m % 60) + 'm');
    };
    const findingText = (finding) => {
      try {
        const f = finding && typeof finding === 'object' ? finding : {};
        const code = typeof f.code === 'string' ? f.code : '', copy = FINDING_COPY[code];
        const data = f.data && typeof f.data === 'object' ? f.data : {}, severity = normSev(f.severity);
        if (!copy) return { title: code || t('未知风险项', 'Unknown finding'), detail: t('未知的风险代码：' + (code || '?'), 'Unknown finding code: ' + (code || '?')), advice: '', severity };
        const detail = typeof copy.detail === 'function' ? copy.detail(data) : pairText(copy.detail, '');
        return { title: pairText(copy.title, code || '—'), detail: String(detail || ''), advice: pairText(copy.advice, ''), severity };
      } catch (err) {
        return { title: '—', detail: t('无法解析的风险项。', 'Unreadable finding.'), advice: '', severity: 'info' };
      }
    };
    const timelineText = (event) => {
      try {
        if (!event || typeof event !== 'object') return t('未知事件', 'Unknown event');
        const code = typeof event.code === 'string' ? event.code : '';
        const data = event.data && typeof event.data === 'object' ? event.data : {};
        if (code === 'event.phase') return t('阶段 ' + text(data.from) + ' → ' + text(data.to), 'Phase ' + text(data.from) + ' → ' + text(data.to));
        if (code === 'event.enabled') return data.enabled ? t('插件已启用', 'Plugin enabled') : t('插件已停用', 'Plugin disabled');
        if (code === 'event.bundleVersion') return t('版本 ' + text(data.from) + ' → ' + text(data.to), 'Version ' + text(data.from) + ' → ' + text(data.to));
        if (code === 'event.bundleAvailability') return t('可用性 ' + text(data.from) + ' → ' + text(data.to), 'Availability ' + text(data.from) + ' → ' + text(data.to));
        if (code === 'event.action') {
          const head = actionLabel(data.action) + (data.ok ? t('成功', ' succeeded') : t('失败', ' failed')), message = chipText(data.message, '');
          return message ? head + ' · ' + message : head;
        }
        if (code === 'event.monitorReset') return t('监控已重置', 'Monitor reset');
        return code || t('未知事件', 'Unknown event');
      } catch (err) { return t('未知事件', 'Unknown event'); }
    };
    const subjectKeyFor = (finding, snapshot) => {
      if (!finding || typeof finding !== 'object') return 'monitor';
      const subject = chipText(finding.subject, '');
      if (finding.scope === 'bundle') return subject ? 'bundle:' + subject : 'monitor';
      if (finding.scope === 'plugin') {
        const hit = arr(snapshot && snapshot.plugins).find((p) => p && (p.moduleName === subject || p.entryId === subject));
        return hit && chipText(hit.entryId, '') ? 'plugin:' + hit.entryId : (subject ? 'plugin:' + subject : 'monitor');
      }
      return 'monitor';
    };
    const packageFacts = (scan) => {
      const p = scan && typeof scan === 'object' ? scan : {};
      return [
        [t('可解析', 'Resolved'), p.resolved ? t('是', 'yes') : t('否', 'no')], [t('许可证', 'License'), text(p.license)],
        [t('仓库', 'Repository'), text(p.repository)], [t('安装脚本', 'Install scripts'), listOf(p.scripts)],
        [t('可执行文件', 'Binaries'), listOf(p.bin)], [t('依赖数', 'Dependencies'), numText(p.dependencyCount)],
        [t('engines', 'Engines'), text(p.engines)],
      ];
    };
    const pkgChips = (scan) => {
      if (!scan || typeof scan !== 'object') return [];
      const out = [];
      if (scan.postinstall) out.push(['warn', t('安装脚本', 'Install scripts')]);
      if (scan.hasClient) out.push(['brand', t('浏览器界面', 'Browser UI')]);
      if (scan.hasTypert) out.push(['brand', t('远程接口', 'Remotes')]);
      if (arr(scan.bin).length) out.push(['warn', t('可执行文件', 'Binaries')]);
      if (scan.resolved && !scan.license) out.push(['neutral', t('无许可证', 'No license')]);
      if (!scan.resolved) out.push(['error', t('包不可读', 'Unreadable package')]);
      return out;
    };

    async function fetchSnapshot() {
      return fetch(API_BASE + '/snapshot', { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
    }
    async function postAction(body) {
      const res = await fetch(API_BASE + '/action', {
        method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
        cache: 'no-store', credentials: 'same-origin', body: JSON.stringify(body),
      });
      let data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      if (!data || typeof data !== 'object') throw new Error('HTTP ' + res.status + ' ' + (res.statusText || ''));
      return { ok: res.ok, data };
    }

    const sectionHead = (title, count) => h('div', { className: 'pgx-section-head' }, h('span', null, title),
      count === undefined || count === null ? null : h('span', { className: 'pgx-dim' }, String(count)));
    function Dot(props) { return h('span', { className: 'pgx-dot pgx-dot-' + (props.tone || 'info') }); }
    function RiskChip(props) {
      const risk = safeRisk(props.risk);
      const tone = risk.level === 'safe' ? 'success' : risk.level === 'watch' ? 'warn' : 'error';
      return h('span', { className: 'pgx-chip pgx-chip-' + tone, title: t('风险评分', 'Risk score') + ' ' + risk.score },
        levelLabel(risk.level) + ' ' + risk.score);
    }
    function ActionButton(props) {
      return h('button', { type: 'button', className: 'pgx-btn pgx-btn-' + (props.kind || 'default'), disabled: !!props.busy, onClick: props.onClick },
        props.busy ? h('span', { className: 'pgx-spin', 'aria-hidden': 'true' }) : null,
        props.busy ? t('处理中…', 'Working…') : props.label);
    }
    function FindingRow(props) {
      const finding = props.finding;
      const copy = findingText(finding);
      const tone = sevTone(copy.severity);
      const subject = finding && typeof finding === 'object' ? chipText(finding.subject, '') : '';
      const children = [
        h(Dot, { key: 'dot', tone }),
        h('span', { key: 'head', className: 'pgx-finding-head' },
          h('span', { className: 'pgx-finding-title' }, copy.title),
          subject ? h('span', { className: 'pgx-mono pgx-subject' }, subject) : null,
          h('span', { className: 'pgx-sev-label' }, sevLabel(copy.severity))),
        copy.detail ? h('span', { key: 'detail', className: 'pgx-finding-detail' }, copy.detail) : null,
        copy.advice ? h('span', { key: 'advice', className: 'pgx-finding-advice' }, copy.advice) : null,
      ];
      if (props.compact) return h('div', { className: 'pgx-finding pgx-tone-' + tone + ' pgx-finding-compact' }, children);
      return h('button', {
        type: 'button', className: 'pgx-finding pgx-tone-' + tone,
        onClick: props.onClick ? () => props.onClick(finding) : undefined,
      }, children);
    }
    function EmptyLine(props) { return h('div', { className: 'pgx-empty' }, props.children); }
    function Skeleton() {
      return h('div', { className: 'pgx-section pgx-skeleton', 'aria-busy': 'true' },
        h('div', { className: 'pgx-skel-line', style: { width: '38%' } }),
        h('div', { className: 'pgx-skel-card' }),
        h('div', { className: 'pgx-skel-line', style: { width: '64%' } }));
    }
    function ErrorRow(props) {
      return h('div', { className: 'pgx-error', role: 'alert' }, h(Dot, { tone: 'crit' }),
        h('span', { className: 'pgx-error-text' }, props.text || t('请求失败', 'Request failed')),
        h('button', { type: 'button', className: 'pgx-btn', onClick: props.onRetry }, t('重试', 'Retry')));
    }
    function Toast(props) {
      const toast = props.toast;
      if (!toast || !toast.text) return null;
      return h('div', { className: 'pgx-toast ' + (toast.ok ? 'pgx-toast-ok' : 'pgx-toast-bad'), role: 'status' }, toast.text);
    }
    function MetricCell(props) {
      return h('div', { className: 'pgx-kv-cell' }, h('span', { className: 'pgx-kv-key' }, props.label),
        h('span', { className: 'pgx-kv-val' }, props.value));
    }
    function MetricsBlock(props) {
      const m = props.metrics && typeof props.metrics === 'object' ? props.metrics : {};
      const history = arr(m.phaseHistory).slice(-6).map((item) => {
        const entry = item && typeof item === 'object' ? item : {};
        return clock(entry.at) + ' ' + (entry.phase ? phaseLabel(entry.phase) : '—');
      }).join(' · ');
      return h('div', { className: 'pgx-metrics' },
        h(MetricCell, { label: t('状态变化', 'Transitions'), value: numText(m.transitions) }),
        h(MetricCell, { label: t('上次变化', 'Last change'), value: m.lastChangeAt ? relTime(m.lastChangeAt, props.now) : '—' }),
        h(MetricCell, { label: t('活跃起始', 'Active since'), value: m.activeSince ? clock(m.activeSince) : '—' }),
        h(MetricCell, { label: t('阶段历史', 'Phase history'), value: history || '—' }));
    }
    function BundleRowLine(props) {
      const r = props.row && typeof props.row === 'object' ? props.row : {};
      const rawPhase = typeof r.phase === 'string' ? r.phase : '';
      const phase = normPhase(rawPhase);
      return h('div', { className: 'pgx-rowline' }, h(Dot, { tone: phase ? phaseTone(phase) : 'info' }),
        h('span', { className: 'pgx-mono pgx-rowline-name' }, chipText(r.moduleName, '') || chipText(r.rowId, '') || '—'),
        chipText(r.title, '') ? h('span', { className: 'pgx-rowline-title pgx-dim' }, chipText(r.title, '')) : null,
        h('span', { className: 'pgx-dim' }, phase ? phaseLabel(phase) : (rawPhase || '—')));
    }

    /* sections */
    function StatusBar(props) {
      const snap = props.snap && typeof props.snap === 'object' ? props.snap : {};
      const summary = snap.summary && typeof snap.summary === 'object' ? snap.summary : {};
      const host = snap.host && typeof snap.host === 'object' ? snap.host : {};
      const plugins = summary.plugins && typeof summary.plugins === 'object' ? summary.plugins : {};
      const bundles = summary.bundles && typeof summary.bundles === 'object' ? summary.bundles : {};
      const level = normLevel(summary.riskLevel), score = clampScore(summary.riskScore);
      const counters = [
        [t('插件', 'Plugins'), numText(plugins.total)], [t('活跃', 'Active'), numText(plugins.active)],
        [t('停用', 'Disabled'), numText(plugins.disabled)], [t('失败', 'Failed'), numText(plugins.failed)],
        [t('第三方', 'Third-party'), numText(bundles.thirdParty)],
      ];
      const hostBits = [host.node, host.platform, host.profile].filter(Boolean).join(' · ');
      const hostLine = [hostBits, chipText(host.origin, ''), host.monitorUptimeMs ? t('运行 ', 'up ') + duration(host.monitorUptimeMs) : '']
        .filter(Boolean).join(' · ');
      return h('div', { className: 'pgx-status', ref: props.anchor('monitor') },
        h('div', { className: 'pgx-status-main' },
          h('div', { className: 'pgx-risk pgx-risk-' + level, title: t('风险评分', 'Risk score') },
            h('span', { className: 'pgx-risk-label' }, levelLabel(level)), h('span', { className: 'pgx-risk-score' }, String(score))),
          h('div', { className: 'pgx-meter', 'aria-hidden': 'true' },
            h('div', { className: 'pgx-meter-fill pgx-fill-' + level, style: { width: score + '%' } })),
          h('div', { className: 'pgx-counters' }, counters.map((c, i) =>
            h('span', { key: 'counter' + i, className: 'pgx-counter' }, h('b', null, c[1]), ' ' + c[0])))),
        h('div', { className: 'pgx-status-side' },
          h('span', { className: 'pgx-updated' }, t('更新于 ', 'Updated ') + relTime(snap.at, props.now)),
          h('div', { className: 'pgx-btnrow' },
            h('button', { type: 'button', className: 'pgx-btn', onClick: props.onRefresh }, t('刷新', 'Refresh')),
            h('label', { className: 'pgx-toggle' },
              h('input', { type: 'checkbox', checked: !!props.auto, onChange: props.onToggleAuto }),
              h('span', null, t('自动刷新', 'Auto') + ' · ' + Math.round((props.refreshMs || DEFAULT_REFRESH) / 1000) + 's')))),
        hostLine ? h('div', { className: 'pgx-hostline' }, hostLine) : null,
        host.lastError ? h('div', { className: 'pgx-hostline pgx-warn-text' }, t('监控错误：', 'Monitor error: ') + text(host.lastError)) : null);
    }

    function FindingsSection(props) {
      const findings = arr(props.snap && props.snap.findings).slice(0, MAX_FINDINGS);
      return h('div', { className: 'pgx-section' }, sectionHead(t('主要风险', 'Top findings'), findings.length),
        findings.length === 0
          ? h('div', { className: 'pgx-empty pgx-ok-text' }, t('未发现风险。', 'No risks found.'))
          : h('div', { className: 'pgx-findings' }, findings.map((finding, i) =>
            h(FindingRow, { key: (finding && finding.id) || 'finding' + i, finding, onClick: props.onJump }))));
    }

    function BundleCard(props) {
      const bundle = props.bundle;
      if (!bundle || typeof bundle !== 'object') {
        return h('div', { className: 'pgx-card' }, h('div', { className: 'pgx-dim' }, t('无法读取的捆绑包条目。', 'Unreadable bundle entry.')));
      }
      const rawName = typeof bundle.name === 'string' ? bundle.name : '';
      const name = rawName || t('未命名捆绑包', 'Unnamed bundle');
      const key = 'bundle:' + rawName;
      const scan = bundle.package && typeof bundle.package === 'object' ? bundle.package : null;
      const busy = !!(props.busy && props.busy[key]);
      const canAct = rawName !== '' && bundle.removable === true;
      const actions = !canAct ? [] : [bundle.enabled
        ? h(ActionButton, { key: 'quarantine', kind: 'danger', busy, label: t('隔离', 'Quarantine'),
          onClick: () => props.onAction('disable-bundle', key, { action: 'disable-bundle', name: rawName }) })
        : h(ActionButton, { key: 'restore', kind: 'primary', busy, label: t('恢复', 'Restore'),
          onClick: () => props.onAction('enable-bundle', key, { action: 'enable-bundle', name: rawName }) })];
      const head = h('div', { className: 'pgx-card-head' },
        h('div', { className: 'pgx-card-title' },
          h('span', { className: 'pgx-name' }, text(bundle.title || bundle.name)),
          h('span', { className: 'pgx-mono pgx-subject' }, name)),
        h('div', { className: 'pgx-card-meta' },
          bundle.version ? h('span', { key: 'version', className: 'pgx-chip pgx-chip-neutral pgx-mono' }, 'v' + String(bundle.version)) : null,
          bundle.official ? h('span', { key: 'official', className: 'pgx-chip pgx-chip-success' }, t('官方', 'Official')) : null,
          bundle.thirdParty ? h('span', { key: 'third', className: 'pgx-chip pgx-chip-warn' }, t('第三方', 'Third-party')) : null,
          h('span', { key: 'state', className: 'pgx-chip ' + (bundle.enabled ? 'pgx-chip-success' : 'pgx-chip-neutral') },
            bundle.enabled ? t('启用', 'Enabled') : t('已停用', 'Disabled')),
          h(RiskChip, { key: 'risk', risk: bundle.risk })),
        h('div', { className: 'pgx-card-actions' }, actions,
          h('button', { key: 'details', type: 'button', className: 'pgx-btn pgx-btn-ghost', onClick: () => props.onToggle(rawName) },
            props.open ? t('收起', 'Hide') : t('详情', 'Details'))));
      const body = h('div', { className: 'pgx-card-body' },
        bundle.description ? h('div', { className: 'pgx-desc' }, String(bundle.description)) : null,
        bundle.error ? h('div', { className: 'pgx-warn-text' }, t('错误：', 'Error: ') + String(bundle.error)) : null,
        bundle.readOnlyReason ? h('div', { className: 'pgx-dim' }, t('只读原因：', 'Read-only: ') + String(bundle.readOnlyReason)) : null,
        scan ? h('div', { className: 'pgx-chips' }, pkgChips(scan).map((chip, i) =>
          h('span', { key: 'pkg' + i, className: 'pgx-chip pgx-chip-' + chip[0] }, chip[1]))) : null,
        arr(bundle.findings).length ? h('div', { className: 'pgx-findings pgx-findings-compact' }, arr(bundle.findings).map((finding, i) =>
          h(FindingRow, { key: 'finding' + i, finding, compact: true }))) : null,
        arr(bundle.rows).length ? h('div', { className: 'pgx-rows' }, arr(bundle.rows).map((row, i) =>
          h(BundleRowLine, { key: (row && row.rowId) || 'row' + i, row }))) : null,
        props.open ? h('div', { className: 'pgx-details' },
          h(MetricsBlock, { metrics: bundle.metrics, now: props.now }),
          scan
            ? h('div', { className: 'pgx-kv' }, packageFacts(scan).map((fact, i) =>
              h('div', { key: 'fact' + i, className: 'pgx-kv-cell' },
                h('span', { className: 'pgx-kv-key' }, fact[0]), h('span', { className: 'pgx-kv-val' }, fact[1]))))
            : h('div', { className: 'pgx-dim' }, t('没有包信息。', 'No package facts.'))) : null);
      return h('div', { ref: rawName ? props.anchor(key) : undefined, className: 'pgx-card' + (props.flashKey === key ? ' pgx-flash' : '') }, head, body);
    }

    function BundlesSection(props) {
      const bundles = arr(props.snap && props.snap.bundles);
      return h('div', { className: 'pgx-section' }, sectionHead(t('第三方插件', 'Third-party bundles'), bundles.length),
        bundles.length === 0
          ? h(EmptyLine, null, t('没有已安装的捆绑包。', 'No bundles installed.'))
          : h('div', { className: 'pgx-cards' }, bundles.map((bundle, i) => {
            const name = bundle && typeof bundle.name === 'string' ? bundle.name : '';
            return h(BundleCard, {
              key: name || 'bundle' + i, bundle, open: !!(name && props.openMap && props.openMap[name]),
              onToggle: props.onToggle, onAction: props.onAction, busy: props.busy,
              anchor: props.anchor, flashKey: props.flashKey, now: props.now,
            });
          })));
    }

    function PluginTableRow(props) {
      const plugin = props.plugin;
      if (!plugin || typeof plugin !== 'object') {
        return h('div', { className: 'pgx-table-row' },
          h('span', { className: 'pgx-col-name pgx-dim' }, t('无法读取的运行时条目。', 'Unreadable runtime entry.')));
      }
      const entryId = chipText(plugin.entryId, '');
      const key = entryId ? 'plugin:' + entryId : '';
      const rawPhase = typeof plugin.phase === 'string' ? plugin.phase : '';
      const phase = normPhase(rawPhase);
      const busy = !!(key && props.busy && props.busy[key]);
      const title = chipText(plugin.title, '');
      const managed = !!plugin.managed && entryId !== '';
      const action = plugin.enabled ? 'disable-plugin' : 'enable-plugin';
      const actionButton = managed
        ? h(ActionButton, {
          kind: plugin.enabled ? 'danger' : 'primary', busy,
          label: plugin.enabled ? t('隔离', 'Quarantine') : t('恢复', 'Restore'),
          onClick: () => props.onAction(action, key, { action, entryId }),
        })
        : (plugin.readOnlyReason ? h('span', { className: 'pgx-dim', title: String(plugin.readOnlyReason) }, t('只读', 'Read-only')) : null);
      return h('div', { ref: key ? props.anchor(key) : undefined, className: 'pgx-table-row' + (key && props.flashKey === key ? ' pgx-flash' : '') },
        h('span', { className: 'pgx-col-name pgx-cell-name' },
          h('b', { className: 'pgx-mono' }, chipText(plugin.moduleName, '') || entryId || '—'), title ? h('span', null, title) : null),
        h('span', { className: 'pgx-col-phase' }, h(Dot, { tone: phase ? phaseTone(phase) : 'info' }),
          phase ? phaseLabel(phase) : (rawPhase || '—')),
        h('span', { className: 'pgx-col-enabled pgx-dim' }, plugin.enabled ? t('启用', 'on') : t('停用', 'off')),
        h('span', { className: 'pgx-col-risk' }, h(RiskChip, { risk: plugin.risk })),
        h('span', { className: 'pgx-col-trans pgx-dim' }, plugin.metrics ? numText(plugin.metrics.transitions) : '—'),
        h('span', { className: 'pgx-col-changed pgx-dim' }, plugin.metrics && plugin.metrics.lastChangeAt ? relTime(plugin.metrics.lastChangeAt, props.now) : '—'),
        h('span', { className: 'pgx-col-actions' }, actionButton));
    }

    function PluginsSection(props) {
      const plugins = arr(props.snap && props.snap.plugins);
      const headLabels = [
        t('条目', 'Entry'), t('阶段', 'Phase'), t('启用', 'Enabled'), t('风险', 'Risk'),
        t('变化', 'Changes'), t('上次变化', 'Last change'), t('操作', 'Actions'),
      ];
      const columns = ['name', 'phase', 'enabled', 'risk', 'trans', 'changed', 'actions'];
      return h('div', { className: 'pgx-section' }, sectionHead(t('运行时条目', 'Runtime entries'), plugins.length),
        plugins.length === 0
          ? h(EmptyLine, null, t('没有已加载的运行时条目。', 'No runtime entries loaded.'))
          : h('div', { className: 'pgx-table' },
            h('div', { className: 'pgx-table-head' }, headLabels.map((label, i) =>
              h('span', { key: 'head' + i, className: 'pgx-col-' + columns[i] }, label))),
            plugins.map((plugin, i) => h(PluginTableRow, {
              key: (plugin && plugin.entryId) || 'plugin' + i, plugin, onAction: props.onAction,
              busy: props.busy, anchor: props.anchor, flashKey: props.flashKey, now: props.now,
            }))));
    }

    function TimelineSection(props) {
      const snap = props.snap && typeof props.snap === 'object' ? props.snap : {};
      const events = arr(snap.timeline).slice(0, MAX_TIMELINE);
      const actions = arr(snap.actions).slice(0, MAX_ACTIONS);
      if (events.length === 0 && actions.length === 0) {
        return h('div', { className: 'pgx-section' }, sectionHead(t('事件时间线', 'Event timeline')),
          h(EmptyLine, null, t('暂无事件。', 'No events yet.')));
      }
      return h('div', { className: 'pgx-section' },
        sectionHead(t('事件时间线', 'Event timeline'), events.length + actions.length),
        events.length ? h('div', { className: 'pgx-timeline' }, events.map((event, i) => {
          const ev = event && typeof event === 'object' ? event : {}, subject = chipText(ev.subject, '');
          return h('div', { key: 'event' + i, className: 'pgx-tl-row' },
            h('span', { className: 'pgx-tl-time pgx-mono' }, clock(ev.at)),
            h(Dot, { tone: sevTone(ev.level) }),
            h('span', { className: 'pgx-tl-text' }, timelineText(ev)),
            subject ? h('span', { className: 'pgx-mono pgx-subject' }, subject) : null);
        })) : null,
        actions.length ? h('div', { className: 'pgx-audit' },
          h('div', { className: 'pgx-audit-head pgx-dim' }, t('面板操作审计', 'Panel action audit')),
          actions.map((entry, i) => {
            const a = entry && typeof entry === 'object' ? entry : {}, subject = chipText(a.subject, '');
            return h('div', { key: 'action' + i, className: 'pgx-audit-row' },
              h('span', { className: 'pgx-mono' }, clock(a.at)),
              h(Dot, { tone: a.ok ? 'ok' : 'crit' }),
              h('span', { className: 'pgx-dim' }, actionLabel(a.action) + (subject ? ' · ' + subject : '')),
              h('span', { className: 'pgx-dim' }, text(a.message, '')));
          })) : null);
    }

    /* panel */
    function GuardianPanel() {
      const [snapshot, setSnapshot] = useState(null);
      const [loadError, setLoadError] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState({});
      const [toast, setToast] = useState(null);
      const [auto, setAuto] = useState(true);
      const [tickKey, setTickKey] = useState(0);
      const [openMap, setOpenMap] = useState({});
      const [flashKey, setFlashKey] = useState('');
      const [now, setNow] = useState(() => Date.now());
      const mountedRef = useRef(true), requestIdRef = useRef(0), refreshRef = useRef(DEFAULT_REFRESH);
      const subjectRefs = useRef({}), refCbs = useRef({}), toastTimerRef = useRef(0), flashTimerRef = useRef(0);

      const applySnapshot = useCallback((next) => {
        if (!next || typeof next !== 'object') return;
        setSnapshot((prev) => (prev && typeof prev.at === 'number' && typeof next.at === 'number' && next.at < prev.at ? prev : next));
      }, []);
      const showToast = useCallback((message, ok) => {
        if (!mountedRef.current) return;
        setToast({ text: String(message == null ? '' : message), ok: !!ok });
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = setTimeout(() => { if (mountedRef.current) setToast(null); }, TOAST_MS);
      }, []);
      const runAction = useCallback(async (action, busyKey, body) => {
        if (!mountedRef.current) return;
        requestIdRef.current += 1;
        setBusy((prev) => Object.assign({}, prev, { [busyKey]: true }));
        try {
          const result = await postAction(body);
          if (!mountedRef.current) return;
          const data = result.data;
          if (data.snapshot && typeof data.snapshot === 'object') applySnapshot(data.snapshot);
          const ok = !!data.ok && result.ok;
          const message = chipText(data.message, '') || chipText(data.error, '') || (ok ? t('操作成功', 'Done') : t('操作失败', 'Action failed'));
          showToast(message, ok);
        } catch (err) {
          if (mountedRef.current) showToast(errText(err), false);
        } finally {
          if (mountedRef.current) setBusy((prev) => { if (!prev[busyKey]) return prev; const next = Object.assign({}, prev); delete next[busyKey]; return next; });
        }
      }, [applySnapshot, showToast]);
      const anchor = useCallback((key) => {
        const cache = refCbs.current;
        return cache[key] || (cache[key] = (node) => { if (node) subjectRefs.current[key] = node; else delete subjectRefs.current[key]; });
      }, []);
      const onJump = useCallback((finding) => {
        try {
          const key = subjectKeyFor(finding, snapshot);
          const node = subjectRefs.current[key] || subjectRefs.current.monitor;
          if (!node || typeof node.scrollIntoView !== 'function') return;
          node.scrollIntoView({ block: 'nearest' });
          setFlashKey(key); clearTimeout(flashTimerRef.current);
          flashTimerRef.current = setTimeout(() => { if (mountedRef.current) setFlashKey(''); }, 1200);
        } catch (err) { /* a jump is never worth breaking the panel */ }
      }, [snapshot]);
      const refresh = useCallback(() => setTickKey((v) => v + 1), []);
      const toggleAuto = useCallback(() => setAuto((v) => !v), []);
      const toggleOpen = useCallback((name) => { if (name) setOpenMap((prev) => Object.assign({}, prev, { [name]: !prev[name] })); }, []);

      useEffect(() => {
        mountedRef.current = true;
        return () => {
          mountedRef.current = false; clearTimeout(toastTimerRef.current); clearTimeout(flashTimerRef.current); requestIdRef.current += 1;
        };
      }, []);
      useEffect(() => {
        const timer = setInterval(() => { if (mountedRef.current) setNow(Date.now()); }, 1000);
        return () => clearInterval(timer);
      }, []);

      useEffect(() => {
        let alive = true, timer = 0;
        const interval = () => Math.max(2000, Math.min(120000, Number(refreshRef.current) || DEFAULT_REFRESH));
        const readOnce = async (initial) => {
          const id = requestIdRef.current + 1;
          requestIdRef.current = id;
          try {
            const res = await fetchSnapshot();
            if (!alive || id !== requestIdRef.current) return;
            if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (res.statusText || ''));
            let data = null; try { data = await res.json(); } catch (err) { data = null; }
            if (!alive || id !== requestIdRef.current) return;
            if (!data || typeof data !== 'object') throw new Error(t('快照格式无效', 'Invalid snapshot payload'));
            const host = data.host && typeof data.host === 'object' ? data.host : {};
            const suggested = Number(host.refreshMs);
            if (isFinite(suggested) && suggested >= 1000) refreshRef.current = Math.min(120000, Math.max(2000, Math.round(suggested)));
            applySnapshot(data);
            setLoadError(null);
          } catch (err) {
            if (!alive || id !== requestIdRef.current) return;
            setLoadError(errText(err));
          } finally {
            if (alive && initial) setLoading(false);
          }
        };
        const tick = async (initial) => {
          await readOnce(initial);
          if (!alive || !auto) return;
          timer = setTimeout(() => { tick(false); }, interval());
        };
        tick(true);
        return () => { alive = false; clearTimeout(timer); requestIdRef.current += 1; };
      }, [auto, tickKey, applySnapshot]);

      let body;
      try {
        const snap = snapshot && typeof snapshot === 'object' ? snapshot : null;
        const host = snap && snap.host && typeof snap.host === 'object' ? snap.host : {};
        const refreshMs = Number(host.refreshMs) >= 1000 ? Number(host.refreshMs) : DEFAULT_REFRESH;
        body = h('div', { className: 'pgx-root' },
          loading && !snap ? h(Skeleton, { key: 'skeleton' }) : null,
          loadError ? h(ErrorRow, { key: 'error', text: loadError, onRetry: refresh }) : null,
          toast ? h(Toast, { key: 'toast', toast }) : null,
          snap ? h(StatusBar, { key: 'status', snap, now, auto, refreshMs, onToggleAuto: toggleAuto, onRefresh: refresh, anchor }) : null,
          snap ? h(FindingsSection, { key: 'findings', snap, onJump }) : null,
          snap ? h(BundlesSection, { key: 'bundles', snap, openMap, busy, flashKey, now, onToggle: toggleOpen, onAction: runAction, anchor }) : null,
          snap ? h(PluginsSection, { key: 'plugins', snap, busy, flashKey, now, anchor, onAction: runAction }) : null,
          snap ? h(TimelineSection, { key: 'timeline', snap }) : null);
      } catch (err) {
        body = h('div', { className: 'pgx-root' },
          h(ErrorRow, { text: t('面板渲染失败：', 'Panel failed to render: ') + errText(err), onRetry: refresh }));
      }
      return body;
    }

    function ensureStyles() {
      if (ensureStyles.done || typeof document === 'undefined' || !document.head) return;
      ensureStyles.done = true;
      const css = `
.pgx-root { display: flex; flex-direction: column; gap: 16px; padding: 4px 2px 32px; min-width: 0; color: var(--dsw-alias-label-primary, #1a1c1f); font-size: 13px; line-height: 1.5; }
.pgx-root *, .pgx-root *::before, .pgx-root *::after { box-sizing: border-box; }
.pgx-root button { font: inherit; cursor: pointer; } .pgx-root button:disabled { cursor: default; opacity: .6; }
.pgx-root .pgx-btn { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l2, #e2e4e8); background: var(--dsw-alias-bg-layer-2, #f4f5f6); color: var(--dsw-alias-label-primary, #1a1c1f); }
.pgx-root .pgx-btn:hover { background: var(--dsw-alias-interactive-bg-hover, #eceef1); }
.pgx-root .pgx-btn-primary { border-color: var(--dsw-alias-button-primary-fill, #3f6fff); background: var(--dsw-alias-button-primary-fill, #3f6fff); color: var(--dsw-alias-label-primary-foreground, #ffffff); }
.pgx-root .pgx-btn-danger { color: var(--dsw-alias-state-error-primary, #d93f3f); border-color: var(--dsw-alias-state-error-primary, #d93f3f); background: var(--dsw-alias-bg-base, #ffffff); }
.pgx-root .pgx-btn-ghost { background: var(--dsw-alias-bg-base, #ffffff); }
.pgx-root .pgx-btnrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pgx-root .pgx-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary, #55595f); }
.pgx-root .pgx-toggle input { accent-color: var(--dsw-alias-brand-primary, #4f7cff); margin: 0; }
.pgx-root .pgx-status { display: flex; flex-wrap: wrap; gap: 12px 16px; padding: 12px 14px; border-radius: 12px; background: var(--dsw-alias-settings-card-fill, #ffffff); border: 1px solid var(--dsw-alias-settings-card-stroke, #e3e5e8); }
.pgx-root .pgx-status-main { display: flex; align-items: center; gap: 10px 12px; flex-wrap: wrap; flex: 1 1 380px; min-width: 0; }
.pgx-root .pgx-status-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; margin-left: auto; }
.pgx-root .pgx-risk { display: inline-flex; align-items: baseline; gap: 8px; padding: 4px 12px; border-radius: 10px; font-weight: 600; }
.pgx-root .pgx-risk-safe { background: var(--dsw-alias-state-success-tertiary, #e3f5ea); color: var(--dsw-alias-state-success-primary, #2f9e63); }
.pgx-root .pgx-risk-watch { background: var(--dsw-alias-state-warn-tertiary, #fdf1de); color: var(--dsw-alias-state-warn-primary, #d98b1f); }
.pgx-root .pgx-risk-high { background: var(--dsw-alias-state-error-primary, #d93f3f); color: var(--dsw-alias-label-primary-foreground, #ffffff); }
.pgx-root .pgx-risk-score { font-size: 18px; font-variant-numeric: tabular-nums; }
.pgx-root .pgx-meter { flex: 1 1 160px; min-width: 100px; height: 6px; border-radius: 999px; overflow: hidden; background: var(--dsw-alias-bg-layer-3, #eceef1); }
.pgx-root .pgx-meter-fill { height: 100%; border-radius: 999px; }
.pgx-root .pgx-fill-safe { background: var(--dsw-alias-state-success-primary, #2f9e63); } .pgx-root .pgx-fill-watch { background: var(--dsw-alias-state-warn-primary, #d98b1f); } .pgx-root .pgx-fill-high { background: var(--dsw-alias-state-error-primary, #d93f3f); }
.pgx-root .pgx-counters { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--dsw-alias-label-secondary, #55595f); }
.pgx-root .pgx-counter b { color: var(--dsw-alias-label-primary, #1a1c1f); }
.pgx-root .pgx-updated { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 12px; }
.pgx-root .pgx-hostline { flex: 1 0 100%; color: var(--dsw-alias-label-dimmed, #b0b4bb); font-size: 11px; overflow-wrap: anywhere; }
.pgx-root .pgx-section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pgx-root .pgx-section-head { display: flex; align-items: baseline; gap: 8px; font-weight: 600; font-size: 13px; }
.pgx-root .pgx-dim { color: var(--dsw-alias-label-tertiary, #8a8f98); font-weight: 400; }
.pgx-root .pgx-empty { padding: 8px 0; color: var(--dsw-alias-label-tertiary, #8a8f98); }
.pgx-root .pgx-ok-text { color: var(--dsw-alias-state-success-primary, #2f9e63); } .pgx-root .pgx-warn-text { color: var(--dsw-alias-state-warn-primary, #d98b1f); }
.pgx-root .pgx-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; overflow-wrap: anywhere; }
.pgx-root .pgx-subject { color: var(--dsw-alias-label-secondary, #55595f); font-size: 11px; }
.pgx-root .pgx-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.pgx-root .pgx-dot-crit { background: var(--dsw-alias-state-error-primary, #d93f3f); } .pgx-root .pgx-dot-high { background: var(--dsw-alias-state-warn-primary, #d98b1f); }
.pgx-root .pgx-dot-med { background: var(--dsw-alias-brand-primary, #4f7cff); } .pgx-root .pgx-dot-low { background: var(--dsw-alias-label-tertiary, #8a8f98); }
.pgx-root .pgx-dot-info { background: var(--dsw-alias-label-dimmed, #b0b4bb); } .pgx-root .pgx-dot-ok { background: var(--dsw-alias-state-success-primary, #2f9e63); }
.pgx-root .pgx-findings { display: flex; flex-direction: column; gap: 6px; }
.pgx-root .pgx-finding { position: relative; display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 7px 10px 7px 24px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1, #e8e9ec); border-left-width: 3px; background: var(--dsw-alias-bg-layer-1, #ffffff); color: inherit; }
.pgx-root .pgx-finding > .pgx-dot { position: absolute; left: 9px; top: 11px; }
.pgx-root .pgx-tone-crit { border-left-color: var(--dsw-alias-state-error-primary, #d93f3f); } .pgx-root .pgx-tone-high { border-left-color: var(--dsw-alias-state-warn-primary, #d98b1f); }
.pgx-root .pgx-tone-med { border-left-color: var(--dsw-alias-brand-primary, #4f7cff); } .pgx-root .pgx-tone-low { border-left-color: var(--dsw-alias-label-tertiary, #8a8f98); } .pgx-root .pgx-tone-info { border-left-color: var(--dsw-alias-border-l4, #c9ccd1); }
.pgx-root .pgx-finding-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pgx-root .pgx-finding-title { font-weight: 600; }
.pgx-root .pgx-sev-label { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 11px; }
.pgx-root .pgx-finding-detail { color: var(--dsw-alias-label-secondary, #55595f); font-size: 12px; overflow-wrap: anywhere; }
.pgx-root .pgx-finding-advice { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 12px; overflow-wrap: anywhere; }
.pgx-root .pgx-finding-compact { padding-top: 5px; padding-bottom: 5px; }
.pgx-root .pgx-cards { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.pgx-root .pgx-card { display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--dsw-alias-settings-card-stroke, #e3e5e8); background: var(--dsw-alias-settings-card-fill, #ffffff); }
.pgx-root .pgx-flash { animation: pgx-flash 1.1s ease-out; }
@keyframes pgx-flash { from { box-shadow: 0 0 0 3px var(--dsw-alias-brand-primary, #4f7cff); } to { box-shadow: 0 0 0 3px var(--dsw-alias-settings-card-fill, #ffffff); } }
.pgx-root .pgx-card-head { display: flex; align-items: flex-start; gap: 8px 12px; flex-wrap: wrap; }
.pgx-root .pgx-card-title { display: flex; flex-direction: column; gap: 2px; flex: 1 1 220px; min-width: 0; }
.pgx-root .pgx-name { font-weight: 600; overflow-wrap: anywhere; }
.pgx-root .pgx-card-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.pgx-root .pgx-card-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.pgx-root .pgx-card-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.pgx-root .pgx-desc { color: var(--dsw-alias-label-secondary, #55595f); overflow-wrap: anywhere; }
.pgx-root .pgx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pgx-root .pgx-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; border: 1px solid var(--dsw-alias-border-l1, #e8e9ec); background: var(--dsw-alias-bg-layer-2, #f4f5f6); color: var(--dsw-alias-label-secondary, #55595f); font-size: 11px; }
.pgx-root .pgx-chip-success { color: var(--dsw-alias-state-success-primary, #2f9e63); background: var(--dsw-alias-state-success-tertiary, #e3f5ea); border-color: var(--dsw-alias-state-success-tertiary, #e3f5ea); }
.pgx-root .pgx-chip-warn { color: var(--dsw-alias-state-warn-primary, #d98b1f); background: var(--dsw-alias-state-warn-tertiary, #fdf1de); border-color: var(--dsw-alias-state-warn-tertiary, #fdf1de); }
.pgx-root .pgx-chip-error { color: var(--dsw-alias-state-error-primary, #d93f3f); border-color: var(--dsw-alias-state-error-primary, #d93f3f); } .pgx-root .pgx-chip-brand { color: var(--dsw-alias-brand-primary, #4f7cff); border-color: var(--dsw-alias-brand-primary, #4f7cff); }
.pgx-root .pgx-rows { display: flex; flex-direction: column; gap: 2px; padding-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1, #e8e9ec); }
.pgx-root .pgx-rowline { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; }
.pgx-root .pgx-rowline-name { color: var(--dsw-alias-label-primary, #1a1c1f); font-size: 11px; }
.pgx-root .pgx-rowline-title { margin-left: auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pgx-root .pgx-details { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f4f5f6); border: 1px solid var(--dsw-alias-border-l1, #e8e9ec); }
.pgx-root .pgx-kv { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 4px 12px; }
.pgx-root .pgx-kv-cell { display: flex; gap: 6px; min-width: 0; font-size: 12px; }
.pgx-root .pgx-kv-key { color: var(--dsw-alias-label-tertiary, #8a8f98); flex: 0 0 auto; }
.pgx-root .pgx-kv-val { min-width: 0; overflow-wrap: anywhere; }
.pgx-root .pgx-metrics { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px 12px; font-size: 12px; }
.pgx-root .pgx-table { display: flex; flex-direction: column; overflow: hidden; border-radius: 10px; border: 1px solid var(--dsw-alias-settings-card-stroke, #e3e5e8); background: var(--dsw-alias-settings-card-fill, #ffffff); }
.pgx-root .pgx-table-head, .pgx-root .pgx-table-row { display: grid; gap: 8px; align-items: center; padding: 6px 10px; grid-template-columns: minmax(0, 1.7fr) 92px 62px 88px 52px 96px minmax(0, auto); }
.pgx-root .pgx-table-head { font-size: 11px; color: var(--dsw-alias-label-tertiary, #8a8f98); background: var(--dsw-alias-bg-layer-2, #f4f5f6); border-bottom: 1px solid var(--dsw-alias-border-l1, #e8e9ec); }
.pgx-root .pgx-table-row { font-size: 12px; min-width: 0; border-bottom: 1px solid var(--dsw-alias-border-l1, #e8e9ec); }
.pgx-root .pgx-table-row:last-child { border-bottom: 0; } .pgx-root .pgx-table-row:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f3f5); }
.pgx-root .pgx-col-phase { display: inline-flex; align-items: center; gap: 5px; }
.pgx-root .pgx-cell-name { display: flex; flex-direction: column; min-width: 0; }
.pgx-root .pgx-cell-name b { font-weight: 500; overflow-wrap: anywhere; }
.pgx-root .pgx-cell-name span { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 11px; overflow-wrap: anywhere; }
.pgx-root .pgx-col-actions { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.pgx-root .pgx-timeline { display: flex; flex-direction: column; gap: 2px; }
.pgx-root .pgx-tl-row { display: grid; grid-template-columns: 64px 10px minmax(0, 1fr) minmax(0, auto); gap: 8px; align-items: center; padding: 4px 0; font-size: 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e8e9ec); }
.pgx-root .pgx-tl-row:last-child { border-bottom: 0; }
.pgx-root .pgx-tl-time { color: var(--dsw-alias-label-tertiary, #8a8f98); font-size: 11px; }
.pgx-root .pgx-tl-text { min-width: 0; overflow-wrap: anywhere; }
.pgx-root .pgx-audit { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, #f4f5f6); }
.pgx-root .pgx-audit-head { font-size: 11px; }
.pgx-root .pgx-audit-row { display: grid; grid-template-columns: 64px 10px minmax(0, 1fr) minmax(0, 1.4fr); gap: 8px; align-items: center; font-size: 12px; min-width: 0; }
.pgx-root .pgx-toast { padding: 8px 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2, #e2e4e8); background: var(--dsw-alias-bg-layer-2, #f4f5f6); overflow-wrap: anywhere; }
.pgx-root .pgx-toast-ok { border-color: var(--dsw-alias-state-success-primary, #2f9e63); color: var(--dsw-alias-state-success-primary, #2f9e63); }
.pgx-root .pgx-toast-bad { border-color: var(--dsw-alias-state-error-primary, #d93f3f); color: var(--dsw-alias-state-error-primary, #d93f3f); }
.pgx-root .pgx-error { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--dsw-alias-state-warn-primary, #d98b1f); color: var(--dsw-alias-state-warn-primary, #d98b1f); background: var(--dsw-alias-state-warn-tertiary, #fdf1de); }
.pgx-root .pgx-error-text { flex: 1 1 220px; min-width: 0; overflow-wrap: anywhere; }
.pgx-root .pgx-skel-line, .pgx-root .pgx-skel-card { border-radius: 8px; background: var(--dsw-alias-bg-layer-3, #eceef1); animation: pgx-pulse 1.2s ease-in-out infinite; }
.pgx-root .pgx-skel-line { height: 12px; } .pgx-root .pgx-skel-card { height: 120px; }
@keyframes pgx-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
.pgx-root .pgx-spin { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--dsw-alias-label-tertiary, #8a8f98); border-top-color: var(--dsw-alias-label-primary, #1a1c1f); animation: pgx-rotate .8s linear infinite; }
@keyframes pgx-rotate { to { transform: rotate(360deg); } }
@media (max-width: 760px) {
.pgx-root .pgx-status-side { align-items: flex-start; margin-left: 0; } .pgx-root .pgx-card-actions { margin-left: 0; }
.pgx-root .pgx-table-head { display: none; } .pgx-root .pgx-table-row { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.pgx-root .pgx-col-name { flex: 1 1 100%; } .pgx-root .pgx-col-actions { margin-left: auto; }
.pgx-root .pgx-tl-row { grid-template-columns: 58px 10px minmax(0, 1fr); } .pgx-root .pgx-tl-row .pgx-subject { grid-column: 3; }
.pgx-root .pgx-audit-row { grid-template-columns: 58px 10px minmax(0, 1fr); } .pgx-root .pgx-audit-row .pgx-dim:last-child { grid-column: 3; }
.pgx-root .pgx-risk { padding: 3px 10px; } .pgx-root .pgx-risk-score { font-size: 16px; }
}
`;
      const el = document.createElement('style');
      el.setAttribute('data-pgx', 'plugin-guardian');
      el.textContent = css;
      document.head.appendChild(el);
    }
    function tabLabel() { return t('监控', 'Guardian'); }

    ensureStyles();

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register(
          { name: 'settings.plugins.tab', id: 'guardian', order: 40, label: () => tabLabel() },
          GuardianPanel,
        ));
      },
    };
  },
});
