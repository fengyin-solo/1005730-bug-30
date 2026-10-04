import type { ProtectionTodo } from './types'

// 保护装置台账待办：独立于业务清单存一份，刷新、重开页面都还在。
const TODO_STORAGE_KEY = 'substation-protection:protection-todos'

function readStorage(): ProtectionTodo[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  const raw = window.localStorage.getItem(TODO_STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as ProtectionTodo[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let cache: ProtectionTodo[] | null = null

function allTodos(): ProtectionTodo[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

function persist(todos: ProtectionTodo[]): void {
  cache = todos
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(TODO_STORAGE_KEY, JSON.stringify(todos))
  }
}

export function listProtectionTodos(status?: ProtectionTodo['status']): ProtectionTodo[] {
  const todos = allTodos()
  const sorted = [...todos].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return status ? sorted.filter((todo) => todo.status === status) : sorted
}

export function openProtectionTodoCount(): number {
  return allTodos().filter((todo) => todo.status === '待处理').length
}

// 同一条不合格试验记录只挂一条待办：已办结过的再次判不合格时重新打开。
export function upsertProtectionTodo(input: Omit<ProtectionTodo, 'id' | 'status'>): ProtectionTodo {
  const todos = allTodos()
  const existing = todos.find(
    (todo) => todo.source === input.source && todo.sourceId === input.sourceId,
  )
  if (existing) {
    const reopened: ProtectionTodo = { ...existing, ...input, status: '待处理' }
    persist(todos.map((todo) => (todo.id === existing.id ? reopened : todo)))
    return reopened
  }
  const created: ProtectionTodo = {
    ...input,
    id: todos.reduce((max, todo) => Math.max(max, todo.id), 0) + 1,
    status: '待处理',
  }
  persist([...todos, created])
  return created
}

export function closeProtectionTodo(id: number): ProtectionTodo | null {
  const todos = allTodos()
  const target = todos.find((todo) => todo.id === id)
  if (!target) {
    return null
  }
  const updated: ProtectionTodo = { ...target, status: '已办结' }
  persist(todos.map((todo) => (todo.id === id ? updated : todo)))
  return updated
}
