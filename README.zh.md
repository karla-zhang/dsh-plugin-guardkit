# Plugin Guardian · 插件卫士

[English](README.md) | 中文

监控当前 DeepSeek Harness 配置文件里安装的每一个插件，为它们的运行时状态打分，并在
**设置 → 插件 → 插件卫士** 这一个标签页里完成查看与隔离。

它要回答的是那个最实际的问题——「这个第三方插件到底在干什么？」。面板数据全部来自 Host 端
Cordis 运行时的实时拓扑，而不是构建期抓取的静态清单。

## 面板内容

| 区块 | 说明 |
| --- | --- |
| 健康条 | 全局风险分与等级、按生命周期阶段统计的插件数量、bundle 数量、快照新鲜度 |
| 关键发现 | 所有命中的风险项，按 critical → info 排序，带主体与证据 |
| Bundle 卡片 | 每个插件包：第三方还是官方、安装来源、版本、许可证、仓库地址、安装脚本、声明的 bin、是否注入前端/Typert 远程、覆盖项、版本豁免 |
| 运行时条目表 | 每个 Cordis 条目：模块名、所属 bundle、是否启用、生命周期阶段、状态切换次数、最后变化时间、诊断信息 |
| 事件时间线 | 阶段切换、启用/停用、版本与可用性变化、卫士自身的操作 |
| 操作 | 启用/停用单个插件条目；启用/停用整个 bundle（一键隔离） |

## 风险模型

每个风险项带一个严重级别，插件的风险分是权重之和、上限 100：

`严重 40 · 高 20 · 中 8 · 低 3 · 提示 0`

等级：`≥ 40 高风险`，`≥ 10 留意`，其余 `安全`。

风险项覆盖：加载失败 / 卸载中 / 卡住未完成的条目、只读条目、被停用的条目、第三方 bundle、
缺失或报错的 bundle、配置覆盖、DSH 版本豁免、安装脚本（`preinstall`/`install`/`postinstall`/
`prepare`）、声明了 `bin`、注入前端 bundle 或 Typert 远程调用、缺少许可证、本地/git 安装来源、
监控数据过期。

## 数据流

Host 半边从 `pluginManager` 服务采集（`listPlugins`、`listBundles`、
`listVersionExemptions`），从 profile 读取每个已安装包的 `package.json`，每次刷新对比清单生成
时间线，并通过同源路由提供只读 JSON 快照：

- `GET  /plugin-guardian/api/snapshot`
- `POST /plugin-guardian/api/action` —— `{ action, entryId?, name? }`

浏览器半边是一个注册进 `settings.plugins.tab` 插槽的 React 组件：轮询快照、只用
`--dsw-alias-*` 主题变量渲染、通过 POST 发起操作。所有文案由前端自己维护（中/英），因此面板
跟随界面语言。

路由安全：响应 `no-store`；跨站请求通过比较 `Origin` 与 `Host` 头拒绝；操作请求体上限
64 KiB 并做校验。

## 配置

所有配置项都可选，写在 profile 里 `plugin-guardian` 那一行 Cordis patch 中：

```yaml
- id: plugin-guardian
  name: dsh-plugin-guardian
  config:
    refreshMs: 12000   # 3000..120000
    audit: true        # 写入 snapshot.json / timeline.ndjson / route-hits.ndjson
    auditDir: null     # 默认 <DSH_HOME>/plugin-guardian
    trusted: []        # 额外允许调用操作路由的 Origin
    maxTimeline: 100   # 时间线环形缓冲长度
```

审计文件（`<DSH_HOME>/plugin-guardian/`）：

- `snapshot.json` —— 最近一次快照（可离线查看）
- `timeline.ndjson` —— 只追加的事件日志，每行一个 JSON 对象
- `route-hits.ndjson` —— 最近 20 次接口请求（方法、路径、状态、时间）

## 安装

在 DSH 桌面端：**设置 → 插件**，从插件市场安装，或直接指向本目录安装后重启应用。

命令行（profile 名按实际填写，桌面端是 `desktop`）：

```sh
dsh plugin --profile desktop add dsh-plugin-guardian          # 已发布到 npm
dsh plugin --profile desktop add github:<owner>/dsh-plugin-guardian   # 直接从 GitHub 安装
dsh plugin --profile desktop add /path/to/plugin-guardian     # 本地目录
```

装完需要重启 DSH，因为新增 bundle 会改变 Host 的启动图。

卸载：`dsh plugin --profile desktop remove dsh-plugin-guardian`，或从 **设置 → 插件** 里移除。

## 说明

- 只读条目（`management-required`、`unaddressable`）会被如实标注，不会当作健康；去操作它们
  时返回的是 Host 自己的解释。
- 隔离走的是 Host 的 `pluginManager` 接口，所以需要重启才能生效的改动会如实告知，而不是假装
  已经生效。
- 面板不会抛异常：请求失败时显示错误条并保留上一份快照。

## 许可

MIT
