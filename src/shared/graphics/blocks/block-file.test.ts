// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { ProjectBlock } from '@/types/project'
import { availableBlockId, blockFileName, parseBlockFile, serializeBlockFile } from './block-file'

const entry = (overrides: Partial<ProjectBlock['definition']> = {}): ProjectBlock => ({
  definition: {
    id: 'local-mascot',
    name: 'Mascot',
    category: 'character',
    width: 200,
    height: 400,
    parts: [
      { id: 'torso', label: 'Torso', d: 'M 0 0 L 60 0 L 60 140 Z', fill: 'primary', z: 0 },
      {
        id: 'arm',
        label: 'Arm',
        d: 'M 60 10 L 84 10 L 84 100 Z',
        parent: 'torso',
        pivot: [70, 15],
        fill: 'ink',
        z: 1,
      },
    ],
    ...overrides,
  },
  createdAt: 111,
  updatedAt: 222,
})

describe('serializeBlockFile', () => {
  it('round-trips a block', () => {
    const original = entry()
    const read = parseBlockFile(serializeBlockFile(original))
    expect(read.definition).toEqual(original.definition)
  })

  it('preserves when the rig was first made, but restamps the edit time', () => {
    const read = parseBlockFile(serializeBlockFile(entry()))
    expect(read.createdAt).toBe(111)
    expect(read.updatedAt).toBeGreaterThan(222)
  })

  it('writes a self-describing envelope', () => {
    const file = JSON.parse(serializeBlockFile(entry()))
    expect({ format: file.format, version: file.version }).toEqual({
      format: 'freecut.block',
      version: 1,
    })
  })

  it('ends with a newline, so the file is well formed for a text editor', () => {
    expect(serializeBlockFile(entry()).endsWith('\n')).toBe(true)
  })
})

describe('parseBlockFile', () => {
  it('refuses something that is not JSON', () => {
    expect(() => parseBlockFile('<svg/>')).toThrow(/not JSON/)
  })

  it('refuses a file of another kind, and names what it is', () => {
    // Dropping a project export into the block importer is the likely mistake.
    expect(() => parseBlockFile('{"format":"freecut.project","version":1}')).toThrow(
      /is a "freecut.project", not a freecut.block/,
    )
  })

  it('refuses an unmarked file', () => {
    expect(() => parseBlockFile('{"block":{}}')).toThrow(/not a FreeCut block/)
  })

  it('refuses a file from a newer FreeCut', () => {
    expect(() => parseBlockFile('{"format":"freecut.block","version":99,"block":{}}')).toThrow(
      /newer version/,
    )
  })

  it('refuses an envelope with no rig in it', () => {
    expect(() => parseBlockFile('{"format":"freecut.block","version":1}')).toThrow(/no rig/)
  })

  it('refuses a rig that would not hold together', () => {
    // Hand-edited on the way, most likely — the file had no reviewer.
    const broken = serializeBlockFile(
      entry({
        parts: [
          { id: 'arm', label: 'Arm', d: 'M 0 0 L 1 0 L 1 1 Z', parent: 'ghost', fill: 'ink', z: 0 },
        ],
      }),
    )
    expect(() => parseBlockFile(broken)).toThrow(/not sound/)
  })

  it('refuses to import over built-in artwork', () => {
    const forged = serializeBlockFile(entry({ id: 'character-astronaut' }))
    expect(() => parseBlockFile(forged)).toThrow(/built-in block/)
  })
})

describe('blockFileName', () => {
  it('names the file after the block', () => {
    expect(blockFileName(entry().definition)).toBe('mascot.freecut-block.json')
  })

  it('cannot produce a path from a block name', () => {
    const name = blockFileName({ ...entry().definition, name: 'Mascot / v2' })
    expect(name).toBe('mascot-v2.freecut-block.json')
    expect(name.includes('/')).toBe(false)
  })

  it('falls back to the id when a name reduces to nothing', () => {
    expect(blockFileName({ ...entry().definition, name: '???' })).toBe(
      'local-mascot.freecut-block.json',
    )
  })
})

describe('availableBlockId', () => {
  it('keeps the wanted id when it is free', () => {
    expect(availableBlockId('local-mascot', new Set())).toBe('local-mascot')
  })

  it('suffixes rather than refusing, because importing twice is normal', () => {
    expect(availableBlockId('local-mascot', new Set(['local-mascot']))).toBe('local-mascot-2')
    expect(availableBlockId('local-mascot', new Set(['local-mascot', 'local-mascot-2']))).toBe(
      'local-mascot-3',
    )
  })

  it('never hands back a committed id', () => {
    expect(availableBlockId('character-astronaut', new Set())).toBe('character-astronaut-2')
  })
})
