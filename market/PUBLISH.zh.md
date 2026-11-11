# 发布与分享（没有 GitHub 账号也能做）

三条路，按「投入 / 覆盖面」排序。**A 不依赖 GitHub**，B、C 依赖 GitHub。

---

## A. npm 发布（推荐，无需 GitHub）

npm 账号只要邮箱，和 GitHub 无关。发布后任何人在 **插件 → 已安装 → 添加插件** 里输入包名即可安装。

```powershell
# 1) 注册：https://www.npmjs.com/signup （邮箱 + 密码，去邮箱点验证链接）
# 2) 登录（在这台机器上，本机已装 npm：C:\Program Files\nodejs\npm.cmd）
cd D:\BaiduSyncdisk\deepseek-harness\plugin-guardian
npm login          # 浏览器会弹出登录页；也可用 --auth-type=web 后按提示
npm whoami         # 确认登录

# 3) 发布前自检（不会真的上传）
npm pack --dry-run # 看清单里是否包含 index.js / client.js / locale / icon.svg / cordis.patch.yml / market

# 4) 正式发布（公开包，免费）
npm publish
```

发布后在 `https://www.npmjs.com/package/dsh-plugin-guardkit` 可见。用户安装方式：

- 界面：插件 → 已安装 → 添加插件 → 填 `dsh-plugin-guardkit`
- 或让我这类 agent 执行 `plugin_manager install_bundle`，target 填 `dsh-plugin-guardkit`

更新版本：改 `package.json` 的 `version` → `npm publish`（同版本号不能重发）。

### 无账号也能先分享
```powershell
npm pack    # 产出 dsh-plugin-guardkit-0.1.1.tgz
```
把 tgz 发给对方，对方在 **插件 → 已安装 → 添加插件** 里填这个 tgz 的绝对路径即可安装（等同我这次用本地目录安装）。也可以直接打包整个 `plugin-guardian` 文件夹发过去，用目录路径安装。

---

## B. 官方插件市场（必须 GitHub）

「插件市场」读取的是人工策展目录 `awesome-dsh-plugin/awesome-dsh-plugin`，条目里必须有 GitHub 仓库地址，**没有 GitHub 就进不去**。拿到账号后：

1. 新建仓库（公开），push 已有提交：
   ```powershell
   cd D:\BaiduSyncdisk\deepseek-harness\plugin-guardian
   git remote add origin https://github.com/karla-zhang/dsh-plugin-guardkit.git
   git push -u origin main
   ```
2. 仓库加 topic `dsh-plugin`，等仓库存在满 1 天（硬性规则）。
3. 先 `npm publish`（目录条目的 `versions[].source` 是 npm）。
4. Fork `awesome-dsh-plugin/awesome-dsh-plugin`，按模板新增
   `data/plugins/karla-zhang__dsh-plugin-guardkit.yml`（模板见 `market/awesome-dsh-plugin.yml`），提 PR。
   README 是生成的，不要改。

审核通过后，插件会出现在市场搜索里，用户点一下就装。

---

## C. 自建索引源（不需要 GitHub，但只在 Discover 里「可搜到」）

市场支持添加第三方索引源（**插件 → 发现 → Index sources**）。索引是 format-1 的 `index.json`，已放在
`market/index.json`，并已加入 `package.json` 的 `files`，所以 `npm publish` 之后 jsDelivr 会直接提供：

```
https://cdn.jsdelivr.net/npm/dsh-plugin-guardkit/market/index.json
```

把上面这个地址加进 Index sources 即可在 Discover 里搜到本插件。

需要注意两点：

- 官方市场的一键安装只认策展目录里的来源，自定义源的条目主要用于**发现/搜索**；真正安装仍建议用
  `dsh-plugin-guardkit` 包名或 tgz。
- Discover 给一个索引源 15 秒加载窗口，jsDelivr 通常够用。

---

## 本机小坑

这台机器的 npm 默认把日志写到 %LOCALAPPDATA%\\npm-cache\\_logs，沙箱会拒绝。用工作区缓存即可：

\powershell
npm pack --dry-run --cache D:\\BaiduSyncdisk\\deepseek-harness\\.npm-cache
\\n
正常桌面终端里没有这个限制。

## 校验清单

- `package.json` 里有 `dsh.bundle.patch`（有），根目录有 `cordis.patch.yml` 且是 `- insert:`（有）
- `icon.svg` ≤ 256 KiB（560 B）
- `locale/en.json` + `locale/zh.json` 带 `meta.title` / `meta.description`（有）
- 无 `preinstall`/`install`/`postinstall` 脚本（没有，安装不会触发构建）
- `npm pack --dry-run` 清单里不含 `node_modules`、`.git`、测试目录（`guardian-selftest` 不在包内）
