// Launcher for the Hacknet Pathfinder Bridge MCP host.
//
// The host is a .NET console program that speaks one JSON-RPC message per line
// over stdin/stdout. It must be started as `dotnet HacknetPathfinderBridge.Host.dll`:
// starting the apphost .exe instead puts the process at Low integrity on this
// machine, where opening the game's Medium-integrity named pipe fails with
// "Access to the path is denied" (the MCP handshake and instance listing still
// work, so the failure only appears on the first pipe-backed call).
//
// Environment:
//   HACKNET_BRIDGE_HOST      absolute path to HacknetPathfinderBridge.Host.dll
//                            (a legacy .exe path is mapped to the .dll beside it)
//   HACKNET_BRIDGE_REGISTRY  optional isolated instance-registry directory
//
// Diagnostics go to launch.log next to this file (truncated per start, bounded).
import { createWriteStream, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const logPath = process.env.HACKNET_BRIDGE_LOG || join(here, 'launch.log')
const LOG_LIMIT = 512 * 1024

let hostDll = join(here, 'host-independent-events', 'HacknetPathfinderBridge.Host.dll')
let migration = ''
const configured = process.env.HACKNET_BRIDGE_HOST
if (configured) {
  if (/\.exe$/i.test(configured)) {
    hostDll = configured.replace(/\.exe$/i, '.dll')
    migration = `HACKNET_BRIDGE_HOST points at an .exe (${configured}). ` +
      `Starting the apphost puts the host at Low integrity and breaks named-pipe calls; ` +
      `using ${hostDll} instead. Update the variable to the .dll path.\n`
  } else {
    hostDll = configured
  }
}

const log = createWriteStream(logPath, { flags: 'w' })
log.write(`# ${new Date().toISOString()} launcher start\n# host ${hostDll}\n`)
if (migration) log.write(`# ${migration}`)

let logged = 0
function record(kind, chunk) {
  if (logged >= LOG_LIMIT) return
  const text = chunk.toString('utf8')
  logged += text.length
  log.write(`${kind} ${text}`)
}

function fail(message) {
  log.write(`# ${message}`)
  log.end()
  process.stderr.write(message)
  process.exit(1)
}

const sidecars = [
  join(dirname(hostDll), 'HacknetPathfinderBridge.Host.deps.json'),
  join(dirname(hostDll), 'HacknetPathfinderBridge.Host.runtimeconfig.json'),
]
if (!existsSync(hostDll)) {
  fail(`HacknetPathfinderBridge host not found: ${hostDll}\n` +
    'Set HACKNET_BRIDGE_HOST to the built HacknetPathfinderBridge.Host.dll.\n')
}
const missing = sidecars.filter((file) => !existsSync(file))
if (missing.length > 0) {
  fail(`HacknetPathfinderBridge host is incomplete, missing: ${missing.join(', ')}\n` +
    'Copy the whole Host build output (.dll, .deps.json, .runtimeconfig.json).\n')
}

// The DSH desktop process does not always inherit a usable PATH, so prefer an
// explicit dotnet.exe and fall back to PATH lookup.
const dotnetCandidates = [
  process.env.DOTNET_HOST_PATH,
  process.env.DOTNET_ROOT && join(process.env.DOTNET_ROOT, 'dotnet.exe'),
  join(process.env.ProgramFiles || 'C:/Program Files', 'dotnet', 'dotnet.exe'),
  'dotnet',
].filter(Boolean)
const dotnet = dotnetCandidates.find((candidate) => candidate === 'dotnet' || existsSync(candidate))
if (dotnet === undefined) {
  fail('dotnet.exe was not found. Install the .NET 10 runtime, or set DOTNET_ROOT / PATH.\n')
}

const args = [hostDll]
if (process.env.HACKNET_BRIDGE_REGISTRY) args.push('--registry', process.env.HACKNET_BRIDGE_REGISTRY)

const child = spawn(dotnet, args, {
  cwd: dirname(hostDll),
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

log.write(`# ${dotnet} pid ${child.pid} args ${JSON.stringify(args)}\n`)
if (migration) process.stderr.write(migration)

child.on('error', (error) => {
  const hint = error.code === 'ENOENT'
    ? 'dotnet.exe could not be started. Install the .NET 10 runtime (dotnet --list-runtimes) ' +
      'or set DOTNET_ROOT.\n'
    : `HacknetPathfinderBridge host failed to start: ${error.message}\n`
  log.write(`# spawn error ${error.message}\n`)
  process.stderr.write(hint)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  log.write(`# exit ${code} ${signal}\n`)
  log.end()
  if (process.exitCode === undefined) process.exitCode = code ?? 1
})

child.stdout.on('data', (chunk) => {
  record('OUT', chunk)
  process.stdout.write(chunk)
})

child.stderr.on('data', (chunk) => {
  record('ERR', chunk)
  process.stderr.write(chunk)
})

process.stdin.on('data', (chunk) => {
  record('IN', chunk)
  child.stdin.write(chunk)
})

process.stdin.on('end', () => child.stdin.end())
process.stdout.on('error', () => {})
process.on('SIGTERM', () => child.kill())
process.on('SIGINT', () => child.kill())
