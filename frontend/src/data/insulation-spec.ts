// 绝缘试验技术要求：试验电压必须落在区间内、泄漏电流不得超过上限。
// 单位约定：试验电压 kV，泄漏电流 μA；页面与判定逻辑都按这套口径解析。

export type InsulationSpec = {
  item: string
  /** 直流试验电压允许区间，单位 kV。 */
  voltageMin: number
  voltageMax: number
  /** 额定（参考）试验电压 kV，表格里给值班员看。 */
  ratedVoltage: number
  /** 泄漏电流上限，单位 μA。 */
  leakageLimit: number
  note: string
}

// 按站内现行作业指导书给的示例口径，新增试验项目时在这里登记一行即可。
export const INSULATION_SPECS: InsulationSpec[] = [
  { item: '主变绕组（220kV）', voltageMin: 80, voltageMax: 100, ratedVoltage: 90, leakageLimit: 20, note: '220kV 主变绕组直流耐压' },
  { item: '主变绕组（110kV）', voltageMin: 38, voltageMax: 50, ratedVoltage: 45, leakageLimit: 20, note: '110kV 主变绕组直流耐压' },
  { item: '断路器（126kV）', voltageMin: 36, voltageMax: 46, ratedVoltage: 40, leakageLimit: 10, note: '126kV 断路器断口及对地' },
  { item: '电流互感器（252kV）', voltageMin: 80, voltageMax: 100, ratedVoltage: 90, leakageLimit: 25, note: '220kV 电流互感器' },
  { item: '电流互感器（40.5kV）', voltageMin: 40, voltageMax: 50, ratedVoltage: 45, leakageLimit: 15, note: '35kV 电流互感器' },
  { item: '电压互感器（252kV）', voltageMin: 80, voltageMax: 100, ratedVoltage: 90, leakageLimit: 30, note: '220kV 电压互感器' },
  { item: '电力电缆（10kV）', voltageMin: 22, voltageMax: 30, ratedVoltage: 25, leakageLimit: 30, note: '10kV 交联电缆直流耐压' },
  { item: '支柱绝缘子（40.5kV）', voltageMin: 18, voltageMax: 24, ratedVoltage: 20, leakageLimit: 15, note: '35kV 支柱绝缘子' },
]

export function specByItem(item: string): InsulationSpec | undefined {
  return INSULATION_SPECS.find((spec) => spec.item === item)
}

/** 试验电压统一解析成 kV；兼容 “90kV”“90.0”“90000V/90000” 这类填法。 */
export function parseKv(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (text === '') return null
  const match = text.match(/(-?\d+(?:\.\d+)?)/)
  if (!match) return null
  let value = Number(match[1])
  if (Number.isNaN(value)) return null
  if (/v\b/i.test(text) && !/kv/i.test(text)) {
    value /= 1000
  }
  return value
}

/** 泄漏电流统一解析成 μA；兼容 “20μA/20uA/20”，mA 自动换算。 */
export function parseMicroAmp(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  const text = String(raw).trim()
  if (text === '') return null
  const match = text.match(/(-?\d+(?:\.\d+)?)/)
  if (!match) return null
  let value = Number(match[1])
  if (Number.isNaN(value)) return null
  if (/ma/i.test(text)) {
    value *= 1000
  }
  return value
}

export type Verdict = {
  pass: boolean | null
  reasons: string[]
  spec?: InsulationSpec
  voltageKv: number | null
  leakageUa: number | null
}

/**
 * 按技术要求核对：试验电压超区间或泄漏电流超上限都判不合格，并给出可读原因。
 * 读数缺失（试验还没做）不在这里下结论，返回 null 由页面提示「待判定」。
 */
export function evaluateInsulation(item: string, rawVoltage: unknown, rawLeakage: unknown): Verdict {
  const spec = specByItem(String(item ?? ''))
  const voltageKv = parseKv(rawVoltage)
  const leakageUa = parseMicroAmp(rawLeakage)

  if (!spec || voltageKv === null || leakageUa === null) {
    return { pass: null, reasons: [], spec, voltageKv, leakageUa }
  }

  const reasons: string[] = []
  if (voltageKv < spec.voltageMin) {
    reasons.push(`试验电压${voltageKv}kV低于技术要求下限${spec.voltageMin}kV（${spec.item}）`)
  } else if (voltageKv > spec.voltageMax) {
    reasons.push(`试验电压${voltageKv}kV超出技术要求上限${spec.voltageMax}kV（${spec.item}）`)
  }
  if (leakageUa > spec.leakageLimit) {
    reasons.push(`泄漏电流${leakageUa}μA超出技术要求上限${spec.leakageLimit}μA（${spec.item}）`)
  }

  return { pass: reasons.length === 0, reasons, spec, voltageKv, leakageUa }
}
