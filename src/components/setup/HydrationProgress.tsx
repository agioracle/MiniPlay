'use client'

interface HydrationStepData {
  id: string
  label: string
  status: 'pending' | 'checking' | 'installing' | 'done' | 'warning' | 'error'
  detail?: string
  children?: HydrationStepData[]
}

function StatusIcon({ status }: { status: HydrationStepData['status'] }) {
  switch (status) {
    case 'pending':
      return <span className="w-5 h-5 rounded-full border-2 border-slate-300" />
    case 'checking':
    case 'installing':
      return (
        <span className={`w-5 h-5 rounded-full border-2 border-t-transparent animate-spin ${
          status === 'installing' ? 'border-amber-500' : 'border-indigo-500'
        }`} />
      )
    case 'done':
      return (
        <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )
    case 'warning':
      return (
        <span className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center">
          <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </span>
      )
    case 'error':
      return (
        <span className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
          <svg className="w-3 h-3 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </span>
      )
  }
}

function SmallStatusDot({ status }: { status: HydrationStepData['status'] }) {
  const color = status === 'done' ? 'bg-emerald-500' : status === 'warning' ? 'bg-amber-500' : 'bg-slate-300'
  return <span className={`w-2 h-2 rounded-full ${color}`} />
}

function detailColor(status: HydrationStepData['status']): string {
  if (status === 'warning') return 'text-amber-600'
  if (status === 'error') return 'text-red-600'
  return 'text-slate-500'
}

export function HydrationProgress({ steps }: { steps: HydrationStepData[] }) {
  if (steps.length === 0) {
    return (
      <div className="flex items-center gap-3 text-slate-400 text-sm">
        <span className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
        Checking environment...
      </div>
    )
  }

  return (
    <div className="w-[420px] space-y-3">
      {steps.map((s) => (
        <div key={s.id}>
          {/* Main step row */}
          <div className="flex items-start gap-3">
            <div className="mt-0.5"><StatusIcon status={s.status} /></div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-800 font-medium">{s.label}</div>
              {s.detail && (
                <div className={`text-xs mt-0.5 ${detailColor(s.status)} whitespace-pre-wrap break-words`}>
                  {s.detail}
                </div>
              )}
            </div>
          </div>

          {/* Children (for coder agent sub-steps) */}
          {s.children && s.children.length > 0 && (
            <div className="ml-8 mt-2 space-y-1.5 border-l-2 border-slate-200 pl-3">
              {s.children.map((child) => (
                <div key={child.id} className="flex items-center gap-2">
                  <SmallStatusDot status={child.status} />
                  <span className="text-xs text-slate-700">{child.label}</span>
                  {child.detail && (
                    <span className={`text-[11px] ${child.status === 'done' ? 'text-slate-400' : 'text-slate-400'}`}>
                      — {child.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
