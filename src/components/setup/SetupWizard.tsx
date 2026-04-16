'use client'

import { useState, useEffect, useCallback } from 'react'
import { HydrationProgress } from './HydrationProgress'
import { ApiKeyForm } from './ApiKeyForm'

type WizardStep = 'hydration' | 'apikey' | 'ready'

interface HydrationStepData {
  id: string
  label: string
  status: 'pending' | 'checking' | 'installing' | 'done' | 'warning' | 'error'
  detail?: string
  children?: HydrationStepData[]
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState<WizardStep>('hydration')
  const [hydrationSteps, setHydrationSteps] = useState<HydrationStepData[]>([])
  const [hydrationError, setHydrationError] = useState<string | null>(null)
  const [hydrationRunning, setHydrationRunning] = useState(false)

  const startHydration = useCallback(() => {
    if (!window.miniplay || hydrationRunning) return
    setHydrationError(null)
    setHydrationRunning(true)
    setHydrationSteps([])

    window.miniplay.hydrationRun().then((success) => {
      setHydrationRunning(false)
      if (success) {
        setTimeout(() => setStep('apikey'), 600)
      } else {
        setHydrationError('Environment setup failed. Check the error details above and retry.')
      }
    }).catch((err) => {
      setHydrationRunning(false)
      setHydrationError(`Unexpected error: ${err}`)
    })
  }, [hydrationRunning])

  useEffect(() => {
    if (step !== 'hydration') return
    if (!window.miniplay) return

    // Listen for progress updates
    const unsub = window.miniplay.onHydrationProgress((steps) => {
      setHydrationSteps(steps)
    })

    // Auto-start hydration on mount
    startHydration()

    return unsub
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps

  if (step === 'hydration') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-8">
        <h1 className="text-2xl font-semibold text-slate-900">Setting up MiniPlay</h1>
        <p className="text-sm text-slate-500">Preparing your development environment...</p>
        <HydrationProgress steps={hydrationSteps} />
        {hydrationError && (
          <div className="flex flex-col items-center gap-3 mt-2">
            <p className="text-sm text-red-600 max-w-md text-center">{hydrationError}</p>
            <button
              onClick={startHydration}
              disabled={hydrationRunning}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50"
            >
              {hydrationRunning ? 'Retrying...' : 'Retry'}
            </button>
          </div>
        )}
      </div>
    )
  }

  if (step === 'apikey') {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-8">
        <h1 className="text-2xl font-semibold text-slate-900">Almost there!</h1>
        <p className="text-sm text-slate-500 max-w-md text-center">
          MiniPlay uses AI to generate games. Enter your API key to get started.
          Your key stays on your machine — it never leaves this device.
        </p>
        <ApiKeyForm onSaved={() => setStep('ready')} />
      </div>
    )
  }

  // step === 'ready'
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-6">
      <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-2xl font-semibold text-slate-900">Ready to go!</h1>
      <p className="text-sm text-slate-500">Your environment is set up. Let's create some games.</p>
      <button
        onClick={onComplete}
        className="mt-4 px-6 py-2.5 text-sm font-medium rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
      >
        Start Creating
      </button>
    </div>
  )
}
