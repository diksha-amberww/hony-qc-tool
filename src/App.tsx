import { useCallback, useEffect, useMemo, useState } from 'react'
import { Box } from '@mui/material'
import { ThemeContextProvider } from './theme'
import { AiUsageProvider } from './context/AiUsageContext'
import { QcToolConfigProvider, useQcToolVendorDisplayName } from './context/QcToolConfigContext'
import { BatchDemoProvider, useBatchDemo, type StartQcPayload } from './context/BatchDemoContext'
import { ErrorEngineProvider } from './context/ErrorEngineContext'
import { LogsProvider } from './context/LogsContext'
import { CredentialRuntimeProvider } from './context/CredentialRuntimeContext'
import { CredentialsActivityProvider } from './context/CredentialsActivityContext'
import { SandboxRunProvider } from './context/SandboxRunContext'
import { LiveOutputProvider } from './context/LiveOutputContext'
import { BrandAliasProvider } from './context/BrandAliasContext'
import { SettingsProvider } from './context/SettingsContext'
import { ToastProvider } from './components/toast'
import { AppHeader } from './components/layout/AppHeader'
import { AppSidebar, type NavItemKey } from './components/layout/AppSidebar'
import { UploadPage } from './pages/UploadPage'
import { LiveOutputPage } from './pages/LiveOutputPage'
import { ExportPage } from './pages/ExportPage'
import { ExportCustomizationPage } from './pages/ExportCustomizationPage'
import { LogsPage } from './pages/LogsPage'
import { SandboxPage } from './pages/SandboxPage'
import { AiCostsPage } from './pages/AiCostsPage'
import { CredentialsPage } from './pages/CredentialsPage'
import { SettingsPage } from './pages/SettingsPage'
import { BrandAliasPage } from './pages/BrandAliasPage'
import { Bitrix24IntegrationPage } from './pages/Bitrix24IntegrationPage'
import { Bitrix24SettingsProvider } from './context/Bitrix24SettingsContext'
import { Bitrix24NotificationBridge } from './context/Bitrix24NotificationBridge'
import { ElectronLogBridge } from './components/layout/ElectronLogBridge'

const NAV_KEYS: NavItemKey[] = [
  'upload',
  'live',
  'export',
  'exportCustomize',
  'logs',
  'sandbox',
  'costs',
  'credentials',
  'settings',
  'brandAlias',
  'bitrix24',
]

function AppShell() {
  const [activeTab, setActiveTab] = useState<NavItemKey>('upload')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { start } = useBatchDemo()
  const vendorDisplayName = useQcToolVendorDisplayName()

  useEffect(() => {
    document.title = `${vendorDisplayName} QC Tool`
  }, [vendorDisplayName])

  const handleStartQc = useCallback(
    async (payload: StartQcPayload) => {
      await start(payload)
      setActiveTab('live')
    },
    [start],
  )

  const pageNodes = useMemo(
    () => ({
      upload: <UploadPage onStartQc={handleStartQc} />,
      live: <LiveOutputPage />,
      export: <ExportPage />,
      exportCustomize: <ExportCustomizationPage />,
      logs: <LogsPage />,
      sandbox: <SandboxPage />,
      costs: <AiCostsPage />,
      credentials: <CredentialsPage />,
      settings: <SettingsPage />,
      brandAlias: <BrandAliasPage />,
      bitrix24: <Bitrix24IntegrationPage />,
    }),
    [handleStartQc],
  )

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', bgcolor: 'background.default', color: 'text.primary' }}>
      <AppSidebar
        isOpen={sidebarOpen}
        currentTab={activeTab}
        onSelectTab={setActiveTab}
        onToggle={() => setSidebarOpen((open) => !open)}
        menuLabel="HONY MENU"
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <AppHeader />
        <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
          {NAV_KEYS.map((key) => (
            <Box
              key={key}
              sx={{
                display: activeTab === key ? 'block' : 'none',
                height: '100%',
                overflow: 'hidden',
              }}
              aria-hidden={activeTab !== key}
            >
              {pageNodes[key]}
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

function App() {
  return (
    <ThemeContextProvider>
      <ToastProvider>
        <LogsProvider>
          <CredentialRuntimeProvider>
            <CredentialsActivityProvider>
              <SettingsProvider>
                <Bitrix24SettingsProvider>
                  <QcToolConfigProvider>
                    <BrandAliasProvider>
                      <AiUsageProvider>
                        <ErrorEngineProvider>
                          <LiveOutputProvider>
                            <BatchDemoProvider>
                              <SandboxRunProvider>
                              <Bitrix24NotificationBridge>
                                <ElectronLogBridge />
                                <AppShell />
                              </Bitrix24NotificationBridge>
                              </SandboxRunProvider>
                            </BatchDemoProvider>
                          </LiveOutputProvider>
                        </ErrorEngineProvider>
                      </AiUsageProvider>
                    </BrandAliasProvider>
                  </QcToolConfigProvider>
                </Bitrix24SettingsProvider>
              </SettingsProvider>
            </CredentialsActivityProvider>
          </CredentialRuntimeProvider>
        </LogsProvider>
      </ToastProvider>
    </ThemeContextProvider>
  )
}

export default App
