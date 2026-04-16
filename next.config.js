/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
  // Use relative asset prefix for file:// protocol compatibility in Electron
  assetPrefix: process.env.NODE_ENV === 'production' ? '.' : undefined,
}

module.exports = nextConfig
