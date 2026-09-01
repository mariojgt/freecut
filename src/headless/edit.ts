/**
 * Headless programmatic editing.
 *
 * Hydrates the real timeline domain stores from a Project, applies a list of
 * edit ops by driving the REAL timeline action modules (so transition repair,
 * track ordering, split-id rebinding, undo bookkeeping etc. all behave exactly
 * like the editor), then serializes the stores back to a Project. No workspace
 * storage layer is required.
 */
import type { Project } from '@/types/project'
import type {
  TimelineItem,
  TimelineTrack,
  TextItem,
  VideoItem,
  AudioItem,
  ImageItem,
} from '@/types/timeline'
import type { MediaMetadata } from '@/types/storage'
import type { Transition } from '@/types/transition'
import type { AnimatableProperty, EasingType } from '@/types/keyframe'
import type { VisualEffect } from '@/types/effects'
import type { TransformProperties } from '@/types/transform'

import { createLogger } from '@/shared/logging/logger'
import { migrateProject } from '@/shared/projects/migrations'
import {
  hydrateTimelineStoresFromProject,
  buildTimelineFromStores,
} from '@/features/timeline/stores/timeline-persistence'
import { useItemsStore } from '@/features/timeline/stores/items-store'
import { useTransitionsStore } from '@/features/timeline/stores/transitions-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
import { BLOCKS, getBlock, getGesture, getPose } from '@/shared/graphics/blocks/registry'
import { instantiateBlock } from '@/shared/graphics/blocks/instantiate'
import { bakeGesture } from '@/shared/graphics/blocks/gesture-bake'
import type { BakedTrack } from '@/shared/graphics/blocks/gesture-bake'
import { poseToGesture, posesToGesture } from '@/shared/graphics/blocks/poses'
import type { PoseStep } from '@/shared/graphics/blocks/poses'
import { resolveRigProperty, rigChannelProperties } from '@/shared/graphics/blocks/rig-channels'
import type { GestureDefinition, PoseDefinition } from '@/shared/graphics/blocks/types'
import { compileDirectedAction } from '@/shared/graphics/scene/direction'
import type {
  DirectedKeyframe,
  DirectedTarget,
  MotionAction,
  MotionDirection,
} from '@/shared/graphics/scene/direction'
import { compileCameraMove } from '@/shared/graphics/scene/camera'
import type { CameraIntent } from '@/shared/graphics/scene/camera'
import { SCENE_PALETTES, DEFAULT_SCENE_PALETTE } from '@/shared/graphics/blocks/scene-palette'
import { importSvgSource } from '@/shared/graphics/shapes/svg-document-import'
import { parseSvgPathToVertices } from '@/shared/graphics/shapes/svg-path-parse'
import { preparePathMorph, pathVertexComponents } from '@/shared/graphics/shapes/path-morph'
import { buildPathVertexAnimatableProperty } from '@/types/keyframe'
import { seedMediaLibrary } from './seed-media'
import {
  addItem,
  updateItem,
  moveItem,
  removeItems,
  splitItem,
  trimItemStart,
  trimItemEnd,
  addTransition,
  updateTransition,
  removeTransition,
  setTransformParent,
  addKeyframes,
  setTracks,
  addKeyframe,
  removeKeyframesForProperty,
  addEffect,
  removeEffect,
  updateItemTransform,
} from '@/features/timeline/stores/timeline-actions'
import { getGpuEffect } from '@/infrastructure/gpu-effects'

const log = createLogger('HeadlessEdit')

export type EditOperationName =
  | 'addText'
  | 'addItem'
  | 'updateItem'
  | 'moveItem'
  | 'removeItems'
  | 'split'
  | 'trimStart'
  | 'trimEnd'
  | 'addTransition'
  | 'updateTransition'
  | 'removeTransition'
  | 'addTrack'
  | 'addClip'
  | 'addKeyframe'
  | 'removeKeyframes'
  | 'setTransformParent'
  | 'addEffect'
  | 'removeEffect'
  | 'setTransform'
  | 'addBlock'
  | 'applyGesture'
  | 'applyPose'
  | 'attachToSlot'
  | 'directAction'
  | 'setCamera'
  | 'importSvg'
  | 'morphPath'

/** A wire operation. Node validates its discriminator and fields before this browser boundary. */
export type EditOp = Record<string, unknown> & { op: EditOperationName }

export interface HeadlessEditInput {
  project: Project
  ops: EditOp[]
  /** MediaMetadata for any media referenced by ops (e.g. addClip), keyed for codec/fps/duration lookups. */
  media?: Array<{ mediaId: string; metadata?: MediaMetadata }>
}

export interface HeadlessEditResult {
  ok: true
  /** The edited project (timeline rebuilt from stores). The driver writes this to disk. */
  project: Project
  applied: number
  results: Array<{ callerId?: string; op: string; ok: boolean; detail?: unknown; error?: string }>
}

function resolvePointer(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/')) throw new Error(`Invalid result JSON pointer "${pointer}"`)
  let current = value
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (current === null || typeof current !== 'object' || !(key in current)) {
      throw new Error(`Result reference pointer not found: ${pointer}`)
    }
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const REFERENCE_ID_FIELDS = new Set([
  'id',
  'itemId',
  'trackId',
  'leftClipId',
  'rightClipId',
  'effectId',
  'mediaId',
])

function resolveOperationRefs(
  op: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
): EditOp {
  const visit = (value: unknown, field?: string): unknown => {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$ref' in value) {
      if (!field || !REFERENCE_ID_FIELDS.has(field))
        throw new Error(`$ref is not allowed in field "${field ?? '$'}"`)
      const ref = (value as { $ref?: unknown }).$ref
      if (typeof ref !== 'string') throw new Error('$ref must be a string')
      const match = /^([A-Za-z][A-Za-z0-9_-]{0,63})#(\/.*)$/.exec(ref)
      if (!match) throw new Error(`Invalid result reference: ${ref}`)
      const result = prior.get(match[1]!)
      if (!result?.ok)
        throw new Error(`Result reference is not a prior successful operation: ${match[1]}`)
      const resolved = resolvePointer(result, match[2]!)
      if (typeof resolved !== 'string')
        throw new Error(`Result reference must resolve to an id string: ${ref}`)
      return resolved
    }
    if (Array.isArray(value))
      return value.map((entry) => visit(entry, field === 'ids' ? 'id' : field))
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, visit(entry, key)]),
      )
    }
    return value
  }
  return visit(op) as EditOp
}

// Canvas of the project being edited (set per editProject call) — transform-parent
// binds resolve world transforms against it.
let editCanvas = { width: 1920, height: 1080, fps: 30 }

const asString = (value: unknown, fallback?: string): string | undefined =>
  typeof value === 'string' ? value : fallback
const asNumber = (value: unknown, fallback?: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

function tracks(): TimelineTrack[] {
  return useItemsStore.getState().tracks
}

/**
 * Every item on the timeline.
 *
 * Read from the store's flat list rather than by walking `tracks[].items`: that
 * per-track array is only populated while a timeline fragment is being spliced
 * in, and is empty once a project has been hydrated. Walking it silently found
 * nothing on any project loaded from disk.
 */
function allItems(): TimelineItem[] {
  return useItemsStore.getState().items
}

/**
 * Bake a gesture onto a block instance that already exists on the timeline.
 *
 * Shared by `applyGesture` and `applyPose` because a pose sequence compiles to
 * an ordinary gesture, and it resolves channels through `rig-channels` — the
 * same resolver `instantiateBlock` uses. That shared path is the point: when the
 * two had separate copies of the mapping, the `scale` channel worked on insert
 * and silently did nothing here.
 */
function bakeOntoInstance(
  op: Record<string, unknown>,
  idPrefix: string,
  gesture: GestureDefinition,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  // Positional and size contributions are authored in block units, so the caller
  // restates the scale it placed the block at; rotation and opacity do not
  // depend on it.
  const scale = asNumber(op.scale, 1)!
  const owned = new Map(
    allItems()
      .filter((item) => item.id.startsWith(`${idPrefix}-`))
      .map((item) => [item.id.slice(idPrefix.length + 1), item]),
  )
  if (owned.size === 0) throw new Error(`${String(op.op)}: no items with prefix "${idPrefix}"`)

  const anchor = [...owned.values()][0]!
  const baked = bakeGesture(gesture, {
    durationInFrames: asNumber(op.durationInFrames, anchor.durationInFrames)!,
    ...(asNumber(op.cycles) !== undefined && { cycles: asNumber(op.cycles)! }),
    ...(asNumber(op.intensity) !== undefined && { intensity: asNumber(op.intensity)! }),
    ...(asNumber(op.startFrame) !== undefined && { startFrame: asNumber(op.startFrame)! }),
  })

  const payloads = []
  const driven = new Set<string>()
  for (const track of baked) {
    const item = owned.get(track.partId)
    if (!item) continue
    const emitted = rigTrackPayloads(track, item, scale)
    if (emitted.length === 0) continue
    driven.add(track.partId)
    payloads.push(...emitted)
  }
  addKeyframes(payloads)
  return { idPrefix, ...extra, parts: driven.size, keyframes: payloads.length }
}

/**
 * Keyframe payloads for one baked rig track against an item's rest pose.
 *
 * The nesting is inherent: one rig channel can reach two properties (a uniform
 * squash drives both width and height), and each carries the whole curve.
 */
// fallow-ignore-next-line complexity
function rigTrackPayloads(
  track: BakedTrack,
  item: TimelineItem,
  scale: number,
): Array<{
  itemId: string
  property: AnimatableProperty
  frame: number
  value: number
  easing: EasingType
}> {
  const transform = item.transform ?? {}
  const rest = {
    rotation: transform.rotation ?? 0,
    x: transform.x ?? 0,
    y: transform.y ?? 0,
    opacity: transform.opacity ?? 1,
    width: transform.width ?? 0,
    height: transform.height ?? 0,
  }

  const payloads = []
  for (const property of rigChannelProperties(track.channel)) {
    // A size channel on an item with no measured box has nothing to scale, and
    // would write a constant 0 over the part's real width.
    if ((property === 'width' || property === 'height') && rest[property] <= 0) continue
    for (const keyframe of track.keyframes) {
      payloads.push({
        itemId: item.id,
        property: property as AnimatableProperty,
        frame: keyframe.frame,
        value: resolveRigProperty(property, keyframe.value, rest, scale),
        easing: keyframe.easing,
      })
    }
  }
  return payloads
}

/**
 * Resolve a directed action's targets, marking which ones carry the group.
 *
 * A recipe needs to know roots from children because the two inheritance rules
 * disagree: geometry passes down the transform-parent chain and opacity does not.
 * Move every part and a rig is displaced twice; fade only the roots and half of
 * it stays on screen.
 *
 * "Root" is relative to the selection, not to the project: a block instance's
 * top parts are roots even though the project may parent them to something else,
 * which is what lets a camera move a scene that is already rigged.
 */
interface SpannedTarget extends DirectedTarget {
  /** Composition frame the item starts at. */
  from: number
  durationInFrames: number
}

function directedTargets(op: Record<string, unknown>): SpannedTarget[] {
  const explicit = Array.isArray(op.itemIds) ? op.itemIds.map((id) => asString(id)) : []
  const idPrefix = asString(op.idPrefix)
  const single = asString(op.itemId)

  const items = allItems()
  const selected = idPrefix
    ? items.filter((item) => item.id.startsWith(`${idPrefix}-`))
    : items.filter((item) => item.id === single || explicit.includes(item.id))

  if (selected.length === 0) {
    throw new Error(
      `${String(op.op)}: no items matched (idPrefix=${idPrefix ?? '-'}, itemId=${single ?? '-'})`,
    )
  }

  const selectedIds = new Set(selected.map((item) => item.id))
  return selected.map((item) => toSpannedTarget(item, selectedIds))
}

/**
 * One item as a recipe target.
 *
 * A flat field mapping whose whole complexity score is the per-field defaults: a
 * stored transform is partial, and every recipe needs concrete numbers.
 */
// Browser-harness driver; exercised end-to-end by the headless chrome contract suite
// fallow-ignore-next-line complexity
function toSpannedTarget(item: TimelineItem, selectedIds: Set<string>): SpannedTarget {
  const parentId = item.transformParent?.parentItemId
  const transform = item.transform ?? {}
  return {
    itemId: item.id,
    isRoot: !parentId || !selectedIds.has(parentId),
    from: item.from,
    durationInFrames: item.durationInFrames,
    rest: {
      x: transform.x ?? 0,
      y: transform.y ?? 0,
      width: transform.width ?? 0,
      height: transform.height ?? 0,
      rotation: transform.rotation ?? 0,
      opacity: transform.opacity ?? 1,
    },
  }
}

/**
 * Convert a beat authored in composition frames onto each item's own timeline.
 *
 * Keyframe frames are item-relative — 0 is the item's first frame — while a scene
 * beat is naturally stated in composition time, and the two only coincide for
 * items that start at 0. Authoring absolutely and converting here is what lets
 * one beat drive targets that enter at different times.
 *
 * A beat that misses a target entirely is refused rather than silently dropped:
 * keyframes written outside an item's life resolve to nothing, which looks
 * exactly like a recipe that did not work.
 */
function toItemRelative(
  keyframes: readonly DirectedKeyframe[],
  targets: readonly SpannedTarget[],
  opName: string,
): DirectedKeyframe[] {
  const spans = new Map(targets.map((target) => [target.itemId, target]))
  const kept: DirectedKeyframe[] = []
  const reached = new Set<string>()

  for (const keyframe of keyframes) {
    const span = spans.get(keyframe.itemId)
    if (!span) continue
    const relative = keyframe.frame - span.from
    // Clamped, not dropped: an exit that runs past an item's last frame is
    // legitimate, and its final pose belongs on that last frame.
    if (relative < 0 || relative > span.durationInFrames) continue
    reached.add(keyframe.itemId)
    kept.push({ ...keyframe, frame: relative })
  }

  const missed = targets.filter((target) => !reached.has(target.itemId))
  // Only roots are driven for geometry, so a child with no keyframes is normal;
  // a target where NOTHING landed means the beat sits outside its life.
  if (reached.size === 0 && missed.length > 0) {
    const example = missed[0]!
    throw new Error(
      `${opName}: the beat does not overlap any target (e.g. "${example.itemId}" spans frames ` +
        `${example.from}..${example.from + example.durationInFrames} in composition time)`,
    )
  }

  // Deduplicate again: clamping can land two curve points on one frame.
  const byKey = new Map<string, DirectedKeyframe>()
  for (const keyframe of kept) {
    byKey.set(`${keyframe.itemId}:${keyframe.property}:${keyframe.frame}`, keyframe)
  }
  return [...byKey.values()]
}

function requireItem(id: string, field = 'id'): TimelineItem {
  const item = useItemsStore.getState().itemById[id]
  if (!item) throw new Error(`${field}: item "${id}" does not exist`)
  return item
}

function requireTransition(id: string, field = 'id'): Transition {
  const transition = useTransitionsStore.getState().transitions.find((t) => t.id === id)
  if (!transition) throw new Error(`${field}: transition "${id}" does not exist`)
  return transition
}

/**
 * Confirm an `updateTransition` actually landed.
 *
 * `updateTransition` runs handle validation for `durationInFrames` / `alignment`
 * and, on rejection, only logs — its signature is `void`, so a caller cannot tell
 * a rejected edit from an applied one. Comparing against the post-update state
 * catches every rejection path, present and future, without changing the shared
 * store API.
 */
function assertTransitionUpdateApplied(
  id: string,
  updates: Parameters<typeof updateTransition>[1],
): void {
  const applied = requireTransition(id)
  const rejected = Object.entries(updates)
    .filter(([field, requested]) => {
      const actual = (applied as unknown as Record<string, unknown>)[field]
      // `properties` is a plain object; the rest are scalars.
      return JSON.stringify(actual) !== JSON.stringify(requested)
    })
    .map(([field, requested]) => `${field}=${JSON.stringify(requested)}`)

  if (rejected.length === 0) return
  throw new Error(
    `updateTransition("${id}") was rejected: ${rejected.join(', ')} — the transition is unchanged. ` +
      'Duration and alignment must fit the handles available on both clips.',
  )
}

function requireTrack(id: string, field = 'trackId'): TimelineTrack {
  const track = tracks().find((candidate) => candidate.id === id)
  if (!track) throw new Error(`${field}: track "${id}" does not exist`)
  if (track.isGroup) throw new Error(`${field}: track "${id}" is a group and cannot contain items`)
  return track
}

/** Resolve a usable trackId: the requested one if it exists, else the first non-group video track. */
function resolveTrackId(preferred: unknown, kind: 'video' | 'audio' = 'video'): string {
  const all = tracks()
  const requested = asString(preferred)
  if (requested) {
    const track = requireTrack(requested)
    if ((track.kind ?? 'video') !== kind)
      throw new Error(`trackId: track "${requested}" is not ${kind}`)
    return requested
  }
  const match = all.find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  const fallback = match ?? all.find((t) => !t.isGroup)
  if (!fallback) throw new Error('No track available to place item on (add a track first)')
  return fallback.id
}

function newId(): string {
  return crypto.randomUUID()
}

/** Find a non-group track of the given kind, or create one (video on top, audio at bottom). */
function getOrCreateTrack(kind: 'video' | 'audio'): string {
  const all = tracks()
  const existing = all.find((t) => !t.isGroup && (t.kind ?? 'video') === kind)
  if (existing) return existing.id
  const orders = all.map((t) => t.order)
  const order = kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1
  const track = createClassicTrack({ tracks: all, kind, order })
  setTracks([...all, track])
  return track.id
}

/** The requested track if it exists, else find-or-create one of the given kind. */
function resolveOrCreateTrack(preferred: unknown, kind: 'video' | 'audio'): string {
  const requested = asString(preferred)
  if (requested) {
    const track = requireTrack(requested)
    if ((track.kind ?? 'video') !== kind)
      throw new Error(`trackId: track "${requested}" is not ${kind}`)
    return requested
  }
  return getOrCreateTrack(kind)
}

/** Source-frame fields for a media clip (source* are in source-native fps). */
function sourceFieldsFor(media: MediaMetadata, projectFps: number) {
  const sourceFps = media.fps && media.fps > 0 ? media.fps : projectFps
  const durationSec = media.duration ?? 0
  const sourceEnd = Math.max(1, Math.round(durationSec * sourceFps))
  return { sourceFps, sourceStart: 0, sourceEnd, sourceDuration: sourceEnd, speed: 1 }
}

function buildTextItem(op: EditOp): TextItem {
  return {
    id: asString(op.id) ?? newId(),
    type: 'text',
    trackId: resolveTrackId(op.trackId, 'video'),
    from: asNumber(op.from, 0)!,
    durationInFrames: asNumber(op.durationInFrames, 90)!,
    label: asString(op.label) ?? 'Text',
    text: asString(op.text) ?? 'Text',
    color: asString(op.color) ?? '#ffffff',
    fontSize: asNumber(op.fontSize, 80)!,
    ...(asString(op.fontFamily) && { fontFamily: asString(op.fontFamily) }),
    ...(op.fontWeight === 'bold' || op.fontWeight === 'semibold' || op.fontWeight === 'medium'
      ? { fontWeight: op.fontWeight }
      : {}),
    ...(op.textAlign === 'left' || op.textAlign === 'center' || op.textAlign === 'right'
      ? { textAlign: op.textAlign }
      : {}),
    ...(op.verticalAlign === 'top' || op.verticalAlign === 'middle' || op.verticalAlign === 'bottom'
      ? { verticalAlign: op.verticalAlign }
      : {}),
  }
}

/** Apply a single op by driving the real timeline action modules. Throws on bad input. */
interface KeyframeLane {
  itemId: string
  properties: Array<{
    property: string
    keyframes: Array<{ frame: number; value: number; easing?: EasingType }>
  }>
}

/** Flatten instantiation keyframes into the batch action's payload shape. */
function keyframePayloads(lanes: KeyframeLane[]) {
  return lanes.flatMap((lane) =>
    lane.properties.flatMap((entry) =>
      entry.keyframes.map((keyframe) => ({
        itemId: lane.itemId,
        property: entry.property as AnimatableProperty,
        frame: keyframe.frame,
        value: keyframe.value,
        ...(keyframe.easing ? { easing: keyframe.easing } : {}),
      })),
    ),
  )
}

/**
 * Append tracks above existing content.
 *
 * Lower order renders in front, so a new block claims the orders immediately
 * above whatever is already on the timeline rather than landing behind it.
 */
function appendTracksOnTop(incoming: TimelineTrack[]): void {
  const existing = tracks()
  setTracks([...existing, ...incoming.map((track) => ({ ...track, items: [] }))])
}

function nextBlockTrackOrder(count: number): number {
  const orders = tracks().map((track) => track.order)
  return Math.min(0, ...orders) - count - 1
}

/**
 * The op dispatcher.
 *
 * One flat `switch` with one case per wire operation. It scores badly on
 * complexity by construction and is left that way deliberately: every branch is
 * independent, the shape mirrors the wire contract one-to-one, and splitting it
 * into sub-dispatchers would hide which ops exist without making any single
 * branch simpler to read.
 */
// fallow-ignore-next-line complexity
function applyOp(op: EditOp): unknown {
  switch (op.op) {
    case 'addText': {
      const item = buildTextItem(op)
      addItem(item)
      return { id: item.id }
    }
    case 'addItem': {
      const item = op.item as TimelineItem | undefined
      if (!item || typeof item !== 'object') throw new Error('addItem requires `item`')
      const withId: TimelineItem = { ...item, id: item.id || newId() }
      requireTrack(withId.trackId, 'item.trackId')
      addItem(withId)
      return { id: withId.id }
    }
    case 'updateItem': {
      const id = asString(op.id)
      if (!id) throw new Error('updateItem requires `id`')
      requireItem(id)
      const updates = (op.updates ?? {}) as Partial<TimelineItem>
      if (updates.trackId) requireTrack(updates.trackId, 'updates.trackId')
      updateItem(id, updates)
      return { id }
    }
    case 'moveItem': {
      const id = asString(op.id)
      const from = asNumber(op.from)
      if (!id || from === undefined) throw new Error('moveItem requires `id` and `from`')
      requireItem(id)
      const destination = asString(op.trackId)
      if (destination) requireTrack(destination)
      moveItem(id, from, destination)
      return { id, from }
    }
    case 'removeItems': {
      const ids = Array.isArray(op.ids)
        ? (op.ids.filter((x) => typeof x === 'string') as string[])
        : []
      if (ids.length === 0) throw new Error('removeItems requires non-empty `ids`')
      for (const id of ids) requireItem(id, 'ids')
      removeItems(ids)
      return { removed: ids }
    }
    case 'split': {
      const id = asString(op.id)
      const frame = asNumber(op.frame)
      if (!id || frame === undefined) throw new Error('split requires `id` and `frame`')
      requireItem(id)
      const result = splitItem(id, frame)
      if (!result) throw new Error(`split failed for item ${id} at frame ${frame}`)
      return { leftId: result.leftItem.id, rightId: result.rightItem.id }
    }
    case 'trimStart': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimStart requires `id` and `amount`')
      requireItem(id)
      trimItemStart(id, amount)
      return { id }
    }
    case 'trimEnd': {
      const id = asString(op.id)
      const amount = asNumber(op.amount)
      if (!id || amount === undefined) throw new Error('trimEnd requires `id` and `amount`')
      requireItem(id)
      trimItemEnd(id, amount)
      return { id }
    }
    case 'addTransition': {
      const left = asString(op.leftClipId)
      const right = asString(op.rightClipId)
      if (!left || !right) throw new Error('addTransition requires `leftClipId` and `rightClipId`')
      requireItem(left, 'leftClipId')
      requireItem(right, 'rightClipId')
      const added = addTransition(
        left,
        right,
        asString(op.type) as Parameters<typeof addTransition>[2],
        asNumber(op.durationInFrames),
        asString(op.presentation) as Parameters<typeof addTransition>[4],
        asString(op.direction) as Parameters<typeof addTransition>[5],
        asNumber(op.alignment) ?? 0.5,
      )
      if (!added) throw new Error(`addTransition failed for clips "${left}" and "${right}"`)
      const created = useTransitionsStore
        .getState()
        .transitions.filter((t) => t.leftClipId === left && t.rightClipId === right)
        .at(-1)
      if (created && (op.timing !== undefined || op.properties !== undefined)) {
        updateTransition(created.id, {
          ...(op.timing !== undefined
            ? { timing: asString(op.timing) as Transition['timing'] }
            : {}),
          ...(op.properties !== undefined
            ? { properties: op.properties as Transition['properties'] }
            : {}),
        })
      }
      return { added, id: created?.id, presentation: created?.presentation }
    }
    case 'updateTransition': {
      const id = asString(op.id)
      if (!id) throw new Error('updateTransition requires `id`')
      requireTransition(id)
      const updates: Parameters<typeof updateTransition>[1] = {
        ...(op.durationInFrames !== undefined
          ? { durationInFrames: asNumber(op.durationInFrames) }
          : {}),
        ...(op.presentation !== undefined
          ? { presentation: asString(op.presentation) as Transition['presentation'] }
          : {}),
        ...(op.direction !== undefined
          ? { direction: asString(op.direction) as Transition['direction'] }
          : {}),
        ...(op.timing !== undefined ? { timing: asString(op.timing) as Transition['timing'] } : {}),
        ...(op.alignment !== undefined ? { alignment: asNumber(op.alignment) } : {}),
        ...(op.properties !== undefined
          ? { properties: op.properties as Transition['properties'] }
          : {}),
      }
      if (Object.keys(updates).length === 0)
        throw new Error('updateTransition requires at least one field to change')
      updateTransition(id, updates)
      // The store action validates handles for duration/alignment and, when the
      // requested value doesn't fit, logs a warning and leaves the transition
      // untouched — it returns void, so the rejection is invisible from here.
      // Verify against the resulting state so a rejected edit fails loudly
      // instead of reporting ok with the old value still in place.
      assertTransitionUpdateApplied(id, updates)
      return { id }
    }
    case 'removeTransition': {
      const id = asString(op.id)
      if (!id) throw new Error('removeTransition requires `id`')
      requireTransition(id)
      removeTransition(id)
      return { id }
    }
    case 'addTrack': {
      const kind = op.kind === 'audio' ? 'audio' : 'video'
      const all = tracks()
      const orders = all.map((t) => t.order)
      const order =
        asNumber(op.order) ??
        (kind === 'video' ? Math.min(0, ...orders) - 1 : Math.max(0, ...orders) + 1)
      const track = createClassicTrack({ tracks: all, kind, order })
      setTracks([...all, track])
      return { trackId: track.id, name: track.name }
    }
    case 'addClip': {
      const mediaId = asString(op.mediaId)
      if (!mediaId) throw new Error('addClip requires `mediaId`')
      const media = useMediaLibraryStore.getState().mediaById[mediaId]
      if (!media) {
        throw new Error(
          `addClip: no metadata for media ${mediaId} (pass it via the CLI's media list)`,
        )
      }
      const from = asNumber(op.from, 0)!
      const projectFps = useTimelineSettingsStore.getState().fps || 30
      const created: Array<{ id: string; type: string }> = []
      const label = media.fileName ?? mediaId

      if (media.mimeType.startsWith('image/')) {
        const item: ImageItem = {
          id: newId(),
          type: 'image',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames: asNumber(op.durationInFrames, 150)!,
          label,
          mediaId,
          src: '',
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
        }
        addItem(item)
        created.push({ id: item.id, type: 'image' })
      } else if (media.mimeType.startsWith('audio/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const item: AudioItem = {
          id: newId(),
          type: 'audio',
          trackId: resolveOrCreateTrack(op.trackId, 'audio'),
          from,
          durationInFrames:
            asNumber(op.durationInFrames) ??
            Math.max(1, Math.round((media.duration ?? 0) * projectFps)),
          label,
          mediaId,
          src: '',
          volume: 0,
          ...sf,
        }
        addItem(item)
        created.push({ id: item.id, type: 'audio' })
      } else if (media.mimeType.startsWith('video/')) {
        const sf = sourceFieldsFor(media, projectFps)
        const durationInFrames =
          asNumber(op.durationInFrames) ??
          Math.max(1, Math.round((media.duration ?? 0) * projectFps))
        const linkedGroupId = crypto.randomUUID()
        const video: VideoItem = {
          id: newId(),
          type: 'video',
          trackId: resolveOrCreateTrack(op.trackId, 'video'),
          from,
          durationInFrames,
          label,
          mediaId,
          src: '',
          volume: 0,
          linkedGroupId,
          ...(media.width ? { sourceWidth: media.width } : {}),
          ...(media.height ? { sourceHeight: media.height } : {}),
          ...sf,
        }
        addItem(video)
        created.push({ id: video.id, type: 'video' })
        // Linked audio companion (as the app creates on import) so audio renders.
        if (media.audioCodec) {
          const audio: AudioItem = {
            id: newId(),
            type: 'audio',
            trackId: getOrCreateTrack('audio'),
            from,
            durationInFrames,
            label: `${label} audio`,
            mediaId,
            src: '',
            volume: 0,
            linkedGroupId,
            ...sf,
          }
          addItem(audio)
          created.push({ id: audio.id, type: 'audio' })
        }
      } else {
        throw new Error(`addClip: unsupported media mimeType ${media.mimeType}`)
      }
      return { created }
    }
    case 'addKeyframe': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      const frame = asNumber(op.frame)
      const value = asNumber(op.value)
      if (!itemId || !property || frame === undefined || value === undefined) {
        throw new Error('addKeyframe requires `itemId`, `property`, `frame`, `value`')
      }
      requireItem(itemId, 'itemId')
      const easing = asString(op.easing) as EasingType | undefined
      // easingConfig (e.g. custom spring tension/friction/mass) goes through the
      // batch action — the scalar addKeyframe action does not accept it.
      const keyframeId = op.easingConfig
        ? (addKeyframes([
            {
              itemId,
              property: property as AnimatableProperty,
              frame,
              value,
              easing,
              easingConfig: op.easingConfig as Parameters<
                typeof addKeyframes
              >[0][number]['easingConfig'],
            },
          ])[0] ?? '')
        : addKeyframe(itemId, property as AnimatableProperty, frame, value, easing)
      if (!keyframeId) throw new Error(`addKeyframe failed (item ${itemId} @ frame ${frame})`)
      return { keyframeId }
    }
    case 'setTransformParent': {
      const id = asString(op.id)
      if (!id) throw new Error('setTransformParent requires `id`')
      const child = requireItem(id)
      const detach = op.parentItemId === null
      const parentItemId = detach ? undefined : asString(op.parentItemId)
      if (!detach && !parentItemId) {
        throw new Error(
          'setTransformParent requires `parentItemId` (item id to attach, null to detach)',
        )
      }
      if (parentItemId) requireItem(parentItemId, 'parentItemId')
      const ok = setTransformParent({
        childItemId: id,
        ...(parentItemId ? { parentItemId } : {}),
        behavior: asString(op.behavior) as Parameters<typeof setTransformParent>[0]['behavior'],
        frame: asNumber(op.frame) ?? child.from,
        canvas: editCanvas,
      })
      if (!ok) {
        throw new Error(
          `setTransformParent failed for "${id}"${parentItemId ? ` -> "${parentItemId}"` : ' (detach)'}`,
        )
      }
      return { id, parentItemId: parentItemId ?? null }
    }
    case 'removeKeyframes': {
      const itemId = asString(op.itemId)
      const property = asString(op.property)
      if (!itemId || !property) throw new Error('removeKeyframes requires `itemId` and `property`')
      requireItem(itemId, 'itemId')
      removeKeyframesForProperty(itemId, property as AnimatableProperty)
      return { itemId, property }
    }
    case 'addEffect': {
      const itemId = asString(op.itemId)
      if (!itemId) throw new Error('addEffect requires `itemId`')
      requireItem(itemId, 'itemId')
      const effect =
        op.effect && typeof op.effect === 'object'
          ? op.effect
          : op.gpuEffectType
            ? { type: 'gpu-effect', gpuEffectType: op.gpuEffectType, params: op.params ?? {} }
            : null
      if (!effect) throw new Error('addEffect requires `effect` or `gpuEffectType`')
      const gpuEffectType = (effect as { gpuEffectType?: unknown }).gpuEffectType
      if (typeof gpuEffectType !== 'string' || !getGpuEffect(gpuEffectType)) {
        throw new Error(`gpuEffectType: unknown GPU effect "${String(gpuEffectType)}"`)
      }
      addEffect(itemId, effect as VisualEffect)
      return { itemId }
    }
    case 'removeEffect': {
      const itemId = asString(op.itemId)
      const effectId = asString(op.effectId)
      if (!itemId || !effectId) throw new Error('removeEffect requires `itemId` and `effectId`')
      const item = requireItem(itemId, 'itemId')
      if (!item.effects?.some((candidate) => candidate.id === effectId)) {
        throw new Error(`effectId: effect "${effectId}" does not exist on item "${itemId}"`)
      }
      removeEffect(itemId, effectId)
      return { itemId, effectId }
    }
    case 'addBlock': {
      const blockId = asString(op.blockId)
      if (!blockId) throw new Error('addBlock requires `blockId`')
      const block = getBlock(blockId)
      if (!block) throw new Error(`addBlock: unknown block "${blockId}"`)

      const requested = Array.isArray(op.gestures) ? op.gestures : []
      const gestures = requested.map((entry) => {
        const record = (entry ?? {}) as Record<string, unknown>
        const gestureId = asString(record.id)
        const gesture = gestureId ? getGesture(gestureId) : undefined
        if (!gesture) throw new Error(`addBlock: unknown gesture "${gestureId ?? ''}"`)
        return {
          gesture,
          ...(asNumber(record.cycles) !== undefined && { cycles: asNumber(record.cycles)! }),
          ...(asNumber(record.intensity) !== undefined && {
            intensity: asNumber(record.intensity)!,
          }),
          ...(asNumber(record.startFrame) !== undefined && {
            startFrame: asNumber(record.startFrame)!,
          }),
        }
      })

      const paletteName = asString(op.palette)
      const idPrefix = asString(op.idPrefix) ?? `${blockId}-${newId()}`
      const result = instantiateBlock({
        block,
        palette: (paletteName ? SCENE_PALETTES[paletteName] : undefined) ?? DEFAULT_SCENE_PALETTE,
        // Secondary motion authors its lag in seconds, so it needs the real rate
        // to land the same way at 24, 30 or 60 fps.
        fps: editCanvas.fps,
        from: asNumber(op.from, 0)!,
        durationInFrames: asNumber(op.durationInFrames, 150)!,
        placement: {
          x: asNumber(op.x, 0)!,
          y: asNumber(op.y, 0)!,
          scale: asNumber(op.scale, 1)!,
        },
        gestures,
        baseTrackOrder: nextBlockTrackOrder(block.parts.length),
        idPrefix,
      })

      appendTracksOnTop(result.tracks)
      for (const item of result.items) addItem(item)
      addKeyframes(keyframePayloads(result.keyframes))
      return {
        idPrefix,
        items: result.items.length,
        tracks: result.tracks.length,
        skipped: result.skipped,
      }
    }
    case 'applyGesture': {
      const idPrefix = asString(op.idPrefix)
      const gestureId = asString(op.gestureId)
      if (!idPrefix || !gestureId) {
        throw new Error('applyGesture requires `idPrefix` and `gestureId`')
      }
      const gesture = getGesture(gestureId)
      if (!gesture) throw new Error(`applyGesture: unknown gesture "${gestureId}"`)
      return bakeOntoInstance(op, idPrefix, gesture, { gestureId })
    }
    case 'applyPose': {
      const idPrefix = asString(op.idPrefix)
      if (!idPrefix) throw new Error('applyPose requires `idPrefix`')
      const requested = Array.isArray(op.poses) ? op.poses : []
      if (requested.length === 0) throw new Error('applyPose requires at least one pose')

      const poses = new Map<string, PoseDefinition>()
      const steps: PoseStep[] = requested.map((entry, index) => {
        const record = (entry ?? {}) as Record<string, unknown>
        const poseId = asString(record.id)
        const pose = poseId ? getPose(poseId) : undefined
        if (!pose) throw new Error(`applyPose: unknown pose "${poseId ?? ''}"`)
        poses.set(pose.id, pose)
        return {
          poseId: pose.id,
          // Even spacing when the caller does not time the sequence itself.
          at: asNumber(record.at) ?? (requested.length === 1 ? 1 : index / (requested.length - 1)),
          ...(asString(record.easing) && { easing: asString(record.easing) as EasingType }),
        }
      })

      // One untimed pose means "hold this", which has to be eased into from rest:
      // a lone keyframe resolves to the pose on frame zero, so the character
      // would already be mid-gesture as the clip opens. A caller that timed the
      // pose itself, or gave a sequence, has said where it wants the keys.
      const timed = requested.some(
        (entry) => asNumber(((entry ?? {}) as Record<string, unknown>).at) !== undefined,
      )
      const held = steps.length === 1 && !timed ? steps[0] : undefined
      const gesture = held
        ? poseToGesture(poses.get(held.poseId)!, { ...(held.easing && { easing: held.easing }) })
        : posesToGesture(steps, poses)

      return bakeOntoInstance(op, idPrefix, gesture, {
        poses: steps.map((step) => step.poseId),
      })
    }
    case 'attachToSlot': {
      const idPrefix = asString(op.idPrefix)
      const slotId = asString(op.slotId)
      const itemId = asString(op.itemId)
      if (!idPrefix || !slotId || !itemId) {
        throw new Error('attachToSlot requires `idPrefix`, `slotId` and `itemId`')
      }

      const all = allItems()
      const target = all.find((item) => item.id === itemId)
      if (!target) throw new Error(`attachToSlot: no item "${itemId}"`)

      // The instance is identified by its item ids, and those carry the block id
      // the prefix was derived from, so the block is recoverable without the
      // caller naming it twice.
      const owned = all.filter((item) => item.id.startsWith(`${idPrefix}-`))
      if (owned.length === 0) throw new Error(`attachToSlot: no items with prefix "${idPrefix}"`)
      const block = [...BLOCKS.values()].find((candidate) =>
        candidate.parts.some((part) => owned.some((item) => item.id === `${idPrefix}-${part.id}`)),
      )
      if (!block) throw new Error(`attachToSlot: "${idPrefix}" is not a known block instance`)

      const slot = (block.slots ?? []).find((candidate) => candidate.id === slotId)
      if (!slot) {
        throw new Error(
          `attachToSlot: block "${block.id}" has no slot "${slotId}" (has: ${(block.slots ?? [])
            .map((candidate) => candidate.id)
            .join(', ')})`,
        )
      }

      // Block-local units become canvas pixels the same way `instantiateBlock`
      // does it, so a slot lands exactly on the artwork it was authored against.
      const scale = asNumber(op.scale, 1)!
      const x =
        (slot.at[0] - block.width / 2) * scale + asNumber(op.x, 0)! + asNumber(op.offsetX, 0)!
      const y =
        (slot.at[1] - block.height / 2) * scale + asNumber(op.y, 0)! + asNumber(op.offsetY, 0)!

      // Contain-fit, because "attached to the viewport" and "larger than the
      // viewport" is the most likely composition error and nothing else catches
      // it: the frame still renders, the child just overflows its container.
      // Geometry is inherited, so resizing the attached item carries its parts.
      const fitted = { ...(target.transform ?? {}), x, y }
      if (asString(op.fit) === 'contain' && slot.partId) {
        const container = all.find((item) => item.id === `${idPrefix}-${slot.partId}`)
        const margin = asNumber(op.margin, 0.1)!
        const room = {
          width: (container?.transform?.width ?? 0) * (1 - margin),
          height: (container?.transform?.height ?? 0) * (1 - margin),
        }
        const own = { width: fitted.width ?? 0, height: fitted.height ?? 0 }
        if (room.width > 0 && room.height > 0 && own.width > 0 && own.height > 0) {
          const factor = Math.min(room.width / own.width, room.height / own.height)
          // Only ever shrinks: growing a block past its authored size to fill a
          // container would soften artwork that was drawn for a specific scale.
          if (factor < 1) {
            fitted.width = own.width * factor
            fitted.height = own.height * factor
          }
        }
      }
      updateItem(itemId, { transform: fitted })

      // Parenting is what makes the attachment hold: without it the prop sits at
      // a fixed canvas position while the rig walks away from it. A slot with no
      // part is a location marker in a static world, so positioning is all it
      // can offer.
      let parentItemId: string | null = null
      if (slot.partId && owned.some((item) => item.id === `${idPrefix}-${slot.partId}`)) {
        parentItemId = `${idPrefix}-${slot.partId}`
        const ok = setTransformParent({
          childItemId: itemId,
          parentItemId,
          frame: target.from,
          canvas: editCanvas,
        })
        if (!ok) {
          throw new Error(`attachToSlot: could not parent "${itemId}" to "${parentItemId}"`)
        }
      }
      return { itemId, slotId, blockId: block.id, x, y, parentItemId }
    }
    case 'directAction': {
      const targets = directedTargets(op)
      const action = asString(op.action)
      if (!action) throw new Error('directAction requires `action`')
      const keyframes = compileDirectedAction(targets, {
        action: action as MotionAction,
        ...(asString(op.direction) && { direction: asString(op.direction) as MotionDirection }),
        from: asNumber(op.from, 0)!,
        durationInFrames: asNumber(op.durationInFrames, editCanvas.fps)!,
        ...(asNumber(op.distance) !== undefined && { distance: asNumber(op.distance)! }),
        ...(op.to && typeof op.to === 'object' ? { to: op.to as { x?: number; y?: number } } : {}),
        ...(asNumber(op.arc) !== undefined && { arc: asNumber(op.arc)! }),
        ...(asNumber(op.intensity) !== undefined && { intensity: asNumber(op.intensity)! }),
        ...(asString(op.easing) && { easing: asString(op.easing) as EasingType }),
        ...(asNumber(op.step) !== undefined && { step: asNumber(op.step)! }),
      })
      const relative = toItemRelative(keyframes, targets, 'directAction')
      addKeyframes(
        relative.map((keyframe) => ({
          itemId: keyframe.itemId,
          property: keyframe.property as AnimatableProperty,
          frame: keyframe.frame,
          value: keyframe.value,
          easing: keyframe.easing,
        })),
      )
      return { action, targets: targets.length, keyframes: relative.length }
    }
    case 'setCamera': {
      const intent = asString(op.intent)
      if (!intent) throw new Error('setCamera requires `intent`')
      // Planes are stated per target rather than read from the artwork, because
      // a lowered block keeps no record of which parallax plane its parts came
      // from; the catalog publishes them so a caller can look them up.
      const planes = new Map<string, number>()
      for (const entry of Array.isArray(op.planes) ? op.planes : []) {
        const record = (entry ?? {}) as Record<string, unknown>
        const key = asString(record.idPrefix) ?? asString(record.itemId)
        const plane = asNumber(record.plane)
        if (key && plane !== undefined) planes.set(key, plane)
      }
      const planeFor = (itemId: string): number => {
        if (planes.has(itemId)) return planes.get(itemId)!
        for (const [key, plane] of planes) {
          if (itemId.startsWith(`${key}-`)) return plane
        }
        return 0
      }

      const targets = directedTargets(op).map((target) => ({
        ...target,
        plane: planeFor(target.itemId),
      }))
      const keyframes = compileCameraMove(targets, {
        intent: intent as CameraIntent,
        from: asNumber(op.from, 0)!,
        durationInFrames: asNumber(op.durationInFrames, editCanvas.fps)!,
        ...(asNumber(op.amount) !== undefined && { amount: asNumber(op.amount)! }),
        ...(asString(op.easing) && { easing: asString(op.easing) as EasingType }),
      })
      const relative = toItemRelative(keyframes, targets, 'setCamera')
      addKeyframes(
        relative.map((keyframe) => ({
          itemId: keyframe.itemId,
          property: keyframe.property as AnimatableProperty,
          frame: keyframe.frame,
          value: keyframe.value,
          easing: keyframe.easing,
        })),
      )
      return { intent, targets: targets.length, keyframes: relative.length }
    }
    case 'importSvg': {
      const source = asString(op.source)
      if (!source) throw new Error('importSvg requires `source`')
      const imported = importSvgSource(source, { idPrefix: asString(op.idPrefix) ?? newId() })
      if (imported.paths.length === 0) {
        throw new Error('importSvg: the document contained no drawable geometry')
      }
      const MAX_PATHS = 120
      if (imported.paths.length > MAX_PATHS) {
        throw new Error(
          `importSvg: ${imported.paths.length} paths exceeds the ${MAX_PATHS} path limit; simplify the file first`,
        )
      }

      const from = asNumber(op.from, 0)!
      const durationInFrames = asNumber(op.durationInFrames, 150)!
      const { viewBox } = imported
      // Contain-fit the document into the requested box so an import lands on
      // canvas at a usable size regardless of its authored units.
      const target = asNumber(op.size, 0)!
      const fit =
        target > 0 && viewBox.width > 0 && viewBox.height > 0
          ? Math.min(target / viewBox.width, target / viewBox.height)
          : (asNumber(op.scale, 1) ?? 1)
      const offsetX = asNumber(op.x, 0)!
      const offsetY = asNumber(op.y, 0)!

      const baseOrder = nextBlockTrackOrder(imported.paths.length)
      const groupTrackId = `svg-group-${newId()}`
      const newTracks: TimelineTrack[] = [
        {
          id: groupTrackId,
          name: asString(op.name) ?? 'Imported SVG',
          kind: 'video',
          height: 40,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: baseOrder,
          items: [],
          isGroup: true,
          isCollapsed: true,
        },
      ]
      const pendingItems: TimelineItem[] = []

      // Later paths paint on top, so they take the lower (frontmost) order.
      const frontToBack = [...imported.paths].sort((a, b) => b.z - a.z)
      frontToBack.forEach((path, index) => {
        const trackId = `${path.id}-track`
        newTracks.push({
          id: trackId,
          name: path.name,
          kind: 'video',
          height: 40,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: baseOrder + 1 + index,
          items: [],
          parentTrackId: groupTrackId,
        })
        pendingItems.push({
          id: path.id,
          trackId,
          type: 'shape',
          shapeType: 'path',
          from,
          durationInFrames,
          label: path.name,
          pathVertices: path.vertices,
          pathClosed: path.closed,
          fillColor: path.fill ?? '#ffffff',
          fillEnabled: path.fillEnabled,
          ...(path.strokeEnabled && {
            strokeColor: path.stroke,
            strokeEnabled: true,
            strokeWidth: path.strokeWidth * fit,
          }),
          transform: {
            x:
              (path.bounds.minX + path.bounds.width / 2 - (viewBox.minX + viewBox.width / 2)) *
                fit +
              offsetX,
            y:
              (path.bounds.minY + path.bounds.height / 2 - (viewBox.minY + viewBox.height / 2)) *
                fit +
              offsetY,
            width: path.bounds.width * fit,
            height: path.bounds.height * fit,
            opacity: path.opacity,
            aspectRatioLocked: false,
          },
        })
      })

      appendTracksOnTop(newTracks)
      for (const item of pendingItems) addItem(item)
      return { items: pendingItems.length, warnings: imported.warnings, viewBox }
    }
    case 'morphPath': {
      const itemId = asString(op.itemId)
      const fromFrame = asNumber(op.fromFrame)
      const toFrame = asNumber(op.toFrame)
      if (!itemId || fromFrame === undefined || toFrame === undefined) {
        throw new Error('morphPath requires `itemId`, `fromFrame`, `toFrame`')
      }
      const item = requireItem(itemId, 'itemId')
      if (item.type !== 'shape' || item.shapeType !== 'path' || !item.pathVertices) {
        throw new Error(`morphPath: item "${itemId}" is not a custom path shape`)
      }

      const targetItemId = asString(op.targetItemId)
      const targetPathData = asString(op.targetPathData)
      let targetVertices
      let targetClosed = true
      if (targetItemId) {
        const target = requireItem(targetItemId, 'targetItemId')
        if (target.type !== 'shape' || target.shapeType !== 'path' || !target.pathVertices) {
          throw new Error(`morphPath: target "${targetItemId}" is not a custom path shape`)
        }
        targetVertices = target.pathVertices
        targetClosed = target.pathClosed ?? true
      } else if (targetPathData) {
        const parsed = parseSvgPathToVertices(targetPathData)[0]
        if (!parsed) throw new Error('morphPath: `targetPathData` drew no geometry')
        targetVertices = parsed.vertices
        targetClosed = parsed.closed
      } else {
        throw new Error('morphPath requires `targetItemId` or `targetPathData`')
      }

      const alignment = preparePathMorph(
        item.pathVertices,
        item.pathClosed ?? true,
        targetVertices,
        targetClosed,
      )
      // Resampling changes the vertex count, so the item's own geometry has to
      // become the resampled source or the keyframe indices address nothing.
      updateItem(itemId, { pathVertices: alignment.from, pathClosed: alignment.closed })

      const easing = (asString(op.easing) as EasingType | undefined) ?? 'ease-in-out'
      const start = pathVertexComponents(alignment.from)
      const end = pathVertexComponents(alignment.to)
      const components = ['positionX', 'positionY', 'inX', 'inY', 'outX', 'outY'] as const
      const payloads = start.flatMap((from, index) =>
        components.flatMap((component) => {
          const to = end[index]![component]
          if (from[component] === to) return []
          const property = buildPathVertexAnimatableProperty(index, component)
          return [
            { itemId, property, frame: fromFrame, value: from[component], easing },
            { itemId, property, frame: toFrame, value: to, easing },
          ]
        }),
      )
      addKeyframes(payloads)
      return {
        itemId,
        vertices: alignment.from.length,
        keyframes: payloads.length,
        reversed: alignment.reversed,
        startOffset: alignment.startOffset,
      }
    }
    case 'setTransform': {
      const id = asString(op.id)
      if (!id || !op.transform || typeof op.transform !== 'object') {
        throw new Error('setTransform requires `id` and `transform`')
      }
      requireItem(id)
      updateItemTransform(id, op.transform as Partial<TransformProperties>)
      return { id }
    }
    default:
      throw new Error(`Unknown edit op: ${String(op.op)}`)
  }
}

/** Apply one op, record its result (success or failure), and rethrow on failure. */
function applyOpTracked(
  rawOp: EditOp,
  prior: Map<string, HeadlessEditResult['results'][number]>,
  results: HeadlessEditResult['results'],
): void {
  const callerId = asString(rawOp.callerId)
  const op = resolveOperationRefs(rawOp, prior)
  try {
    const detail = applyOp(op)
    const result = { ...(callerId ? { callerId } : {}), op: op.op, ok: true as const, detail }
    results.push(result)
    if (callerId) prior.set(callerId, result)
  } catch (error) {
    results.push({
      ...(callerId ? { callerId } : {}),
      op: op.op,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      `Edit op "${op.op}" failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function editProject(input: HeadlessEditInput): Promise<HeadlessEditResult> {
  const { project: migrated } = migrateProject(input.project)
  editCanvas = {
    width: migrated.metadata?.width ?? 1920,
    height: migrated.metadata?.height ?? 1080,
    fps: migrated.metadata?.fps ?? 30,
  }
  await hydrateTimelineStoresFromProject(migrated)
  seedMediaLibrary(input.media)

  log.info('Headless edit starting', { ops: input.ops.length })

  const results: HeadlessEditResult['results'] = []
  const prior = new Map<string, HeadlessEditResult['results'][number]>()
  const callerIds = input.ops.map((op) => asString(op.callerId)).filter(Boolean) as string[]
  if (new Set(callerIds).size !== callerIds.length) throw new Error('Duplicate edit callerId')
  for (const rawOp of input.ops) applyOpTracked(rawOp, prior, results)

  const timeline = buildTimelineFromStores()
  log.info('Headless edit complete', { applied: results.length })

  return {
    ok: true,
    project: { ...migrated, timeline },
    applied: results.length,
    results,
  }
}
