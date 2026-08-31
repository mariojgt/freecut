import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  getDockerDeploymentInfo,
  requestDockerUpdate,
  type DockerDeploymentInfo,
} from '@/shared/deployment/docker-update-api'
import {
  armDockerUpdateAutoApply,
  DOCKER_UPDATE_REQUESTED_EVENT,
} from '@/shared/deployment/docker-update-session'
import { cn } from '@/shared/ui/cn'

type RequestState = 'idle' | 'requesting' | 'requested'

interface DockerUpdateButtonProps {
  compact?: boolean
  className?: string
}

export function DockerUpdateButton({ compact = false, className }: DockerUpdateButtonProps) {
  const { t } = useTranslation()
  const [deployment, setDeployment] = useState<DockerDeploymentInfo | null>(null)
  const [requestState, setRequestState] = useState<RequestState>('idle')
  const resetTimeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    void getDockerDeploymentInfo(controller.signal).then((info) => {
      if (!controller.signal.aborted) setDeployment(info)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== undefined) window.clearTimeout(resetTimeoutRef.current)
    }
  }, [])

  const requestUpdate = useCallback(async () => {
    if (requestState !== 'idle') return
    setRequestState('requesting')
    try {
      await requestDockerUpdate()
      armDockerUpdateAutoApply()
      window.dispatchEvent(new Event(DOCKER_UPDATE_REQUESTED_EVENT))
      setRequestState('requested')
      toast.success(t('appShell.dockerUpdate.requested'), {
        description: t('appShell.dockerUpdate.requestedDescription'),
      })
      resetTimeoutRef.current = window.setTimeout(() => {
        setRequestState('idle')
        resetTimeoutRef.current = undefined
      }, 5000)
    } catch {
      setRequestState('idle')
      toast.error(t('appShell.dockerUpdate.failed'), {
        description: t('appShell.dockerUpdate.failedDescription'),
      })
    }
  }, [requestState, t])

  if (!deployment) return null

  const label =
    requestState === 'requesting'
      ? t('appShell.dockerUpdate.checking')
      : requestState === 'requested'
        ? t('appShell.dockerUpdate.requestedShort')
        : t('appShell.dockerUpdate.button')

  return (
    <Button
      type="button"
      variant="outline"
      size={compact ? 'icon' : 'lg'}
      className={cn(compact ? 'h-7 w-7' : 'gap-2 px-4', className)}
      onClick={requestUpdate}
      disabled={requestState !== 'idle'}
      aria-label={t('appShell.dockerUpdate.ariaLabel')}
      data-tooltip={compact ? label : undefined}
      data-tooltip-side="bottom"
      data-testid="docker-update-button"
    >
      {requestState === 'requesting' ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : requestState === 'requested' ? (
        <Check className="h-4 w-4" />
      ) : (
        <RefreshCw className="h-4 w-4" />
      )}
      {!compact && <span>{label}</span>}
    </Button>
  )
}
