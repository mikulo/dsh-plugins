# dsh-plugins — mikulo 的 DSH 插件清单

这里列出我自己维护的 [DeepSeek Harness（DSH）](https://www.npmjs.com/package/@deepseek-ai/dsh) 插件，并提供一键批量安装脚本。

DSH 目前还是 alpha 版本，升级时经常有破坏式更新，升级后往往要把插件重装一遍。有了这个清单，一条命令就能把全部插件装回来，不用一个个找仓库地址。

> **给 AI 助手：** 如果你被要求"安装 / 重装清单里的插件"，请先阅读 [AGENTS.md](AGENTS.md)，按其中的步骤执行。

## 插件清单

| 插件 | 仓库 | 说明 |
| --- | --- | --- |
| `@mikulo/dsh-thinking-effort` | [mikulo/dsh-thinking-effort](https://github.com/mikulo/dsh-thinking-effort) | 为 llm-pi-ai 第三方模型补充可配置的思考强度档位，并设置子 agent 默认思考强度 |
| `@mikulo/dsh-easyrewrite` | [mikulo/dsh-easyrewrite](https://github.com/mikulo/dsh-easyrewrite) | DSH Web 消息撤回、气泡原位编辑、版本翻页器 |
| `@mikulo/dsh-ssh` | [mikulo/dsh-ssh](https://github.com/mikulo/dsh-ssh) | SSH 主机管理、Web 终端、SFTP、端口转发、集群执行，以及 `ssh_*` Agent 工具 |
| `@mikulo/dsh-prompt-switcher` | [mikulo/dsh-prompt-switcher](https://github.com/mikulo/dsh-prompt-switcher) | 新对话中输入 `/` 选择本地 `.md` 提示词模板，约束力等同于 AGENTS.md 并对整个对话生效；设置页可配置目录、开关和编辑模板 |

机器可读的清单在 [plugins.json](plugins.json)，安装脚本读的就是它。

## 一键安装

前提：已安装 DSH（`dsh --version` 能输出版本号）、Git，并且至少启动过一次目标 profile。

```sh
git clone https://github.com/mikulo/dsh-plugins.git
cd dsh-plugins
node install.mjs --profile web
```

不想克隆仓库，也可以直接从 GitHub 运行（脚本会在线读取 `plugins.json`）：

```sh
curl -fsSL https://raw.githubusercontent.com/mikulo/dsh-plugins/main/install.mjs | node --input-type=module - --profile web
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/mikulo/dsh-plugins/main/install.mjs | node --input-type=module - --profile web
```

完成后**重启 `dsh web` 并刷新页面**。

### 常用参数

| 参数 | 作用 |
| --- | --- |
| `--profile <name>` | 目标 profile，默认 `web` |
| `--reinstall` | 先卸载再安装。**DSH 升级后推荐用这个** |
| `--only dsh-ssh,dsh-easyrewrite` | 只处理部分插件（可写短名或完整包名） |
| `--dry-run` | 只打印将要执行的命令，不做修改 |
| `--git-proxy http://127.0.0.1:7891` | 为 github.com 设置 git 代理（git 直连不上 GitHub 时用） |
| `--list` | 列出清单 |

不加 `--reinstall` 时是"同步"模式：没装的装上，已装的更新到 main 分支最新提交。

### 脚本会做什么

1. 检查 `dsh`、`git`，以及 git 能否访问 GitHub；
2. 如果 profile 里还装着这些插件被取代的上游旧包（如 `@hytime/dsh-thinking-effort`、`@linxin666/dsh-ssh`），先移除，并把 `cordis.patch.yml` 里旧包名的条目改成新包名，**保留原有设置**（改写前会备份）；
3. 通过官方 `dsh plugin --profile <p> add / update / remove` 安装或更新，不手工改 profile 文件；
4. 用 `dsh --profile <p> --dump-config` 确认每个插件都已挂进 profile。

## 手动安装（不用脚本）

```sh
dsh plugin --profile web add github:mikulo/dsh-thinking-effort github:mikulo/dsh-easyrewrite github:mikulo/dsh-ssh github:mikulo/dsh-prompt-switcher
```

更新：`dsh plugin --profile web update @mikulo/dsh-ssh`；卸载：`dsh plugin --profile web remove @mikulo/dsh-ssh`。

## 常见问题

- **`git ls-remote failed` / `Failed to connect to github.com`**：git 默认不走系统代理。加 `--git-proxy http://127.0.0.1:<端口>` 重跑，或执行 `git config --global http.https://github.com.proxy http://127.0.0.1:<端口>`。
- **安装日志里有 `cpu-features ... Unable to detect compiler type`**：这是 ssh2 的可选原生加速模块，没有 C++ 编译器时编译失败，不影响使用。
- **`Issues with peer dependencies found`**：插件依赖的 DSH SDK 由宿主运行时提供，这条警告可以忽略。
- **重装后插件不生效**：确认已经重启 `dsh web`；再看 `dsh --profile web --dump-config` 里有没有对应的 `# == @mikulo/...` 段落。

## 往清单里加插件

1. 插件仓库需要满足：`package.json` 有 `dsh.bundle.patch`，构建好的 `lib/` 已提交到仓库，且没有 `prepare` / `prepack` 这类安装时构建的脚本；
2. 在 `plugins.json` 的 `plugins` 数组里追加一项（字段说明见 [AGENTS.md](AGENTS.md)）；
3. 同步更新上面的"插件清单"表格；
4. 用 `node install.mjs --profile web --only <新插件>` 实测一次，再提交推送。
