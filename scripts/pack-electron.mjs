import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const packDir = path.join(root, 'pack')
/** Build in %TEMP% first — electron-builder rename into project `pack/` can fail under OneDrive/Documents. */
const stagingDir = path.join(os.tmpdir(), 'hony-qc-tool-electron-builder')
const builderConfig = path.join(root, 'electron-builder.yml')
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      ...options,
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

function runNpmScript(scriptName) {
  if (process.platform === 'win32') {
    return run('cmd.exe', ['/d', '/s', '/c', `npm run ${scriptName}`])
  }
  return run('npm', ['run', scriptName])
}

function tryRemoveDir(dir, label) {
  if (!fs.existsSync(dir)) return true
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 750 })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[pack] Warning: could not remove ${label} (${message})`)
    return false
  }
}

function findPortableExe() {
  const unpacked = path.join(packDir, 'win-unpacked')
  if (!fs.existsSync(unpacked)) return null
  const entries = fs.readdirSync(unpacked, { withFileTypes: true })
  const exe = entries.find((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe'))
  return exe ? path.join(unpacked, exe.name) : null
}

function findNsisInstaller() {
  if (!fs.existsSync(packDir)) return null
  const entries = fs.readdirSync(packDir, { withFileTypes: true })
  const setup = entries.find(
    (e) => e.isFile() && e.name.toLowerCase().endsWith('.exe') && /setup/i.test(e.name),
  )
  return setup ? path.join(packDir, setup.name) : null
}

async function main() {
  console.log('[pack] Cleaning previous output…')
  tryRemoveDir(packDir, 'pack/')
  tryRemoveDir(stagingDir, 'staging')

  console.log('[pack] Building production UI (tsc + vite)…')
  await runNpmScript('build')

  console.log('[pack] Running electron-builder (Windows portable + NSIS)…')
  console.log(`[pack] Staging directory: ${stagingDir}`)
  const builderCli = path.join(root, 'node_modules', 'electron-builder', 'cli.js')
  await run(
    process.execPath,
    [
      builderCli,
      '--win',
      'dir',
      'nsis',
      '--config',
      builderConfig,
      `--config.directories.output=${stagingDir}`,
    ],
    { shell: false },
  )

  console.log('[pack] Copying artifacts into pack/…')
  if (!tryRemoveDir(packDir, 'pack/')) {
    console.warn('[pack] Close any running Honey QC Tool / Electron windows and retry if pack/ is stale.')
  }
  fs.mkdirSync(packDir, { recursive: true })
  fs.cpSync(stagingDir, packDir, { recursive: true, force: true })
  tryRemoveDir(stagingDir, 'staging')

  const portableExe = findPortableExe()
  const installerExe = findNsisInstaller()

  console.log('\n[pack] Done.')
  if (portableExe) {
    console.log(`  Portable app: ${portableExe}`)
  } else {
    console.warn('  Portable app: not found (expected pack/win-unpacked/*.exe)')
  }
  if (installerExe) {
    console.log(`  NSIS installer: ${installerExe}`)
  } else {
    console.warn('  NSIS installer: not found (expected pack/*Setup*.exe)')
  }
}

main().catch((err) => {
  console.error('[pack] Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
