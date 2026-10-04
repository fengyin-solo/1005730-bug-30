import type { EntryRow } from './types'

// 绝缘试验技术要求：按试验项目匹配；匹配不上时走默认要求。
// 试验电压允许 ±10% 偏差；泄漏电流以对应项目的上限为准。
export type InsulationSpec = {
  key: string
  name: string
  keywords: string[]
  voltageKv: number
  voltageTolerance: number
  maxLeakageUa: number
  basis: string
}

export const INSULATION_SPECS: InsulationSpec[] = [
  {
    key: 'secondary',
    name: '二次回路绝缘试验',
    keywords: ['二次回路', '二次线'],
    voltageKv: 1,
    voltageTolerance: 0.1,
    maxLeakageUa: 50,
    basis: 'DL/T 995：1kV 试验电压，泄漏电流不大于 50μA',
  },
  {
    key: 'cable',
    name: '电力电缆绝缘试验',
    keywords: ['电缆'],
    voltageKv: 2.5,
    voltageTolerance: 0.1,
    maxLeakageUa: 100,
    basis: 'GB 50150：2.5kV 直流试验电压，泄漏电流不大于 100μA',
  },
  {
    key: 'breaker',
    name: '断路器绝缘试验',
    keywords: ['断路器', '开关'],
    voltageKv: 2,
    voltageTolerance: 0.1,
    maxLeakageUa: 80,
    basis: 'GB 50150：2kV 试验电压，泄漏电流不大于 80μA',
  },
  {
    key: 'transformer',
    name: '变压器绕组绝缘试验',
    keywords: ['变压器', '主变', '绕组'],
    voltageKv: 5,
    voltageTolerance: 0.1,
    maxLeakageUa: 200,
    basis: 'GB 50150：5kV 试验电压，泄漏电流不大于 200μA',
  },
]

export const DEFAULT_SPEC: InsulationSpec = {
  key: 'default',
  name: '通用绝缘试验',
  keywords: [],
  voltageKv: 2.5,
  voltageTolerance: 0.1,
  maxLeakageUa: 100,
  basis: '通用要求：2.5kV 试验电压（±10%），泄漏电流不大于 100μA',
}

export function matchSpec(itemName: string): InsulationSpec {
  const name = itemName.trim()
  let best: InsulationSpec | null = null
  let bestScore = 0
  for (const spec of INSULATION_SPECS) {
    for (const keyword of spec.keywords) {
      if (name.includes(keyword) && keyword.length > bestScore) {
        best = spec
        bestScore = keyword.length
      }
    }
  }
  return best ?? DEFAULT_SPEC
}

export function specVoltageRange(spec: InsulationSpec): { min: number; max: number } {
  return {
    min: spec.voltageKv * (1 - spec.voltageTolerance),
    max: spec.voltageKv * (1 + spec.voltageTolerance),
  }
}

// 试验电压统一换算成 kV：带单位按单位换算；不带单位时按常见登记习惯，>=50 视作 V。
export function parseVoltageKv(raw: string | number | boolean | undefined): number | null {
  if (raw === undefined || raw === null) {
    return null
  }
  const text = String(raw).trim()
  if (!text) {
    return null
  }
  const match = text.match(/(\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }
  const value = Number(match[1])
  if (!Number.isFinite(value)) {
    return null
  }
  if (/mV/i.test(text)) {
    return value / 1_000_000
  }
  if (/kV/i.test(text)) {
    return value
  }
  if (text.includes('V') || text.includes('v') || text.includes('伏')) {
    return value / 1000
  }
  return value >= 50 ? value / 1000 : value
}

// 泄漏电流统一换算成 μA：mA 放大 1000 倍；不带单位按 μA 登记。
export function parseLeakageUa(raw: string | number | boolean | undefined): number | null {
  if (raw === undefined || raw === null) {
    return null
  }
  const text = String(raw).trim()
  if (!text) {
    return null
  }
  const match = text.match(/(\d+(?:\.\d+)?)/)
  if (!match) {
    return null
  }
  const value = Number(match[1])
  if (!Number.isFinite(value)) {
    return null
  }
  if (/mA/i.test(text)) {
    return value * 1000
  }
  return value
}

export function formatKv(value: number): string {
  return `${Number.isInteger(value) ? value : Math.round(value * 100) / 100}kV`
}

export const REQUIRED_FIELDS = [
  '试验编号',
  '试验设备',
  '试验项目',
  '试验电压',
  '泄漏电流',
  '试验人',
  '试验日期',
  '试验结论',
] as const

export function isFieldEmpty(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === ''
}

export function missingFields(row: EntryRow): string[] {
  return REQUIRED_FIELDS.filter((field) => isFieldEmpty(row[field]))
}

function dateValue(raw: unknown): string {
  return isFieldEmpty(raw) ? '' : String(raw)
}

// 同台设备（试验设备同名）只留最早一条：按试验日期、再按编号排序后取首个。
export function prepareInsulationRows(rows: EntryRow[]): EntryRow[] {
  const sorted = [...rows].sort((a, b) => {
    const da = dateValue(a['试验日期'])
    const db = dateValue(b['试验日期'])
    if (da !== db) {
      if (!da) return 1
      if (!db) return -1
      return da < db ? -1 : 1
    }
    return Number(a.id) - Number(b.id)
  })
  const seen = new Set<string>()
  return sorted.filter((row) => {
    const device = String(row['试验设备'] ?? '').trim()
    if (!device) {
      return true
    }
    if (seen.has(device)) {
      return false
    }
    seen.add(device)
    return true
  })
}

export type InsulationVerdict =
  | { pass: true; reasons: []; spec: InsulationSpec; voltageKv: number; leakageUa: number }
  | {
      pass: false
      reasons: string[]
      spec: InsulationSpec
      voltageKv: number | null
      leakageUa: number | null
    }

export function evaluateInsulation(row: EntryRow): InsulationVerdict {
  const spec = matchSpec(String(row['试验项目'] ?? ''))
  const voltageKv = parseVoltageKv(row['试验电压'])
  const leakageUa = parseLeakageUa(row['泄漏电流'])
  const reasons: string[] = []

  if (voltageKv === null) {
    reasons.push(`试验电压「${String(row['试验电压'] ?? '').trim() || '空'}」无法识别，需填写数值（如 2.5kV）`)
  } else {
    const range = specVoltageRange(spec)
    if (voltageKv < range.min || voltageKv > range.max) {
      reasons.push(
        `试验电压 ${formatKv(voltageKv)} 超出${spec.name}要求范围 ${formatKv(range.min)}～${formatKv(range.max)}（标准 ${formatKv(spec.voltageKv)}，±10%）`,
      )
    }
  }

  if (leakageUa === null) {
    reasons.push(`泄漏电流「${String(row['泄漏电流'] ?? '').trim() || '空'}」无法识别，需填写数值（如 100μA）`)
  } else if (leakageUa > spec.maxLeakageUa) {
    reasons.push(`泄漏电流 ${leakageUa}μA 超过${spec.name}允许上限 ${spec.maxLeakageUa}μA`)
  }

  if (reasons.length === 0 && voltageKv !== null && leakageUa !== null) {
    return { pass: true, reasons: [], spec, voltageKv, leakageUa }
  }
  return { pass: false, reasons, spec, voltageKv, leakageUa }
}
