import React, { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import RealTimeArbitrageDashboard from './components/RealTimeArbitrageDashboard.jsx'

const THEME_KEY = 'realtime-arb-theme'

function App() {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY)
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    const initialDark = stored === null ? prefersDark : stored === 'dark'
    setIsDark(initialDark)
    document.documentElement.classList.toggle('dark', initialDark)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    window.localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light')
  }, [isDark])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-400">
            Real-time Arbitrage Monitoring
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsDark((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500 hover:bg-slate-800 transition"
        >
          {isDark ? (
            <>
              <Moon className="w-3.5 h-3.5 text-slate-300" />
              <span>Dark</span>
            </>
          ) : (
            <>
              <Sun className="w-3.5 h-3.5 text-amber-300" />
              <span>Light</span>
            </>
          )}
        </button>
      </header>
      <main className="flex-1 min-h-0">
        <RealTimeArbitrageDashboard />
      </main>
    </div>
  )
}

export default App

