import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { deleteFile, uploadFile } from '@huggingface/hub'
import type {
  MediaAssetRole,
  MediaStorageAdapter,
  MediaStorageBeginWriteInput,
  MediaStorageFinalizeWriteInput,
  MediaStorageUploadPlan,
  MediaStorageVerifyResult,
  MediaStorageWriteResult,
} from '@core/plugin-sdk'
import { LOCAL_DISK_STEP_METHOD } from '@core/plugins/mediaStorageRegistry'

const HF_API_BASE = 'https://huggingface.co/api/buckets'
const HF_PUBLIC_BASE = 'https://huggingface.co/buckets'
const ADAPTER_ID = 'huggingface'

interface HuggingfaceAdapterOptions {
  token: string
  bucketId: string
}

const SUPPORTED_ROLES: readonly MediaAssetRole[] = [
  'original',
  'variant',
  'avatar',
  'font',
]

function stagingPath(storagePath: string): string {
  return join(tmpdir(), 'instatic-huggingface', encodeURIComponent(storagePath))
}

function publicUrl(bucketId: string, storagePath: string): string {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/')
  return `${HF_PUBLIC_BASE}/${bucketId}/resolve/${encodedPath}`
}

function buildHuggingfaceAdapter(options: HuggingfaceAdapterOptions): MediaStorageAdapter {
  const repo = { type: 'bucket' as const, name: options.bucketId }
  const credentials = { accessToken: options.token }

  return {
    id: ADAPTER_ID,
    label: 'Hugging Face Storage',
    roles: SUPPORTED_ROLES,
    servingMode: 'public-url',
    cspOrigins: [
      { directive: 'img-src', origin: 'huggingface.co' },
      { directive: 'img-src', origin: 'cas-bridge-direct.xethub.hf.co' },
      { directive: 'media-src', origin: 'huggingface.co' },
      { directive: 'media-src', origin: 'cas-bridge-direct.xethub.hf.co' },
    ],

    beginWrite: async (
      input: MediaStorageBeginWriteInput,
    ): Promise<MediaStorageUploadPlan> => {
      return {
        storagePath: input.suggestedStoragePath,
        steps: [
          {
            method: LOCAL_DISK_STEP_METHOD as unknown as 'PUT',
            url: pathToFileURL(stagingPath(input.suggestedStoragePath)).href,
            headers: {},
          },
        ],
        expiresAt: Date.now() + 15 * 60 * 1000,
      }
    },

    finalizeWrite: async (
      input: MediaStorageFinalizeWriteInput,
    ): Promise<MediaStorageWriteResult> => {
      const temporaryPath = stagingPath(input.storagePath)
      try {
        await uploadFile({
          repo,
          file: {
            path: input.storagePath,
            content: Bun.file(temporaryPath),
          },
          credentials,
        })
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => undefined)
      }
      return { publicUrl: publicUrl(options.bucketId, input.storagePath) }
    },

    abortWrite: async ({ storagePath }) => {
      await rm(stagingPath(storagePath), { force: true })
    },

    delete: async (storagePath: string) => {
      await deleteFile({ repo, path: storagePath, credentials })
    },

    verify: async (): Promise<MediaStorageVerifyResult> => {
      try {
        const response = await fetch(`${HF_API_BASE}/${options.bucketId}`, {
          headers: { Authorization: `Bearer ${options.token}` },
        })
        if (response.ok) return { ok: true }
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            reason: `Hugging Face API returned ${response.status}; the token may lack write permission`,
            hint: 'Generate a User Access Token with write scope at https://huggingface.co/settings/tokens',
          }
        }
        return {
          ok: false,
          reason: `Hugging Face API returned ${response.status}`,
          hint: 'Verify HF_BUCKET_ID and HF_TOKEN are correct',
        }
      } catch (err) {
        return {
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
          hint: 'Check network connectivity to huggingface.co',
        }
      }
    },
  }
}

export function createHuggingfaceAdapter(
  token: string,
  bucketId: string,
): MediaStorageAdapter | null {
  if (!token || !bucketId) return null
  if (!/^[^/]+\/[^/]+$/.test(bucketId)) {
    console.error(
      '[hf-storage] HF_BUCKET_ID must be in the format "username/bucket-name"',
    )
    return null
  }
  return buildHuggingfaceAdapter({ token, bucketId })
}
