import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import { Calculator, LayoutDashboard, LineChart as LineChartIcon, Shield } from 'lucide-react'

const fallbackCatalog = {
  Energy: [
    { code: 'SC', name: 'Crude Oil', multiplier: 1000, exchange: 'INE' },
    { code: 'LU', name: 'LSFO', multiplier: 10, exchange: 'INE' },
    { code: 'FU', name: 'Fuel Oil', multiplier: 10, exchange: 'SHFE' },
    { code: 'BU', name: 'Bitumen', multiplier: 10, exchange: 'SHFE' },
  ],
  Chemicals: [
    { code: 'TA', name: 'PTA', multiplier: 5, exchange: 'CZCE' },
    { code: 'MA', name: 'Methanol', multiplier: 10, exchange: 'CZCE' },
    { code: 'V', name: 'PVC', multiplier: 5, exchange: 'DCE' },
    { code: 'PP', name: 'PP', multiplier: 5, exchange: 'DCE' },
    { code: 'L', name: 'L', multiplier: 5, exchange: 'DCE' },
    { code: 'SA', name: 'Soda Ash', multiplier: 20, exchange: 'CZCE' },
  ],
}

function buildInitialInstruments() {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear()
  // Use next month as a safer default placeholder than a fixed "2505".
  const nextMonth = month === 12 ? 1 : month + 1
  const nextYear = month === 12 ? year + 1 : year
  const yymm = `${String(nextYear % 100).padStart(2, '0')}${String(nextMonth).padStart(2, '0')}`

  const out = []
  Object.entries(fallbackCatalog).forEach(([sector, items]) => {
    items.forEach((item) => {
      out.push({
        code: item.code,
        name: item.name,
        sector,
        ctpSymbol: `${item.exchange}.${item.code.toLowerCase()}${yymm}`,
        spotPrice: 0,
        spotSource: 'Ref: Internal',
        futuresPrice: 0,
        daysToExpiry: 35,
        multiplier: item.multiplier,
      })
    })
  })
  return out
}

function computeAnnualizedReturn(spot, futures, days) {
  if (!spot || !days) return 0
  const diff = spot - futures
  return ((diff / spot) * (365 / days)) * 100
}

function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return Number(value).toFixed(decimals)
}

function RealTimeArbitrageDashboard() {
  const [instruments, setInstruments] = useState(buildInitialInstruments)
  const [activeSector, setActiveSector] = useState('Energy')
  const [selectedCode, setSelectedCode] = useState('SC')
  const [basisHistory, setBasisHistory] = useState([])

  const [spotInputMap, setSpotInputMap] = useState({})
  const [logisticsCost, setLogisticsCost] = useState('')
  const [fundingRate, setFundingRate] = useState('3.5')
  const [premiumDiscount, setPremiumDiscount] = useState('0')
  const [customDaysToExpiry, setCustomDaysToExpiry] = useState('')

  const [netPerUnit, setNetPerUnit] = useState(null)
  const [streamStatus, setStreamStatus] = useState({ state: 'connecting', message: '' })

  const selectedCodeRef = useRef(selectedCode)
  const spotInputMapRef = useRef(spotInputMap)

  useEffect(() => {
    selectedCodeRef.current = selectedCode
  }, [selectedCode])

  useEffect(() => {
    spotInputMapRef.current = spotInputMap
  }, [spotInputMap])

  const selectedInstrument = useMemo(
    () => instruments.find((x) => x.code === selectedCode) ?? instruments[0],
    [instruments, selectedCode],
  )

  const visibleInstruments = useMemo(
    () => instruments.filter((x) => x.sector === activeSector),
    [instruments, activeSector],
  )

  useEffect(() => {
    if (!visibleInstruments.find((x) => x.code === selectedCode) && visibleInstruments[0]) {
      setSelectedCode(visibleInstruments[0].code)
    }
  }, [visibleInstruments, selectedCode])

  function getUserSpot(code, fallbackSpot) {
    const raw = spotInputMap[code]
    const parsed = parseFloat(raw ?? '')
    return Number.isFinite(parsed) ? parsed : fallbackSpot
  }

  useEffect(() => {
    if (!selectedInstrument) return
    const userSpot = getUserSpot(selectedInstrument.code, selectedInstrument.spotPrice)
    setBasisHistory([
      {
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        basis: userSpot - selectedInstrument.futuresPrice,
      },
    ])
  }, [selectedInstrument?.code])

  // HTTP polling fallback: fetch latest ticks every 2s
  useEffect(() => {
    let timer = null

    const fetchTicks = async () => {
      try {
        const res = await fetch('/api/ticks')
        if (!res.ok) {
          setStreamStatus({ state: 'error', message: `HTTP ${res.status}` })
          return
        }
        const data = await res.json()
        const ticks = data?.ticks || {}
        setStreamStatus({ state: 'connected', message: '' })

        setInstruments((prev) => {
          const updated = prev.map((item) => {
            const tick = Object.values(ticks).find((t) => t.code === item.code)
            if (!tick) return item
            const lastPrice = Number(tick.lastPrice)
            return {
              ...item,
              ctpSymbol: tick.symbol || item.ctpSymbol,
              futuresPrice: Number.isFinite(lastPrice) ? lastPrice : item.futuresPrice,
              spotPrice: Number.isFinite(Number(tick.referenceSpot))
                ? Number(tick.referenceSpot)
                : item.spotPrice,
              spotSource: tick.spotSource || item.spotSource,
              multiplier: Number(tick.contractMultiplier || item.multiplier),
            }
          })

          const activeCode = selectedCodeRef.current
          const current = updated.find((x) => x.code === activeCode)
          const tickForActive =
            current && Object.values(ticks).find((t) => t.code === current.code)
          if (current && tickForActive && Number.isFinite(Number(tickForActive.lastPrice))) {
            const lastPrice = Number(tickForActive.lastPrice)
            const userSpotRaw = spotInputMapRef.current[current.code]
            const userSpot = Number.isFinite(parseFloat(userSpotRaw))
              ? parseFloat(userSpotRaw)
              : current.spotPrice
            const basis = userSpot - lastPrice
            const label = new Date().toLocaleTimeString('zh-CN', { hour12: false })
            setBasisHistory((prevHistory) => {
              const next = [...prevHistory, { time: label, basis }]
              return next.length > 60 ? next.slice(next.length - 60) : next
            })
          }

          return updated
        })
      } catch (err) {
        setStreamStatus({ state: 'error', message: '无法连接后端，请确认 uvicorn 已启动在 8000 端口' })
      }
    }

    fetchTicks()
    timer = window.setInterval(fetchTicks, 2000)

    return () => {
      if (timer) window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    let ws = null
    let retryTimer = null
    let closed = false

    const connect = () => {
      setStreamStatus({ state: 'connecting', message: '' })
      // Use explicit 127.0.0.1 to avoid localhost/IPv6/proxy issues.
      ws = new WebSocket('ws://127.0.0.1:8000/ws')

      ws.onopen = () => setStreamStatus({ state: 'connected', message: '' })

      ws.onmessage = (event) => {
        let msg = null
        try {
          msg = JSON.parse(event.data)
        } catch {
          return
        }

        if (msg?.type === 'error') {
          setStreamStatus({ state: 'error', message: msg?.message || 'backend error' })
          return
        }

        if (msg?.type === 'hello') {
          setInstruments((prev) =>
            prev.map((item) => {
              const meta = msg?.symbolMeta ? Object.values(msg.symbolMeta).find((m) => m.code === item.code) : null
              if (!meta) return item
              const foundSymbol = Object.keys(msg.symbolMeta).find((k) => msg.symbolMeta[k]?.code === item.code)
              return {
                ...item,
                ctpSymbol: foundSymbol || item.ctpSymbol,
                name: meta.displayName || item.name,
                sector: meta.sector || item.sector,
                multiplier: Number(meta.contractMultiplier || item.multiplier),
              }
            }),
          )
          return
        }

        if (msg?.type !== 'tick') return

        const code = msg?.code
        const lastPrice = Number(msg?.lastPrice)
        if (!code) return

        setInstruments((prev) => {
          const updated = prev.map((item) => {
            if (item.code !== code) return item
            return {
              ...item,
              ctpSymbol: msg.symbol || item.ctpSymbol,
              futuresPrice: Number.isFinite(lastPrice) ? lastPrice : item.futuresPrice,
              spotPrice: Number.isFinite(Number(msg.referenceSpot))
                ? Number(msg.referenceSpot)
                : item.spotPrice,
              spotSource: msg.spotSource || item.spotSource,
              multiplier: Number(msg.contractMultiplier || item.multiplier),
            }
          })

          const activeCode = selectedCodeRef.current
          const current = updated.find((x) => x.code === activeCode)
          if (current && current.code === code && Number.isFinite(lastPrice)) {
            const userSpotRaw = spotInputMapRef.current[current.code]
            const userSpot = Number.isFinite(parseFloat(userSpotRaw))
              ? parseFloat(userSpotRaw)
              : current.spotPrice
            const basis = userSpot - lastPrice
            const label = new Date().toLocaleTimeString('zh-CN', { hour12: false })
            setBasisHistory((prevHistory) => {
              const next = [...prevHistory, { time: label, basis }]
              return next.length > 60 ? next.slice(next.length - 60) : next
            })
          }

          return updated
        })
      }

      ws.onerror = () => setStreamStatus({ state: 'error', message: 'WebSocket error' })
      ws.onclose = () => {
        if (closed) return
        setStreamStatus({ state: 'reconnecting', message: 'reconnecting...' })
        retryTimer = window.setTimeout(connect, 1200)
      }
    }

    connect()
    return () => {
      closed = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close()
      }
    }
  }, [])

  const selectedUserSpot = useMemo(() => {
    if (!selectedInstrument) return 0
    return getUserSpot(selectedInstrument.code, selectedInstrument.spotPrice)
  }, [selectedInstrument, spotInputMap])

  function handleCalculatorSubmit(e) {
    e.preventDefault()
    if (!selectedInstrument) return

    const futures = selectedInstrument.futuresPrice
    const userSpot = selectedUserSpot
    const logistics = parseFloat(logisticsCost || '0')
    const rate = parseFloat(fundingRate || '0') / 100
    const premium = parseFloat(premiumDiscount || '0')
    const days =
      parseFloat(customDaysToExpiry || '') || Number(selectedInstrument.daysToExpiry || 0)

    if (!Number.isFinite(futures) || !Number.isFinite(userSpot) || !Number.isFinite(days)) {
      setNetPerUnit(null)
      return
    }
    const interestCost = userSpot * rate * (days / 365)
    const net =
      futures -
      userSpot -
      (Number.isFinite(logistics) ? logistics : 0) -
      (Number.isFinite(interestCost) ? interestCost : 0) +
      (Number.isFinite(premium) ? premium : 0)
    setNetPerUnit(net)
  }

  const netResult = useMemo(() => {
    if (!selectedInstrument || netPerUnit === null || Number.isNaN(netPerUnit)) return null
    const perLot = netPerUnit * selectedInstrument.multiplier
    return {
      perUnit: netPerUnit,
      perLot,
      positive: netPerUnit >= 0,
      className: netPerUnit >= 0 ? 'text-emerald-400' : 'text-red-400',
    }
  }, [netPerUnit, selectedInstrument])

  const chartOption = useMemo(
    () => ({
      backgroundColor: 'transparent',
      grid: { left: 40, right: 16, top: 40, bottom: 28 },
      xAxis: {
        type: 'category',
        data: basisHistory.map((p) => p.time),
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#64748b' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: '#1e293b' } },
        axisLabel: { color: '#94a3b8', fontSize: 10 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#020617',
        borderColor: '#1e293b',
        textStyle: { color: '#e2e8f0', fontSize: 11 },
        valueFormatter: (v) => `${formatNumber(v)} 元/吨`,
      },
      series: [
        {
          name: 'Basis',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: basisHistory.map((p) => p.basis),
          lineStyle: { color: '#22c55e', width: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34, 197, 94, 0.35)' },
                { offset: 1, color: 'rgba(15, 23, 42, 0.05)' },
              ],
            },
          },
        },
      ],
      title: {
        text: `实时基差曲线 · Basis Fluctuation (${selectedInstrument?.code ?? '-'})`,
        left: 0,
        top: 0,
        textStyle: { color: '#e2e8f0', fontSize: 13, fontWeight: 500 },
      },
    }),
    [basisHistory, selectedInstrument],
  )

  return (
    <div className="h-full flex bg-slate-950 text-slate-100">
      <aside className="hidden md:flex w-60 flex-col border-r border-slate-900 bg-slate-950/90">
        <div className="px-4 pt-4 pb-3 border-b border-slate-900 flex items-center gap-2">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/40">
            <LayoutDashboard className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-100">
              CN Commodity Arbitrage
            </div>
            <div className="text-[10px] text-slate-500">Energy & Chemicals monitor</div>
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 text-xs space-y-1">
          <button className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 bg-slate-900 text-emerald-300 border border-slate-800 text-left">
            <LineChartIcon className="w-3.5 h-3.5" />
            <span>Market View</span>
          </button>
          <button className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-slate-300 hover:bg-slate-900 hover:text-slate-50 border border-transparent hover:border-slate-800 text-left">
            <Calculator className="w-3.5 h-3.5" />
            <span>Private Calculator</span>
          </button>
        </nav>
        <div className="px-3 pb-4 mt-auto">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5 flex gap-2 items-start">
            <Shield className="w-3.5 h-3.5 text-slate-500 mt-0.5" />
            <p className="text-[10px] text-slate-500">
              示例界面，仅用于策略研究和回测可视化展示，不构成任何投资建议。
            </p>
          </div>
        </div>
      </aside>

      <section className="flex-1 flex flex-col md:flex-row gap-4 p-3 md:p-4 min-h-0">
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="rounded-xl border border-slate-900 bg-slate-950/60 overflow-hidden flex-1 min-h-[260px] flex flex-col">
            <div className="px-3 md:px-4 py-2.5 border-b border-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <LineChartIcon className="w-3.5 h-3.5 text-emerald-400" />
                <div>
                  <div className="text-xs font-medium text-slate-100">Market View</div>
                  <div className="text-[10px] text-slate-500">Spot vs Futures · Basis & Return</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-slate-400">Selected</div>
                <div className="text-xs font-medium text-slate-100">
                  {selectedInstrument?.code} · {selectedInstrument?.name}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  Stream:{' '}
                  <span
                    className={
                      streamStatus.state === 'connected'
                        ? 'text-emerald-400'
                        : streamStatus.state === 'error'
                          ? 'text-red-400'
                          : 'text-amber-300'
                    }
                  >
                    {streamStatus.state}
                  </span>
                </div>
              </div>
            </div>

            <div className="px-3 py-2 border-b border-slate-900 flex gap-2">
              {Object.keys(fallbackCatalog).map((sector) => (
                <button
                  key={sector}
                  onClick={() => setActiveSector(sector)}
                  className={`px-2.5 py-1 rounded-md text-[11px] border ${
                    activeSector === sector
                      ? 'bg-slate-900 text-emerald-300 border-slate-700'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {sector}
                </button>
              ))}
            </div>

            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-900 text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Symbol</th>
                    <th className="text-right font-medium px-3 py-2">Spot</th>
                    <th className="text-right font-medium px-3 py-2">Futures</th>
                    <th className="text-right font-medium px-3 py-2">Basis</th>
                    <th className="text-right font-medium px-3 py-2">Ann. Return</th>
                    <th className="text-right font-medium px-3 py-2">Days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/80">
                  {visibleInstruments.map((item) => {
                    const isActive = item.code === selectedCode
                    const userSpot = getUserSpot(item.code, item.spotPrice)
                    const basis = userSpot - item.futuresPrice
                    const annRet = computeAnnualizedReturn(userSpot, item.futuresPrice, item.daysToExpiry)
                    return (
                      <tr
                        key={item.code}
                        onClick={() => setSelectedCode(item.code)}
                        className={`cursor-pointer transition-colors ${
                          isActive ? 'bg-slate-900/80 hover:bg-slate-900' : 'hover:bg-slate-900/40'
                        }`}
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs font-medium text-slate-100">{item.code}</span>
                            <span className="text-[10px] text-slate-500">{item.ctpSymbol}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-200">
                          <div>{formatNumber(item.spotPrice, 2)}</div>
                          <span className="inline-flex mt-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[9px] text-cyan-300">
                            {item.spotSource}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-200">
                          {formatNumber(item.futuresPrice, 2)}
                        </td>
                        <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${basis >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatNumber(basis, 2)}
                        </td>
                        <td className={`px-3 py-2.5 text-right text-xs tabular-nums ${annRet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatNumber(annRet, 2)}%
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-300">
                          {item.daysToExpiry}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-900 bg-slate-950/60 min-h-[230px]">
            <ReactECharts style={{ height: 260, width: '100%' }} option={chartOption} notMerge lazyUpdate />
          </div>
        </div>

        <div className="w-full md:w-80 lg:w-96 shrink-0">
          <div className="rounded-xl border border-slate-900 bg-slate-950/70 flex flex-col">
            <div className="px-3 md:px-4 py-2.5 border-b border-slate-900">
              <div className="text-xs font-medium text-slate-100">Private Arbitrage Calculator</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Contract-aware multiplier loaded by symbol</div>
            </div>

            <form onSubmit={handleCalculatorSubmit} className="px-3 md:px-4 py-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Symbol</label>
                  <select
                    value={selectedCode}
                    onChange={(e) => setSelectedCode(e.target.value)}
                    className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100"
                  >
                    {instruments.map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.code} ({item.sector})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-300">Contract Multiplier</label>
                  <div className="rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-cyan-300">
                    {selectedInstrument?.multiplier ?? '-'} / lot
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-300">My Spot Price (元/吨)</label>
                <input
                  type="number"
                  value={spotInputMap[selectedCode] ?? ''}
                  onChange={(e) => setSpotInputMap((prev) => ({ ...prev, [selectedCode]: e.target.value }))}
                  placeholder={`Default ${formatNumber(selectedInstrument?.spotPrice ?? 0, 2)}`}
                  className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-300">Logistics Cost (元/吨)</label>
                <input
                  type="number"
                  value={logisticsCost}
                  onChange={(e) => setLogisticsCost(e.target.value)}
                  className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  step="0.01"
                  value={fundingRate}
                  onChange={(e) => setFundingRate(e.target.value)}
                  placeholder="Funding Rate %"
                  className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100"
                />
                <input
                  type="number"
                  value={premiumDiscount}
                  onChange={(e) => setPremiumDiscount(e.target.value)}
                  placeholder="Premium/Discount"
                  className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-100"
                />
              </div>

              <input
                type="number"
                value={customDaysToExpiry}
                onChange={(e) => setCustomDaysToExpiry(e.target.value)}
                placeholder={`Days to Expiry (Default ${selectedInstrument?.daysToExpiry ?? '-'})`}
                className="w-full rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-[11px] text-slate-100"
              />

              <button
                type="submit"
                className="w-full inline-flex items-center justify-center rounded-md bg-emerald-500/90 hover:bg-emerald-500 text-xs font-medium text-slate-950 py-1.5"
              >
                计算净利润 · Compute Net Profit
              </button>
            </form>

            <div className="px-3 md:px-4 pb-3 border-t border-slate-900 bg-slate-950/80">
              <div className="text-[11px] text-slate-400 mb-1.5">Net Profit</div>
              <div className="text-sm font-semibold tabular-nums">
                {netResult ? (
                  <span className={netResult.className}>
                    {formatNumber(netResult.perUnit, 2)} /吨 · {formatNumber(netResult.perLot, 2)} /手
                  </span>
                ) : (
                  <span className="text-slate-600">-</span>
                )}
              </div>
              {streamStatus.message && (
                <p className="text-[10px] text-red-400 mt-1 break-all">{streamStatus.message}</p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default RealTimeArbitrageDashboard

