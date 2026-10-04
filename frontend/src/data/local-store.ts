import { SEED_PROTECTION_TODOS, SEED_ROWS } from './seed'
import type { EntryRow, ProtectionTodo } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
// 升到 v2：绝缘试验的种子数据结构换过（补判定原因、缺项与重复样本），旧缓存对不上，重新播种。
const STORAGE_KEY = 'substation-protection:entries:v2'
const TODO_STORAGE_KEY = 'substation-protection:protection-todos:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 以种子为底，缓存里已有的模块覆盖之，保证后加的模块也有数据。
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null
let todoCache: ProtectionTodo[] | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 保护装置待办单独一份存储：绝缘试验判不合格往这里追加，办结在保护装置台账页操作。
export function listProtectionTodos(): ProtectionTodo[] {
  if (todoCache === null) {
    todoCache = readJSON<ProtectionTodo[]>(TODO_STORAGE_KEY, clone(SEED_PROTECTION_TODOS))
  }
  return todoCache
}

export function saveProtectionTodos(todos: ProtectionTodo[]): void {
  todoCache = todos
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos))
  }
}
