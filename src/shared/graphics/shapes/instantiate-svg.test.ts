import { describe, expect, it } from 'vite-plus/test'
import { importSvgSource } from './svg-document-import'
import { instantiateSvgLayers, MAX_EDITABLE_SVG_PATHS } from './instantiate-svg'

const SVG = `
<svg viewBox="10 20 200 100" xmlns="http://www.w3.org/2000/svg">
  <rect id="back" x="10" y="20" width="200" height="100" fill="#123456" />
  <path id="line" d="M 60 45 L 160 95" fill="none" stroke="#abcdef" stroke-width="4" />
</svg>`

describe('instantiateSvgLayers', () => {
  it('contain-fits contours, preserves paint, and reverses painter order into tracks', () => {
    const document = importSvgSource(SVG, { idPrefix: 'art' })
    const result = instantiateSvgLayers(document, {
      name: 'Artwork',
      idPrefix: 'art',
      from: 24,
      durationInFrames: 120,
      baseTrackOrder: -3,
      canvasWidth: 1000,
      canvasHeight: 500,
      fitRatio: 0.8,
      x: 20,
      y: -10,
    })

    expect(result.groupTrackId).toBe('art-group')
    expect(result.tracks[0]).toMatchObject({
      id: 'art-group',
      name: 'Artwork',
      order: -3,
      isGroup: true,
      isCollapsed: true,
    })
    expect(result.items.map((item) => item.label)).toEqual(['line', 'back'])
    expect(result.tracks.slice(1).map((track) => track.name)).toEqual(['line', 'back'])
    expect(result.tracks.slice(1).every((track) => track.parentTrackId === 'art-group')).toBe(true)

    const line = result.items[0]!
    expect(line).toMatchObject({
      id: 'art-1-0',
      from: 24,
      durationInFrames: 120,
      fillEnabled: false,
      strokeEnabled: true,
      strokeColor: '#abcdef',
      strokeWidth: 16,
      pathClosed: false,
      transform: {
        x: 20,
        y: -10,
        width: 400,
        height: 200,
        aspectRatioLocked: false,
      },
    })
    expect(result.items[1]).toMatchObject({
      fillColor: '#123456',
      fillEnabled: true,
      transform: { x: 20, y: -10, width: 800, height: 400 },
    })
  })

  it('reports compound contours and rejects impractically large editable imports', () => {
    const compound = importSvgSource(
      '<svg viewBox="0 0 20 20"><path d="M0 0H20V20H0Z M5 5H15V15H5Z" /></svg>',
      { idPrefix: 'compound' },
    )
    const imported = instantiateSvgLayers(compound, {
      name: 'Compound',
      idPrefix: 'compound',
      from: 0,
      durationInFrames: 30,
      baseTrackOrder: 0,
      canvasWidth: 100,
      canvasHeight: 100,
    })
    expect(imported.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining('Compound-path holes') }),
      ]),
    )

    expect(() =>
      instantiateSvgLayers(
        {
          viewBox: { minX: 0, minY: 0, width: 10, height: 10 },
          paths: Array.from({ length: MAX_EDITABLE_SVG_PATHS + 1 }, (_, index) => ({
            ...compound.paths[0]!,
            id: `too-many-${index}`,
            z: index,
          })),
          warnings: [],
        },
        {
          name: 'Too many',
          idPrefix: 'too-many',
          from: 0,
          durationInFrames: 30,
          baseTrackOrder: 0,
          canvasWidth: 100,
          canvasHeight: 100,
        },
      ),
    ).toThrow(`support up to ${MAX_EDITABLE_SVG_PATHS}`)
  })
})
