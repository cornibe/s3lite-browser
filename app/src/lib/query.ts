import { QueryClient, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import type { DeleteObjectsParams, DeleteResult, ListObjectsParams, ListObjectsResult } from '../../electron/types'
import { useStore } from './store'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000
    }
  }
})

export function useBuckets(enabled: boolean, profile?: string) {
  return useQuery({
    queryKey: ['buckets', profile ?? ''],
    queryFn: () => window.api.s3.listBuckets(),
    enabled
  })
}

export function useObjects(params: Omit<ListObjectsParams, 'token' | 'maxKeys'> & { enabled: boolean; profile?: string }) {
  return useInfiniteQuery<ListObjectsResult, Error>({
    queryKey: ['objects', params.profile ?? '', params.bucket, params.prefix ?? ''],
    enabled: params.enabled && Boolean(params.bucket),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextToken,
    queryFn: async ({ pageParam }) => {
      return window.api.s3.listObjects({ bucket: params.bucket, prefix: params.prefix, token: pageParam as string | undefined, maxKeys: 1000 })
    }
  })
}

export function useDeleteObjects() {
  const { showToast } = useStore()
  return useMutation<
    { ok: true; result: DeleteResult } | { ok: false; error: string },
    Error,
    DeleteObjectsParams
  >({
    mutationFn: (params: DeleteObjectsParams) => window.api.s3.deleteObjects(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['objects'] })
    },
    onError: (error) => {
      showToast({
        type: 'error',
        message: `Delete failed: ${error.message}`
      });
    }
  })
}

export function useUploads() {
  const { showToast, registerJobForActiveTab } = useStore()
  return useMutation<
    { ok: true; jobId: string } | { ok: false; error: string },
    Error,
    { bucket: string; prefix: string; files: any[] }
  >({
    mutationFn: (params) => window.api.transfers.startUpload(params),
    onSuccess: (result) => {
      if ((result as any).ok && (result as any).jobId) {
        const { jobId } = result as { ok: true; jobId: string }
        registerJobForActiveTab(jobId)
      } else if (!(result as any).ok) {
        const { error } = result as { ok: false; error: string }
        showToast({
          type: 'error',
          message: `Upload failed: ${error}`
        });
      }
    },
    onError: (error) => {
      showToast({
        type: 'error',
        message: `Upload failed: ${error.message}`
      });
    }
  })
}
