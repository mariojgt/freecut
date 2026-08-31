import { createLogger, createOperationId } from '@/shared/logging/logger'

const logger = createLogger('FileAccess')

/**
 * Error thrown when file handle permission is denied or file is missing.
 */
export class FileAccessError extends Error {
  constructor(
    message: string,
    public readonly type: 'permission_denied' | 'file_missing' | 'unknown',
  ) {
    super(message)
    this.name = 'FileAccessError'
  }
}

/**
 * Check and request permission for a file handle.
 * Returns true if permission is granted, false otherwise.
 */
export async function ensureFileHandlePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opId = createOperationId()
  const event = logger.startEvent('file.permission.check', opId)

  try {
    const permissionApi = handle as FileSystemFileHandle & {
      queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
      requestPermission?: (options: { mode: 'read' }) => Promise<PermissionState>
    }
    // Plain File objects selected through Firefox's input picker are wrapped
    // in a transient handle and require no additional permission prompt.
    if (
      typeof permissionApi.queryPermission !== 'function' ||
      typeof permissionApi.requestPermission !== 'function'
    ) {
      event.success({ permission: 'granted', source: 'transient-file' })
      return true
    }

    const permission = await permissionApi.queryPermission({ mode: 'read' })
    event.set('queryPermission', permission)
    if (permission === 'granted') {
      event.success({ permission })
      return true
    }

    const newPermission = await permissionApi.requestPermission({ mode: 'read' })
    event.set('requestPermission', newPermission)
    const granted = newPermission === 'granted'
    event.success({ permission: newPermission })
    return granted
  } catch (error) {
    event.failure(error)
    throw new FileAccessError(
      `Unexpected error checking file permission: ${error instanceof Error ? error.message : String(error)}`,
      'unknown',
    )
  }
}
