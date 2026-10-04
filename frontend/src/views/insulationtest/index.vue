<template>
  <section class="page" data-module="insulationtest">
    <header class="page-head">
      <div>
        <h2>绝缘试验管理</h2>
        <p class="page-desc">维护试验记录，围绕试验编号、试验设备、试验项目、试验电压做登记、筛选与状态流转；结论按技术要求核定。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记试验记录</button>
        <button class="btn" type="button" @click="exportRows">导出绝缘试验清单</button>
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

    <details class="spec-box">
      <summary>试验结论核定依据（试验电压 / 泄漏电流技术要求）</summary>
      <table class="spec-table">
        <thead>
          <tr>
            <th>适用试验项目</th>
            <th>标准试验电压</th>
            <th>允许电压范围</th>
            <th>泄漏电流上限</th>
            <th>依据</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="spec in specRows" :key="spec.key">
            <td>{{ spec.name }}</td>
            <td>{{ formatKv(spec.voltageKv) }}</td>
            <td>{{ formatKv(spec.voltageKv * (1 - spec.voltageTolerance)) }}～{{ formatKv(spec.voltageKv * (1 + spec.voltageTolerance)) }}</td>
            <td>≤ {{ spec.maxLeakageUa }}μA</td>
            <td>{{ spec.basis }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <form class="filter-bar" @submit.prevent="reloadFromStart">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>缺项</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-incomplete': missingOf(row).length > 0 }">
          <td v-for="column in columns" :key="column">
            <template v-if="isEmptyField(row[column])">
              <span class="missing-tag">缺失（{{ column }}）</span>
            </template>
            <template v-else>{{ row[column] }}</template>
          </td>
          <td>
            <span v-if="missingOf(row).length" class="missing-badge">缺 {{ missingOf(row).join('、') }}</span>
            <span v-else class="complete-badge">字段齐全</span>
          </td>
          <td>
            <span :class="row.status === '试验不合格' ? 'status-bad' : ''">{{ row.status }}</span>
            <p v-if="row['不合格原因']" class="reason-text" :title="String(row['不合格原因'])">
              {{ String(row['不合格原因']) }}
            </p>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">查看明细</button>
            <button class="link" type="button" @click="submitEntry(row)">提交试验</button>
            <button class="link" type="button" @click="evaluateEntry(row)">技术核定</button>
            <button class="link danger" type="button" @click="markUnqualified(row)">标记不合格</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">没有可看的记录{{ emptyHint }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="hasMore" class="load-more">
      <button class="btn" type="button" @click="loadMore">接着已看过的 {{ shown }} 条继续加载（每次 {{ pageSize }} 条）</button>
    </div>

    <footer class="page-foot">
      <span>去重后共 {{ total }} 条试验记录，当前已看 {{ shown }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detailRow" class="detail-mask" @click.self="closeDetail">
      <div class="detail-panel" role="dialog" aria-modal="true" aria-label="绝缘试验明细">
        <header class="detail-head">
          <h3>试验明细 · {{ detailRow['试验编号'] || `记录 ${detailRow.id}` }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-list">
          <div v-for="field in detailFields" :key="field" class="detail-item">
            <dt>{{ field }}</dt>
            <dd v-if="field === '泄漏电流'">
              <input
                v-model="leakageDraft"
                class="leakage-input"
                type="text"
                placeholder="如 42μA / 0.05mA"
                @keyup.enter="saveLeakage"
              />
              <button class="btn small" type="button" @click="saveLeakage">保存读数</button>
              <span v-if="leakageSavedTip" class="ok-text">{{ leakageSavedTip }}</span>
            </dd>
            <dd v-else-if="isEmptyField(detailRow[field])">
              <span class="missing-tag">缺失（{{ field }}）</span>
            </dd>
            <dd v-else>{{ detailRow[field] }}</dd>
          </div>
          <div class="detail-item">
            <dt>缺项</dt>
            <dd>
              <span v-if="missingOf(detailRow).length" class="missing-badge">缺 {{ missingOf(detailRow).join('、') }}</span>
              <span v-else class="complete-badge">字段齐全</span>
            </dd>
          </div>
          <div v-if="detailRow['不合格原因']" class="detail-item">
            <dt>不合格原因</dt>
            <dd class="reason-text">{{ detailRow['不合格原因'] }}</dd>
          </div>
        </dl>
        <p v-if="detailVerdict" class="verdict-text" :class="detailVerdict.pass ? 'ok-text' : 'error-text'">
          {{ detailVerdict.pass ? '按技术要求核定：合格' : `按技术要求核定：不合格，${detailVerdict.reasons.join('；')}` }}
        </p>
        <footer class="detail-foot">
          <button class="btn primary" type="button" @click="evaluateEntry(detailRow)">按技术要求核定</button>
          <button class="btn" type="button" @click="markUnqualified(detailRow)">标记不合格</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  runAction as applyAction,
} from '@/api/local-service'
import {
  INSULATION_PAGE_SIZE,
  evaluateInsulationEntry,
  loadInsulation,
  loadMoreInsulation,
  markInsulationUnqualified,
  resetCursor,
  saveCursor,
  updateLeakageCurrent,
} from '@/api/insulation-service'
import {
  DEFAULT_SPEC,
  INSULATION_SPECS,
  evaluateInsulation,
  formatKv,
  isFieldEmpty as isEmptyField,
  missingFields,
} from '@/data/insulation'
import type { EntryRow } from '@/data/types'

const columns = ["试验编号", "试验设备", "试验项目", "试验电压", "泄漏电流", "试验人", "试验日期", "试验结论"]
const detailFields = columns
const filterFields = columns.slice(0, 3)
const statuses = ["待试验", "试验中", "试验合格", "试验不合格"]
const specRows = [...INSULATION_SPECS, DEFAULT_SPEC]
const pageSize = INSULATION_PAGE_SIZE

const rows = ref<EntryRow[]>([])
const preparedRows = ref<EntryRow[]>([])
const total = ref(0)
const shown = ref(0)
const hasMore = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})

const detailRow = ref<EntryRow | null>(null)
const leakageDraft = ref('')
const leakageSavedTip = ref('')

const stats = computed(() => [
  { label: '待试验设备', value: countByStatus(['待试验', '试验中']) },
  { label: '试验合格设备', value: countByStatus(['试验合格']) },
  { label: '试验不合格设备', value: countByStatus(['试验不合格']) },
  { label: '字段不全记录', value: preparedRows.value.filter((row) => missingOf(row).length > 0).length },
])

function countByStatus(list: string[]): number {
  return preparedRows.value.filter((row) => list.includes(String(row.status))).length
}

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: preparedRows.value.filter((row) => String(row.status) === status).length,
  })),
)

const emptyHint = computed(() => {
  const active = Object.values(filters.value).some((value) => value.trim() !== '')
  return active ? '（当前筛选条件下没有匹配记录，可调整查询条件后重试）' : '（整批为空，可先登记试验记录）'
})

const detailVerdict = computed(() =>
  detailRow.value ? evaluateInsulation(detailRow.value) : null,
)

function missingOf(row: EntryRow): string[] {
  return missingFields(row)
}

function applyPayload(payload: ReturnType<typeof loadInsulation>) {
  rows.value = payload.items
  preparedRows.value = payload.prepared
  total.value = payload.total
  shown.value = payload.shown
  hasMore.value = payload.hasMore
  if (payload.resumed) {
    noticeMessage.value = `已从上次断点续上，先展示之前看到的 ${payload.shown} 条，可继续往下加载`
  }
}

function clearMessages() {
  errorMessage.value = ''
  noticeMessage.value = ''
}

function reload() {
  try {
    applyPayload(loadInsulation(filters.value))
    syncDetail()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '绝缘试验列表读取失败'
  }
}

function reloadFromStart() {
  clearMessages()
  resetCursor(filters.value)
  reload()
}

function resetFilters() {
  filters.value = {}
  reloadFromStart()
}

function loadMore() {
  clearMessages()
  try {
    applyPayload(loadMoreInsulation(filters.value, shown.value))
    syncDetail()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继续加载失败'
  }
}

function exportRows() {
  downloadEntries('insulationtest')
}

function openCreate() {
  errorMessage.value = '试验记录登记入口尚未接入审批流'
}

function submitEntry(row: EntryRow) {
  clearMessages()
  const result = applyAction('insulationtest', Number(row.id), '提交试验')
  reload()
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function evaluateEntry(row: EntryRow) {
  clearMessages()
  const result = evaluateInsulationEntry(Number(row.id))
  reload()
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function markUnqualified(row: EntryRow) {
  const reason = window.prompt(
    `请填写「${String(row['试验设备'] || row.id)}」判定不合格的原因：`,
    String(row['不合格原因'] ?? ''),
  )
  if (reason === null) {
    return
  }
  clearMessages()
  const result = markInsulationUnqualified(Number(row.id), reason)
  reload()
  if (result.ok) {
    noticeMessage.value = result.message
  } else {
    errorMessage.value = result.message
  }
}

function openDetail(row: EntryRow) {
  detailRow.value = row
  leakageDraft.value = String(row['泄漏电流'] ?? '')
  leakageSavedTip.value = ''
}

function closeDetail() {
  detailRow.value = null
  leakageSavedTip.value = ''
}

function syncDetail() {
  if (!detailRow.value) {
    return
  }
  const latest = rows.value.find((row) => Number(row.id) === Number(detailRow.value?.id))
  const full = preparedRows.value.find((row) => Number(row.id) === Number(detailRow.value?.id))
  detailRow.value = latest ?? full ?? null
}

function saveLeakage() {
  if (!detailRow.value) {
    return
  }
  const result = updateLeakageCurrent(Number(detailRow.value.id), leakageDraft.value)
  if (result.ok) {
    errorMessage.value = ''
    saveCursor(filters.value, shown.value)
    reload()
    leakageSavedTip.value = result.message
  } else {
    leakageSavedTip.value = ''
    errorMessage.value = result.message
  }
}

onMounted(reload)
</script>

<style scoped>
.spec-box {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 13px;
}
.spec-box summary {
  cursor: pointer;
  font-weight: 600;
}
.spec-table {
  width: 100%;
  margin-top: 8px;
  border-collapse: collapse;
}
.spec-table th,
.spec-table td {
  border: 1px solid var(--border);
  padding: 6px 8px;
  font-size: 12px;
  text-align: left;
}
.missing-tag {
  color: #b42318;
  font-size: 12px;
}
.missing-badge {
  display: inline-block;
  background: #fef3f2;
  color: #b42318;
  border: 1px solid #fda29b;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
}
.complete-badge {
  color: #027a48;
  font-size: 12px;
}
.row-incomplete {
  background: #fffcf5;
}
.reason-text {
  margin: 2px 0 0;
  color: #b42318;
  font-size: 12px;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-bad {
  color: #b42318;
  font-weight: 600;
}
.link.danger {
  color: #b42318;
}
.notice-text {
  color: #027a48;
  font-size: 12px;
  margin: 0 0 8px;
}
.ok-text {
  color: #027a48;
}
.load-more {
  margin-top: 10px;
  text-align: center;
}
.btn.small {
  padding: 3px 8px;
  font-size: 12px;
}
.detail-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.detail-panel {
  width: 640px;
  max-height: 82vh;
  overflow-y: auto;
  background: #fff;
  border-radius: 10px;
  padding: 16px 18px;
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail-head h3 {
  margin: 0;
  font-size: 15px;
}
.detail-list {
  margin: 12px 0;
}
.detail-item {
  display: flex;
  gap: 12px;
  border-bottom: 1px dashed var(--border);
  padding: 6px 0;
  font-size: 13px;
}
.detail-item dt {
  width: 96px;
  color: var(--muted);
  flex-shrink: 0;
}
.detail-item dd {
  margin: 0;
  flex: 1;
}
.leakage-input {
  width: 160px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  margin-right: 6px;
}
.verdict-text {
  font-size: 13px;
}
.detail-foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
</style>
