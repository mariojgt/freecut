import { toast } from 'sonner'
import { i18n } from '@/i18n'
import {
  HeadlessApiError,
  UNSEEN_SERVER_COPY,
  pushProjectToHeadlessWorkspace,
} from '@/shared/deployment/headless-api'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('SendToMcp')

/** Deliberate second click: discover the server revision and replace it. */
async function overwriteServerCopy(
  projectId: string,
  save: () => Promise<void>,
  onPushed: ((revision: string | null) => void) | undefined,
): Promise<void> {
  try {
    onPushed?.(await pushAndAnnounce(projectId, save, undefined))
  } catch (error) {
    logger.error('Failed to overwrite the MCP workspace copy:', error)
    toast.error(i18n.t('toolbar.sendToMcpFailed'))
  }
}

function isUnseenServerCopy(error: unknown): boolean {
  return error instanceof HeadlessApiError && error.code === UNSEEN_SERVER_COPY
}

async function pushAndAnnounce(
  projectId: string,
  save: () => Promise<void>,
  expectedRevision: string | null | undefined,
): Promise<string | null> {
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
}

/**
 * Save the open project, push a portable copy into the server workspace, and
 * report the outcome — the whole flow lives here so the editor component only
 * contributes a one-line callback.
 */
export async function sendProjectToMcpWorkspace(
  projectId: string,
  save: () => Promise<void>,
  expectedRevision: string | null,
  onPushed?: (revision: string | null) => void,
): Promise<string | null> {
  try {
    const revision = await pushAndAnnounce(projectId, save, expectedRevision)
    onPushed?.(revision)
    return revision
  } catch (error) {
    if (isUnseenServerCopy(error)) {
      // Never silently discard MCP work this editor has not seen: make the
      // overwrite a deliberate second click instead of a dead end.
      toast.warning(i18n.t('toolbar.sendToMcpUnseenServerCopy'), {
        duration: 15_000,
        action: {
          label: i18n.t('toolbar.sendToMcpOverwrite'),
          onClick: () => void overwriteServerCopy(projectId, save, onPushed),
        },
      })
      return null
    }
    logger.error('Failed to send project to the MCP workspace:', error)
    toast.error(i18n.t('toolbar.sendToMcpFailed'))
    return null
  }
}
