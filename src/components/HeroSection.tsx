'use client'

import { motion } from 'motion/react'

const RIPPLES = [0, 1, 2, 3]

export function HeroSection() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-indigo-50 via-white to-violet-50 border border-slate-200 mb-8">
      <div className="relative z-10 flex flex-col items-center justify-center py-14 px-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">
          Mini<span className="text-indigo-600">Play</span>
        </h1>
        <p className="text-sm text-slate-600 text-center max-w-md mb-1">
          Turn your creative ideas into WeChat Mini Games
        </p>
        <p className="text-sm text-slate-600 text-center max-w-md">
          Imagine · Create · Play · Earn
        </p>
      </div>

      {/* Ripple animation */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {RIPPLES.map((i) => (
          <motion.div
            key={i}
            className="absolute w-32 h-32 rounded-full border border-indigo-300/40"
            initial={{ scale: 0.5, opacity: 0.6 }}
            animate={{ scale: 4, opacity: 0 }}
            transition={{
              duration: 4,
              repeat: Infinity,
              delay: i * 1,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>
    </div>
  )
}
