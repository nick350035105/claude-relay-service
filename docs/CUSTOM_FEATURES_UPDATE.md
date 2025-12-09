# 自定义功能分支更新指南

## 分支说明

- **main**: 远程主分支，保持与上游同步
- **my-features**: 本地自定义功能分支，包含以下功能：
  - 一键更新：支持从 GitHub 拉取最新代码并自动重启服务
  - 日志明细：记录所有 AI 请求日志，支持查看输入输出详情

## 自定义功能涉及的文件

### 新增文件（3个）
```
src/routes/admin/requestLogs.js          # 日志 API 路由
src/services/requestLogService.js        # 日志服务
web/admin-spa/src/views/RequestLogsView.vue  # 日志页面组件
```

### 修改文件（12个）
```
src/handlers/geminiHandlers.js           # Gemini 日志记录
src/routes/admin/index.js                # 路由注册
src/routes/admin/system.js               # 一键更新 API
src/routes/api.js                        # Claude 日志记录
src/services/apiKeyService.js            # API Key 服务
src/services/claudeRelayService.js       # Claude 流式响应收集
web/admin-spa/src/components/layout/AppHeader.vue    # 更新按钮
web/admin-spa/src/components/layout/MainLayout.vue   # 路由映射
web/admin-spa/src/components/layout/TabBar.vue       # 日志标签
web/admin-spa/src/router/index.js        # 前端路由
web/admin-spa/src/views/ApiKeysView.vue  # API Keys 页面
web/admin-spa/package-lock.json          # 依赖锁定
```

## 更新流程

### 1. 切换到 main 分支拉取最新代码

```bash
git checkout main
git pull origin main
```

### 2. 切换回自定义分支，变基到最新代码

```bash
git checkout my-features
git rebase main
```

### 3. 如果有冲突

Git 会暂停并提示冲突文件，手动解决冲突后：

```bash
# 标记冲突已解决
git add .

# 继续变基
git rebase --continue
```

常见冲突解决方式：
- 打开冲突文件，找到 `<<<<<<< HEAD` 和 `>>>>>>> xxx` 标记
- 保留需要的代码，删除冲突标记
- 保存文件

### 4. 重新构建前端并重启服务

```bash
# 构建前端
npm run build:web

# 重启服务
npm run service:stop
npm run service:start:daemon
```

## 完整更新脚本

```bash
#!/bin/bash
# update-with-features.sh

cd /Users/chen/ClaudeCode/GitHub项目/03-开发工具/claude-relay-service

# 停止服务
npm run service:stop

# 更新代码
git checkout main
git pull origin main
git checkout my-features
git rebase main

# 如果变基成功，构建并重启
if [ $? -eq 0 ]; then
    npm run build:web
    npm run service:start:daemon
    echo "✅ 更新完成！"
else
    echo "⚠️ 有冲突需要手动解决"
    echo "解决后运行: git add . && git rebase --continue"
fi
```

## 日志输出格式

### Gemini 日志
```json
{
  "finish_reason": "STOP",
  "text": "完整的响应文本内容...",
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 200,
    "total_tokens": 300
  },
  "model": "gemini-2.5-pro"
}
```

### Claude 日志
```json
{
  "finish_reason": "end_turn",
  "text": "完整的响应文本内容...",
  "usage": {
    "input_tokens": 100,
    "output_tokens": 200,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 0,
    "total_tokens": 300
  },
  "model": "claude-sonnet-4-20250514"
}
```

## 注意事项

1. **不要在 my-features 分支上执行 `git pull`**，应该通过 rebase main 来同步
2. **重大冲突时**，可以考虑重新在最新代码上实现功能
3. **日志自动清理**：3 天前的日志会自动清理（每小时检查一次）
4. **构建前端**：每次更新后都需要重新构建前端 `npm run build:web`
