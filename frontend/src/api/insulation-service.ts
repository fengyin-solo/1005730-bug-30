import { filterRows, moduleMeta, runAction as genericRunAction } from '@/api/local-service'
import { addFailureTodo } from '@/api/protection-todo'
import { evaluateInsulation } from '@/data/insulation-spec'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

const KEY = 'insulationtest'
// 断点续翻游标存在本机：翻到一半离开，再回来从上次的条数接着展示，不用从第一页重来。
const CURSOR_KEY = 'substation-protection:insulationtest:cursor:v1'
export const PAGE_SIZE = 5

// 缺项分两类提示：试验设备类 / 试验结论类；读数列空了也单独点出来，避免「整条藏起来」。
export type MissingKind = '试验设备' | '试验结论' | '试验读数'

export type MissingTag = {
  field: string
  kind: MissingKind
}

const KIND_BY_FIELD: Record<string, MissingKind> = {
  试验设备: '试验设备',
  试验结论: '试验结论',
  试验电压: '试验读数',
  泄漏电流: '试验读数',
}

/** 参与完整性核对的必填字段：行内为空就点出缺的是哪一项。 */
export const REQUIRED_FIELDS = ['试验设备', '试验项目', '试验电压', '泄漏电流', '试验人', '试验日期', '试验结论']

export function meta() {
  return moduleMeta(KEY)
}

export function isBlank(row: EntryRow, field: string): boolean {
  return String(row[field] ?? '').trim() === ''
}

export function missingTags(row: EntryRow): MissingTag[] {
  return REQUIRED_FIELDS.filter((field) => isBlank(row, field)).map((field) => ({
    field,
    kind: KIND_BY_FIELD[field] ?? '试验设备',
  }))
}

/**
 * 同一台设备报了两次：只留最早那条。
 * 先按试验日期（同日按记录编号）升序排，再用设备名去重。
 */
export function dedupeByEquipment(rows: EntryRow[]): { rows: EntryRow[]; removed: EntryRow[] } {
  const ordered = [...rows].sort((a, b) => {
    const dateA = String(a['试验日期'] ?? '')
    const dateB = String(b['试验日期'] ?? '')
    if (dateA !== dateB) return dateA < dateB ? -1 : 1
    return Number(a.id) - Number(b.id)
  })
  const seen = new Set<string>()
  const kept: EntryRow[] = []
  const removed: EntryRow[] = []
  for (const row of ordered) {
    const equipment = String(row['试验设备'] ?? '').trim()
    if (equipment === '') {
      kept.push(row)
      continue
    }
    if (seen.has(equipment)) {
      removed.push(row)
      continue
    }
    seen.add(equipment)
    kept.push(row)
  }
  return { rows: kept, removed }
}

function readCursor(): number {
  if (typeof window === 'undefined' || !window.localStorage) return PAGE_SIZE
  const raw = window.localStorage.getItem(CURSOR_KEY)
  const value = raw === null ? PAGE_SIZE : Number(raw)
  return Number.isFinite(value) && value >= PAGE_SIZE ? value : PAGE_SIZE
}

function writeCursor(value: number): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(CURSOR_KEY, String(value))
  }
}

export function resetCursor(): void {
  writeCursor(PAGE_SIZE)
}

export type InsulationPage = PageResult & {
  removedCount: number
}

/** 统计口径也走去重后的全量名册，不被当前翻页截断影响。 */
export function insulationStats(): Record<string, number> {
  const { rows } = dedupeByEquipment(listRows(KEY))
  const counts: Record<string, number> = {}
  for (const row of rows) {
    const status = String(row.status)
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

/**
 * 绝缘试验名册读取：筛选 → 去重排序 → 按断点游标截断。
 * 字段不全的记录照样保留，缺什么由页面照 missingTags 点出来。
 */
export function listInsulation(filters: Record<string, string> = {}): InsulationPage {
  const filtered = filterRows(listRows(KEY), filters)
  const { rows: deduped, removed } = dedupeByEquipment(filtered)

  const total = deduped.length
  // 数据可能因继续去重而变少，游标要夹回合法范围。
  const cursor = Math.min(Math.max(readCursor(), PAGE_SIZE), Math.max(total, PAGE_SIZE))
  if (cursor !== readCursor()) writeCursor(cursor)

  const visible = Math.min(cursor, total)
  const items = deduped.slice(0, visible)
  return {
    items,
    total,
    rawTotal: filtered.length,
    removedCount: removed.length,
    page: 1,
    size: PAGE_SIZE,
    visible,
    cursor,
    hasMore: visible < total,
  }
}

/** 接着断点往下翻一页：游标推进后返回追加展示所需的新名册。 */
export function loadMoreInsulation(filters: Record<string, string> = {}): InsulationPage {
  const filtered = filterRows(listRows(KEY), filters)
  const { rows: deduped } = dedupeByEquipment(filtered)
  const next = Math.min(readCursor() + PAGE_SIZE, Math.max(deduped.length, PAGE_SIZE))
  writeCursor(next)
  return listInsulation(filters)
}

function persistRow(updated: EntryRow): void {
  const rows = listRows(KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(updated.id))
  if (index < 0) return
  const next = [...rows]
  next[index] = updated
  saveRows(KEY, next)
}

/** 提交试验：读数没填全先拦住，提示缺的是试验电压还是泄漏电流。 */
export function submitTest(row: EntryRow): ActionResult {
  const missing: string[] = []
  if (isBlank(row, '试验电压')) missing.push('试验电压')
  if (isBlank(row, '泄漏电流')) missing.push('泄漏电流')
  if (isBlank(row, '试验设备')) missing.push('试验设备')
  if (missing.length) {
    return { ok: false, message: `读数不完整，缺少：${missing.join('、')}，无法提交试验` }
  }
  return genericRunAction(KEY, Number(row.id), '提交试验')
}

/**
 * 判定合格：仍按试验电压与泄漏电流的技术要求核对。
 * 读数超范围的不能判合格，直接说明原因。
 */
export function judgePass(row: EntryRow): ActionResult {
  const verdict = evaluateInsulation(String(row['试验项目'] ?? ''), row['试验电压'], row['泄漏电流'])
  if (verdict.pass === null) {
    const missing = [
      isBlank(row, '试验电压') ? '试验电压' : '',
      isBlank(row, '泄漏电流') ? '泄漏电流' : '',
    ].filter(Boolean)
    return {
      ok: false,
      message: missing.length
        ? `无法判定：缺少${missing.join('、')}读数`
        : `无法判定：试验项目「${String(row['试验项目'] ?? '')}」未登记技术要求`,
    }
  }
  if (!verdict.pass) {
    return { ok: false, message: `技术要求核对未通过：${verdict.reasons.join('；')}` }
  }
  const result = genericRunAction(KEY, Number(row.id), '判定合格')
  if (!result.ok) return result
  persistRow({
    ...listRows(KEY).find((item) => Number(item.id) === Number(row.id))!,
    试验结论: '合格',
    判定原因: '',
  })
  return { ok: true, message: '技术要求核对通过，已判定合格' }
}

/**
 * 判定不合格：技术要求核对给出原因；即使读数没超范围，也允许人工标记，但要写明原因。
 * 判成之后在保护装置台账待办清单挂一条，数据落到本机那份 localStorage。
 */
export function judgeFail(row: EntryRow, manualReason = ''): ActionResult {
  const verdict = evaluateInsulation(String(row['试验项目'] ?? ''), row['试验电压'], row['泄漏电流'])
  const reason = verdict.pass === false ? verdict.reasons.join('；') : manualReason.trim()
  if (!reason) {
    return { ok: false, message: '判为不合格需要说明原因（读数未超技术要求时请填写人工判定原因）' }
  }
  const result = genericRunAction(KEY, Number(row.id), '标记不合格')
  if (!result.ok) return result
  const saved = listRows(KEY).find((item) => Number(item.id) === Number(row.id))
  if (saved) {
    persistRow({ ...saved, 试验结论: '不合格', 判定原因: reason, abnormal: true })
  }
  addFailureTodo({
    equipment: String(row['试验设备'] ?? '未登记设备'),
    testNo: String(row['试验编号'] ?? `#${row.id}`),
    sourceId: Number(row.id),
    reason,
  })
  return { ok: true, message: `已判定不合格：${reason}；保护装置台账待办清单已新增一条跟踪项` }
}
