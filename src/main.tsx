import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthKitProvider } from '@workos-inc/authkit-react'
import App from './App'
import './styles.css'

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID as string
const apiHostname = (import.meta.env.VITE_WORKOS_API_HOSTNAME as string | undefined) || undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthKitProvider
      clientId={clientId}
      apiHostname={apiHostname}
      devMode={import.meta.env.DEV || undefined}
      onRedirectCallback={() => {
        if (window.location.pathname === '/callback') window.history.replaceState({}, '', '/')
      }}
      onRefreshFailure={({ signIn }) => signIn()}
    >
      <App />
    </AuthKitProvider>
  </StrictMode>,
)
