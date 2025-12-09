/**
 * 请求日志路由
 * 提供AI请求日志的查询和管理API
 */

const express = require('express')
const router = express.Router()
const { authenticateAdmin } = require('../../middleware/auth')
const requestLogService = require('../../services/requestLogService')
const logger = require('../../utils/logger')

/**
 * 获取日志列表
 * GET /admin/request-logs
 */
router.get('/request-logs', authenticateAdmin, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      apiKeyId,
      accountId,
      model,
      status,
      startTime,
      endTime
    } = req.query

    const result = await requestLogService.getLogs({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      apiKeyId,
      accountId,
      model,
      status,
      startTime,
      endTime
    })

    return res.json({
      success: true,
      data: result.logs,
      pagination: result.pagination
    })
  } catch (error) {
    logger.error('❌ Failed to get request logs:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get request logs',
      message: error.message
    })
  }
})

/**
 * 获取日志统计
 * GET /admin/request-logs/stats
 */
router.get('/request-logs/stats', authenticateAdmin, async (req, res) => {
  try {
    const stats = await requestLogService.getLogStats()

    return res.json({
      success: true,
      data: stats
    })
  } catch (error) {
    logger.error('❌ Failed to get log stats:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get log stats',
      message: error.message
    })
  }
})

/**
 * 获取单条日志详情
 * GET /admin/request-logs/:logId
 */
router.get('/request-logs/:logId', authenticateAdmin, async (req, res) => {
  try {
    const { logId } = req.params
    const log = await requestLogService.getLogDetail(logId)

    if (!log) {
      return res.status(404).json({
        success: false,
        error: 'Log not found'
      })
    }

    return res.json({
      success: true,
      data: log
    })
  } catch (error) {
    logger.error('❌ Failed to get log detail:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to get log detail',
      message: error.message
    })
  }
})

/**
 * 清理所有日志
 * DELETE /admin/request-logs
 */
router.delete('/request-logs', authenticateAdmin, async (req, res) => {
  try {
    const count = await requestLogService.clearAllLogs()

    return res.json({
      success: true,
      message: `Cleared ${count} logs`
    })
  } catch (error) {
    logger.error('❌ Failed to clear logs:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to clear logs',
      message: error.message
    })
  }
})

/**
 * 手动触发过期日志清理
 * POST /admin/request-logs/cleanup
 */
router.post('/request-logs/cleanup', authenticateAdmin, async (req, res) => {
  try {
    await requestLogService.cleanupExpiredLogs()

    return res.json({
      success: true,
      message: 'Cleanup completed'
    })
  } catch (error) {
    logger.error('❌ Failed to cleanup logs:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to cleanup logs',
      message: error.message
    })
  }
})

module.exports = router
