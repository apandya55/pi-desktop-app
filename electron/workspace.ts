import { execFile } from 'node:child_process'
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { GitDiff, GitStatus, Workspace } from '../src/shared/types'

const exec = promisify(execFile)
const maxFiles = 20_000
const maxDiff = 240_000

export async function describeWorkspace(path: string): Promise<Workspace> {
  const canonical = await realpath(path)
  if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a folder to open.')
  return { path: canonical, name: basename(canonical) || canonical }
}

async function git(cwd: string, args: string[], acceptChanges = false): Promise<string> {
  try {
    const { stdout } = await exec('git', ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotePath=false', '-c', 'core.fsmonitor=false', ...args], {
      cwd, env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 12_000,
    })
    return stdout
  } catch (error) {
    if (acceptChanges && (error as { code?: number }).code === 1) {
      return (error as { stdout: string }).stdout
    }
    throw error
  }
}

export async function workspaceFiles(cwd: string): Promise<string[]> {
  try {
    const out = await git(cwd, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'])
    return [...new Set(out.split('\0').filter(Boolean))].slice(0, maxFiles)
  } catch {
    const files: string[] = []
    const directories = ['']
    const ignored = new Set(['.git', '.svn', '.hg', 'node_modules', 'dist', 'out', '.venv', '.DS_Store'])
    for (const directory of directories) {
      if (files.length >= maxFiles || directories.length > maxFiles) break
      const entries = await readdir(join(cwd, directory), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (ignored.has(entry.name)) continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) directories.push(path)
        if (entry.isFile()) files.push(path)
        if (files.length >= maxFiles || directories.length > maxFiles) break
      }
    }
    return files
  }
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  let records: string[]
  try {
    records = (await git(cwd, ['status', '--porcelain=v1', '-z', '-b', '-uall', '--', '.'])).split('\0')
  } catch (error) {
    if ((error as { code?: number }).code === 128 &&
      (error as { stderr?: string }).stderr?.includes('not a git repository')) {
      return { branch: null, changes: [] }
    }
    if ((error as { code?: string }).code === 'ENOENT') return { branch: null, changes: [] }
    throw error
  }

  const branchLine = records.shift()?.slice(3) ?? ''
  const branch = branchLine === 'HEAD (no branch)'
    ? (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim()
    : branchLine.replace(/^(No commits yet on |Initial commit on )/, '').split('...')[0]
  const root = await repositoryRoot(cwd)
  const changes: GitStatus['changes'] = []

  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (!record) continue
    const status = record.slice(0, 2)
    const path = relative(cwd, resolve(root, record.slice(3)))
    const previousPath = /[RC]/.test(status) ? relative(cwd, resolve(root, records[++index])) : undefined
    changes.push({ path, status, previousPath })
  }
  return { branch, changes }
}

async function repositoryRoot(cwd: string) {
  return (await git(cwd, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '')
}

export async function gitDiff(cwd: string, path: string): Promise<GitDiff> {
  const target = resolve(cwd, path)
  if (isAbsolute(path) || !target.startsWith(cwd === sep ? sep : cwd + sep) || target === cwd) {
    throw new Error('Choose a file within the workspace.')
  }
  const change = (await gitStatus(cwd)).changes.find((item) => item.path === path)
  if (!change) return { text: '', truncated: false }
  const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color']
  let diff = ''
  try {
    if (change.status === '??') {
      diff = await git(cwd, [...args, '--no-index', '--', '/dev/null', path], true)
    } else {
      const paths = change.previousPath ? [change.previousPath, path] : [path]
      const [staged, unstaged] = await Promise.all([
        git(cwd, [...args, '--cached', '--', ...paths]),
        git(cwd, [...args, '--', ...paths]),
      ])
      const stagedText = staged && unstaged ? 'Staged\n' + staged + '\nUnstaged\n' : staged
      diff = stagedText + unstaged
    }
  } catch (error) {
    if ((error as { code?: string }).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error
    return { text: (error as { stdout?: string }).stdout?.slice(0, maxDiff) ?? '', truncated: true }
  }
  return { text: diff.slice(0, maxDiff), truncated: diff.length > maxDiff }
}
