import {
  evaluateInsulation,
  missingFields,
  prepareInsulationRows,
} from '@/data/insulation'
import { listRows, saveRows } from '@/data/local-store'
import { upsertProtectionTodo } from '@/data/protection-todo-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { filterRows } from './local-service'

export const INSULATION_KEY = 'insulationtest'
export const INSULATION_PAGE_SIZE = 5

// 翻页断点按筛选条件分别记住：列表从半路截断后，再进来从断点继续，不从头翻。
const CURSOR_STORAGE_KEY = 'substation-protection:insulation-cursor'

function filterSignature(filters: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(filters)
      .sort()
      .map((key) => [key, filters[key].trim()]),
  )
}

function readCursor(filters: Record<string, string>): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 0
  }
  try {
    const raw = window.localStorage.getItem(CURSOR_STORAGE_KEY)
    if (!raw) {
      return 0
    }
    const parsed = JSON.parse(raw) as { signature: string; cursor: number }
    if (parsed.signature !== filterSignature(filters)) {
      return 0
    }
    return Number.isFinite(parsed.cursor) ? Math.max(0, Math.floor(parsed.cursor)) : 0
  } catch {
    return 0
  }
}

export function saveCursor(filters: Record<string, string>, cursor: number): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(
    CURSOR_STORAGE_KEY,
    JSON.stringify({ signature: filterSignature(filters), cursor }),
  )
}

export function resetCursor(filters: Record<string, string> = {}): void {
  saveCursor(filters, 0)
}

export type InsulationListResult = {
  items: EntryRow[]
  prepared: EntryRow[]
  total: number
  shown: number
  hasMore: boolean
  resumed: boolean
}

function buildResult(
  filters: Record<string, string>,
  prepared: EntryRow[],
  cursor: number,
  resumed: boolean,
): InsulationListResult {
  const safeCursor = Math.min(cursor, prepared.length)
  const items = prepared.slice(0, safeCursor)
  return {
    items,
    prepared,
    total: prepared.length,
    shown: items.length,
    hasMore: safeCursor < prepared.length,
    resumed,
  }
}

// 首次进入：接着上次断点往下展示；断点不再有效（筛选变了/数据变少）时从头来。
export function loadInsulation(filters: Record<string, string> = {}): InsulationListResult {
  const matched = filterRows(listRows(INSULATION_KEY), filters)
  const prepared = prepareInsulationRows(matched)
  const stored = readCursor(filters)
  const cursor = stored === 0 ? INSULATION_PAGE_SIZE : stored
  return buildResult(filters, prepared, cursor, stored > 0)
}

export function loadMoreInsulation(
  filters: Record<string, string>,
  currentShown: number,
): InsulationListResult {
  const matched = filterRows(listRows(INSULATION_KEY), filters)
  const prepared = prepareInsulationRows(matched)
  const cursor = Math.min(currentShown + INSULATION_PAGE_SIZE, prepared.length)
  saveCursor(filters, cursor)
  return buildResult(filters, prepared, cursor, false)
}

function updateRow(id: number, patch: Partial<EntryRow>): { row: EntryRow } | ActionResult {
  const rows = listRows(INSULATION_KEY)
  const index = rows.findIndex((item) => Number(item.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const updated: EntryRow = { ...rows[index], ...patch } as EntryRow
  const next = [...rows]
  next[index] = updated
  saveRows(INSULATION_KEY, next)
  return { row: updated }
}

// 泄漏电流在试验列表与明细面板两处共用同一份读数：只改存储，两边都从这里取。
export function updateLeakageCurrent(id: number, value: string): ActionResult {
  const trimmed = value.trim()
  if (!trimmed) {
    return { ok: false, message: '泄漏电流不能为空，不填写会导致记录缺项' }
  }
  const result = updateRow(id, { 泄漏电流: trimmed })
  if ('ok' in result) {
    return result
  }
  return { ok: true, message: '泄漏电流读数已保存，列表与明细面板读到的是同一份' }
}

function raiseUnqualifiedTodo(row: EntryRow, reason: string): void {
  upsertProtectionTodo({
    source: 'insulationtest',
    sourceId: Number(row.id),
    title: `绝缘试验不合格待复核：${String(row['试验设备'] ?? '未登记设备')}`,
    device: String(row['试验设备'] ?? ''),
    serial: String(row['试验编号'] ?? ''),
    detail: `试验项目：${String(row['试验项目'] ?? '')}；试验日期：${String(row['试验日期'] ?? '')}`,
    reason,
    createdAt: new Date().toISOString(),
  })
}

// 按试验电压与泄漏电流的技术要求核定：超范围直接判不合格并写明原因，同时挂待办。
export function evaluateInsulationEntry(id: number): ActionResult {
  const rows = listRows(INSULATION_KEY)
  const target = rows.find((row) => Number(row.id) === id)
  if (!target) {
    return { ok: false, message: `没有找到编号为 ${id} 的试验记录` }
  }
  const missing = missingFields(target)
  if (missing.length > 0) {
    return { ok: false, message: `记录字段不全（缺少：${missing.join('、')}），补齐后才能核定` }
  }
  const verdict = evaluateInsulation(target)
  if (verdict.pass) {
    const result = updateRow(id, {
      status: '试验合格',
      pending: false,
      abnormal: false,
      试验结论: '合格（按技术要求核定）',
      不合格原因: '',
    })
    if ('ok' in result) {
      return result
    }
    return {
      ok: true,
      message: `核定合格：${verdict.spec.basis}；实测 ${verdict.voltageKv}kV / ${verdict.leakageUa}μA`,
    }
  }
  const reason = verdict.reasons.join('；')
  const result = updateRow(id, {
    status: '试验不合格',
    pending: false,
    abnormal: true,
    试验结论: '不合格（按技术要求核定）',
    不合格原因: reason,
  })
  if ('ok' in result) {
    return result
  }
  raiseUnqualifiedTodo(result.row, reason)
  return { ok: false, message: `核定不通过，已判为不合格并通知保护装置台账：${reason}` }
}

// 手动标记不合格同样要说明原因，并联动保护装置台账待办。
export function markInsulationUnqualified(id: number, reason: string): ActionResult {
  const trimmed = reason.trim()
  if (!trimmed) {
    return { ok: false, message: '标记不合格必须填写原因' }
  }
  const result = updateRow(id, {
    status: '试验不合格',
    pending: false,
    abnormal: true,
    不合格原因: trimmed,
  })
  if ('ok' in result) {
    return result
  }
  raiseUnqualifiedTodo(result.row, trimmed)
  return { ok: true, message: '已标记为试验不合格，保护装置台账待办清单已新增一条' }
}
