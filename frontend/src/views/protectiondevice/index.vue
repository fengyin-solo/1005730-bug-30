<template>
  <section class="page" data-module="protectiondevice">
    <header class="page-head">
      <div>
        <h2>保护装置台账管理</h2>
        <p class="page-desc">维护保护装置，围绕装置编号、所属间隔、装置型号、保护类型做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记保护装置</button>
        <button class="btn" type="button" @click="exportRows">导出保护装置台账清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="todo-panel">
      <header class="todo-head">
        <h3>待办清单<span v-if="openTodos.length" class="todo-count">{{ openTodos.length }}</span></h3>
        <span class="todo-source">绝缘试验判不合格的记录会自动在这里挂一条，办结后不再提醒</span>
      </header>
      <table v-if="openTodos.length" class="data-table todo-table">
        <thead>
          <tr>
            <th>待办事项</th>
            <th>试验设备</th>
            <th>试验编号</th>
            <th>试验信息</th>
            <th>不合格原因</th>
            <th>来源时间</th>
            <th>处理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in openTodos" :key="todo.id">
            <td>{{ todo.title }}</td>
            <td>{{ todo.device || '—' }}</td>
            <td>{{ todo.serial || '—' }}</td>
            <td>{{ todo.detail }}</td>
            <td class="todo-reason">{{ todo.reason }}</td>
            <td>{{ formatTime(todo.createdAt) }}</td>
            <td>
              <button class="link" type="button" @click="finishTodo(todo.id)">办结</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="todo-empty">暂无绝缘试验不合格带来的待办事项</p>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无保护装置台账数据，可先登记保护装置</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条保护装置台账记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  closeProtectionTodo,
  listProtectionTodos,
} from '@/data/protection-todo-store'
import type { EntryRow, ProtectionTodo } from '@/data/types'

const meta = moduleMeta('protectiondevice')
const columns = ["装置编号", "所属间隔", "装置型号", "保护类型", "投运日期", "校验周期", "上次校验日", "装置状态"]
const actions = ["登记运行", "完成校验", "提出更换"]
const statuses = ["待校验", "运行正常", "已校验", "需更换"]
const stats = [{"label": "运行正常装置", "value": 0}, {"label": "待校验装置", "value": 0}, {"label": "需更换装置", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const openTodos = ref<ProtectionTodo[]>([])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function refreshTodos() {
  openTodos.value = listProtectionTodos('待处理')
}

function finishTodo(id: number) {
  closeProtectionTodo(id)
  refreshTodos()
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '保护装置登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保护装置台账列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshTodos()
})
</script>

<style scoped>
.todo-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.todo-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.todo-head h3 {
  margin: 0;
  font-size: 14px;
}
.todo-count {
  display: inline-block;
  min-width: 18px;
  text-align: center;
  background: #b42318;
  color: #fff;
  border-radius: 999px;
  font-size: 12px;
  padding: 0 6px;
  margin-left: 4px;
}
.todo-source {
  color: var(--muted);
  font-size: 12px;
}
.todo-table {
  margin-bottom: 4px;
}
.todo-reason {
  color: #b42318;
  max-width: 240px;
}
.todo-empty {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  padding: 6px 0;
}
</style>
