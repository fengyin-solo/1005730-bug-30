/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
  /** 去重前的原始记录数；只有需要去重的模块（如绝缘试验）才会和 total 不同。 */
  rawTotal?: number
  /** 截断后本次实际返回的条数，调用方据此判断还能不能继续往后翻。 */
  visible?: number
  /** 断点续翻的游标：下次请求从这个下标继续，不用从头来。 */
  cursor?: number
  hasMore?: boolean
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 保护装置台账侧的待办：绝缘试验判不合格后自动挂一条过来。 */
export type ProtectionTodo = {
  id: number
  sourceModule: string
  sourceId: number
  equipment: string
  testNo: string
  reason: string
  createdAt: string
  done: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
