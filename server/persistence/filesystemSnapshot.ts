import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { deleteFile, downloadFile, uploadFile } from '@huggingface/hub'

interface FilesystemSnapshotOptions {
  directory: string
  token: string
  bucketId: string
  snapshotPath: string
  intervalMs: number
}

interface FilesystemSnapshotController {
  saveNow: () => Promise<void>
  stop: () => void
}

async function runTar(args: string[]): Promise<void> {
  const process = Bun.spawn(['tar', ...args], {
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const stderr = await new Response(process.stderr).text()
  const exitCode = await process.exited
  if (exitCode !== 0) {
    throw new Error(`tar exited with ${exitCode}: ${stderr.trim()}`)
  }
}

async function listArchiveEntries(archivePath: string): Promise<string[]> {
  const process = Bun.spawn(['tar', '-tzf', archivePath], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exitCode !== 0) {
    throw new Error(`tar could not inspect snapshot: ${stderr.trim()}`)
  }
  return stdout.split('\n').filter(Boolean)
}

function assertSafeArchiveEntries(entries: readonly string[]): void {
  for (const entry of entries) {
    const normalized = entry.replace(/^\.\//, '')
    if (
      normalized.startsWith('/') ||
      normalized.split('/').some((segment) => segment === '..')
    ) {
      throw new Error(`Filesystem snapshot contains an unsafe path: ${entry}`)
    }
  }
}

function hubOptions(options: FilesystemSnapshotOptions) {
  return {
    repo: { type: 'bucket' as const, name: options.bucketId },
    credentials: { accessToken: options.token },
  }
}

/** Restore the durable directory before any subsystem reads files from it. */
export async function restoreFilesystemSnapshot(
  options: FilesystemSnapshotOptions,
): Promise<'restored' | 'empty'> {
  const blob = await downloadFile({
    ...hubOptions(options),
    path: options.snapshotPath,
  })
  if (!blob) {
    await mkdir(options.directory, { recursive: true })
    return 'empty'
  }

  const workDir = await mkdtemp(join(tmpdir(), 'instatic-restore-'))
  const archivePath = join(workDir, 'snapshot.tar.gz')
  const restoredDir = join(workDir, 'restored')
  const absoluteDirectory = resolve(options.directory)
  const parent = dirname(absoluteDirectory)
  const previousDir = join(parent, `.${basename(absoluteDirectory)}-previous`)

  try {
    await Bun.write(archivePath, blob)
    assertSafeArchiveEntries(await listArchiveEntries(archivePath))
    await mkdir(restoredDir, { recursive: true })
    await runTar(['-xzf', archivePath, '-C', restoredDir, '--no-same-owner'])
    await mkdir(parent, { recursive: true })
    await rm(previousDir, { recursive: true, force: true })
    await rename(absoluteDirectory, previousDir).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    })
    try {
      await rename(restoredDir, absoluteDirectory)
      await rm(previousDir, { recursive: true, force: true })
    } catch (err) {
      await rename(previousDir, absoluteDirectory).catch(() => undefined)
      throw err
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
  return 'restored'
}

/** Create and atomically replace the bucket's current filesystem checkpoint. */
export async function saveFilesystemSnapshot(
  options: FilesystemSnapshotOptions,
): Promise<void> {
  const absoluteDirectory = resolve(options.directory)
  await mkdir(absoluteDirectory, { recursive: true })
  const workDir = await mkdtemp(join(tmpdir(), 'instatic-snapshot-'))
  const archivePath = join(workDir, 'snapshot.tar.gz')
  try {
    await runTar([
      '--warning=no-file-changed',
      '--ignore-failed-read',
      '-czf',
      archivePath,
      '-C',
      absoluteDirectory,
      '.',
    ])
    await uploadFile({
      ...hubOptions(options),
      file: {
        path: options.snapshotPath,
        content: Bun.file(archivePath),
      },
    })
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/** Periodic checkpoints are primary; SIGTERM flushing is best-effort insurance. */
export function startFilesystemSnapshots(
  options: FilesystemSnapshotOptions,
): FilesystemSnapshotController {
  let running: Promise<void> | null = null
  let rerun = false

  const saveNow = async (): Promise<void> => {
    if (running) {
      rerun = true
      return running
    }
    running = (async () => {
      do {
        rerun = false
        await saveFilesystemSnapshot(options)
      } while (rerun)
    })().finally(() => {
      running = null
    })
    return running
  }

  const timer = setInterval(() => {
    void saveNow().catch((err) => {
      console.error('[filesystem-snapshot] Periodic checkpoint failed:', err)
    })
  }, options.intervalMs)
  timer.unref()

  return {
    saveNow,
    stop: () => clearInterval(timer),
  }
}

/** Test/maintenance helper for removing a checkpoint from its bucket. */
export async function deleteFilesystemSnapshot(
  options: FilesystemSnapshotOptions,
): Promise<void> {
  await deleteFile({
    ...hubOptions(options),
    path: options.snapshotPath,
  })
}

export type { FilesystemSnapshotOptions, FilesystemSnapshotController }
