'use client'

import { useState, useEffect, useMemo, useRef } from 'react'

const MACARON_COLORS = [
  '#FFB5C2', // pink
  '#B5DEFF', // blue
  '#C3B1E1', // lavender
  '#FFDAB9', // peach
  '#B5EAD7', // mint
  '#FFE5B4', // cream
  '#E8D5B7', // tan
  '#F0C5D0', // rose
  '#A7D8DE', // aqua
  '#D4A5E5', // lilac
]

export function WaveDotsBackground() {
  const gridData = useMemo(() => {
    const cols = 120
    const rows = 70
    const items: { x: number; y: number; color: string }[] = []
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const jx = Math.sin(col * 13.7 + row * 7.3) * 0.08
        const jy = Math.cos(col * 9.1 + row * 11.9) * 0.08
        const colorIdx = (row * 3 + col * 7) % MACARON_COLORS.length
        items.push({
          x: (col / (cols - 1)) * 100 + jx,
          y: (row / (rows - 1)) * 100 + jy,
          color: MACARON_COLORS[colorIdx],
        })
      }
    }
    return items
  }, [])

  const [ripples, setRipples] = useState<{ cx: number; cy: number; birth: number; id: number }[]>([])
  const rippleCounter = useRef(0)
  const circleRefs = useRef<(SVGCircleElement | null)[]>([])
  const rafRef = useRef<number>(0)

  useEffect(() => {
    function spawnRipple() {
      const cx = Math.random() * 100
      const cy = Math.random() * 100
      const id = rippleCounter.current++
      setRipples(prev => {
        const now = performance.now()
        const alive = prev.filter(r => (now - r.birth) / 1000 < 8)
        const active = alive.length >= 3 ? alive.slice(1) : alive
        return [...active, { cx, cy, birth: now, id }]
      })
    }

    spawnRipple()
    setTimeout(spawnRipple, 1000)
    setTimeout(spawnRipple, 2000)

    const interval = setInterval(spawnRipple, 2400)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const items = gridData

    function animate() {
      const now = performance.now()

      for (let i = 0; i < items.length; i++) {
        const dot = items[i]
        let maxInfluence = 0

        for (const ripple of ripples) {
          const age = (now - ripple.birth) / 1000
          const radius = age * 12.5
          const dx = dot.x - ripple.cx
          const dy = dot.y - ripple.cy
          const dist = Math.sqrt(dx * dx + dy * dy)

          const ringDist = Math.abs(dist - radius)
          const width = 10 + age * 2
          const falloff = Math.max(0, 1 - ringDist / width)
          const timeFade = Math.max(0, 1 - age / 7)
          const influence = falloff * falloff * timeFade

          if (influence > maxInfluence) maxInfluence = influence
        }

        const r = 0.02 + maxInfluence * 0.28
        const opacity = 0.1 + maxInfluence * 0.75

        const el = circleRefs.current[i]
        if (el) {
          el.setAttribute('r', String(r))
          el.setAttribute('opacity', String(opacity))
        }
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(rafRef.current)
  }, [gridData, ripples])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        {gridData.map((dot, i) => (
          <circle
            key={i}
            ref={(el) => { circleRefs.current[i] = el }}
            cx={dot.x}
            cy={dot.y}
            r="0.02"
            opacity="0.1"
            fill={dot.color}
          />
        ))}
      </svg>
    </div>
  )
}
