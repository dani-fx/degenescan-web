import fs from 'node:fs'
import path from 'node:path'

export function dataPath(fileName: string): string {
  return path.join(/* turbopackIgnore: true */ process.env.DATA_DIR || path.join(process.cwd(), 'data'), fileName)
}

export async function atomicWrite(filePath: string, data: Uint8Array | string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(tempPath, data)
  await fs.promises.rename(tempPath, filePath)
}

export function atomicWriteSync(filePath: string, data: Uint8Array | string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tempPath, data)
  fs.renameSync(tempPath, filePath)
}

export function createMutationQueue(): <T>(mutation: () => Promise<T> | T) => Promise<T> {
  let tail = Promise.resolve()
  return async <T>(mutation: () => Promise<T> | T): Promise<T> => {
    const result = tail.then(mutation, mutation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}

export async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
