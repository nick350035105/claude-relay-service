<template>
  <div>
    <!-- 头部统计和控制 -->
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100 sm:text-2xl">日志明细</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          共 {{ stats.totalLogs || 0 }} 条日志，今日 {{ stats.todayLogs || 0 }} 条，保留
          {{ stats.retentionDays || 3 }} 天
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <!-- 自动刷新控制 -->
        <div class="flex items-center rounded-lg bg-gray-100 px-3 py-1.5 dark:bg-gray-700">
          <label class="relative inline-flex cursor-pointer items-center">
            <input v-model="autoRefreshEnabled" class="peer sr-only" type="checkbox" />
            <div
              class="peer relative h-5 w-9 rounded-full bg-gray-300 transition-all duration-200 after:absolute after:left-[2px] after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:content-[''] peer-checked:bg-blue-500 peer-checked:after:translate-x-4 peer-focus:outline-none dark:bg-gray-600"
            />
            <span
              class="ml-2.5 flex select-none items-center gap-1 text-sm font-medium text-gray-600 dark:text-gray-300"
            >
              <i class="fas fa-redo-alt text-xs text-gray-500 dark:text-gray-400" />
              <span>自动刷新</span>
              <span
                v-if="autoRefreshEnabled"
                class="ml-1 font-mono text-xs text-blue-600 transition-opacity"
                :class="refreshCountdown > 0 ? 'opacity-100' : 'opacity-0'"
              >
                {{ refreshCountdown }}s
              </span>
            </span>
          </label>
        </div>

        <!-- 刷新按钮 -->
        <button
          class="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700"
          :disabled="isLoading"
          title="立即刷新"
          @click="loadLogs"
        >
          <i :class="['fas fa-sync-alt text-xs', { 'animate-spin': isLoading }]" />
          <span>{{ isLoading ? '刷新中' : '刷新' }}</span>
        </button>

        <!-- 清空日志按钮 -->
        <button
          class="flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:bg-gray-800 dark:hover:bg-red-900/20"
          :disabled="isLoading || logs.length === 0"
          @click="confirmClearLogs"
        >
          <i class="fas fa-trash-alt text-xs" />
          <span>清空</span>
        </button>
      </div>
    </div>

    <!-- 筛选器 -->
    <div class="mb-4 flex flex-wrap gap-2">
      <select
        v-model="filters.status"
        class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        @change="loadLogs"
      >
        <option value="">全部状态</option>
        <option value="success">成功</option>
        <option value="error">失败</option>
      </select>

      <input
        v-model="filters.model"
        class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        placeholder="筛选模型"
        @keyup.enter="loadLogs"
      />

      <button
        v-if="filters.status || filters.model"
        class="rounded-lg bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600"
        @click="clearFilters"
      >
        <i class="fas fa-times mr-1" />清除筛选
      </button>
    </div>

    <!-- 日志列表 -->
    <div class="card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="min-w-full">
          <thead class="bg-gray-50 dark:bg-gray-700">
            <tr>
              <th
                class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                时间
              </th>
              <th
                class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                API Key
              </th>
              <th
                class="hidden px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 md:table-cell"
              >
                账户
              </th>
              <th
                class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                模型
              </th>
              <th
                class="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                状态
              </th>
              <th
                class="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 lg:table-cell"
              >
                耗时
              </th>
              <th
                class="hidden px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300 sm:table-cell"
              >
                Tokens
              </th>
              <th
                class="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300"
              >
                操作
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 dark:divide-gray-600">
            <tr v-if="isLoading && logs.length === 0">
              <td class="px-4 py-8 text-center text-gray-500 dark:text-gray-400" colspan="8">
                <i class="fas fa-spinner fa-spin mr-2" />加载中...
              </td>
            </tr>
            <tr v-else-if="logs.length === 0">
              <td class="px-4 py-8 text-center text-gray-500 dark:text-gray-400" colspan="8">
                <i class="fas fa-inbox mr-2" />暂无日志记录
              </td>
            </tr>
            <tr
              v-for="log in logs"
              :key="log.id"
              class="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
            >
              <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                {{ formatTime(log.createdAt) }}
              </td>
              <td class="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                <span class="max-w-[120px] truncate" :title="log.apiKeyName">
                  {{ log.apiKeyName || log.apiKeyId?.slice(0, 8) }}
                </span>
              </td>
              <td class="hidden px-4 py-3 text-sm text-gray-600 dark:text-gray-400 md:table-cell">
                <div class="flex items-center gap-1">
                  <span
                    class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium"
                    :class="getAccountTypeClass(log.accountType)"
                  >
                    {{ log.accountType || 'unknown' }}
                  </span>
                </div>
              </td>
              <td class="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                <span class="max-w-[150px] truncate" :title="log.model">
                  {{ log.model || '-' }}
                </span>
              </td>
              <td class="px-4 py-3 text-center">
                <span
                  class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                  :class="
                    log.status === 'success'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                  "
                >
                  {{ log.status === 'success' ? '成功' : '失败' }}
                </span>
              </td>
              <td
                class="hidden whitespace-nowrap px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400 lg:table-cell"
              >
                {{ log.duration ? `${log.duration}ms` : '-' }}
              </td>
              <td
                class="hidden whitespace-nowrap px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400 sm:table-cell"
              >
                {{ formatTokens(log) }}
              </td>
              <td class="px-4 py-3 text-center">
                <button
                  class="rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50"
                  @click="showLogDetail(log)"
                >
                  <i class="fas fa-eye mr-1" />详情
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页 -->
      <div
        v-if="pagination.totalPages > 1"
        class="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-600 dark:bg-gray-700"
      >
        <div class="text-sm text-gray-600 dark:text-gray-400">
          第 {{ pagination.page }} / {{ pagination.totalPages }} 页，共 {{ pagination.total }} 条
        </div>
        <div class="flex gap-2">
          <button
            class="rounded-lg border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            :disabled="pagination.page <= 1"
            @click="goToPage(pagination.page - 1)"
          >
            上一页
          </button>
          <button
            class="rounded-lg border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
            :disabled="pagination.page >= pagination.totalPages"
            @click="goToPage(pagination.page + 1)"
          >
            下一页
          </button>
        </div>
      </div>
    </div>

    <!-- 日志详情模态框 -->
    <div
      v-if="showDetailModal"
      class="modal fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
    >
      <div
        class="modal-content mx-auto flex max-h-[90vh] w-full max-w-4xl flex-col p-4 sm:p-6 md:p-8"
      >
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600"
            >
              <i class="fas fa-file-alt text-white" />
            </div>
            <h3 class="text-xl font-bold text-gray-900 dark:text-gray-100">日志详情</h3>
          </div>
          <button
            class="text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            @click="showDetailModal = false"
          >
            <i class="fas fa-times text-xl" />
          </button>
        </div>

        <div v-if="detailLoading" class="flex items-center justify-center py-8">
          <i class="fas fa-spinner fa-spin mr-2 text-blue-500" />
          <span class="text-gray-500 dark:text-gray-400">加载中...</span>
        </div>

        <div v-else-if="selectedLog" class="custom-scrollbar flex-1 space-y-4 overflow-y-auto">
          <!-- 基本信息 -->
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">时间</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ formatTime(selectedLog.createdAt) }}
              </p>
            </div>
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">状态</label>
              <p class="text-sm font-medium">
                <span :class="selectedLog.status === 'success' ? 'text-green-600' : 'text-red-600'">
                  {{ selectedLog.status === 'success' ? '成功' : '失败' }}
                  ({{ selectedLog.statusCode }})
                </span>
              </p>
            </div>
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">耗时</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ selectedLog.duration ? `${selectedLog.duration}ms` : '-' }}
              </p>
            </div>
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">模型</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ selectedLog.model || '-' }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">API Key</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ selectedLog.apiKeyName || selectedLog.apiKeyId }}
              </p>
            </div>
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">账户类型</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ selectedLog.accountType || '-' }}
              </p>
            </div>
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">输入/输出</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ selectedLog.inputTokens || 0 }} / {{ selectedLog.outputTokens || 0 }}
              </p>
            </div>
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">缓存</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                创建: {{ selectedLog.cacheCreateTokens || 0 }} / 读取:
                {{ selectedLog.cacheReadTokens || 0 }}
              </p>
            </div>
          </div>

          <!-- 请求路径和客户端信息 -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">请求路径</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ selectedLog.requestPath || '-' }}
              </p>
            </div>
            <div>
              <label class="text-xs text-gray-500 dark:text-gray-400">客户端IP</label>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ selectedLog.clientIp || '-' }}
              </p>
            </div>
          </div>

          <!-- 输入 -->
          <div>
            <div class="mb-2 flex items-center justify-between">
              <label class="text-xs font-semibold text-gray-700 dark:text-gray-300">输入</label>
              <button
                class="text-xs text-blue-500 hover:text-blue-700"
                @click="copyToClipboard(selectedLog.input)"
              >
                <i class="fas fa-copy mr-1" />复制
              </button>
            </div>
            <pre
              class="custom-scrollbar max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"
              >{{ formatJson(selectedLog.input) }}</pre
            >
          </div>

          <!-- 输出 -->
          <div>
            <div class="mb-2 flex items-center justify-between">
              <label class="text-xs font-semibold text-gray-700 dark:text-gray-300">输出</label>
              <button
                class="text-xs text-blue-500 hover:text-blue-700"
                @click="copyToClipboard(selectedLog.output)"
              >
                <i class="fas fa-copy mr-1" />复制
              </button>
            </div>
            <pre
              class="custom-scrollbar max-h-48 overflow-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100"
              >{{ formatJson(selectedLog.output) }}</pre
            >
          </div>

          <!-- 错误信息 -->
          <div v-if="selectedLog.errorMessage">
            <label class="text-xs font-semibold text-red-600">错误信息</label>
            <pre
              class="mt-1 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400"
              >{{ selectedLog.errorMessage }}</pre
            >
          </div>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            class="rounded-xl bg-gray-100 px-6 py-2 font-semibold text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            @click="showDetailModal = false"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import { apiClient } from '@/config/api'
import { showToast } from '@/utils/toast'

// 日志列表
const logs = ref([])
const isLoading = ref(false)

// 统计信息
const stats = ref({
  totalLogs: 0,
  todayLogs: 0,
  retentionDays: 3
})

// 分页
const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0
})

// 筛选
const filters = reactive({
  status: '',
  model: ''
})

// 详情模态框
const showDetailModal = ref(false)
const selectedLog = ref(null)
const detailLoading = ref(false)

// 自动刷新
const autoRefreshEnabled = ref(false)
const autoRefreshInterval = 30 // 秒
const refreshCountdown = ref(0)
let autoRefreshTimer = null
let countdownTimer = null

// 加载日志列表
async function loadLogs() {
  isLoading.value = true
  try {
    const params = {
      page: pagination.page,
      limit: pagination.limit
    }
    if (filters.status) params.status = filters.status
    if (filters.model) params.model = filters.model

    const result = await apiClient.get('/admin/request-logs', params)

    if (result.success) {
      logs.value = result.data || []
      pagination.total = result.pagination?.total || 0
      pagination.totalPages = result.pagination?.totalPages || 0
    }
  } catch (error) {
    console.error('Failed to load logs:', error)
    showToast('加载日志失败', 'error')
  } finally {
    isLoading.value = false
  }
}

// 加载统计信息
async function loadStats() {
  try {
    const result = await apiClient.get('/admin/request-logs/stats')
    if (result.success) {
      stats.value = result.data
    }
  } catch (error) {
    console.error('Failed to load stats:', error)
  }
}

// 显示日志详情
async function showLogDetail(log) {
  showDetailModal.value = true
  detailLoading.value = true
  selectedLog.value = null

  try {
    const result = await apiClient.get(`/admin/request-logs/${log.id}`)
    if (result.success) {
      selectedLog.value = result.data
    } else {
      showToast('加载详情失败', 'error')
    }
  } catch (error) {
    console.error('Failed to load log detail:', error)
    showToast('加载详情失败', 'error')
  } finally {
    detailLoading.value = false
  }
}

// 确认清空日志
async function confirmClearLogs() {
  if (!confirm('确定要清空所有日志吗？此操作不可恢复。')) {
    return
  }

  isLoading.value = true
  try {
    const result = await apiClient.delete('/admin/request-logs')
    if (result.success) {
      showToast('日志已清空', 'success')
      await loadLogs()
      await loadStats()
    } else {
      showToast('清空失败', 'error')
    }
  } catch (error) {
    console.error('Failed to clear logs:', error)
    showToast('清空失败', 'error')
  } finally {
    isLoading.value = false
  }
}

// 分页
function goToPage(page) {
  pagination.page = page
  loadLogs()
}

// 清除筛选
function clearFilters() {
  filters.status = ''
  filters.model = ''
  pagination.page = 1
  loadLogs()
}

// 格式化时间
function formatTime(dateStr) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${month}-${day} ${hours}:${minutes}:${seconds}`
}

// 格式化Token
function formatTokens(log) {
  const total = (log.inputTokens || 0) + (log.outputTokens || 0)
  if (total === 0) return '-'
  return total.toLocaleString()
}

// 获取账户类型样式
function getAccountTypeClass(type) {
  const classes = {
    'claude-official': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
    'claude-console': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    bedrock: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    ccr: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
    gemini: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
  }
  return classes[type] || 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
}

// 格式化JSON
function formatJson(str) {
  if (!str) return '-'
  try {
    const obj = typeof str === 'string' ? JSON.parse(str) : str
    return JSON.stringify(obj, null, 2)
  } catch {
    return str
  }
}

// 复制到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text || '')
    showToast('已复制到剪贴板', 'success')
  } catch {
    showToast('复制失败', 'error')
  }
}

// 自动刷新
function startAutoRefresh() {
  if (!autoRefreshEnabled.value) return

  refreshCountdown.value = autoRefreshInterval

  if (countdownTimer) clearInterval(countdownTimer)
  if (autoRefreshTimer) clearTimeout(autoRefreshTimer)

  countdownTimer = setInterval(() => {
    refreshCountdown.value--
    if (refreshCountdown.value <= 0) {
      clearInterval(countdownTimer)
    }
  }, 1000)

  autoRefreshTimer = setTimeout(async () => {
    await loadLogs()
    await loadStats()
    if (autoRefreshEnabled.value) {
      startAutoRefresh()
    }
  }, autoRefreshInterval * 1000)
}

function stopAutoRefresh() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer)
    autoRefreshTimer = null
  }
  refreshCountdown.value = 0
}

watch(autoRefreshEnabled, (newVal) => {
  if (newVal) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
})

onMounted(async () => {
  await Promise.all([loadLogs(), loadStats()])
})

onUnmounted(() => {
  stopAutoRefresh()
})
</script>

<style scoped>
.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
