const express = require('express')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { exec, spawn } = require('child_process')
const { promisify } = require('util')
const claudeCodeHeadersService = require('../../services/claudeCodeHeadersService')
const claudeAccountService = require('../../services/claudeAccountService')
const redis = require('../../models/redis')
const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const config = require('../../../config/config')

const execAsync = promisify(exec)

const router = express.Router()

// ==================== Claude Code Headers 管理 ====================

// 获取所有 Claude Code headers
router.get('/claude-code-headers', authenticateAdmin, async (req, res) => {
  try {
    const allHeaders = await claudeCodeHeadersService.getAllAccountHeaders()

    // 获取所有 Claude 账号信息
    const accounts = await claudeAccountService.getAllAccounts()
    const accountMap = {}
    accounts.forEach((account) => {
      accountMap[account.id] = account.name
    })

    // 格式化输出
    const formattedData = Object.entries(allHeaders).map(([accountId, data]) => ({
      accountId,
      accountName: accountMap[accountId] || 'Unknown',
      version: data.version,
      userAgent: data.headers['user-agent'],
      updatedAt: data.updatedAt,
      headers: data.headers
    }))

    return res.json({
      success: true,
      data: formattedData
    })
  } catch (error) {
    logger.error('❌ Failed to get Claude Code headers:', error)
    return res
      .status(500)
      .json({ error: 'Failed to get Claude Code headers', message: error.message })
  }
})

// 🗑️ 清除指定账号的 Claude Code headers
router.delete('/claude-code-headers/:accountId', authenticateAdmin, async (req, res) => {
  try {
    const { accountId } = req.params
    await claudeCodeHeadersService.clearAccountHeaders(accountId)

    return res.json({
      success: true,
      message: `Claude Code headers cleared for account ${accountId}`
    })
  } catch (error) {
    logger.error('❌ Failed to clear Claude Code headers:', error)
    return res
      .status(500)
      .json({ error: 'Failed to clear Claude Code headers', message: error.message })
  }
})

// ==================== 系统更新检查 ====================

// 版本比较函数
function compareVersions(current, latest) {
  const parseVersion = (v) => {
    const parts = v.split('.').map(Number)
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    }
  }

  const currentV = parseVersion(current)
  const latestV = parseVersion(latest)

  if (currentV.major !== latestV.major) {
    return currentV.major - latestV.major
  }
  if (currentV.minor !== latestV.minor) {
    return currentV.minor - latestV.minor
  }
  return currentV.patch - latestV.patch
}

router.get('/check-updates', authenticateAdmin, async (req, res) => {
  // 读取当前版本
  const versionPath = path.join(__dirname, '../../../VERSION')
  let currentVersion = '1.0.0'
  try {
    currentVersion = fs.readFileSync(versionPath, 'utf8').trim()
  } catch (err) {
    logger.warn('⚠️ Could not read VERSION file:', err.message)
  }

  try {
    // 从缓存获取
    const cacheKey = 'version_check_cache'
    const cached = await redis.getClient().get(cacheKey)

    if (cached && !req.query.force) {
      const cachedData = JSON.parse(cached)
      const cacheAge = Date.now() - cachedData.timestamp

      // 缓存有效期1小时
      if (cacheAge < 3600000) {
        // 实时计算 hasUpdate，不使用缓存的值
        const hasUpdate = compareVersions(currentVersion, cachedData.latest) < 0

        return res.json({
          success: true,
          data: {
            current: currentVersion,
            latest: cachedData.latest,
            hasUpdate, // 实时计算，不用缓存
            releaseInfo: cachedData.releaseInfo,
            cached: true
          }
        })
      }
    }

    // 请求 GitHub API
    const githubRepo = 'wei-shaw/claude-relay-service'
    const response = await axios.get(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Claude-Relay-Service'
      },
      timeout: 10000
    })

    const release = response.data
    const latestVersion = release.tag_name.replace(/^v/, '')

    // 比较版本
    const hasUpdate = compareVersions(currentVersion, latestVersion) < 0

    const releaseInfo = {
      name: release.name,
      body: release.body,
      publishedAt: release.published_at,
      htmlUrl: release.html_url
    }

    // 缓存结果（不缓存 hasUpdate，因为它应该实时计算）
    await redis.getClient().set(
      cacheKey,
      JSON.stringify({
        latest: latestVersion,
        releaseInfo,
        timestamp: Date.now()
      }),
      'EX',
      3600
    ) // 1小时过期

    return res.json({
      success: true,
      data: {
        current: currentVersion,
        latest: latestVersion,
        hasUpdate,
        releaseInfo,
        cached: false
      }
    })
  } catch (error) {
    // 改进错误日志记录
    const errorDetails = {
      message: error.message || 'Unknown error',
      code: error.code,
      response: error.response
        ? {
            status: error.response.status,
            statusText: error.response.statusText,
            data: error.response.data
          }
        : null,
      request: error.request ? 'Request was made but no response received' : null
    }

    logger.error('❌ Failed to check for updates:', errorDetails.message)

    // 处理 404 错误 - 仓库或版本不存在
    if (error.response && error.response.status === 404) {
      return res.json({
        success: true,
        data: {
          current: currentVersion,
          latest: currentVersion,
          hasUpdate: false,
          releaseInfo: {
            name: 'No releases found',
            body: 'The GitHub repository has no releases yet.',
            publishedAt: new Date().toISOString(),
            htmlUrl: '#'
          },
          warning: 'GitHub repository has no releases'
        }
      })
    }

    // 如果是网络错误，尝试返回缓存的数据
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      const cacheKey = 'version_check_cache'
      const cached = await redis.getClient().get(cacheKey)

      if (cached) {
        const cachedData = JSON.parse(cached)
        // 实时计算 hasUpdate
        const hasUpdate = compareVersions(currentVersion, cachedData.latest) < 0

        return res.json({
          success: true,
          data: {
            current: currentVersion,
            latest: cachedData.latest,
            hasUpdate, // 实时计算
            releaseInfo: cachedData.releaseInfo,
            cached: true,
            warning: 'Using cached data due to network error'
          }
        })
      }
    }

    // 其他错误返回当前版本信息
    return res.json({
      success: true,
      data: {
        current: currentVersion,
        latest: currentVersion,
        hasUpdate: false,
        releaseInfo: {
          name: 'Update check failed',
          body: `Unable to check for updates: ${error.message || 'Unknown error'}`,
          publishedAt: new Date().toISOString(),
          htmlUrl: '#'
        },
        error: true,
        warning: error.message || 'Failed to check for updates'
      }
    })
  }
})

// ==================== 一键更新功能 ====================

// 获取更新配置
router.get('/update-config', authenticateAdmin, async (req, res) => {
  try {
    const client = redis.getClient()
    const updateConfig = await client.get('system:update_config')

    const defaultConfig = {
      gitRemote: 'git@github.com:Wei-Shaw/claude-relay-service.git',
      updatedAt: null
    }

    let configData = defaultConfig
    if (updateConfig) {
      try {
        configData = { ...defaultConfig, ...JSON.parse(updateConfig) }
      } catch (err) {
        logger.warn('⚠️ Failed to parse update config, using defaults:', err.message)
      }
    }

    return res.json({
      success: true,
      data: configData
    })
  } catch (error) {
    logger.error('❌ Failed to get update config:', error)
    return res.status(500).json({ error: 'Failed to get update config', message: error.message })
  }
})

// 保存更新配置
router.put('/update-config', authenticateAdmin, async (req, res) => {
  try {
    const { gitRemote } = req.body

    if (!gitRemote || typeof gitRemote !== 'string') {
      return res.status(400).json({ error: 'Git remote URL is required' })
    }

    const configData = {
      gitRemote: gitRemote.trim(),
      updatedAt: new Date().toISOString()
    }

    const client = redis.getClient()
    await client.set('system:update_config', JSON.stringify(configData))

    logger.info(`✅ Update config saved: ${gitRemote}`)

    return res.json({
      success: true,
      message: 'Update config saved successfully',
      data: configData
    })
  } catch (error) {
    logger.error('❌ Failed to save update config:', error)
    return res.status(500).json({ error: 'Failed to save update config', message: error.message })
  }
})

// 一键更新
router.post('/one-click-update', authenticateAdmin, async (req, res) => {
  const projectRoot = path.join(__dirname, '../../..')
  const logs = []

  const addLog = (type, message) => {
    const logEntry = { type, message, time: new Date().toISOString() }
    logs.push(logEntry)
    if (type === 'error') {
      logger.error(`❌ Update: ${message}`)
    } else {
      logger.info(`📦 Update: ${message}`)
    }
  }

  try {
    addLog('info', '开始一键更新...')

    // 获取配置的 git remote
    const client = redis.getClient()
    const updateConfig = await client.get('system:update_config')
    let gitRemote = 'git@github.com:Wei-Shaw/claude-relay-service.git'

    if (updateConfig) {
      try {
        const config = JSON.parse(updateConfig)
        if (config.gitRemote) {
          gitRemote = config.gitRemote
        }
      } catch (err) {
        addLog('warn', `解析更新配置失败，使用默认值: ${err.message}`)
      }
    }

    // Step 1: 设置 git remote（如果需要）
    addLog('info', `设置 Git 远程地址: ${gitRemote}`)
    try {
      await execAsync(`git remote set-url origin "${gitRemote}"`, { cwd: projectRoot })
      addLog('success', 'Git 远程地址设置成功')
    } catch (err) {
      // 如果 origin 不存在，尝试添加
      try {
        await execAsync(`git remote add origin "${gitRemote}"`, { cwd: projectRoot })
        addLog('success', 'Git 远程地址添加成功')
      } catch (addErr) {
        addLog('warn', `设置远程地址时出现警告: ${addErr.message}`)
      }
    }

    // Step 2: Git fetch
    addLog('info', '获取远程更新...')
    try {
      const { stdout: fetchOut } = await execAsync('git fetch origin', {
        cwd: projectRoot,
        timeout: 60000
      })
      addLog('success', `Git fetch 完成: ${fetchOut || '无输出'}`)
    } catch (err) {
      addLog('error', `Git fetch 失败: ${err.message}`)
      return res.status(500).json({
        success: false,
        message: 'Git fetch 失败',
        error: err.message,
        logs
      })
    }

    // Step 2.5: 检查并暂存本地修改
    addLog('info', '检查本地修改...')
    let hasLocalChanges = false
    let modifiedFiles = []
    try {
      const { stdout: statusOut } = await execAsync('git status --porcelain', { cwd: projectRoot })
      if (statusOut.trim().length > 0) {
        hasLocalChanges = true
        // 解析修改的文件列表
        modifiedFiles = statusOut
          .trim()
          .split('\n')
          .map((line) => line.substring(3).trim())
          .filter((f) => f.length > 0)
        addLog('info', `检测到 ${modifiedFiles.length} 个本地修改的文件，正在暂存...`)
        await execAsync('git stash push -m "auto-stash-before-update"', { cwd: projectRoot })
        addLog('success', '本地修改已暂存')
      } else {
        addLog('info', '无本地修改')
      }
    } catch (err) {
      addLog('warn', `检查本地修改时出现警告: ${err.message}`)
    }

    // Step 3: Git pull (使用 rebase 策略)
    addLog('info', '拉取最新代码...')
    try {
      const { stdout: pullOut, stderr: pullErr } = await execAsync('git pull --rebase origin main', {
        cwd: projectRoot,
        timeout: 120000
      })
      const pullMessage = pullOut || pullErr || '无输出'
      addLog('success', `Git pull 完成: ${pullMessage.trim()}`)

      // 检查是否已经是最新
      if (pullMessage.includes('Already up to date') || pullMessage.includes('已经是最新')) {
        addLog('info', '代码已是最新版本')
      }
    } catch (err) {
      addLog('error', `Git pull 失败: ${err.message}`)
      // 如果 rebase 失败，尝试终止 rebase
      try {
        await execAsync('git rebase --abort', { cwd: projectRoot })
        addLog('warn', 'Rebase 已终止')
      } catch (abortErr) {
        // 忽略，可能没有正在进行的 rebase
      }
      // 恢复 stash
      if (hasLocalChanges) {
        try {
          await execAsync('git stash pop', { cwd: projectRoot })
          addLog('info', '已恢复本地修改')
        } catch (popErr) {
          addLog('warn', `恢复本地修改失败: ${popErr.message}`)
        }
      }
      return res.status(500).json({
        success: false,
        message: 'Git pull 失败，可能存在冲突或权限问题',
        error: err.message,
        logs
      })
    }

    // Step 3.5: 恢复本地修改
    if (hasLocalChanges) {
      addLog('info', '恢复本地修改...')
      try {
        await execAsync('git stash pop', { cwd: projectRoot })
        addLog('success', '本地修改已恢复')
      } catch (err) {
        // stash pop 有冲突，使用本地修改覆盖
        addLog('warn', `恢复本地修改时出现冲突，将保留本地修改...`)
        try {
          // 对于每个修改的文件，从 stash 中恢复
          for (const file of modifiedFiles) {
            try {
              await execAsync(`git checkout stash@{0} -- "${file}"`, { cwd: projectRoot })
            } catch (fileErr) {
              // 文件可能在 stash 中不存在，忽略
            }
          }
          // 清理 stash
          await execAsync('git stash drop', { cwd: projectRoot })
          // 重置冲突状态
          await execAsync('git reset HEAD', { cwd: projectRoot })
          addLog('success', '冲突已自动解决（保留本地修改）')
        } catch (resolveErr) {
          addLog('warn', `自动解决冲突时出现问题: ${resolveErr.message}`)
          // 尝试强制丢弃 stash
          try {
            await execAsync('git stash drop', { cwd: projectRoot })
          } catch (dropErr) {
            // 忽略
          }
        }
      }
    }

    // Step 4: 安装依赖
    addLog('info', '安装依赖...')
    try {
      const { stdout: npmOut } = await execAsync('npm install', {
        cwd: projectRoot,
        timeout: 300000 // 5分钟超时
      })
      addLog('success', 'npm install 完成')
    } catch (err) {
      addLog('warn', `npm install 警告: ${err.message}`)
      // npm install 警告不阻止更新
    }

    // Step 5: 读取新版本号
    let newVersion = 'unknown'
    try {
      const versionPath = path.join(projectRoot, 'VERSION')
      newVersion = fs.readFileSync(versionPath, 'utf8').trim()
      addLog('success', `新版本: ${newVersion}`)
    } catch (err) {
      addLog('warn', `读取版本号失败: ${err.message}`)
    }

    // Step 6: 重启服务（延迟执行，让响应先返回）
    addLog('info', '准备重启服务...')

    // 先返回成功响应
    res.json({
      success: true,
      message: '更新完成，服务将在 3 秒后重启',
      newVersion,
      logs
    })

    // 延迟重启，确保响应已发送
    setTimeout(() => {
      logger.info('🔄 正在重启服务...')

      // 使用 spawn 而不是 exec，避免阻塞
      const restart = spawn('npm', ['run', 'service:restart:daemon'], {
        cwd: projectRoot,
        detached: true,
        stdio: 'ignore'
      })

      restart.unref()
    }, 3000)
  } catch (error) {
    addLog('error', `更新失败: ${error.message}`)
    logger.error('❌ One-click update failed:', error)

    return res.status(500).json({
      success: false,
      message: '更新过程中出现错误',
      error: error.message,
      logs
    })
  }
})

// 获取更新状态（用于检查服务是否已重启）
router.get('/update-status', authenticateAdmin, async (req, res) => {
  try {
    const versionPath = path.join(__dirname, '../../../VERSION')
    let currentVersion = '1.0.0'
    try {
      currentVersion = fs.readFileSync(versionPath, 'utf8').trim()
    } catch (err) {
      logger.warn('⚠️ Could not read VERSION file:', err.message)
    }

    return res.json({
      success: true,
      data: {
        version: currentVersion,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      }
    })
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message })
  }
})

// ==================== OEM 设置管理 ====================

// 获取OEM设置（公开接口，用于显示）
// 注意：这个端点没有 authenticateAdmin 中间件，因为前端登录页也需要访问
router.get('/oem-settings', async (req, res) => {
  try {
    const client = redis.getClient()
    const oemSettings = await client.get('oem:settings')

    // 默认设置
    const defaultSettings = {
      siteName: 'Claude Relay Service',
      siteIcon: '',
      siteIconData: '', // Base64编码的图标数据
      showAdminButton: true, // 是否显示管理后台按钮
      updatedAt: new Date().toISOString()
    }

    let settings = defaultSettings
    if (oemSettings) {
      try {
        settings = { ...defaultSettings, ...JSON.parse(oemSettings) }
      } catch (err) {
        logger.warn('⚠️ Failed to parse OEM settings, using defaults:', err.message)
      }
    }

    // 添加 LDAP 启用状态到响应中
    return res.json({
      success: true,
      data: {
        ...settings,
        ldapEnabled: config.ldap && config.ldap.enabled === true
      }
    })
  } catch (error) {
    logger.error('❌ Failed to get OEM settings:', error)
    return res.status(500).json({ error: 'Failed to get OEM settings', message: error.message })
  }
})

// 更新OEM设置
router.put('/oem-settings', authenticateAdmin, async (req, res) => {
  try {
    const { siteName, siteIcon, siteIconData, showAdminButton } = req.body

    // 验证输入
    if (!siteName || typeof siteName !== 'string' || siteName.trim().length === 0) {
      return res.status(400).json({ error: 'Site name is required' })
    }

    if (siteName.length > 100) {
      return res.status(400).json({ error: 'Site name must be less than 100 characters' })
    }

    // 验证图标数据大小（如果是base64）
    if (siteIconData && siteIconData.length > 500000) {
      // 约375KB
      return res.status(400).json({ error: 'Icon file must be less than 350KB' })
    }

    // 验证图标URL（如果提供）
    if (siteIcon && !siteIconData) {
      // 简单验证URL格式
      try {
        new URL(siteIcon)
      } catch (err) {
        return res.status(400).json({ error: 'Invalid icon URL format' })
      }
    }

    const settings = {
      siteName: siteName.trim(),
      siteIcon: (siteIcon || '').trim(),
      siteIconData: (siteIconData || '').trim(), // Base64数据
      showAdminButton: showAdminButton !== false, // 默认为true
      updatedAt: new Date().toISOString()
    }

    const client = redis.getClient()
    await client.set('oem:settings', JSON.stringify(settings))

    logger.info(`✅ OEM settings updated: ${siteName}`)

    return res.json({
      success: true,
      message: 'OEM settings updated successfully',
      data: settings
    })
  } catch (error) {
    logger.error('❌ Failed to update OEM settings:', error)
    return res.status(500).json({ error: 'Failed to update OEM settings', message: error.message })
  }
})

// ==================== Claude Code 版本管理 ====================

router.get('/claude-code-version', authenticateAdmin, async (req, res) => {
  try {
    const CACHE_KEY = 'claude_code_user_agent:daily'

    // 获取缓存的统一User-Agent
    const unifiedUserAgent = await redis.client.get(CACHE_KEY)
    const ttl = unifiedUserAgent ? await redis.client.ttl(CACHE_KEY) : 0

    res.json({
      success: true,
      userAgent: unifiedUserAgent,
      isActive: !!unifiedUserAgent,
      ttlSeconds: ttl,
      lastUpdated: unifiedUserAgent ? new Date().toISOString() : null
    })
  } catch (error) {
    logger.error('❌ Get unified Claude Code User-Agent error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to get User-Agent information',
      error: error.message
    })
  }
})

// 🗑️ 清除统一Claude Code User-Agent缓存
router.post('/claude-code-version/clear', authenticateAdmin, async (req, res) => {
  try {
    const CACHE_KEY = 'claude_code_user_agent:daily'

    // 删除缓存的统一User-Agent
    await redis.client.del(CACHE_KEY)

    logger.info(`🗑️ Admin manually cleared unified Claude Code User-Agent cache`)

    res.json({
      success: true,
      message: 'Unified User-Agent cache cleared successfully'
    })
  } catch (error) {
    logger.error('❌ Clear unified User-Agent cache error:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
      error: error.message
    })
  }
})

module.exports = router
