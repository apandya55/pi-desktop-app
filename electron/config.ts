import { CONFIG_DIR_NAME, getAgentDir, getPackageDir } from '@earendil-works/pi-coding-agent'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import type { TSchema } from 'typebox'
import { Compile } from 'typebox/compile'
import type { ConfigDocument, ConfigFile } from '../src/shared/types'

const files = {
  global: { name: 'settings.json', initial: '{}\n' },
  project: { name: 'settings.json', initial: '{}\n' },
  models: { name: 'models.json', initial: '{\n  "providers": {}\n}\n' },
} satisfies Record<ConfigFile, { name: string; initial: string }>
const schemas = new Map<string, ReturnType<typeof Compile>>()
const maxBytes = 1024 * 1024

function getPath(file: ConfigFile, workspace?: string) {
  if (!Object.hasOwn(files, file)) throw new Error('Unknown configuration file.')
  if (file === 'project' && !workspace) throw new Error('Open a workspace to configure it.')
  return join(file === 'project' ? join(workspace!, CONFIG_DIR_NAME) : getAgentDir(), files[file].name)
}

function read(path: string) {
  try {
    const content = readFileSync(path, 'utf8')
    if (Buffer.byteLength(content) > maxBytes) throw new Error('This file is too large for the settings editor.')
    return content
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

function version(content: string | undefined) {
  return content === undefined ? 'missing' : createHash('sha256').update(content).digest('hex')
}

function validate(file: ConfigFile, text: string) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > maxBytes) throw new Error('The file must be under 1 MB.')
  const content = text.replace(/^\uFEFF/, '')
  // Pi accepts line comments and trailing commas specifically in models.json.
  const json = file === 'models' ? content
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (match) => match.startsWith('"') ? match : '')
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail: string | undefined) => tail ?? match) : content
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    const location = /line \d+ column \d+/.exec((error as Error).message)?.[0]
    throw new Error(location ? 'Invalid JSON at ' + location + '.' : 'Invalid JSON. Check the file syntax.')
  }
  const name = file === 'models' ? 'models' : 'settings'
  let schema = schemas.get(name)
  if (!schema) {
    const definition = JSON.parse(readFileSync(join(getPackageDir(), 'schemas', `${name}.schema.json`), 'utf8')) as TSchema
    schema = Compile(definition)
    schemas.set(name, schema)
  }
  const issue = schema.Errors(value)[0]
  if (issue) throw new Error(`${issue.instancePath || files[file].name} ${issue.message}.`)
}

export function readConfig(file: ConfigFile, workspace?: string): ConfigDocument {
  const path = getPath(file, workspace)
  const content = read(path)
  return { path, text: content ?? files[file].initial, version: version(content) }
}

export function writeConfig(file: ConfigFile, text: string, expectedVersion: string, workspace?: string): ConfigDocument {
  const path = getPath(file, workspace)
  validate(file, text)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const unlock = lockSync(path, { realpath: false })
  try {
    const current = read(path)
    if (version(current) !== expectedVersion) throw new Error('This file changed on disk. Copy any edits you want to keep, then use Revert to reload it.')
    if (text !== current) {
      const target = current === undefined ? path : realpathSync(path)
      const temp = join(dirname(target), `.${files[file].name}.${randomUUID()}.tmp`)
      try {
        writeFileSync(temp, text, { mode: 0o600, flag: 'wx' })
        renameSync(temp, target)
      } finally {
        try { unlinkSync(temp) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    }
    return { path, text, version: version(text) }
  } finally {
    unlock()
  }
}
