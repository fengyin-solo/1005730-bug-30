import { listProtectionTodos, saveProtectionTodos } from '@/data/local-store'
import type { ProtectionTodo } from '@/data/types'

export function listTodos(): ProtectionTodo[] {
  return listProtectionTodos()
}

export function pendingTodos(): ProtectionTodo[] {
  return listProtectionTodos().filter((todo) => !todo.done)
}

/** 绝缘试验判不合格时调用：同一试验编号只挂一条待办，避免重复点击堆一串。 */
export function addFailureTodo(input: {
  equipment: string
  testNo: string
  sourceId: number
  reason: string
}): ProtectionTodo {
  const todos = listProtectionTodos()
  const existed = todos.find((todo) => todo.sourceModule === 'insulationtest' && todo.testNo === input.testNo)
  if (existed) {
    if (existed.done || existed.reason !== input.reason) {
      existed.done = false
      existed.reason = input.reason
      saveProtectionTodos([...todos])
    }
    return existed
  }
  const todo: ProtectionTodo = {
    id: todos.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    sourceModule: 'insulationtest',
    sourceId: input.sourceId,
    equipment: input.equipment,
    testNo: input.testNo,
    reason: input.reason,
    createdAt: new Date().toISOString().slice(0, 10),
    done: false,
  }
  saveProtectionTodos([...todos, todo])
  return todo
}

export function resolveTodo(id: number): boolean {
  const todos = listProtectionTodos()
  const index = todos.findIndex((todo) => todo.id === id)
  if (index < 0) return false
  todos[index] = { ...todos[index], done: true }
  saveProtectionTodos([...todos])
  return true
}
