import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import type { ProjectBlock } from '@/types/project'
import { BlockRigEditor } from './block-rig-editor'

const entry = (parts?: ProjectBlock['definition']['parts']): ProjectBlock => ({
  definition: {
    id: 'local-mascot',
    name: 'Mascot',
    category: 'character',
    width: 200,
    height: 400,
    parts: parts ?? [
      { id: 'torso', label: 'Torso', d: 'M 0 0 L 60 0 L 60 140 Z', fill: 'primary', z: 0 },
      { id: 'arm', label: 'Arm', d: 'M 60 10 L 84 10 L 84 100 Z', fill: 'ink', z: 1 },
    ],
  },
  createdAt: 1,
  updatedAt: 1,
})

/**
 * The preview letterboxes, so the test states the box it is measured against.
 * Queried from the document because the dialog renders through a portal.
 */
function previewSvg(): Element {
  const svg = document.querySelector('[data-rig-preview="true"]')
  expect(svg).not.toBeNull()
  return svg!
}

function stubPreviewGeometry(): void {
  const svg = previewSvg()
  Object.defineProperty(svg, 'getBoundingClientRect', {
    // 200x400 content in a 200x400 box: scale 1, no letterboxing to correct for.
    value: () => ({ left: 0, top: 0, width: 200, height: 400, right: 200, bottom: 400 }),
  })
}

/** The definition handed to onSave, asserted to exist so a miss fails clearly. */
function savedDefinition(onSave: { mock: { calls: unknown[][] } }): ProjectBlock['definition'] {
  const call = onSave.mock.calls[0]
  expect(call).toBeDefined()
  return call![0] as ProjectBlock['definition']
}

describe('BlockRigEditor', () => {
  it('renders nothing without a block', () => {
    const { container } = render(<BlockRigEditor entry={null} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(container.textContent).toBe('')
  })

  it('lists every part and selects the first', () => {
    render(<BlockRigEditor entry={entry()} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Torso' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Arm' })).toBeTruthy()
    expect(screen.getByDisplayValue('Torso')).toBeTruthy()
  })

  it('saves a renamed block and part', () => {
    const onSave = vi.fn()
    render(<BlockRigEditor entry={entry()} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.change(screen.getByDisplayValue('Mascot'), { target: { value: 'Hero' } })
    fireEvent.change(screen.getByDisplayValue('Torso'), { target: { value: 'Body' } })
    fireEvent.click(screen.getByText('Save'))

    const saved = savedDefinition(onSave)
    expect(saved.name).toBe('Hero')
    expect(saved.parts.find((part) => part.id === 'torso')?.label).toBe('Body')
  })

  it('parents one part to another', () => {
    const onSave = vi.fn()
    render(<BlockRigEditor entry={entry()} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Arm' }))
    fireEvent.change(screen.getByDisplayValue('None (root)'), { target: { value: 'torso' } })
    fireEvent.click(screen.getByText('Save'))
    expect(savedDefinition(onSave).parts.find((part) => part.id === 'arm')?.parent).toBe('torso')
  })

  it('never offers a parent that would close a loop', () => {
    // torso -> arm already; offering `arm` as the torso's parent would make a
    // cycle the rig cannot resolve.
    render(
      <BlockRigEditor
        entry={entry([
          { id: 'torso', label: 'Torso', d: 'M 0 0 L 60 0 L 60 140 Z', fill: 'primary', z: 0 },
          {
            id: 'arm',
            label: 'Arm',
            d: 'M 60 10 L 84 10 L 84 100 Z',
            parent: 'torso',
            fill: 'ink',
            z: 1,
          },
        ])}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )
    const parentSelect = screen.getByDisplayValue('None (root)') as HTMLSelectElement
    expect([...parentSelect.options].map((option) => option.value)).toEqual([''])
  })

  it('places a joint where the preview is clicked', () => {
    const onSave = vi.fn()
    render(<BlockRigEditor entry={entry()} onClose={vi.fn()} onSave={onSave} />)
    stubPreviewGeometry()
    fireEvent.click(screen.getByText('Set joint'))
    fireEvent.click(previewSvg(), { clientX: 70, clientY: 15 })
    fireEvent.click(screen.getByText('Save'))

    expect(savedDefinition(onSave).parts[0]?.pivot).toEqual([70, 15])
  })

  it('ignores preview clicks until asked for a joint', () => {
    const onSave = vi.fn()
    render(<BlockRigEditor entry={entry()} onClose={vi.fn()} onSave={onSave} />)
    stubPreviewGeometry()
    fireEvent.click(previewSvg(), { clientX: 70, clientY: 15 })
    fireEvent.click(screen.getByText('Save'))
    expect(savedDefinition(onSave).parts[0]?.pivot).toBeUndefined()
  })

  it('clears a joint back to the part centre', () => {
    const onSave = vi.fn()
    render(
      <BlockRigEditor
        entry={entry([
          {
            id: 'torso',
            label: 'Torso',
            d: 'M 0 0 L 60 0 L 60 140 Z',
            fill: 'primary',
            pivot: [10, 20],
            z: 0,
          },
        ])}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    )
    fireEvent.click(screen.getByText('Clear'))
    fireEvent.click(screen.getByText('Save'))
    expect(savedDefinition(onSave).parts[0]?.pivot).toBeUndefined()
  })

  it('refuses to save a rig that would not hold together', () => {
    // The same rule the API applies, enforced where the mistake is being made.
    render(
      <BlockRigEditor
        entry={entry([{ id: 'orphan', label: 'Orphan', d: 'M 0 0 L 1 0 L 1 1 Z', z: 0 }])}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )
    expect(screen.getByText(/draw nothing/)).toBeTruthy()
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('discards an abandoned edit rather than carrying it to the next block', () => {
    const { rerender } = render(
      <BlockRigEditor entry={entry()} onClose={vi.fn()} onSave={vi.fn()} />,
    )
    fireEvent.change(screen.getByDisplayValue('Mascot'), { target: { value: 'Edited' } })
    rerender(<BlockRigEditor entry={null} onClose={vi.fn()} onSave={vi.fn()} />)
    rerender(<BlockRigEditor entry={entry()} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByDisplayValue('Mascot')).toBeTruthy()
  })
})
