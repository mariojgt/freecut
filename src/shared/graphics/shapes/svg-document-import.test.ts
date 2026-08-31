// @vitest-environment jsdom

import { describe, expect, it } from 'vite-plus/test'
import { importSvgSource, parseTransform } from './svg-document-import'

const wrap = (body: string, attributes = 'viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`

const importOne = (body: string, attributes?: string) =>
  importSvgSource(wrap(body, attributes)).paths[0]

describe('parseTransform', () => {
  it('returns identity for a missing or empty transform', () => {
    expect(parseTransform(null)).toEqual([1, 0, 0, 1, 0, 0])
    expect(parseTransform('')).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('reads translate, scale and matrix', () => {
    expect(parseTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20])
    expect(parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0])
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('mirrors a single scale argument onto both axes', () => {
    expect(parseTransform('scale(3)')).toEqual(parseTransform('scale(3 3)'))
  })

  it('composes left to right, so the last listed applies first', () => {
    // translate then scale: the scale must not move the translation.
    expect(parseTransform('translate(10 0) scale(2)')).toEqual([2, 0, 0, 2, 10, 0])
  })

  it('rotates about a point when given a centre', () => {
    const [a, b, c, d, e, f] = parseTransform('rotate(90 10 10)')
    // (10,10) is the fixed point of the rotation.
    expect(a * 10 + c * 10 + e).toBeCloseTo(10, 9)
    expect(b * 10 + d * 10 + f).toBeCloseTo(10, 9)
  })

  it('ignores an unknown transform function rather than failing the import', () => {
    expect(parseTransform('wobble(3) translate(5 0)')).toEqual([1, 0, 0, 1, 5, 0])
  })
})

describe('shape elements', () => {
  it('imports a rect at its authored position and size', () => {
    const path = importOne('<rect x="10" y="20" width="30" height="40"/>')
    expect(path?.bounds).toMatchObject({ minX: 10, minY: 20, width: 30, height: 40 })
    expect(path?.closed).toBe(true)
  })

  it('rounds a rect only when a radius is given', () => {
    const square = importOne('<rect width="40" height="40"/>')
    const rounded = importOne('<rect width="40" height="40" rx="8"/>')
    expect(square?.vertices).toHaveLength(4)
    expect(rounded!.vertices.length).toBeGreaterThan(4)
  })

  it('mirrors an omitted corner radius from the other axis', () => {
    const fromRx = importOne('<rect width="40" height="40" rx="8"/>')
    const fromRy = importOne('<rect width="40" height="40" ry="8"/>')
    expect(fromRx?.vertices).toEqual(fromRy?.vertices)
  })

  it('clamps a corner radius to half the shorter side', () => {
    const huge = importOne('<rect width="40" height="40" rx="900"/>')
    const half = importOne('<rect width="40" height="40" rx="20"/>')
    expect(huge?.vertices).toEqual(half?.vertices)
  })

  it('imports circles and ellipses at their true extents', () => {
    const circle = importOne('<circle cx="50" cy="50" r="20"/>')
    // Arcs resolve through a cubic approximation, so extents land within
    // floating-point noise of the exact radius rather than exactly on it.
    expect(circle?.bounds.minX).toBeCloseTo(30, 9)
    expect(circle?.bounds.minY).toBeCloseTo(30, 9)
    expect(circle?.bounds.width).toBeCloseTo(40, 9)
    expect(circle?.bounds.height).toBeCloseTo(40, 9)
    const ellipse = importOne('<ellipse cx="50" cy="50" rx="30" ry="10"/>')
    expect(ellipse?.bounds.width).toBeCloseTo(60, 6)
    expect(ellipse?.bounds.height).toBeCloseTo(20, 6)
  })

  it('imports polygons closed and polylines open', () => {
    expect(importOne('<polygon points="0,0 10,0 10,10"/>')?.closed).toBe(true)
    expect(importOne('<polyline points="0,0 10,0 10,10"/>')?.closed).toBe(false)
  })

  it('imports a line as an open two-anchor path', () => {
    const path = importOne('<line x1="0" y1="0" x2="10" y2="10"/>')
    expect(path?.closed).toBe(false)
    expect(path?.vertices).toHaveLength(2)
  })

  it('drops zero-area geometry instead of emitting an invisible item', () => {
    expect(importSvgSource(wrap('<rect width="0" height="40"/>')).paths).toHaveLength(0)
    expect(importSvgSource(wrap('<circle r="0"/>')).paths).toHaveLength(0)
  })
})

describe('transforms', () => {
  it('applies a parent group transform to its children', () => {
    const path = importOne('<g transform="translate(20 30)"><rect width="10" height="10"/></g>')
    expect(path?.bounds).toMatchObject({ minX: 20, minY: 30 })
  })

  it('compounds nested group transforms', () => {
    const path = importOne(
      '<g transform="translate(10 0)"><g transform="translate(5 0)"><rect width="10" height="10"/></g></g>',
    )
    expect(path?.bounds.minX).toBe(15)
  })

  it('scales geometry without shearing its curve handles', () => {
    const plain = importOne('<circle cx="10" cy="10" r="10"/>')
    const scaled = importOne('<g transform="scale(2)"><circle cx="10" cy="10" r="10"/></g>')
    expect(scaled?.bounds.width).toBeCloseTo((plain?.bounds.width ?? 0) * 2, 6)
    // Handles are offsets, so normalizing by the scaled box reproduces the
    // original shape exactly — proof the translation was not applied to them.
    scaled?.vertices.forEach((vertex, index) => {
      expect(vertex.outHandle[0]).toBeCloseTo(plain!.vertices[index]!.outHandle[0], 6)
      expect(vertex.outHandle[1]).toBeCloseTo(plain!.vertices[index]!.outHandle[1], 6)
    })
  })

  it('rotates geometry about the requested centre', () => {
    const path = importOne(
      '<g transform="rotate(90 50 50)"><rect x="50" y="50" width="20" height="10"/></g>',
    )
    expect(path?.bounds.width).toBeCloseTo(10, 6)
    expect(path?.bounds.height).toBeCloseTo(20, 6)
  })
})

describe('paint', () => {
  it('reads fill and stroke from attributes', () => {
    const path = importOne(
      '<rect width="10" height="10" fill="#ff0000" stroke="#00ff00" stroke-width="3"/>',
    )
    expect(path).toMatchObject({
      fill: '#ff0000',
      fillEnabled: true,
      stroke: '#00ff00',
      strokeEnabled: true,
      strokeWidth: 3,
    })
  })

  it('lets the style attribute win over a presentation attribute', () => {
    const path = importOne('<rect width="10" height="10" fill="#ff0000" style="fill: #0000ff"/>')
    expect(path?.fill).toBe('#0000ff')
  })

  it('inherits paint from an ancestor group', () => {
    const path = importOne('<g fill="#123456"><rect width="10" height="10"/></g>')
    expect(path?.fill).toBe('#123456')
  })

  it('treats fill="none" as unpainted rather than inherited', () => {
    const path = importOne('<g fill="#123456"><rect width="10" height="10" fill="none"/></g>')
    expect(path?.fillEnabled).toBe(false)
  })

  it('disables a stroke with no width', () => {
    const path = importOne('<rect width="10" height="10" stroke="#fff" stroke-width="0"/>')
    expect(path?.strokeEnabled).toBe(false)
  })

  it('compounds group opacity down the tree', () => {
    const path = importOne('<g opacity="0.5"><rect width="10" height="10" opacity="0.5"/></g>')
    expect(path?.opacity).toBeCloseTo(0.25, 9)
  })

  it('flattens a gradient to its first stop and says so', () => {
    const document = importSvgSource(
      wrap(
        '<defs><linearGradient id="g"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>',
      ),
    )
    expect(document.paths[0]?.fill).toBe('#ff0000')
    expect(document.warnings.some((warning) => warning.reason.includes('first stop'))).toBe(true)
  })

  it('reports an unresolvable paint reference', () => {
    const document = importSvgSource(wrap('<rect width="10" height="10" fill="url(#missing)"/>'))
    expect(document.paths[0]?.fillEnabled).toBe(false)
    expect(document.warnings.some((warning) => warning.reason.includes('Unresolved'))).toBe(true)
  })
})

describe('document handling', () => {
  it('reads the viewBox', () => {
    expect(
      importSvgSource(wrap('<rect width="10" height="10"/>', 'viewBox="5 6 200 300"')).viewBox,
    ).toEqual({ minX: 5, minY: 6, width: 200, height: 300 })
  })

  it('falls back to width and height when there is no viewBox', () => {
    expect(
      importSvgSource(wrap('<rect width="10" height="10"/>', 'width="640" height="480"')).viewBox,
    ).toEqual({ minX: 0, minY: 0, width: 640, height: 480 })
  })

  it('falls back to the geometry bounds when the document declares no size', () => {
    const document = importSvgSource(wrap('<rect x="10" y="10" width="30" height="20"/>', ''))
    expect(document.viewBox).toEqual({ minX: 10, minY: 10, width: 30, height: 20 })
  })

  it('preserves document order as painter order', () => {
    const document = importSvgSource(
      wrap('<rect id="a" width="10" height="10"/><rect id="b" width="10" height="10"/>'),
    )
    expect(document.paths.map((path) => path.name)).toEqual(['a', 'b'])
    expect(document.paths[0]!.z).toBeLessThan(document.paths[1]!.z)
  })

  it('splits a multi-contour path and flags the counters as holes', () => {
    const document = importSvgSource(
      wrap('<path d="M 0 0 L 40 0 L 40 40 L 0 40 Z M 10 10 L 30 10 L 30 30 L 10 30 Z"/>'),
    )
    expect(document.paths).toHaveLength(2)
    expect(document.paths.map((path) => path.isHole)).toEqual([false, true])
  })

  it('refuses scripts and other non-drawable content silently', () => {
    const document = importSvgSource(
      wrap('<script>alert(1)</script><rect width="10" height="10"/>'),
    )
    expect(document.paths).toHaveLength(1)
  })

  it('reports text as skipped rather than dropping it without a trace', () => {
    const document = importSvgSource(wrap('<text x="0" y="10">hello</text>'))
    expect(document.paths).toHaveLength(0)
    expect(document.warnings[0]?.element).toBe('text')
  })

  it('does not draw anything defined inside defs', () => {
    expect(importSvgSource(wrap('<defs><rect width="10" height="10"/></defs>')).paths).toHaveLength(
      0,
    )
  })

  it('gives every imported path a unique id', () => {
    const document = importSvgSource(
      wrap('<rect width="10" height="10"/><circle r="5"/><rect width="8" height="8"/>'),
    )
    expect(new Set(document.paths.map((path) => path.id)).size).toBe(document.paths.length)
  })

  it('namespaces ids per import so two documents never collide', () => {
    const first = importSvgSource(wrap('<rect width="10" height="10"/>'), { idPrefix: 'a' })
    const second = importSvgSource(wrap('<rect width="10" height="10"/>'), { idPrefix: 'b' })
    expect(first.paths[0]!.id).not.toBe(second.paths[0]!.id)
  })

  it('rejects input that is not an SVG', () => {
    expect(() => importSvgSource('<html><body>no</body></html>')).toThrow(/not a valid SVG/)
  })

  it('rejects oversized input before parsing it', () => {
    expect(() => importSvgSource('x'.repeat(4_000_001))).toThrow(/too large/)
  })
})
