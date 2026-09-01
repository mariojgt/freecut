import type { ProjectBlock } from '@/types/project'
import { assertDefinedBlockIsSound } from './define-from-svg'
import { getBlock } from './registry'
import type { BlockDefinition } from './types'

/**
 * Rigged blocks as files.
 *
 * A block is worth moving between projects, and the simplest thing that can be
 * moved is a file. The format is deliberately self-describing: a marker and a
 * version, so a project export dropped into the import box is refused by name
 * rather than half-parsed into a broken rig.
 *
 * Pure, so the rules are the same whether a file arrives through the editor or
 * through the API.
 */

const BLOCK_FILE_FORMAT = 'freecut.block'
const BLOCK_FILE_VERSION = 1

interface BlockFile {
  format: typeof BLOCK_FILE_FORMAT
  version: number
  block: ProjectBlock
}

/** Filename-safe, so a block called "Mascot / v2" does not produce a path. */
export function blockFileName(definition: BlockDefinition): string {
  const safe = definition.name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60)
  return `${safe || definition.id}.freecut-block.json`
}

export function serializeBlockFile(block: ProjectBlock): string {
  const file: BlockFile = { format: BLOCK_FILE_FORMAT, version: BLOCK_FILE_VERSION, block }
  return `${JSON.stringify(file, null, 2)}\n`
}

/**
 * Read a block file, refusing anything that would not hold together.
 *
 * Every failure names what was wrong, because the person seeing it picked a file
 * out of a folder and has no other way to tell a block from a project.
 */
export function parseBlockFile(text: string): ProjectBlock {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not JSON.')
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('That file is not a block.')
  const file = parsed as Partial<BlockFile>

  if (file.format !== BLOCK_FILE_FORMAT) {
    throw new Error(
      file.format
        ? `That file is a "${String(file.format)}", not a ${BLOCK_FILE_FORMAT}.`
        : 'That file is not a FreeCut block.',
    )
  }
  if (typeof file.version !== 'number' || file.version > BLOCK_FILE_VERSION) {
    throw new Error(
      `That block was written by a newer version of FreeCut (format ${String(file.version)}).`,
    )
  }

  const block = file.block
  const definition = block?.definition
  if (!definition || typeof definition !== 'object') {
    throw new Error('That block file has no rig in it.')
  }
  if (getBlock(definition.id)) {
    throw new Error(`"${definition.id}" is a built-in block and cannot be imported over.`)
  }
  // The same validator committed artwork faces. A file has had no reviewer since
  // it was written, and may have been hand-edited on the way.
  assertDefinedBlockIsSound(definition)

  const now = Date.now()
  return {
    definition,
    createdAt: typeof block.createdAt === 'number' ? block.createdAt : now,
    updatedAt: now,
    ...(block.origin ? { origin: block.origin } : {}),
  }
}

/**
 * A free id for an incoming block.
 *
 * Importing the same rig twice is a normal thing to do — a second character
 * built from the first — so a collision suffixes rather than refuses.
 */
export function availableBlockId(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted) && !getBlock(wanted)) return wanted
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${wanted}-${suffix}`
    if (!taken.has(candidate) && !getBlock(candidate)) return candidate
  }
  throw new Error(`Could not find a free id based on "${wanted}".`)
}
