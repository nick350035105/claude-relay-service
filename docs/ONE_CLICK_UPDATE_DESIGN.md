# 一键更新功能设计指南

## 概述

本文档提供一键更新功能的通用设计方案，适用于需要从远程仓库拉取更新并自动处理冲突的 Web 服务项目。

## 核心流程

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  暂存本地    │ -> │  拉取远程    │ -> │  解决冲突    │ -> │  恢复本地    │
│  修改        │    │  更新        │    │  (自动)      │    │  修改        │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                              │
                                              v
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  重启服务    │ <- │  安装依赖    │ <- │  更新版本    │
└─────────────┘    └─────────────┘    └─────────────┘
```

## 详细步骤

### Step 1: 检测并暂存本地修改

```javascript
// 检查是否有未提交的修改
const { stdout } = await exec('git status --porcelain', { cwd: projectRoot })

if (stdout.trim().length > 0) {
  // 解析修改的文件列表（用于后续恢复）
  const modifiedFiles = stdout
    .trim()
    .split('\n')
    .map(line => line.substring(3).trim())
    .filter(f => f.length > 0)

  // 暂存修改
  await exec('git stash push -m "auto-stash-before-update"', { cwd: projectRoot })
}
```

**设计要点：**
- 记录修改的文件列表，用于冲突恢复时定向处理
- 使用带消息的 stash，便于识别和调试

### Step 2: 设置远程仓库

```javascript
// 支持用户配置自定义远程地址
const gitRemote = config.gitRemote || 'git@github.com:owner/repo.git'

try {
  await exec(`git remote set-url origin "${gitRemote}"`, { cwd: projectRoot })
} catch {
  // origin 不存在时添加
  await exec(`git remote add origin "${gitRemote}"`, { cwd: projectRoot })
}
```

**设计要点：**
- 允许用户配置自定义远程地址（支持 fork 分支更新）
- 远程配置可存储在数据库或配置文件中

### Step 3: 获取远程更新

```javascript
await exec('git fetch origin', { cwd: projectRoot, timeout: 60000 })
```

**设计要点：**
- 设置合理的超时时间（网络问题）
- fetch 与 pull 分离，便于检测状态

### Step 4: 拉取并 Rebase

```javascript
// 使用 rebase 策略保持提交历史整洁
await exec('git pull --rebase origin main', { cwd: projectRoot, timeout: 120000 })
```

**为什么用 rebase 而不是 merge：**
- 保持线性提交历史
- 本地提交始终在远程提交之上
- 更容易回滚和定位问题

### Step 5: 自动解决冲突（核心）

```javascript
const maxRetries = 20  // 最多处理的冲突提交数

for (let i = 0; i < maxRetries; i++) {
  // 检查是否还在 rebase 中
  const { stdout: status } = await exec('git status', { cwd: projectRoot })
  if (!status.includes('rebase in progress')) {
    break  // rebase 完成
  }

  // 获取冲突文件
  const { stdout: conflicts } = await exec(
    'git diff --name-only --diff-filter=U',
    { cwd: projectRoot }
  )
  const conflictFiles = conflicts.trim().split('\n').filter(f => f)

  if (conflictFiles.length === 0) {
    // 无冲突，可能是空提交
    try {
      await exec('git rebase --continue', { cwd: projectRoot })
    } catch {
      await exec('git rebase --skip', { cwd: projectRoot })
    }
    continue
  }

  // 解决每个冲突文件
  for (const file of conflictFiles) {
    // 策略选择（见下文）
    await exec(`git checkout --theirs "${file}"`, { cwd: projectRoot })
    await exec(`git add "${file}"`, { cwd: projectRoot })
  }

  // 继续 rebase
  await exec('GIT_EDITOR=true git rebase --continue', {
    cwd: projectRoot,
    env: { ...process.env, GIT_EDITOR: 'true' }
  })
}
```

### 冲突解决策略

| 策略 | 命令 | 适用场景 |
|------|------|----------|
| `--theirs` | 接受远程版本 | 更新为主，本地修改可重新应用 |
| `--ours` | 保留本地版本 | 本地定制优先，不想被覆盖 |
| 智能合并 | 自定义逻辑 | 特定文件有特殊处理需求 |

**策略选择建议：**

```javascript
function resolveConflict(file) {
  // 配置文件：保留本地
  if (file.match(/config\.(js|json|yaml)$/)) {
    return 'ours'
  }
  // 锁文件：接受远程
  if (file.match(/package-lock\.json|yarn\.lock$/)) {
    return 'theirs'
  }
  // 默认：接受远程
  return 'theirs'
}
```

### Step 6: 恢复本地修改

```javascript
if (hasLocalChanges) {
  try {
    await exec('git stash pop', { cwd: projectRoot })
  } catch {
    // stash pop 冲突时，从 stash 中恢复指定文件
    for (const file of modifiedFiles) {
      try {
        await exec(`git checkout stash@{0} -- "${file}"`, { cwd: projectRoot })
      } catch {
        // 文件可能不在 stash 中
      }
    }
    await exec('git stash drop', { cwd: projectRoot })
    await exec('git reset HEAD', { cwd: projectRoot })
  }
}
```

### Step 7: 安装依赖

```javascript
// 根据项目类型选择包管理器
await exec('npm install', { cwd: projectRoot, timeout: 300000 })
// 或
await exec('pip install -r requirements.txt', { cwd: projectRoot })
// 或
await exec('go mod download', { cwd: projectRoot })
```

### Step 8: 重启服务

```javascript
// 先返回响应，再延迟重启
res.json({ success: true, message: '更新完成，即将重启' })

setTimeout(() => {
  const restart = spawn('npm', ['run', 'restart'], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore'
  })
  restart.unref()
}, 3000)
```

**设计要点：**
- 延迟重启确保响应已发送
- 使用 detached 模式，避免主进程退出影响重启

## 失败回滚

```javascript
async function rollback(hasLocalChanges) {
  // 1. 终止 rebase
  try {
    await exec('git rebase --abort', { cwd: projectRoot })
  } catch {}

  // 2. 恢复 stash
  if (hasLocalChanges) {
    try {
      await exec('git stash pop', { cwd: projectRoot })
    } catch {}
  }

  // 3. 返回错误信息
  return { success: false, message: '更新失败，已恢复原状态' }
}
```

## API 设计

### 请求

```http
POST /api/admin/one-click-update
Authorization: Bearer <token>
```

### 响应

```json
{
  "success": true,
  "message": "更新完成，服务将在 3 秒后重启",
  "newVersion": "1.2.3",
  "logs": [
    { "type": "info", "message": "开始更新...", "time": "2025-01-01T00:00:00Z" },
    { "type": "success", "message": "Git pull 完成", "time": "2025-01-01T00:00:01Z" },
    { "type": "warn", "message": "发现冲突，自动解决中...", "time": "2025-01-01T00:00:02Z" },
    { "type": "success", "message": "冲突已解决", "time": "2025-01-01T00:00:03Z" }
  ]
}
```

## 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `gitRemote` | 远程仓库地址 | origin |
| `gitBranch` | 目标分支 | main |
| `conflictStrategy` | 冲突解决策略 | theirs |
| `maxConflictRetries` | 最大冲突处理次数 | 20 |
| `restartDelay` | 重启延迟(ms) | 3000 |
| `fetchTimeout` | fetch 超时(ms) | 60000 |
| `pullTimeout` | pull 超时(ms) | 120000 |
| `installTimeout` | 依赖安装超时(ms) | 300000 |

## 安全考虑

1. **权限验证** - 必须验证管理员身份
2. **命令注入** - 对用户输入的远程地址进行校验
3. **敏感信息** - 日志中不要暴露 token 或密钥
4. **速率限制** - 防止频繁触发更新

```javascript
// 远程地址校验
function validateGitRemote(remote) {
  const patterns = [
    /^git@[\w.-]+:[\w.-]+\/[\w.-]+\.git$/,           // SSH
    /^https?:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\.git$/,   // HTTPS
  ]
  return patterns.some(p => p.test(remote))
}
```

## 前端实现建议

```javascript
async function oneClickUpdate() {
  const btn = document.getElementById('update-btn')
  btn.disabled = true
  btn.textContent = '更新中...'

  try {
    const res = await fetch('/api/admin/one-click-update', { method: 'POST' })
    const data = await res.json()

    if (data.success) {
      showLogs(data.logs)
      showMessage(`更新到 ${data.newVersion}，页面将自动刷新...`)

      // 等待服务重启后刷新页面
      setTimeout(() => {
        pollServerReady().then(() => location.reload())
      }, 5000)
    } else {
      showError(data.message)
    }
  } finally {
    btn.disabled = false
    btn.textContent = '一键更新'
  }
}

// 轮询服务是否就绪
async function pollServerReady(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await fetch('/api/health')
      return true
    } catch {
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  throw new Error('服务重启超时')
}
```

## 日志记录

建议记录以下信息便于排查问题：

```javascript
const logs = []

function addLog(type, message) {
  const entry = {
    type,      // info | success | warn | error
    message,
    time: new Date().toISOString()
  }
  logs.push(entry)

  // 同时输出到服务器日志
  if (type === 'error') {
    logger.error(`[Update] ${message}`)
  } else {
    logger.info(`[Update] ${message}`)
  }
}
```

## 测试清单

- [ ] 无本地修改时正常更新
- [ ] 有本地修改时正确 stash/恢复
- [ ] 单个文件冲突自动解决
- [ ] 多个文件冲突自动解决
- [ ] 空提交正确跳过
- [ ] 无法解决的冲突正确回滚
- [ ] 网络超时正确处理
- [ ] 依赖安装失败不阻塞更新
- [ ] 服务正确重启
- [ ] 前端正确显示日志和状态

## 参考实现

完整实现参考：`src/routes/admin/system.js` 中的 `/one-click-update` 路由。
