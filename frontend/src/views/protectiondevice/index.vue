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

    <section class="todo-panel">
      <header class="todo-head">
        <h3>绝缘试验不合格跟踪待办</h3>
        <span class="todo-count">待办 {{ pendingTodoList.length }} 条 · 已办结 {{ doneTodoList.length }} 条</span>
        <button class="btn ghost" type="button" @click="reloadTodos">刷新待办</button>
      </header>
      <table v-if="todoList.length" class="data-table">
        <thead>
          <tr>
            <th>来源试验编号</th>
            <th>不合格设备</th>
            <th>不合格原因</th>
            <th>挂单日期</th>
            <th>处理状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todoList" :key="todo.id" :class="{ 'todo-done': todo.done }">
            <td>{{ todo.testNo }}</td>
            <td>{{ todo.equipment }}</td>
            <td>{{ todo.reason }}</td>
            <td>{{ todo.createdAt }}</td>
            <td>
              <span :class="['status-pill', todo.done ? '' : 'status-fail']">{{ todo.done ? '已办结' : '待处理' }}</span>
            </td>
            <td class="row-actions">
              <button v-if="!todo.done" class="link" type="button" @click="finishTodo(todo.id)">办结</button>
              <span v-else>—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">没有绝缘试验不合格待办，保护装置台账当前无需跟踪项</p>
    </section>

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
import { listTodos, resolveTodo } from '@/api/protection-todo'
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
const todoList = ref<ProtectionTodo[]>([])
const pendingTodoList = computed(() => todoList.value.filter((todo) => !todo.done))
const doneTodoList = computed(() => todoList.value.filter((todo) => todo.done))
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

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

function reloadTodos() {
  // 绝缘试验页判不合格写入同一份 localStorage，这里每次进入/刷新都重读。
  todoList.value = listTodos()
}

function finishTodo(id: number) {
  if (resolveTodo(id)) {
    reloadTodos()
  }
}

onMounted(() => {
  reload()
  reloadTodos()
})
</script>
