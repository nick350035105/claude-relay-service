/**
 * AI请求日志服务
 * 记录所有AI请求的详细信息，支持自动清理过期日志
 */

const redis = require('../models/redis')
const logger = require('../utils/logger')
const { v4: uuidv4 } = require('uuid')

// 日志保留天数
const LOG_RETENTION_DAYS = 3

// Redis key前缀
const LOG_PREFIX = 'request_log:'
const LOG_INDEX_KEY = 'request_logs:index'

/**
 * 记录请求日志
 * @param {Object} logData 日志数据
 * @returns {Promise<string>} 日志ID
 */
async function logRequest(logData) {
  try {
    const client = redis.getClient()
    const logId = uuidv4()
    const timestamp = Date.now()

    const logEntry = {
      id: logId,
      timestamp,
      createdAt: new Date(timestamp).toISOString(),
      ...logData
    }

    // 存储日志详情
    const logKey = `${LOG_PREFIX}${logId}`
    const ttl = LOG_RETENTION_DAYS * 24 * 60 * 60 // 转换为秒

    await client.set(logKey, JSON.stringify(logEntry), 'EX', ttl)

    // 添加到有序集合索引（按时间戳排序）
    await client.zadd(LOG_INDEX_KEY, timestamp, logId)

    return logId
  } catch (error) {
    logger.error('❌ Failed to log request:', error)
    return null
  }
}

/**
 * 获取日志列表
 * @param {Object} options 查询选项
 * @returns {Promise<Object>} 日志列表和分页信息
 */
async function getLogs(options = {}) {
  const {
    page = 1,
    limit = 20,
    apiKeyId = null,
    accountId = null,
    model = null,
    status = null,
    startTime = null,
    endTime = null
  } = options

  try {
    const client = redis.getClient()

    // 清理过期日志
    await cleanupExpiredLogs()

    // 获取时间范围
    const minScore = startTime ? new Date(startTime).getTime() : '-inf'
    const maxScore = endTime ? new Date(endTime).getTime() : '+inf'

    // 从索引获取所有日志ID（按时间倒序）
    const allLogIds = await client.zrevrangebyscore(LOG_INDEX_KEY, maxScore, minScore)

    // 获取所有日志详情并过滤
    const logs = []
    for (const logId of allLogIds) {
      const logKey = `${LOG_PREFIX}${logId}`
      const logData = await client.get(logKey)

      if (!logData) {
        // 日志已过期，从索引中移除
        await client.zrem(LOG_INDEX_KEY, logId)
        continue
      }

      const log = JSON.parse(logData)

      // 应用过滤条件
      if (apiKeyId && log.apiKeyId !== apiKeyId) {
        continue
      }
      if (accountId && log.accountId !== accountId) {
        continue
      }
      if (model && log.model !== model) {
        continue
      }
      if (status && log.status !== status) {
        continue
      }

      logs.push(log)
    }

    // 计算分页
    const total = logs.length
    const totalPages = Math.ceil(total / limit)
    const startIndex = (page - 1) * limit
    const paginatedLogs = logs.slice(startIndex, startIndex + limit)

    // 返回时隐藏敏感信息
    const sanitizedLogs = paginatedLogs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      createdAt: log.createdAt,
      apiKeyId: log.apiKeyId,
      apiKeyName: log.apiKeyName,
      accountId: log.accountId,
      accountName: log.accountName,
      accountType: log.accountType,
      model: log.model,
      status: log.status,
      statusCode: log.statusCode,
      duration: log.duration,
      inputTokens: log.inputTokens,
      outputTokens: log.outputTokens,
      cacheCreateTokens: log.cacheCreateTokens,
      cacheReadTokens: log.cacheReadTokens,
      cost: log.cost,
      errorMessage: log.errorMessage,
      clientIp: log.clientIp,
      userAgent: log.userAgent,
      requestPath: log.requestPath,
      hasInput: !!log.input,
      hasOutput: !!log.output
    }))

    return {
      logs: sanitizedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    }
  } catch (error) {
    logger.error('❌ Failed to get logs:', error)
    throw error
  }
}

/**
 * 获取单条日志详情（包含输入输出）
 * @param {string} logId 日志ID
 * @returns {Promise<Object|null>} 日志详情
 */
async function getLogDetail(logId) {
  try {
    const client = redis.getClient()
    const logKey = `${LOG_PREFIX}${logId}`
    const logData = await client.get(logKey)

    if (!logData) {
      return null
    }

    const log = JSON.parse(logData)

    // 截断过长的输入输出
    const maxLength = 50000

    return {
      ...log,
      input:
        log.input && log.input.length > maxLength
          ? `${log.input.substring(0, maxLength)}... [已截断]`
          : log.input,
      output:
        log.output && log.output.length > maxLength
          ? `${log.output.substring(0, maxLength)}... [已截断]`
          : log.output
    }
  } catch (error) {
    logger.error('❌ Failed to get log detail:', error)
    throw error
  }
}

/**
 * 清理过期日志
 */
async function cleanupExpiredLogs() {
  try {
    const client = redis.getClient()
    const cutoffTime = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000

    // 获取过期的日志ID
    const expiredLogIds = await client.zrangebyscore(LOG_INDEX_KEY, '-inf', cutoffTime)

    if (expiredLogIds.length === 0) {
      return
    }

    // 删除过期日志
    const pipeline = client.pipeline()
    for (const logId of expiredLogIds) {
      pipeline.del(`${LOG_PREFIX}${logId}`)
      pipeline.zrem(LOG_INDEX_KEY, logId)
    }
    await pipeline.exec()

    logger.info(`🗑️ Cleaned up ${expiredLogIds.length} expired request logs`)
  } catch (error) {
    logger.error('❌ Failed to cleanup expired logs:', error)
  }
}

/**
 * 获取日志统计信息
 * @returns {Promise<Object>} 统计信息
 */
async function getLogStats() {
  try {
    const client = redis.getClient()

    // 清理过期日志
    await cleanupExpiredLogs()

    const totalLogs = await client.zcard(LOG_INDEX_KEY)

    // 获取今日日志数
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayLogs = await client.zcount(LOG_INDEX_KEY, todayStart.getTime(), '+inf')

    return {
      totalLogs,
      todayLogs,
      retentionDays: LOG_RETENTION_DAYS
    }
  } catch (error) {
    logger.error('❌ Failed to get log stats:', error)
    throw error
  }
}

/**
 * 手动清理所有日志
 * @returns {Promise<number>} 清理的日志数量
 */
async function clearAllLogs() {
  try {
    const client = redis.getClient()

    // 获取所有日志ID
    const allLogIds = await client.zrange(LOG_INDEX_KEY, 0, -1)

    if (allLogIds.length === 0) {
      return 0
    }

    // 删除所有日志
    const pipeline = client.pipeline()
    for (const logId of allLogIds) {
      pipeline.del(`${LOG_PREFIX}${logId}`)
    }
    pipeline.del(LOG_INDEX_KEY)
    await pipeline.exec()

    logger.info(`🗑️ Cleared all ${allLogIds.length} request logs`)
    return allLogIds.length
  } catch (error) {
    logger.error('❌ Failed to clear all logs:', error)
    throw error
  }
}

// 启动定时清理任务（每小时运行一次）
setInterval(
  () => {
    cleanupExpiredLogs().catch((err) => {
      logger.error('❌ Scheduled log cleanup failed:', err)
    })
  },
  60 * 60 * 1000
)

module.exports = {
  logRequest,
  getLogs,
  getLogDetail,
  getLogStats,
  clearAllLogs,
  cleanupExpiredLogs,
  LOG_RETENTION_DAYS
}
