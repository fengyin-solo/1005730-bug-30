<template>
  <section class="page" data-module="insulationtest">
    <header class="page-head">
      <div>
        <h2>绝缘试验管理</h2>
        <p class="page-desc">维护试验记录，围绕试验编号、试验设备、试验项目、试验电压做登记、筛选与状态流转。字段不全的记录照样保留，缺哪一项在行内点出。</p>
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

    <details class="spec-panel">
      <summary>试验电压与泄漏电流技术要求</summary>
      <table class="data-table spec-table">
        <thead>
          <tr>
            <th>试验项目</th>
            <th>额定试验电压(kV)</th>
            <th>允许电压区间(kV)</th>
            <th>泄漏电流上限(μA)</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="spec in specs" :key="spec.item">
            <td>{{ spec.item }}</td>
            <td>{{ spec.ratedVoltage }}</td>
            <td>{{ spec.voltageMin }} ~ {{ spec.voltageMax }}</td>
            <td>{{ spec.leakageLimit }}</td>
            <td>{{ spec.note }}</td>
          </tr>
        </tbody>
      </table>
    </details>

    <form class="filter-bar" @submit.prevent="search">
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
          <th>缺项提示</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'is-failed': row.status === '试验不合格' }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '泄漏电流'">
              <button class="link" type="button" @click="openDetail(row)">{{ formatLeakage(row) }}</button>
            </template>
            <template v-else-if="column === '试验结论'">
              <span v-if="verdictOf(row).pass === false" class="tag tag-fail">不合格</span>
              <span v-else-if="verdictOf(row).pass === true" class="tag tag-pass">合格</span>
              <span v-else-if="isBlankCell(row, column)" class="cell-missing">缺试验结论</span>
              <span v-else>{{ row[column] }}</span>
            </template>
            <template v-else-if="column === '判定原因'">
              <span v-if="row[column]">{{ row[column] }}</span>
              <span v-else-if="verdictOf(row).pass === false" class="hint-text">{{ verdictOf(row).reasons.join('；') }}</span>
              <span v-else>—</span>
            </template>
            <template v-else>
              <span v-if="isBlankCell(row, column)" class="cell-missing">缺{{ column }}</span>
              <span v-else>{{ row[column] }}</span>
            </template>
          </td>
          <td>
            <span :class="['status-pill', row.status === '试验不合格' ? 'status-fail' : '']">{{ row.status }}</span>
          </td>
          <td class="missing-cell">
            <template v-if="missingOf(row).length">
              <span
                v-for="tag in missingOf(row)"
                :key="tag.field"
                :class="['tag', tagClass(tag.kind)]"
                :title="`该项属于${tag.kind}，请补录`"
              >缺{{ tag.field }}（{{ tag.kind }}）</span>
            </template>
            <span v-else class="tag tag-ok">字段完整</span>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="runAction('提交试验', row)">提交试验</button>
            <button class="link" type="button" @click="runAction('判定合格', row)">判定合格</button>
            <button class="link fail-link" type="button" @click="runAction('标记不合格', row)">标记不合格</button>
            <button class="link" type="button" @click="openDetail(row)">查看明细</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">
            {{ emptyText }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot load-foot">
      <span>
        共 {{ total }} 条绝缘试验记录
        <template v-if="removedCount > 0">（已按同台设备去重 {{ removedCount }} 条重复记录，只留最早那条）</template>
        <template v-if="visible < total">，当前展示 {{ visible }} 条</template>
      </span>
      <span v-if="hasMore" class="resume-hint">已记住断点，可接着往下翻</span>
      <button v-if="hasMore" class="btn primary" type="button" @click="loadMore">继续往后看（再载 {{ PAGE_SIZE }} 条）</button>
      <span v-else-if="total > PAGE_SIZE" class="resume-hint">已到名册末尾</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="detail" class="detail-mask" @click.self="closeDetail">
      <section class="detail-panel" role="dialog" aria-modal="true" aria-label="绝缘试验明细">
        <header class="detail-head">
          <h3>试验明细 · {{ detail['试验编号'] }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <dl class="detail-grid">
          <template v-for="field in detailFields" :key="field">
            <dt>{{ field }}</dt>
            <dd :class="{ 'cell-missing': isBlankCell(detail, field) }">
              {{ isBlankCell(detail, field) ? `缺${field}` : detail[field] }}
            </dd>
          </template>
          <dt>当前状态</dt>
          <dd>{{ detail.status }}</dd>
        </dl>
        <div class="detail-verdict">
          <p v-for="line in verdictLines(detail)" :key="line" :class="line.startsWith('不合格') ? 'fail-text' : 'hint-text'">
            {{ line }}
          </p>
        </div>
        <label class="manual-reason">
          <span>人工判定原因（读数未超技术要求、仍需标记不合格时填写）</span>
          <textarea v-model="manualReason" rows="2" placeholder="例如：外观异常、环境湿度超标，结合经验判不合格"></textarea>
        </label>
        <footer class="detail-actions">
          <button class="btn" type="button" @click="runAction('提交试验', detail)">提交试验</button>
          <button class="btn primary" type="button" @click="runAction('判定合格', detail)">判定合格</button>
          <button class="btn fail-btn" type="button" @click="runAction('标记不合格', detail)">标记不合格</button>
        </footer>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  PAGE_SIZE,
  insulationStats,
  judgeFail,
  judgePass,
  listInsulation,
  loadMoreInsulation,
  meta,
  missingTags,
  resetCursor,
  submitTest,
  type MissingKind,
} from '@/api/insulation-service'
import { INSULATION_SPECS, evaluateInsulation, parseMicroAmp } from '@/data/insulation-spec'
import type { EntryRow } from '@/data/types'

const moduleMeta = meta()
const columns = ['试验编号', '试验设备', '试验项目', '试验电压', '泄漏电流', '试验人', '试验日期', '试验结论', '判定原因']
const detailFields = columns
const statuses = ['待试验', '试验中', '试验合格', '试验不合格']
const specs = INSULATION_SPECS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const visible = ref(0)
const removedCount = ref(0)
const hasMore = ref(false)
const everHadData = ref(true)
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const detail = ref<EntryRow | null>(null)
const manualReason = ref('')

const stats = computed(() => {
  const counts = insulationStats()
  return [
    { label: '待试验设备', value: counts['待试验'] ?? 0 },
    { label: '试验合格设备', value: counts['试验合格'] ?? 0 },
    { label: '试验不合格设备', value: counts['试验不合格'] ?? 0 },
  ]
})

const statusSummary = computed(() => {
  const counts = insulationStats()
  return statuses.map((status) => ({ status, count: counts[status] ?? 0 }))
})

const emptyText = computed(() =>
  everHadData.value
    ? '当前筛选条件下没有可看的记录，可调整查询条件或重置后再看'
    : '没有可看的记录：绝缘试验名册为空，可先登记试验记录',
)

function isBlankCell(row: EntryRow, field: string): boolean {
  return String(row[field] ?? '').trim() === ''
}

function missingOf(row: EntryRow) {
  return missingTags(row)
}

function tagClass(kind: MissingKind): string {
  if (kind === '试验设备') return 'tag-equip'
  if (kind === '试验结论') return 'tag-conclusion'
  return 'tag-reading'
}

function verdictOf(row: EntryRow) {
  return evaluateInsulation(String(row['试验项目'] ?? ''), row['试验电压'], row['泄漏电流'])
}

// 泄漏电流在列表与明细两处共用同一份读数：都取自该行 record，不做第二份拷贝。
function formatLeakage(row: EntryRow): string {
  if (isBlankCell(row, '泄漏电流')) return '缺泄漏电流'
  const value = parseMicroAmp(row['泄漏电流'])
  return value === null ? String(row['泄漏电流']) : `${value} μA`
}

function verdictLines(row: EntryRow): string[] {
  const verdict = verdictOf(row)
  if (!verdict.spec) {
    return [`试验项目「${String(row['试验项目'] ?? '')}」未登记技术要求，暂不能自动核对`]
  }
  const lines = [
    `技术要求：试验电压 ${verdict.spec.voltageMin}~${verdict.spec.voltageMax}kV，泄漏电流≤${verdict.spec.leakageLimit}μA`,
    `本次读数：试验电压 ${verdict.voltageKv === null ? '缺失' : `${verdict.voltageKv}kV`}，泄漏电流 ${verdict.leakageUa === null ? '缺失' : `${verdict.leakageUa}μA`}`,
  ]
  if (verdict.pass === null) {
    lines.push('读数不全，暂不判定，补全试验电压与泄漏电流后再核对')
  } else if (verdict.pass) {
    lines.push('合格：试验电压与泄漏电流均在技术要求范围内')
  } else {
    lines.push(`不合格：${verdict.reasons.join('；')}`)
  }
  return lines
}

function applyPayload(payload: ReturnType<typeof listInsulation>) {
  rows.value = payload.items
  total.value = payload.total
  visible.value = payload.visible ?? payload.items.length
  removedCount.value = payload.removedCount
  hasMore.value = payload.hasMore ?? false
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listInsulation(filters)
    everHadData.value = (payload.rawTotal ?? payload.total) > 0
    applyPayload(payload)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '绝缘试验列表读取失败'
  }
}

function search() {
  // 换了筛选条件等于重新看一份名册：断点回到开头。
  resetCursor()
  reload()
}

function resetFilters() {
  for (const key of Object.keys(filters)) delete filters[key]
  resetCursor()
  reload()
}

function loadMore() {
  errorMessage.value = ''
  try {
    applyPayload(loadMoreInsulation(filters))
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '继续读取失败'
  }
}

function exportRows() {
  downloadEntries(moduleMeta.key)
}

function openCreate() {
  errorMessage.value = '试验记录登记入口尚未接入审批流'
}

function openDetail(row: EntryRow) {
  // 明细直接引用名册里的同一行对象；判定刷新后重读，列表和明细看到的泄漏电流永远一致。
  detail.value = row
  manualReason.value = ''
}

function closeDetail() {
  detail.value = null
}

const ACTION_HANDLERS = {
  提交试验: submitTest,
  判定合格: judgePass,
  标记不合格: (row: EntryRow) => judgeFail(row, manualReason.value),
} as const

function runAction(action: keyof typeof ACTION_HANDLERS, row: EntryRow) {
  errorMessage.value = ''
  const result = ACTION_HANDLERS[action](row)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
  if (detail.value && Number(detail.value.id) === Number(row.id)) {
    const fresh = rows.value.find((item) => Number(item.id) === Number(row.id))
    detail.value = fresh ?? null
  }
}

onMounted(reload)
</script>
