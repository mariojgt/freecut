import { useEffect, useState } from 'react'
import { detectHeadlessApi } from '@/shared/deployment/headless-api'

/** True once the deployment probe finds the headless API behind /api/headless. */
export function useMcpWorkspaceAvailable(): boolean {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void detectHeadlessApi(controller.signal).then((detected) => {
      if (!controller.signal.aborted) setAvailable(detected)
    })
    return () => controller.abort()
  }, [])

  return available
}
