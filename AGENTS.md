# AGENTS.md — 给 AI 助手的安装指引

本仓库是 mikulo 的 DSH（DeepSeek Harness）个人插件清单。用户让你"安装 / 重装 / 更新清单里的插件"时，按下面的步骤做。

## 清单格式（plugins.json）

```jsonc
{
  "defaultProfile": "web",          // 未指定 profile 时使用
  "plugins": [
    {
      "name": "@mikulo/dsh-ssh",       // 包名：update / remove 时用它
      "source": "github:mikulo/dsh-ssh", // 安装来源：add 时用它
      "repo": "https://github.com/mikulo/dsh-ssh",
      "description": "...",
      "replaces": ["@linxin666/dsh-ssh"],  // 被本插件取代的旧包：自动移除，并把 cordis.patch.yml 里的旧包名改成新包名
      "conflicts": ["@linxin666/dsh-web-all"], // 与本插件冲突、但可能还带着别的功能的包：只提醒，不自动删
      "notes": "..."                  // 安装注意事项
    }
  ]
}
```

## 标准流程

1. **确认目标 profile**：用户没说就用 `$DSH_PROFILE`，再没有就用 `plugins.json` 的 `defaultProfile`（`web`）。在 DSH 会话里可以通过 `$env:DSH_PROFILE`（PowerShell）或 `$DSH_PROFILE` 读取当前 profile。
2. **确认环境**：`dsh --version`、`git --version`，以及 `$DSH_HOME/profiles/<profile>` 存在（`$DSH_HOME` 默认是 `~/.dsh`）。
3. **运行脚本**（在本仓库根目录）：
   - DSH 刚升级、插件坏了、或用户说"重装"：`node install.mjs --profile <p> --reinstall`
   - 只是同步 / 更新：`node install.mjs --profile <p>`
   - 只处理部分插件：加 `--only <短名或包名,...>`
   - 不确定时先 `--dry-run` 看将执行哪些命令。
4. **看结果**：脚本最后会逐个打印 `✔ / ✖`。全部 `✔` 才算成功。
5. **告诉用户重启 `dsh <profile>` 并刷新页面**。不要自己启动另一个 DSH 服务来"验证"，那不会更新用户正在用的 GUI。

## 故障处理

- **`git ls-remote failed` / 连不上 github.com**：本机 git 可能不走系统代理。在 Windows 上可以查 `HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyServer`，找到代理端口后用 `--git-proxy http://127.0.0.1:<端口>` 重跑。这会写入 git 全局配置（仅对 github.com 生效），执行前告诉用户。
- **`cpu-features ... Unable to detect compiler type`**：忽略，不影响使用。
- **某个插件显示 `✖`**：看 `dsh --profile <p> --dump-config` 的输出，以及 `$DSH_HOME/profiles/<p>/.plugin-manager/logs/` 下的 pnpm 日志；再用 `--only <该插件> --reinstall` 单独重装。
- **报告 `conflicts` 警告**：说明 profile 里装着与该插件功能重叠的包（例如上游全家桶会重复注册 `ssh_*` 工具）。把冲突告诉用户，由用户决定是否移除，不要自作主张删除。
- **DSH 升级后插件本身报错**（不是安装失败，而是运行时异常）：这通常说明插件需要适配新版 DSH，需要去对应插件仓库修改源码、重新构建并提交 `lib/`。先告诉用户，不要在 profile 的 `node_modules` 里直接改文件。

## 规则

- 只通过官方 `dsh plugin --profile <p> add / update / remove`（或本仓库的 `install.mjs`）安装，不要手工编辑 profile 的 `package.json` 或 `node_modules`。
- 不要把任何 token、密码写进本仓库。
- 往清单里加插件时：更新 `plugins.json`，同步更新 `README.md` 的插件表格，用 `node install.mjs --only <新插件>` 实测后再提交。
