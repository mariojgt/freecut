export const MEDIA_FILE_PICKER_TYPES = [
  {
    description: 'Media files',
    accept: {
      'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
      'audio/*': ['.mp3', '.wav', '.ogg', '.m4a', '.aac'],
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
      'application/lottie+json': ['.json', '.lottie'],
    },
  },
] satisfies FilePickerAcceptType[]

const FORMAT_LABEL_OVERRIDES: Record<string, string> = {
  webm: 'WebM',
  webp: 'WebP',
}

export function getSupportedMediaFormatLabels(): string[] {
  const extensions = Object.values(MEDIA_FILE_PICKER_TYPES[0]?.accept ?? {}).flat()
  return extensions.map((extension) => {
    const normalized = extension.replace(/^\./, '')
    return FORMAT_LABEL_OVERRIDES[normalized] ?? normalized.toUpperCase()
  })
}

export function hasMediaFilePickerSupport(): boolean {
  return hasNativeMediaFilePickerSupport() || typeof document !== 'undefined'
}

export function hasNativeMediaFilePickerSupport(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

/**
 * A read-only, session-scoped handle around a plain File returned by
 * `<input type="file">`. Copy-mode imports consume the bytes immediately, so
 * Firefox does not need a persistent operating-system file handle.
 */
export function createTransientFileHandle(file: File): FileSystemFileHandle {
  const handle = {
    kind: 'file' as const,
    name: file.name,
    getFile: async () => file,
    queryPermission: async () => 'granted' as PermissionState,
    requestPermission: async () => 'granted' as PermissionState,
    isSameEntry: async (other: FileSystemHandle) => other === handle,
    createWritable: async () => {
      throw new DOMException('Transient file handles are read-only.', 'NotSupportedError')
    },
  }
  return handle as unknown as FileSystemFileHandle
}

function showInputFilePicker(multiple: boolean): Promise<FileSystemFileHandle[]> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('File picker is unavailable outside a browser.'))
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.accept = Object.values(MEDIA_FILE_PICKER_TYPES[0]?.accept ?? {})
      .flat()
      .join(',')
    input.hidden = true

    let settled = false
    const finish = (files: FileSystemFileHandle[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.addEventListener(
      'change',
      () => finish(Array.from(input.files ?? []).map(createTransientFileHandle)),
      { once: true },
    )
    input.addEventListener('cancel', () => finish([]), { once: true })
    document.body.append(input)
    input.click()
  })
}

export async function showMediaFilePicker(options?: {
  multiple?: boolean
}): Promise<FileSystemFileHandle[]> {
  const multiple = options?.multiple ?? true
  if (hasNativeMediaFilePickerSupport()) {
    return window.showOpenFilePicker({
      multiple,
      types: MEDIA_FILE_PICKER_TYPES,
    })
  }
  return showInputFilePicker(multiple)
}
