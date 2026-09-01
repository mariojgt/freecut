import { toast } from 'sonner'
import { i18n } from '@/i18n'
import { pushProjectToHeadlessWorkspace } from '@/shared/deployment/headless-api'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('SendToMcp')

/**
 * Save the open project, push a portable copy into the server workspace, and
 * report the outcome — the whole flow lives here so the editor component only
 * contributes a one-line callback.
 */
export async function sendProjectToMcpWorkspace(
  projectId: string,
  save: () => Promise<void>,
  expectedRevision: string | null,
): Promise<string | null> {
  try {
    await save()
    const { getProject } = await import('@/infrastructure/storage')
    const stored = await getProject(projectId)
    if (!stored) throw new Error(`Project ${projectId} is missing from the workspace`)
    const revision = await pushProjectToHeadlessWorkspace(stored, expectedRevision)
    const liveUrl = `${window.location.origin}/live/${projectId}`
    toast.success(i18n.t('toolbar.sendToMcpSuccess'), {
      action: {
        label: i18n.t('toolbar.copyLiveLink'),
        onClick: () => void navigator.clipboard.writeText(liveUrl),
      },
    })
    return revision
  } catch (error) {
    logger.error('Failed to send project to the MCP workspace:', error)
    toast.error(i18n.t('toolbar.sendToMcpFailed'))
    return null
  }
}
