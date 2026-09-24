#!/usr/bin/env node
/**
 * 批量安装 / 同步 plugins.json 里的 DSH 插件。
 *
 * 用法：
 *   node install.mjs [--profile web] [--only a,b] [--reinstall] [--dry-run]
 *                    [--git-proxy http://127.0.0.1:7891] [--list]
 *
 * 不克隆仓库也能用（会从 GitHub 读取 plugins.json）：
 *   curl -fsSL https://raw.githubusercontent.com/mikulo/dsh-plugins/main/install.mjs | node - --profile web
 *
 * 默认行为（同步）：
 *   1. 移除 profile 里被清单插件取代的旧包（replaces），并把 cordis.patch.yml 里
 *      旧包名的条目改成新包名，保留原有设置；
 *   2. 未安装的插件：一次性 `dsh plugin --profile <p> add ...`；
 *   3. 已安装的插件：`dsh plugin --profile <p> update ...`（拉取 main 最新提交）；
 *   4. 用 `dsh --profile <p> --dump-config` 校验每个插件都挂进了 profile。
 * --reinstall：先 remove 再 add（DSH 破坏式升级后推荐）。
 *
 * 只依赖 Node.js 内置模块；DSH 本身就要求 Node.js，所以不需要额外安装任何东西。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MANIFEST_URL = 'https://raw.githubusercontent.com/mikulo/dsh-plugins/main/plugins.json'
const isWin = process.platform === 'win32'

// ---------- 参数 ----------
function parseArgs(argv) {
  const opts = { profile: undefined, only: undefined, reinstall: false, dryRun: false, gitProxy: undefined, list: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${a} 需要一个参数`)
      return v
    }
    if (a === '--profile' || a === '-p') opts.profile = next()
    else if (a.startsWith('--profile=')) opts.profile = a.slice('--profile='.length)
    else if (a === '--only') opts.only = next().split(',').map(s => s.trim()).filter(Boolean)
    else if (a.startsWith('--only=')) opts.only = a.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--reinstall') opts.reinstall = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a === '--git-proxy') opts.gitProxy = next()
    else if (a.startsWith('--git-proxy=')) opts.gitProxy = a.slice('--git-proxy='.length)
    else if (a === '--list') opts.list = true
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
    else fail(`未知参数：${a}（--help 查看用法）`)
  }
  return opts
}

function printHelp() {
  console.log(`用法: node install.mjs [选项]

  --profile <name>     目标 DSH profile（默认：$DSH_PROFILE 或清单的 defaultProfile）
  --only <a,b>         只处理这些插件（可写完整包名或短名，如 dsh-ssh）
  --reinstall          先卸载再安装（DSH 破坏式升级后推荐）
  --dry-run            只打印将执行的命令，不做任何修改
  --git-proxy <url>    为 github.com 设置 git 全局代理（git 连不上 GitHub 时使用）
  --list               列出清单内容后退出`)
}

function fail(message) {
  console.error(`\n✖ ${message}`)
  process.exit(1)
}

function log(message) {
  console.log(`\n▶ ${message}`)
}

// ---------- 命令执行 ----------
/** Windows 下 dsh / git 可能是 .cmd shim，需要经过 shell 调用。 */
function quote(arg) {
  if (!isWin) return `'${String(arg).replace(/'/g, `'\\''`)}'`
  return /[\s"&|<>^]/.test(arg) ? `"${String(arg).replace(/"/g, '""')}"` : String(arg)
}

function run(cmd, args, { capture = false, dryRun = false, timeout } = {}) {
  const line = [cmd, ...args].map(quote).join(' ')
  if (dryRun) {
    console.log(`  [dry-run] ${line}`)
    return { status: 0, stdout: '', stderr: '' }
  }
  console.log(`  $ ${line}`)
  const r = spawnSync(line, {
    shell: true,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  })
  if (r.error) return { status: 1, stdout: '', stderr: String(r.error.message) }
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ---------- 清单 ----------
async function loadManifest() {
  const here = (() => {
    try { return dirname(fileURLToPath(import.meta.url)) } catch { return undefined }
  })()
  const local = here ? join(here, 'plugins.json') : undefined
  if (local && existsSync(local)) return JSON.parse(readFileSync(local, 'utf8'))
  log(`本地没有 plugins.json，从 ${MANIFEST_URL} 读取`)
  const resp = await fetch(MANIFEST_URL)
  if (!resp.ok) fail(`读取清单失败：HTTP ${resp.status}`)
  return resp.json()
}

function selectPlugins(manifest, only) {
  const all = manifest.plugins ?? []
  if (!only) return all
  const picked = all.filter(p => only.some(o => o === p.name || o === p.name.split('/').pop() || o === p.source))
  const unknown = only.filter(o => !all.some(p => o === p.name || o === p.name.split('/').pop() || o === p.source))
  if (unknown.length) fail(`清单里没有：${unknown.join(', ')}`)
  return picked
}

// ---------- profile ----------
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function readProfileDeps(profileDir) {
  const file = join(profileDir, 'package.json')
  if (!existsSync(file)) return {}
  const pkg = JSON.parse(readFileSync(file, 'utf8'))
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
}

/** 把 cordis.patch.yml 中旧包名的条目改成新包名（保留该条目下的设置）。 */
function renamePatchEntries(profileDir, renames, dryRun) {
  const file = join(profileDir, 'cordis.patch.yml')
  if (!existsSync(file) || renames.length === 0) return
  let text = readFileSync(file, 'utf8')
  const original = text
  for (const { from, to } of renames) {
    const esc = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    // 只匹配 `name:` 键，值可以带单/双引号或不带引号。
    const re = new RegExp(`^(\\s*(?:-\\s+)?name:\\s*)(["']?)${esc}\\2(\\s*)$`, 'gm')
    text = text.replace(re, (_m, head, _q, tail) => `${head}'${to}'${tail}`)
  }
  if (text === original) return
  if (dryRun) {
    console.log(`  [dry-run] 将改写 ${file} 中的旧包名：${renames.map(r => `${r.from} → ${r.to}`).join('，')}`)
    return
  }
  const backup = `${file}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`
  copyFileSync(file, backup)
  writeFileSync(file, text)
  console.log(`  已改写 cordis.patch.yml 中的旧包名（备份：${backup}）`)
}

// ---------- 网络前置检查 ----------
function checkGit(plugins, opts) {
  if (run('git', ['--version'], { capture: true }).status !== 0) {
    fail('找不到 git。GitHub 插件的安装和更新都依赖 git，请先安装 Git 并加入 PATH。')
  }
  if (opts.gitProxy) {
    run('git', ['config', '--global', 'http.https://github.com.proxy', opts.gitProxy], { dryRun: opts.dryRun })
  }
  const repo = plugins[0]?.repo
  if (!repo || opts.dryRun) return
  const r = run('git', ['ls-remote', `${repo}.git`, 'HEAD'], { capture: true, timeout: 45_000 })
  if (r.status !== 0) {
    fail(`git 无法访问 ${repo}：\n${(r.stderr || r.stdout).trim()}\n\n` +
      'pnpm 解析 / 更新 GitHub 依赖需要 git 能连上 github.com。\n' +
      '如果本机通过代理上网，重新运行并加上：--git-proxy http://127.0.0.1:<代理端口>\n' +
      '（等价于 git config --global http.https://github.com.proxy <代理地址>）')
  }
}

// ---------- 主流程 ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const manifest = await loadManifest()
  const plugins = selectPlugins(manifest, opts.only)

  if (opts.list) {
    for (const p of plugins) console.log(`${p.name}\n  来源: ${p.source}\n  说明: ${p.description}\n`)
    return
  }
  if (plugins.length === 0) fail('没有要处理的插件')

  const profile = opts.profile || process.env.DSH_PROFILE || manifest.defaultProfile || 'web'
  const profileDir = join(dshHome(), 'profiles', profile)

  log('检查环境')
  const ver = run('dsh', ['--version'], { capture: true })
  if (ver.status !== 0) fail('找不到 dsh 命令，请先安装 DeepSeek Harness（npm i -g @deepseek-ai/dsh）。')
  console.log(`  dsh ${ver.stdout.trim()}，profile: ${profile}（${profileDir}）`)
  if (!existsSync(profileDir)) {
    fail(`profile 目录不存在：${profileDir}\n先启动一次 \`dsh ${profile}\`，或用 \`dsh ${profile} --from-default-profile web\` 创建。`)
  }
  checkGit(plugins, opts)

  const deps = readProfileDeps(profileDir)
  const has = name => Object.hasOwn(deps, name)

  // 1. 冲突提示 + 替换旧包
  for (const p of plugins) {
    for (const c of p.conflicts ?? []) {
      if (has(c)) console.warn(`  ⚠ ${p.name} 与已安装的 ${c} 冲突（${p.notes ?? ''}）。如需保留 ${c}，请自行确认；否则执行 dsh plugin --profile ${profile} remove ${c}`)
    }
  }
  const renames = []
  const oldPackages = []
  for (const p of plugins) {
    for (const old of p.replaces ?? []) {
      if (old === p.name) continue
      renames.push({ from: old, to: p.name })
      if (has(old)) oldPackages.push(old)
    }
  }
  if (oldPackages.length) {
    log(`移除被取代的旧包：${oldPackages.join(', ')}`)
    const r = run('dsh', ['plugin', '--profile', profile, 'remove', ...oldPackages], { dryRun: opts.dryRun })
    if (r.status !== 0) fail('移除旧包失败')
  }

  // 2. 重装：先卸载已安装的清单插件
  const installed = plugins.filter(p => has(p.name))
  if (opts.reinstall && installed.length) {
    log(`卸载（--reinstall）：${installed.map(p => p.name).join(', ')}`)
    const r = run('dsh', ['plugin', '--profile', profile, 'remove', ...installed.map(p => p.name)], { dryRun: opts.dryRun })
    if (r.status !== 0) fail('卸载失败')
  }
  const toAdd = opts.reinstall ? plugins : plugins.filter(p => !has(p.name))
  const toUpdate = opts.reinstall ? [] : installed

  // 3. 安装 / 更新
  if (toAdd.length) {
    log(`安装：${toAdd.map(p => p.name).join(', ')}`)
    const r = run('dsh', ['plugin', '--profile', profile, 'add', ...toAdd.map(p => p.source)], { dryRun: opts.dryRun })
    if (r.status !== 0) fail('安装失败（见上方 pnpm 输出；cpu-features 的编译失败可以忽略，它不会导致失败）')
  }
  if (toUpdate.length) {
    log(`更新到最新提交：${toUpdate.map(p => p.name).join(', ')}`)
    const r = run('dsh', ['plugin', '--profile', profile, 'update', ...toUpdate.map(p => p.name)], { dryRun: opts.dryRun })
    if (r.status !== 0) fail('更新失败（可改用 --reinstall 重试）')
  }

  // 4. 保留旧包的设置
  renamePatchEntries(profileDir, renames, opts.dryRun)

  // 5. 校验
  if (opts.dryRun) return
  log('校验 profile 组合结果')
  const dump = run('dsh', ['--profile', profile, '--dump-config'], { capture: true })
  if (dump.status !== 0) fail(`dsh --dump-config 失败：\n${dump.stderr.trim()}`)
  const missing = plugins.filter(p => !dump.stdout.includes(`# == ${p.name}`))
  for (const p of plugins) console.log(`  ${missing.includes(p) ? '✖' : '✔'} ${p.name}`)
  if (missing.length) fail(`以下插件没有挂进 profile：${missing.map(p => p.name).join(', ')}`)

  console.log(`\n✔ 完成。请重启 \`dsh ${profile}\` 并刷新页面使插件生效。`)
}

main().catch(err => fail(err?.stack || String(err)))
