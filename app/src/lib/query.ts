import { QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ListObjectsParams, ListObjectsResult } from '../../electron/types'

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
      return window.api.s3.listObjects({ bucket: params.bucket, prefix: params.prefix, token: pageParam, maxKeys: 1000 })
    }
  })
}
