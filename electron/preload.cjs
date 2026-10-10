const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onAppLog: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('app:log', handler)
    return () => ipcRenderer.removeListener('app:log', handler)
  },
  qc: {
    validateUpload: (request) => ipcRenderer.invoke('qc:validateUpload', request),
    startBatch: (payload) => ipcRenderer.invoke('qc:startBatch', payload),
    pauseBatch: (payload) => ipcRenderer.invoke('qc:pauseBatch', payload),
    resumeBatch: (payload) => ipcRenderer.invoke('qc:resumeBatch', payload),
    stopBatch: (payload) => ipcRenderer.invoke('qc:stopBatch', payload),
    getSession: (payload) => ipcRenderer.invoke('qc:getSession', payload),
    exportBatch: (request) => ipcRenderer.invoke('qc:exportBatch', request),
    processRow: (payload) => ipcRenderer.invoke('qc:processRow', payload),
    processBatchInBackground: (payload) =>
      ipcRenderer.invoke('qc:processBatchInBackground', payload),
    onBatchProcessing: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('qc:batchProcessing', handler)
      return () => ipcRenderer.removeListener('qc:batchProcessing', handler)
    },
  },
  vendorSession: {
    login: (request) => ipcRenderer.invoke('vendorSession:login', request),
  },
  errorEngine: {
    cancelSession: () => ipcRenderer.invoke('errorEngine:cancelSession'),
    relogin: (payload) => ipcRenderer.invoke('errorEngine:relogin', payload),
    executeScrape: (payload) => ipcRenderer.invoke('errorEngine:executeScrape', payload),
  },
  credentials: {
    getStatus: () => ipcRenderer.invoke('credentials:getStatus'),
    getDisplayValues: () => ipcRenderer.invoke('credentials:getDisplayValues'),
    getFormValues: () => ipcRenderer.invoke('credentials:getFormValues'),
    save: (groupId, values) => ipcRenderer.invoke('credentials:save', { groupId, values }),
    saveAll: (items) => ipcRenderer.invoke('credentials:saveAll', { items }),
    clear: (groupId) => ipcRenderer.invoke('credentials:clear', { groupId }),
    test: (groupId, options) =>
      ipcRenderer.invoke('credentials:test', {
        groupId,
        headlessScraping: options?.headlessScraping,
      }),
    encryptionAvailable: () => ipcRenderer.invoke('credentials:encryptionAvailable'),
    onTestLog: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = (_event, payload) => callback(payload)
      ipcRenderer.on('credentials:testLog', handler)
      return () => ipcRenderer.removeListener('credentials:testLog', handler)
    },
    onChanged: (callback) => {
      if (typeof callback !== 'function') return () => {}
      const handler = () => callback()
      ipcRenderer.on('credentials:changed', handler)
      return () => ipcRenderer.removeListener('credentials:changed', handler)
    },
  },
  bitrix24: {
    testConnection: () => ipcRenderer.invoke('bitrix24:testConnection'),
    sendMessage: (payload) => ipcRenderer.invoke('bitrix24:sendMessage', payload),
  },
  export: {
    generateCustomExcel: (request) => ipcRenderer.invoke('export:generateCustomExcel', request),
  },
})
