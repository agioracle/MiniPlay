import type { Metadata } from 'next'
import '@/app/globals.css'

export const metadata: Metadata = {
  title: 'MiniPlay',
  description: 'AI-powered WeChat mini-game generator',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-50 text-slate-900 antialiased overflow-hidden h-screen">
        {children}
      </body>
    </html>
  )
}
