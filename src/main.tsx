import { createRoot } from 'react-dom/client'
import { AuthKitProvider } from '@workos-inc/authkit-react'
import App from './App'
import './styles.css'

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID as string
const apiHostname = (import.meta.env.VITE_WORKOS_API_HOSTNAME as string | undefined) || undefined
const devEnvironment = (import.meta.env.VITE_ARCHBOARD_DEV as string | undefined)?.toLowerCase() === 'true'
const redirectUri = devEnvironment
  ? (import.meta.env.VITE_WORKOS_DEV_REDIRECT_URI as string | undefined) || 'http://localhost:5173/callback'
  : (import.meta.env.VITE_WORKOS_PROD_REDIRECT_URI as string | undefined) || 'https://archboard-iota.vercel.app/callback'

createRoot(document.getElementById('root')!).render(
    <AuthKitProvider
      clientId={clientId}
      apiHostname={apiHostname}
      redirectUri={redirectUri}
      devMode={devEnvironment || undefined}
      onRedirectCallback={({ state }) => {
        const callbackState = state as { returnTo?: string } | undefined
        const returnTo = callbackState?.returnTo
          || sessionStorage.getItem('archboard-post-auth-return')
          || '/'
        sessionStorage.removeItem('archboard-post-auth-return')
        const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/'
        window.history.replaceState({}, '', safeReturn)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }}
      onRefreshFailure={({ signIn }) => signIn()}
    >
      <App />
    </AuthKitProvider>,
)
