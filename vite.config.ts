import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import viewArchboardDig from './api/view-archboard-dig'

function viewArchboardDigDevApi(): Plugin {
  return {
    name: 'view-archboard-dig-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (pathname !== '/view-archboard-dig' && pathname !== '/view-archboard-dig/') return next()
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auth-Token, Accept, Origin, X-Requested-With')
        res.setHeader('Access-Control-Max-Age', '86400')
        if (req.method === 'OPTIONS' || req.method === 'PUT') {
          await viewArchboardDig(req as never, res as never)
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), viewArchboardDigDevApi()],
  build: { sourcemap: true },
})
