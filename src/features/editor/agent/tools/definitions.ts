/**
 * The editor tool catalog. Each tool validates with Zod (runtime) and carries a
 * hand-authored JSON Schema (`inputSchema`) for the prompt catalog + MCP. Tools
 * are clip-addressable: a `clips` arg takes refs ("c1", "c3") from the grounded
 * inventory, falling back to the current selection when omitted.
 */

import { z } from 'zod'
import {
  applyMotionModifierToItems,
  useCompositionNavigationStore,
  useCompositionsStore,
  useTimelineStore,
} from '@/features/editor/deps/timeline-store'
import {
  createTextTemplateItem,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  getDefaultGeneratedLayerDurationInFrames,
} from '@/features/editor/deps/timeline-utils'
import {
  useFillerRemovalDialogStore,
  useSilenceRemovalDialogStore,
} from '@/features/editor/deps/timeline-ui'
import { useProjectStore } from '@/features/editor/deps/projects'
import { searchTimelineTranscript } from '@/features/editor/deps/timeline-utils'
import { usePlaybackStore } from '@/shared/state/playback'
import { useSelectionStore } from '@/shared/state/selection'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'
import type { TextItem, TimelineItem } from '@/types/timeline'
import {
  createMotionModifier,
  DEFAULT_MOTION_GENERATOR_SETTINGS,
  getAnimatablePropertiesForItem,
  MOTION_MODULATORS,
  MOTION_PRESETS,
} from '@/features/editor/deps/keyframes'
import { resolveGeneratedLayerCanvasSize } from '../../utils/generated-layer-canvas-size'
import { applyBuiltInMotion } from '../../services/apply-built-in-motion'
import type { EditorAgentTool, JsonSchema, ToolResult, ToolValidation } from './types'
import { buildClipRefs, resolveClipRefs, resolveItemRef, resolveTargetItems } from './clip-refs'

// --- factory ----------------------------------------------------------------

function makeValidate<S extends z.ZodType>(schema: S): (args: unknown) => ToolValidation {
  return (args) => {
    const result = schema.safeParse(args ?? {})
    if (result.success) return { ok: true, value: result.data as Record<string, unknown> }
    const issue = result.error.issues[0]
    const path = issue?.path.join('.') || 'args'
    return { ok: false, error: `${path}: ${issue?.message ?? 'invalid'}` }
  }
}

function defineTool<S extends z.ZodType>(def: {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema
  readOnly?: boolean
  destructive?: boolean
  handoff?: boolean
  schema: S
  summarize: (args: z.infer<S>) => string
  execute: (args: z.infer<S>) => Promise<ToolResult> | ToolResult
}): EditorAgentTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: def.inputSchema,
    readOnly: def.readOnly ?? false,
    destructive: def.destructive ?? false,
    handoff: def.handoff ?? false,
    validate: makeValidate(def.schema),
    summarize: (args) => def.summarize(args as z.infer<S>),
    execute: (args) => def.execute(args as z.infer<S>),
  }
}

// --- shared schema fragments ------------------------------------------------

const CLIPS_PROP = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Clip refs like ["c1","c3"] from the timeline list. Omit to use the current selection.',
}

const SCOPE_PROP = {
  type: 'string',
  enum: ['selection', 'all'],
  description:
    'Use "all" for every compatible timeline clip. Defaults to the current selection when clips are omitted.',
}

function objSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

const clipsField = z.array(z.string()).optional()
const scopeField = z.enum(['selection', 'all']).optional()
const motionPresetField = z
  .string()
  .refine((value) => MOTION_PRESETS.some((preset) => preset.id === value), 'Unknown motion preset.')
const continuousMotionField = z
  .string()
  .refine(
    (value) => MOTION_MODULATORS.some((modulator) => modulator.id === value),
    'Unknown continuous motion type.',
  )

function getFps(): number {
  return useTimelineStore.getState().fps
}

function isMedia(item: TimelineItem): boolean {
  return item.type === 'video' || item.type === 'audio'
}

function isVisual(item: TimelineItem): boolean {
  return item.type === 'video' || item.type === 'image' || item.type === 'composition'
}

function isAnimatableVisual(item: TimelineItem): boolean {
  return item.type !== 'audio' && item.type !== 'adjustment'
}

function orderedForAnimation(items: TimelineItem[]): TimelineItem[] {
  const orderByTrack = new Map(
    useTimelineStore.getState().tracks.map((track) => [track.id, track.order ?? 0]),
  )
  return items.toSorted(
    (left, right) =>
      left.from - right.from ||
      (orderByTrack.get(left.trackId) ?? 0) - (orderByTrack.get(right.trackId) ?? 0),
  )
}

function activeAnimationCanvas(): { width: number; height: number; fps: number } {
  const fps = useTimelineStore.getState().fps
  const project = useProjectStore.getState().currentProject
  const activeCompositionId = useCompositionNavigationStore.getState().activeCompositionId
  const activeComposition = activeCompositionId
    ? useCompositionsStore.getState().getComposition(activeCompositionId)
    : undefined
  const size = resolveGeneratedLayerCanvasSize(activeComposition, project?.metadata)
  return { ...size, fps }
}

function scaledMotionSettings(
  values: {
    durationPercent?: number
    intensityPercent?: number
    staggerSeconds?: number
  },
  fps: number,
) {
  return {
    ...DEFAULT_MOTION_GENERATOR_SETTINGS,
    durationScale: (values.durationPercent ?? 100) / 100,
    intensityScale: (values.intensityPercent ?? 100) / 100,
    staggerFrames: Math.round((values.staggerSeconds ?? 0) * fps),
  }
}

function throwMotionApplyFailure(
  reason: 'no-targets' | 'incompatible' | 'transition-blocked' | undefined,
): never {
  if (reason === 'incompatible') {
    throw new Error('That animation is not compatible with every targeted clip.')
  }
  if (reason === 'transition-blocked') {
    throw new Error('The animation falls entirely inside a protected transition region.')
  }
  throw new Error('The animation did not create any editable motion.')
}

function animationAppliedMessage(
  presetId: string,
  targetCount: number,
  staggerSeconds: number | undefined,
): string {
  const noun = targetCount === 1 ? 'clip' : 'clips'
  const stagger = staggerSeconds ? ` with ${staggerSeconds}s stagger` : ''
  return `Applied ${presetId} to ${targetCount} ${noun}${stagger}.`
}

function resolveScopedItems(
  clips: string[] | undefined,
  scope: 'selection' | 'all' | undefined,
): TimelineItem[] {
  if (clips && clips.length > 0) return resolveTargetItems(clips)
  if (scope === 'all') return useTimelineStore.getState().items
  return resolveTargetItems(undefined)
}

// --- query tools ------------------------------------------------------------

const findClips = defineTool({
  name: 'find_clips',
  title: 'Find clips',
  description:
    'List clips on the timeline, optionally filtered by type or a label substring. Returns their refs so other tools can target them.',
  inputSchema: objSchema({
    query: {
      type: 'string',
      description: 'Case-insensitive substring to match against clip labels.',
    },
    type: {
      type: 'string',
      enum: ['video', 'audio', 'text', 'image', 'shape'],
      description: 'Restrict to one clip type.',
    },
  }),
  readOnly: true,
  schema: z.object({
    query: z.string().optional(),
    type: z.enum(['video', 'audio', 'text', 'image', 'shape']).optional(),
  }),
  summarize: (args) => `Find clips${args.type ? ` of type ${args.type}` : ''}`,
  execute: (args) => {
    const query = args.query?.toLowerCase()
    const matches = buildClipRefs().filter((clip) => {
      if (args.type && clip.type !== args.type) return false
      if (query && !clip.label.toLowerCase().includes(query)) return false
      return true
    })
    const summary =
      matches.map((clip) => `${clip.ref} ${clip.type} "${clip.label}"`).join('; ') ||
      'no matching clips'
    return { ok: true, message: `Found ${matches.length}: ${summary}`, data: matches }
  },
})

const searchTranscript = defineTool({
  name: 'search_transcript',
  title: 'Search spoken words',
  description:
    'Search what is SAID in the video/audio for a word or phrase. Returns matching clip refs and timecodes. Use this FIRST to locate content the user describes (e.g. "where I talk about pricing") before editing around it.',
  inputSchema: objSchema(
    { query: { type: 'string', description: 'A word or phrase spoken in the media.' } },
    ['query'],
  ),
  readOnly: true,
  schema: z.object({ query: z.string().min(1) }),
  summarize: (args) => `Search transcript for "${args.query}"`,
  execute: async (args) => {
    const matches = await searchTimelineTranscript(args.query)
    // Refresh ref maps so itemIds resolve to the refs the model already saw.
    buildClipRefs()
    if (matches.length === 0) {
      return { ok: true, message: `No spoken match for "${args.query}".`, data: [] }
    }
    const lines = matches.map((match) => {
      const ref = resolveItemRef(match.itemId) ?? '?'
      return `${ref} @${match.timelineSeconds.toFixed(1)}s "${match.snippet}"`
    })
    return { ok: true, message: `Found "${args.query}" in: ${lines.join('; ')}`, data: matches }
  },
})

const selectClips = defineTool({
  name: 'select_clips',
  title: 'Select clips',
  description: 'Select the given clips so later actions and the UI focus on them.',
  inputSchema: objSchema({ clips: CLIPS_PROP }, ['clips']),
  schema: z.object({ clips: z.array(z.string()).min(1) }),
  summarize: (args) => `Select ${args.clips.join(', ')}`,
  execute: (args) => {
    const ids = resolveClipRefs(args.clips)
    if (ids.length === 0) throw new Error('None of those clip refs exist.')
    useSelectionStore.getState().selectItems(ids)
    return { ok: true, message: `Selected ${ids.length} clip${ids.length === 1 ? '' : 's'}.` }
  },
})

const seekTo = defineTool({
  name: 'seek_to',
  title: 'Move playhead',
  description: 'Move the playhead to a time in seconds.',
  inputSchema: objSchema({ seconds: { type: 'number', minimum: 0 } }, ['seconds']),
  schema: z.object({ seconds: z.number().min(0) }),
  summarize: (args) => `Seek to ${args.seconds.toFixed(1)}s`,
  execute: (args) => {
    usePlaybackStore.getState().setCurrentFrame(Math.round(args.seconds * getFps()))
    return { ok: true, message: `Moved playhead to ${args.seconds.toFixed(1)}s.` }
  },
})

// --- creation tools ---------------------------------------------------------

const addTitle = defineTool({
  name: 'add_title',
  title: 'Add title',
  description: 'Add a text/title layer at the playhead (or at a given time).',
  inputSchema: objSchema(
    {
      text: { type: 'string', description: 'Title text.' },
      atSeconds: {
        type: 'number',
        minimum: 0,
        description: 'Start time; defaults to the playhead.',
      },
      durationSeconds: {
        type: 'number',
        minimum: 0.1,
        maximum: 3600,
        description: 'How long the title stays visible; defaults to the editor title duration.',
      },
      position: {
        type: 'string',
        enum: ['center', 'top', 'bottom', 'lower-third'],
        description: 'Title position on the canvas.',
      },
      fontSize: { type: 'number', minimum: 8, maximum: 400 },
      color: { type: 'string', description: 'Text color as a hex value such as #ffffff.' },
    },
    ['text'],
  ),
  schema: z.object({
    text: z.string().min(1).max(300),
    atSeconds: z.number().min(0).optional(),
    durationSeconds: z.number().min(0.1).max(3600).optional(),
    position: z.enum(['center', 'top', 'bottom', 'lower-third']).optional(),
    fontSize: z.number().min(8).max(400).optional(),
    color: z
      .string()
      .regex(/^#[\da-f]{3}(?:[\da-f]{3})?$/i)
      .optional(),
  }),
  summarize: (args) => `Add title: "${args.text.slice(0, 40)}"`,
  // Placement and optional styling branches are covered by the title mutation tests.
  // fallow-ignore-next-line complexity
  execute: (args) => {
    const { tracks, items, fps, addItem } = useTimelineStore.getState()
    const { activeTrackId, selectItems } = useSelectionStore.getState()
    const currentProject = useProjectStore.getState().currentProject

    const targetTrack = findCompatibleTrackForItemType({
      tracks,
      items,
      itemType: 'text',
      preferredTrackId: activeTrackId,
    })
    if (!targetTrack) throw new Error('No available track for a text layer.')

    const durationInFrames = args.durationSeconds
      ? Math.max(1, Math.round(args.durationSeconds * fps))
      : getDefaultGeneratedLayerDurationInFrames(fps)
    const proposed =
      args.atSeconds !== undefined
        ? Math.round(args.atSeconds * fps)
        : usePlaybackStore.getState().currentFrame
    const from =
      findNearestAvailableSpace(proposed, durationInFrames, targetTrack.id, items) ?? proposed

    const canvasWidth = currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH
    const canvasHeight = currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT
    const baseTextItem = createTextTemplateItem({
      placement: {
        trackId: targetTrack.id,
        from,
        durationInFrames,
        canvasWidth,
        canvasHeight,
        fps,
      },
      text: args.text,
    })
    const positionY =
      args.position === 'top'
        ? -canvasHeight * 0.32
        : args.position === 'bottom'
          ? canvasHeight * 0.32
          : args.position === 'lower-third'
            ? canvasHeight * 0.24
            : 0
    const textItem: TextItem = {
      ...baseTextItem,
      ...(args.fontSize !== undefined ? { fontSize: args.fontSize } : {}),
      ...(args.color ? { color: args.color } : {}),
      transform: { ...baseTextItem.transform, y: positionY },
    }

    addItem(textItem)
    if (useTimelineStore.getState().items.some((item) => item.id === textItem.id)) {
      selectItems([textItem.id])
    }
    return { ok: true, message: `Added a title "${args.text.slice(0, 40)}".` }
  },
})

// --- edit tools -------------------------------------------------------------

const split = defineTool({
  name: 'split',
  title: 'Split clips',
  description:
    'Split clips at a time (default playhead). Targets the given clips, else the selection, else all clips crossing that time.',
  inputSchema: objSchema({
    clips: CLIPS_PROP,
    atSeconds: { type: 'number', minimum: 0, description: 'Split time; defaults to the playhead.' },
  }),
  schema: z.object({ clips: clipsField, atSeconds: z.number().min(0).optional() }),
  summarize: (args) =>
    `Split at ${args.atSeconds !== undefined ? `${args.atSeconds.toFixed(1)}s` : 'the playhead'}`,
  execute: (args) => {
    const { items, splitItem } = useTimelineStore.getState()
    const frame =
      args.atSeconds !== undefined
        ? Math.round(args.atSeconds * getFps())
        : usePlaybackStore.getState().currentFrame

    const targeted = resolveTargetItems(args.clips)
    const pool = targeted.length > 0 ? targeted : items
    const crossing = pool.filter(
      (item) => frame > item.from && frame < item.from + item.durationInFrames,
    )
    if (crossing.length === 0) throw new Error('No clips cross that time to split.')

    for (const item of crossing) splitItem(item.id, frame)
    return {
      ok: true,
      message: `Split ${crossing.length} clip${crossing.length === 1 ? '' : 's'}.`,
    }
  },
})

const deleteClips = defineTool({
  name: 'delete_clips',
  title: 'Delete clips',
  description: 'Ripple-delete the given clips, closing the gaps so later clips shift back.',
  inputSchema: objSchema({ clips: CLIPS_PROP }, ['clips']),
  destructive: true,
  schema: z.object({ clips: z.array(z.string()).min(1) }),
  summarize: (args) => `Delete ${args.clips.join(', ')}`,
  execute: (args) => {
    const items = resolveTargetItems(args.clips)
    if (items.length === 0) throw new Error('None of those clip refs exist.')
    useTimelineStore.getState().rippleDeleteItems(items.map((item) => item.id))
    return { ok: true, message: `Deleted ${items.length} clip${items.length === 1 ? '' : 's'}.` }
  },
})

const setSpeed = defineTool({
  name: 'set_speed',
  title: 'Set speed',
  description: 'Change playback speed of video/audio clips. 1 = normal, 2 = double, 0.5 = half.',
  inputSchema: objSchema(
    {
      clips: CLIPS_PROP,
      scope: SCOPE_PROP,
      speed: { type: 'number', minimum: 0.1, maximum: 10 },
    },
    ['speed'],
  ),
  schema: z.object({
    clips: clipsField,
    scope: scopeField,
    speed: z.number().min(0.1).max(10),
  }),
  summarize: (args) => `Set speed to ${args.speed}x`,
  execute: (args) => {
    const { rateStretchItem } = useTimelineStore.getState()
    const media = resolveScopedItems(args.clips, args.scope).filter(isMedia)
    if (media.length === 0) throw new Error('Select or name one or more video/audio clips.')
    for (const item of media) {
      const current = item.speed ?? 1
      const newDuration = Math.max(1, Math.round((item.durationInFrames * current) / args.speed))
      rateStretchItem(item.id, item.from, newDuration, args.speed)
    }
    return {
      ok: true,
      message: `Set ${media.length} clip${media.length === 1 ? '' : 's'} to ${args.speed}x.`,
    }
  },
})

const setVolume = defineTool({
  name: 'set_volume',
  title: 'Set volume',
  description: 'Set video/audio volume as a percentage (0 = mute, 100 = original level).',
  inputSchema: objSchema(
    {
      clips: CLIPS_PROP,
      scope: SCOPE_PROP,
      volume: { type: 'number', minimum: 0, maximum: 200 },
    },
    ['volume'],
  ),
  schema: z.object({
    clips: clipsField,
    scope: scopeField,
    volume: z.number().min(0).max(200),
  }),
  summarize: (args) => `Set volume to ${Math.round(args.volume)}%`,
  execute: (args) => {
    const { updateItemsTransformMap } = useTimelineStore.getState()
    const media = resolveScopedItems(args.clips, args.scope).filter(isMedia)
    if (media.length === 0) throw new Error('Select or name one or more video/audio clips.')
    const volumeDb = args.volume <= 0 ? -60 : Math.min(12, 20 * Math.log10(args.volume / 100))
    updateItemsTransformMap(new Map(), {
      itemUpdates: new Map(media.map((item) => [item.id, { volume: volumeDb }])),
    })
    return {
      ok: true,
      message: `Set ${media.length} clip${media.length === 1 ? '' : 's'} to ${Math.round(args.volume)}% volume.`,
    }
  },
})

const setFades = defineTool({
  name: 'set_fades',
  title: 'Set clip fades',
  description:
    'Apply fade-in, fade-out, or both to selected clips or every compatible clip. Use this for fades on clip edges, not transitions between cuts.',
  inputSchema: objSchema(
    {
      clips: CLIPS_PROP,
      scope: SCOPE_PROP,
      direction: { type: 'string', enum: ['in', 'out', 'both'] },
      kind: { type: 'string', enum: ['visual', 'audio', 'both'] },
      durationSeconds: { type: 'number', minimum: 0, maximum: 30 },
    },
    ['durationSeconds'],
  ),
  schema: z.object({
    clips: clipsField,
    scope: scopeField,
    direction: z.enum(['in', 'out', 'both']).optional(),
    kind: z.enum(['visual', 'audio', 'both']).optional(),
    durationSeconds: z.number().min(0).max(30),
  }),
  summarize: (args) =>
    `Set ${args.direction ?? 'in/out'} ${args.kind ?? 'visual'} fades to ${args.durationSeconds.toFixed(1)}s`,
  // Visual/audio and in/out combinations intentionally share one atomic update command.
  // fallow-ignore-next-line complexity
  execute: (args) => {
    const { fps, updateItemsTransformMap } = useTimelineStore.getState()
    const direction = args.direction ?? 'both'
    const kind = args.kind ?? 'visual'
    const updates = new Map<string, Partial<TimelineItem>>()

    for (const item of resolveScopedItems(args.clips, args.scope)) {
      const visual = kind !== 'audio' && (item.type === 'video' || item.type === 'composition')
      const audio = kind !== 'visual' && (item.type === 'video' || item.type === 'audio')
      if (!visual && !audio) continue

      const clipSeconds = item.durationInFrames / Math.max(1, fps)
      const maxFadeSeconds = direction === 'both' ? clipSeconds / 2 : clipSeconds
      const duration = Math.min(args.durationSeconds, maxFadeSeconds)
      const update: Partial<TimelineItem> = {}
      if (visual && direction !== 'out') update.fadeIn = duration
      if (visual && direction !== 'in') update.fadeOut = duration
      if (audio && direction !== 'out') update.audioFadeIn = duration
      if (audio && direction !== 'in') update.audioFadeOut = duration
      updates.set(item.id, update)
    }

    if (updates.size === 0) throw new Error('Select compatible video, composition, or audio clips.')
    updateItemsTransformMap(new Map(), { itemUpdates: updates })
    return {
      ok: true,
      message: `Applied ${args.durationSeconds.toFixed(1)}s fades to ${updates.size} clip${updates.size === 1 ? '' : 's'}.`,
    }
  },
})

const setTransform = defineTool({
  name: 'set_transform',
  title: 'Position and transform clips',
  description:
    'Set canvas position, rotation, or opacity for visual clips. Coordinates are pixel offsets from canvas center.',
  inputSchema: objSchema({
    clips: CLIPS_PROP,
    scope: SCOPE_PROP,
    x: { type: 'number', description: 'Horizontal pixels from canvas center.' },
    y: { type: 'number', description: 'Vertical pixels from canvas center.' },
    rotation: { type: 'number', minimum: -360, maximum: 360 },
    opacity: { type: 'number', minimum: 0, maximum: 1 },
  }),
  schema: z
    .object({
      clips: clipsField,
      scope: scopeField,
      x: z.number().optional(),
      y: z.number().optional(),
      rotation: z.number().min(-360).max(360).optional(),
      opacity: z.number().min(0).max(1).optional(),
    })
    .refine(
      (args) =>
        args.x !== undefined ||
        args.y !== undefined ||
        args.rotation !== undefined ||
        args.opacity !== undefined,
      { message: 'Provide at least one transform property.' },
    ),
  summarize: () => 'Transform visual clips',
  execute: (args) => {
    const targets = resolveScopedItems(args.clips, args.scope).filter(
      (item) => item.type !== 'audio' && item.type !== 'adjustment',
    )
    if (targets.length === 0) throw new Error('Select or name one or more visual clips.')
    useTimelineStore.getState().updateItemsTransform(
      targets.map((item) => item.id),
      {
        ...(args.x !== undefined ? { x: args.x } : {}),
        ...(args.y !== undefined ? { y: args.y } : {}),
        ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
        ...(args.opacity !== undefined ? { opacity: args.opacity } : {}),
      },
    )
    return {
      ok: true,
      message: `Transformed ${targets.length} clip${targets.length === 1 ? '' : 's'}.`,
    }
  },
})

const animateClips = defineTool({
  name: 'animate_clips',
  title: 'Animate clips',
  description:
    'Apply editable entrance, exit, or emphasis animation to SVG parts and other visual clips. Supports non-destructive motion layers and multi-clip staggering. Direction names describe travel: slide-in-up enters from below; slide-in-down enters from above.',
  inputSchema: objSchema(
    {
      clips: CLIPS_PROP,
      scope: SCOPE_PROP,
      preset: {
        type: 'string',
        enum: MOTION_PRESETS.map((preset) => preset.id),
        description: 'Built-in animation recipe to apply.',
      },
      mode: {
        type: 'string',
        enum: ['layer', 'merge', 'replace'],
        description:
          '"layer" is non-destructive and independently removable (default); "merge" preserves keyframes at matching frames; "replace" rewrites the affected animation window.',
      },
      durationPercent: {
        type: 'number',
        minimum: 25,
        maximum: 300,
        description: 'Animation duration relative to the preset default (100 = normal).',
      },
      intensityPercent: {
        type: 'number',
        minimum: 0,
        maximum: 200,
        description: 'Motion strength relative to the preset default (100 = normal).',
      },
      staggerSeconds: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Delay each successive selected clip by this many seconds.',
      },
    },
    ['preset'],
  ),
  schema: z.object({
    clips: clipsField,
    scope: scopeField,
    preset: motionPresetField,
    mode: z.enum(['layer', 'merge', 'replace']).optional(),
    durationPercent: z.number().min(25).max(300).optional(),
    intensityPercent: z.number().min(0).max(200).optional(),
    staggerSeconds: z.number().min(0).max(10).optional(),
  }),
  summarize: (args) => `Apply ${args.preset} animation`,
  execute: (args) => {
    const preset = MOTION_PRESETS.find((candidate) => candidate.id === args.preset)
    if (!preset) throw new Error(`Unknown motion preset: ${args.preset}`)
    const targets = orderedForAnimation(
      resolveScopedItems(args.clips, args.scope).filter(isAnimatableVisual),
    )
    if (targets.length === 0) throw new Error('Select or name one or more visual clips.')

    const canvas = activeAnimationCanvas()
    const result = applyBuiltInMotion({
      preset,
      presetName: preset.id,
      items: targets,
      canvas,
      mode: args.mode ?? 'layer',
      settings: scaledMotionSettings(args, canvas.fps),
    })
    if (!result.applied) throwMotionApplyFailure(result.reason)

    return {
      ok: true,
      message: animationAppliedMessage(preset.id, targets.length, args.staggerSeconds),
      data: { preset: preset.id, itemIds: targets.map((item) => item.id), ...result },
    }
  },
})

const addContinuousMotion = defineTool({
  name: 'add_continuous_motion',
  title: 'Add continuous motion',
  description:
    'Attach editable, procedural looping motion to SVG parts and other visual clips without baking dense keyframes. Use for ambient float, breathing, shake, sway, or spin.',
  inputSchema: objSchema(
    {
      clips: CLIPS_PROP,
      scope: SCOPE_PROP,
      motion: {
        type: 'string',
        enum: MOTION_MODULATORS.map((modulator) => modulator.id),
      },
      durationPercent: {
        type: 'number',
        minimum: 25,
        maximum: 300,
        description: 'Cycle duration relative to the default (larger is slower).',
      },
      intensityPercent: {
        type: 'number',
        minimum: 0,
        maximum: 200,
        description: 'Motion strength relative to the default.',
      },
      staggerSeconds: {
        type: 'number',
        minimum: 0,
        maximum: 10,
        description: 'Phase offset between successive clips.',
      },
    },
    ['motion'],
  ),
  schema: z.object({
    clips: clipsField,
    scope: scopeField,
    motion: continuousMotionField,
    durationPercent: z.number().min(25).max(300).optional(),
    intensityPercent: z.number().min(0).max(200).optional(),
    staggerSeconds: z.number().min(0).max(10).optional(),
  }),
  summarize: (args) => `Add ${args.motion} motion`,
  execute: (args) => {
    const modulator = MOTION_MODULATORS.find((candidate) => candidate.id === args.motion)
    if (!modulator) throw new Error(`Unknown continuous motion type: ${args.motion}`)
    const targets = orderedForAnimation(
      resolveScopedItems(args.clips, args.scope).filter(isAnimatableVisual),
    )
    if (targets.length === 0) throw new Error('Select or name one or more visual clips.')

    const incompatible = targets.find((item) => {
      if (item.type === 'text' && modulator.scalesBox) return true
      const properties = new Set(getAnimatablePropertiesForItem(item))
      return !modulator.properties.every((property) => properties.has(property))
    })
    if (incompatible) {
      throw new Error(
        `Continuous ${modulator.id} motion is incompatible with ${incompatible.label}.`,
      )
    }

    const settings = scaledMotionSettings(args, getFps())
    const applied = applyMotionModifierToItems(
      targets.map((item, index) => ({
        itemId: item.id,
        modifier: createMotionModifier(modulator.id, settings, index),
      })),
    )
    if (applied === 0) throw new Error('The continuous motion could not be applied.')
    return {
      ok: true,
      message: `Added ${modulator.id} motion to ${applied} clip${applied === 1 ? '' : 's'}.`,
      data: { motion: modulator.id, itemIds: targets.map((item) => item.id) },
    }
  },
})

const removeRange = defineTool({
  name: 'remove_range',
  title: 'Remove a timeline range',
  description:
    'Cut out an exact timeline time range and ripple-close the gap. Use absolute timeline seconds; this is destructive and always reviewed first.',
  inputSchema: objSchema(
    {
      clips: CLIPS_PROP,
      scope: SCOPE_PROP,
      startSeconds: { type: 'number', minimum: 0 },
      endSeconds: { type: 'number', minimum: 0 },
    },
    ['startSeconds', 'endSeconds'],
  ),
  destructive: true,
  schema: z
    .object({
      clips: clipsField,
      scope: scopeField,
      startSeconds: z.number().min(0),
      endSeconds: z.number().min(0),
    })
    .refine((args) => args.endSeconds > args.startSeconds, {
      message: 'endSeconds must be greater than startSeconds.',
      path: ['endSeconds'],
    }),
  summarize: (args) =>
    `Remove ${args.startSeconds.toFixed(1)}–${args.endSeconds.toFixed(1)}s and close the gap`,
  execute: (args) => {
    const state = useTimelineStore.getState()
    const targets = resolveScopedItems(args.clips, args.scope).filter(isMedia)
    if (targets.length === 0) throw new Error('Select media clips or use scope "all".')
    const result = state.removeTimelineRangeFromItems(
      targets.map((item) => item.id),
      Math.round(args.startSeconds * state.fps),
      Math.round(args.endSeconds * state.fps),
    )
    if (result.removedItemCount === 0) {
      throw new Error('That range does not contain a removable part of the targeted clips.')
    }
    return {
      ok: true,
      message: `Removed ${args.startSeconds.toFixed(1)}–${args.endSeconds.toFixed(1)}s from the timeline.`,
      data: result,
    }
  },
})

const trimClip = defineTool({
  name: 'trim_clip',
  title: 'Trim clip',
  description: 'Trim seconds off the start or end of a single clip.',
  inputSchema: objSchema(
    {
      clip: { type: 'string', description: 'A single clip ref, e.g. "c2".' },
      side: { type: 'string', enum: ['start', 'end'] },
      seconds: { type: 'number', minimum: 0 },
    },
    ['clip', 'side', 'seconds'],
  ),
  schema: z.object({
    clip: z.string(),
    side: z.enum(['start', 'end']),
    seconds: z.number().min(0),
  }),
  summarize: (args) => `Trim ${args.seconds.toFixed(1)}s off the ${args.side} of ${args.clip}`,
  execute: (args) => {
    const [item] = resolveTargetItems([args.clip])
    if (!item) throw new Error(`Clip ${args.clip} does not exist.`)
    const frames = Math.round(args.seconds * getFps())
    if (frames <= 0) throw new Error('Trim amount must be greater than zero.')
    const { trimItemStart, trimItemEnd } = useTimelineStore.getState()
    if (args.side === 'start') trimItemStart(item.id, frames)
    else trimItemEnd(item.id, frames)
    return {
      ok: true,
      message: `Trimmed ${args.seconds.toFixed(1)}s off the ${args.side} of ${args.clip}.`,
    }
  },
})

const TRANSITION_STYLES = ['fade', 'dissolve', 'wipe', 'slide', 'flip', 'iris', 'pixelate'] as const

// Handle both sides of every failed transition while coalescing updates by clip.
// fallow-ignore-next-line complexity
function applyFallbackFadeEdges(
  pairs: Array<{ leftClipId: string; rightClipId: string }>,
  durationSeconds: number,
): number {
  const state = useTimelineStore.getState()
  const byId = new Map(state.items.map((item) => [item.id, item]))
  const updates = new Map<string, Partial<TimelineItem>>()
  for (const pair of pairs) {
    const left = byId.get(pair.leftClipId)
    const right = byId.get(pair.rightClipId)
    if (left && (left.type === 'video' || left.type === 'composition')) {
      updates.set(left.id, {
        ...(updates.get(left.id) ?? {}),
        fadeOut: Math.min(durationSeconds, left.durationInFrames / Math.max(1, state.fps) / 2),
      })
    }
    if (right && (right.type === 'video' || right.type === 'composition')) {
      updates.set(right.id, {
        ...(updates.get(right.id) ?? {}),
        fadeIn: Math.min(durationSeconds, right.durationInFrames / Math.max(1, state.fps) / 2),
      })
    }
  }
  if (updates.size > 0) state.updateItemsTransformMap(new Map(), { itemUpdates: updates })
  return updates.size
}

const addTransition = defineTool({
  name: 'add_transition',
  title: 'Add transition',
  description: 'Add a transition between exactly two adjacent clips on the same track.',
  inputSchema: objSchema({
    clips: {
      ...CLIPS_PROP,
      description: 'Exactly two adjacent clip refs. Omit to use the current selection.',
    },
    type: { type: 'string', enum: [...TRANSITION_STYLES] },
    durationSeconds: { type: 'number', minimum: 0.1, maximum: 5 },
  }),
  schema: z.object({
    clips: clipsField,
    type: z.enum(TRANSITION_STYLES).optional(),
    durationSeconds: z.number().min(0.1).max(5).optional(),
  }),
  summarize: (args) => `Add ${args.type ?? 'default'} transition`,
  // A real transition and its handle-free fade fallback are validated as one user-facing tool.
  // fallow-ignore-next-line complexity
  execute: (args) => {
    const targets = resolveTargetItems(args.clips)
    if (targets.length !== 2) throw new Error('Name exactly two adjacent clips for a transition.')
    const [a, b] = targets as [TimelineItem, TimelineItem]
    if (a.trackId !== b.trackId) throw new Error('Both clips must be on the same track.')
    const [left, right] = a.from <= b.from ? [a, b] : [b, a]

    const { addTransition: add, fps } = useTimelineStore.getState()
    const durationInFrames = args.durationSeconds
      ? Math.max(1, Math.round(args.durationSeconds * fps))
      : undefined
    const style = args.type ?? 'fade'
    const ok = add(left.id, right.id, 'crossfade', durationInFrames, style)
    if (ok) return { ok: true, message: `Added a ${style} transition.` }

    if (style === 'fade' || style === 'dissolve') {
      const fallbackCount = applyFallbackFadeEdges(
        [{ leftClipId: left.id, rightClipId: right.id }],
        args.durationSeconds ?? 1,
      )
      if (fallbackCount > 0) {
        return {
          ok: true,
          message:
            'Applied fade edges at the cut because the source clips have no transition handles.',
        }
      }
    }
    throw new Error('Could not add a transition between those clips.')
  },
})

const addTransitions = defineTool({
  name: 'add_transitions',
  title: 'Add transitions across clips',
  description:
    'Add the same transition at every adjacent cut among selected clips or all visual clips. Use one bulk call instead of one call per cut.',
  inputSchema: objSchema({
    clips: CLIPS_PROP,
    scope: SCOPE_PROP,
    type: { type: 'string', enum: [...TRANSITION_STYLES] },
    durationSeconds: { type: 'number', minimum: 0.1, maximum: 5 },
  }),
  schema: z.object({
    clips: clipsField,
    scope: scopeField,
    type: z.enum(TRANSITION_STYLES).optional(),
    durationSeconds: z.number().min(0.1).max(5).optional(),
  }),
  summarize: (args) =>
    `Add ${args.type ?? 'fade'} transitions across ${args.scope === 'all' ? 'all clips' : 'the target clips'}`,
  // Track grouping, adjacency checks, and fade fallbacks are covered by bulk transition tests.
  // fallow-ignore-next-line complexity
  execute: (args) => {
    const state = useTimelineStore.getState()
    const targets = resolveScopedItems(args.clips, args.scope).filter(isVisual)
    if (targets.length < 2) throw new Error('Select at least two visual clips or use scope "all".')

    const existingCuts = new Set(
      state.transitions.map((transition) => `${transition.leftClipId}:${transition.rightClipId}`),
    )
    const byTrack = new Map<string, TimelineItem[]>()
    for (const item of targets) {
      const trackItems = byTrack.get(item.trackId) ?? []
      trackItems.push(item)
      byTrack.set(item.trackId, trackItems)
    }

    const style = args.type ?? 'fade'
    const durationInFrames = args.durationSeconds
      ? Math.max(1, Math.round(args.durationSeconds * state.fps))
      : undefined
    const requests = Array.from(byTrack.values()).flatMap((items) => {
      const ordered = items.toSorted((a, b) => a.from - b.from)
      return ordered.slice(0, -1).flatMap((left, index) => {
        const right = ordered[index + 1]
        if (!right || left.from + left.durationInFrames !== right.from) return []
        if (existingCuts.has(`${left.id}:${right.id}`)) return []
        return [
          {
            leftClipId: left.id,
            rightClipId: right.id,
            type: 'crossfade' as const,
            durationInFrames,
            presentation: style,
          },
        ]
      })
    })
    if (requests.length === 0) throw new Error('No new adjacent cuts were found in those clips.')

    const result = state.addTransitions(requests)
    const fallbackCount =
      style === 'fade' || style === 'dissolve'
        ? applyFallbackFadeEdges(result.failed, args.durationSeconds ?? 1)
        : 0
    if (result.added === 0 && fallbackCount === 0) {
      throw new Error('The adjacent clips do not have enough source handles for transitions.')
    }

    const fallbackCuts = result.failed.length > 0 && fallbackCount > 0 ? result.failed.length : 0
    return {
      ok: true,
      message:
        fallbackCuts > 0
          ? `Added ${result.added} transition${result.added === 1 ? '' : 's'} and fade edges at ${fallbackCuts} cut${fallbackCuts === 1 ? '' : 's'} without media handles.`
          : `Added ${result.added} ${style} transition${result.added === 1 ? '' : 's'}.`,
      data: { ...result, fallbackCuts },
    }
  },
})

// --- review hand-offs -------------------------------------------------------

function cleanupTargetIds(clips: string[] | undefined): string[] {
  const targeted = resolveTargetItems(clips).filter(isMedia)
  if (targeted.length > 0) return targeted.map((item) => item.id)
  return useTimelineStore
    .getState()
    .items.filter(isMedia)
    .map((item) => item.id)
}

const removeSilence = defineTool({
  name: 'remove_silence',
  title: 'Remove silences',
  description:
    'Open the silence-removal review for the given clips (or all). The user previews and confirms the cuts.',
  inputSchema: objSchema({ clips: CLIPS_PROP }),
  handoff: true,
  schema: z.object({ clips: clipsField }),
  summarize: () => 'Review and remove silences',
  execute: (args) => {
    const itemIds = cleanupTargetIds(args.clips)
    if (itemIds.length === 0) throw new Error('There are no video or audio clips to analyze.')
    useSilenceRemovalDialogStore.getState().open({ itemIds })
    return { ok: true, message: 'Opened the silence-removal review.' }
  },
})

const removeFillers = defineTool({
  name: 'remove_fillers',
  title: 'Remove filler words',
  description:
    'Open the filler-word review (um, uh, like…) for the given clips (or all). The user previews and confirms.',
  inputSchema: objSchema({ clips: CLIPS_PROP }),
  handoff: true,
  schema: z.object({ clips: clipsField }),
  summarize: () => 'Review and remove filler words',
  execute: (args) => {
    const itemIds = cleanupTargetIds(args.clips)
    if (itemIds.length === 0) throw new Error('There are no video or audio clips to analyze.')
    useFillerRemovalDialogStore.getState().open({ itemIds })
    return { ok: true, message: 'Opened the filler-word review.' }
  },
})

export const EDITOR_TOOLS: readonly EditorAgentTool[] = [
  findClips,
  searchTranscript,
  selectClips,
  seekTo,
  addTitle,
  split,
  deleteClips,
  setSpeed,
  setVolume,
  setFades,
  setTransform,
  animateClips,
  addContinuousMotion,
  removeRange,
  trimClip,
  addTransition,
  addTransitions,
  removeSilence,
  removeFillers,
]
