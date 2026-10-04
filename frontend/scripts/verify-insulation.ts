// 临时验证脚本：用内存 localStorage 跑绝缘试验数据层
import { listInsulation, loadMoreInsulation, resetCursor, missingTags, judgeFail, judgePass, submitTest, insulationStats } from '@/api/insulation-service'
import { listRows } from '@/data/local-store'
import { evaluateInsulation } from '@/data/insulation-spec'
import { listTodos, pendingTodos, resolveTodo } from '@/api/protection-todo'

let store: Record<string, string> = {}
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
  },
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 }
  else console.log('ok:', msg)
}

// 1. 缺项记录仍保留，且指出缺什么
resetCursor()
let page = listInsulation()
const incomplete = page.items.find((r) => r['试验编号'] === 'INSU-0001')!
assert(!!incomplete, '缺电压/电流/结论的记录仍在名册')
const tags = missingTags(incomplete).map((t) => `${t.field}:${t.kind}`)
assert(tags.includes('试验电压:试验读数') && tags.includes('泄漏电流:试验读数') && tags.includes('试验结论:试验结论'), `缺项分类正确: ${tags.join(',')}`)
const noEquip = listRows('insulationtest').find((r) => r['试验编号'] === 'INSU-0005')!
assert(missingTags(noEquip).some((t) => t.field === '试验设备' && t.kind === '试验设备'), '缺试验设备标成试验设备类')

// 2. 同台设备去重，只留最早（INSU-0001 09-01 保留，INSU-0007 09-08 去掉）
assert(page.removedCount >= 1, `去重计数: ${page.removedCount}`)
const allAfterDedupe = [...page.items]
assert(!allAfterDedupe.find((r) => r['试验编号'] === 'INSU-0007'), '重复的 INSU-0007 被去掉')
assert(!!allAfterDedupe.find((r) => r['试验编号'] === 'INSU-0001'), '最早的 INSU-0001 保留')
assert(page.total === 13 && page.rawTotal === 15, `去重后 13 条/原始 15 条 (got ${page.total}/${page.rawTotal})`)

// 3. 分页截断 + 断点续翻
assert(page.items.length === 5 && page.hasMore === true, `首页截断 5 条 (got ${page.items.length})`)
page = loadMoreInsulation()
assert(page.items.length === 10, '第二次接着断点到 10 条')
const cursorStored = JSON.parse(JSON.stringify(store))
page = loadMoreInsulation()
assert(page.items.length === 13 && page.hasMore === false, '第三次到末尾 13 条')
// 重新打开页面：游标仍在，不用从头翻
const reopened = listInsulation()
assert(reopened.items.length === 13, `重开页面从断点恢复 13 条 (got ${reopened.items.length})`)

// 4. 技术要求核对
const overLeak = evaluateInsulation('电力电缆（10kV）', '28.0', '35')
assert(overLeak.pass === false && overLeak.reasons[0].includes('泄漏电流35μA超出技术要求上限30μA'), '泄漏电流超限判不合格并说明原因')
const overVolt = evaluateInsulation('电力电缆（10kV）', '30.5', '28')
assert(overVolt.pass === false && overVolt.reasons[0].includes('试验电压30.5kV超出技术要求上限30kV'), '试验电压超限判不合格')
const lowVolt = evaluateInsulation('主变绕组（220kV）', '70', '10')
assert(lowVolt.pass === false && lowVolt.reasons[0].includes('低于技术要求下限'), '电压偏低判不合格')
const good = evaluateInsulation('主变绕组（220kV）', '90', '18')
assert(good.pass === true, '范围内判合格')
const missing = evaluateInsulation('主变绕组（220kV）', '', '18')
assert(missing.pass === null, '读数缺时不下结论')
// 单位解析
assert(evaluateInsulation('电力电缆（10kV）', '30000V', '0.035mA').pass === false, 'V/mA 单位自动换算')

// 5. 动作流转
const row14 = listRows('insulationtest').find((r) => r['试验编号'] === 'INSU-0014')!
const blockedPass = judgePass(row14)
assert(!blockedPass.ok && blockedPass.message.includes('试验电压30.5kV'), `超范围不能判合格: ${blockedPass.message}`)
const todosBefore = pendingTodos().length
const failRes = judgeFail(row14)
assert(failRes.ok && failRes.message.includes('保护装置台账待办清单已新增'), `判不合格: ${failRes.message}`)
const todosAfter = pendingTodos()
assert(todosAfter.length === todosBefore + 1, `保护台账待办 +1 (${todosBefore} -> ${todosAfter.length})`)
const newTodo = todosAfter.find((t) => t.testNo === 'INSU-0014')!
assert(!!newTodo && newTodo.reason.includes('试验电压30.5kV'), '待办带设备与原因')
// 重复判不产生重复待办
judgeFail(row14, '')
assert(pendingTodos().length === todosAfter.length, '重复判不合格不重复挂待办')
// 办结
assert(resolveTodo(newTodo.id) && pendingTodos().length === todosAfter.length - 1, '可办结')
// 缺读数提交被拦
const row1 = listRows('insulationtest').find((r) => r['试验编号'] === 'INSU-0001')!
const submitBlocked = submitTest(row1)
assert(!submitBlocked.ok && submitBlocked.message.includes('试验电压') && submitBlocked.message.includes('泄漏电流'), `缺读数提交被拦: ${submitBlocked.message}`)
// 人工判不合格必须写原因
const row11 = listRows('insulationtest').find((r) => r['试验编号'] === 'INSU-0011')!
const manualEmpty = judgeFail(row11, '  ')
assert(!manualEmpty.ok, '读数未超时人工判不合格需写原因')
const manualOk = judgeFail(row11, '环境湿度过高，结合外观异常判不合格')
assert(manualOk.ok, '有原因可人工判不合格')

// 6. 统计
const counts = insulationStats()
assert(counts['试验不合格'] >= 3, `不合格统计: ${counts['试验不合格']}`)

// 7. 持久化：关掉重开读到的还是改过的数据
const saved = JSON.parse(store[Object.keys(store).find((k) => k.includes('entries'))!])
const saved14 = saved.insulationtest.find((r: any) => r.id === 14)
assert(saved14['试验结论'] === '不合格' && saved14['判定原因'].includes('30.5kV'), '判定结果落进本地存储')
const todosStored = JSON.parse(store[Object.keys(store).find((k) => k.includes('protection-todos'))!])
assert(todosStored.some((t: any) => t.testNo === 'INSU-0014'), '待办也在本地存储')

console.log('total todos:', listTodos().length)
