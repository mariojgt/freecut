import type { AnimationKeyframeSource, AnimatableProperty } from '@/types/keyframe'
import type { TimelineItem } from '@/types/timeline'
import type { CanvasSettings } from '@/types/transform'
import {
  applyMotionLayersToItems,
  applyMotionPresetKeyframes,
  useKeyframesStore,
  type MotionPresetClear,
  type MotionPresetVectorApply,
} from '@/features/editor/deps/timeline-store'
import { getSourceDimensions, resolveTransform } from '@/features/editor/deps/composition-runtime'
import {
  applyMotionGeneratorSettings,
  createMotionAnimationLayer,
  getAnimatablePropertiesForItem,
  getMotionPresetAnchorFrame,
  MOTION_PRESETS,
  motionPresetScalesBox,
  resolveAnimatedTransform,
  type MotionGeneratorSettings,
  type MotionPreset,
} from '@/features/editor/deps/keyframes'

export type BuiltInMotionApplyMode = 'replace' | 'merge' | 'layer'

export interface ApplyBuiltInMotionOptions {
  preset: MotionPreset
  items: TimelineItem[]
  canvas: CanvasSettings
  settings: MotionGeneratorSettings
  mode?: BuiltInMotionApplyMode
  /** Human-readable name stored with generated layers/keyframes. */
  presetName?: string
}

export interface ApplyBuiltInMotionResult {
  applied: boolean
  keyframes: number
  layers: number
  reason?: 'no-targets' | 'incompatible' | 'transition-blocked'
  incompatibleItemIds?: string[]
}

const MOTION_PRESET_PROPERTIES: AnimatableProperty[] = Array.from(
  new Set(MOTION_PRESETS.flatMap((preset) => preset.properties)),
)

function incompatibleItems(items: TimelineItem[], preset: MotionPreset): string[] {
  return items.flatMap((item) => {
    if (item.type === 'text' && motionPresetScalesBox(preset)) return [item.id]
    const properties = new Set<AnimatableProperty>(getAnimatablePropertiesForItem(item))
    return preset.properties.every((property) => properties.has(property)) ? [] : [item.id]
  })
}

/**
 * Apply one built-in motion recipe to an ordered set of timeline items.
 *
 * The Motion inspector and the AI assistant share this path so stagger,
 * replace/merge semantics, Vector2 lanes, undo, and transition-region safety
 * stay identical regardless of who authored the animation.
 */
// The scalar/vector preservation branches intentionally mirror the animation model.
// fallow-ignore-next-line complexity
export function applyBuiltInMotion(options: ApplyBuiltInMotionOptions): ApplyBuiltInMotionResult {
  const { preset, items, canvas, settings } = options
  if (items.length === 0) return { applied: false, keyframes: 0, layers: 0, reason: 'no-targets' }

  const incompatibleItemIds = incompatibleItems(items, preset)
  if (incompatibleItemIds.length > 0) {
    return {
      applied: false,
      keyframes: 0,
      layers: 0,
      reason: 'incompatible',
      incompatibleItemIds,
    }
  }

  const mode = options.mode ?? 'replace'
  const replace = mode === 'replace'
  const additiveLayer = mode === 'layer'
  const presetName = options.presetName ?? preset.id
  const clearSet = new Set<AnimatableProperty>(MOTION_PRESET_PROPERTIES)
  const keyframesByItemId = useKeyframesStore.getState().keyframesByItemId
  const payloads: Array<
    { itemId: string; source?: AnimationKeyframeSource } & ReturnType<
      typeof applyMotionGeneratorSettings
    >[number]
  > = []
  const clears: MotionPresetClear[] = []
  const vectorApplies: MotionPresetVectorApply[] = []
  const layerAssignments: Parameters<typeof applyMotionLayersToItems>[0] = []

  for (const [index, item] of items.entries()) {
    const itemKeyframes = keyframesByItemId[item.id]
    const anchorKeyframes =
      replace && itemKeyframes
        ? {
            ...itemKeyframes,
            properties: itemKeyframes.properties.filter((entry) => !clearSet.has(entry.property)),
            vectorProperties: itemKeyframes.vectorProperties?.filter(
              (entry) => entry.property !== 'position' && entry.property !== 'scale',
            ),
          }
        : itemKeyframes
    const base = resolveTransform(item, canvas, getSourceDimensions(item))
    const anchorFrame = getMotionPresetAnchorFrame(
      preset.category,
      item.durationInFrames,
      canvas.fps,
    )
    const anchor = resolveAnimatedTransform(base, anchorKeyframes, anchorFrame)
    const context = {
      anchor,
      durationInFrames: item.durationInFrames,
      fps: canvas.fps,
      frameWidth: canvas.width,
      frameHeight: canvas.height,
    }
    const built = applyMotionGeneratorSettings(
      preset,
      preset.build(context),
      context,
      settings,
      index,
    )
    if (built.length === 0) continue

    if (additiveLayer) {
      layerAssignments.push({
        itemId: item.id,
        layer: createMotionAnimationLayer({
          name: presetName,
          source: 'built-in-preset',
          sourcePresetId: preset.id,
          anchor,
          payloads: built,
        }),
      })
      continue
    }

    const source: AnimationKeyframeSource = {
      applicationId: crypto.randomUUID(),
      kind: 'built-in-preset',
      presetId: preset.id,
      presetName,
    }
    const existingVectorProperties = new Set(
      itemKeyframes?.vectorProperties
        ?.filter((property) => property.keyframes.length > 0)
        .map((property) => property.property) ?? [],
    )
    const vectorEvaluationKeyframes = replace ? anchorKeyframes : itemKeyframes
    const vectorControlledScalars = new Set<AnimatableProperty>()

    if (existingVectorProperties.has('position')) {
      const positionPayloads = built.filter(
        (keyframe) => keyframe.property === 'x' || keyframe.property === 'y',
      )
      if (positionPayloads.length > 0) {
        const frames = [...new Set(positionPayloads.map((keyframe) => keyframe.frame))]
        const fromFrame = Math.min(...frames)
        const toFrame = Math.max(...frames)
        vectorApplies.push({
          itemId: item.id,
          property: 'position',
          keyframes: frames.map((frame) => {
            const pose = resolveAnimatedTransform(base, vectorEvaluationKeyframes, frame)
            const x = positionPayloads.find(
              (keyframe) => keyframe.frame === frame && keyframe.property === 'x',
            )
            const y = positionPayloads.find(
              (keyframe) => keyframe.frame === frame && keyframe.property === 'y',
            )
            const style = x ?? y!
            return {
              frame,
              value: { x: x?.value ?? pose.x, y: y?.value ?? pose.y },
              easing: style.easing,
              easingConfig: style.easingConfig,
              source,
            }
          }),
          ...(replace && { replaceRange: { fromFrame, toFrame } }),
        })
        vectorControlledScalars.add('x')
        vectorControlledScalars.add('y')
      }
    }

    if (existingVectorProperties.has('scale')) {
      const scalePayloads = built.filter(
        (keyframe) => keyframe.property === 'width' || keyframe.property === 'height',
      )
      if (scalePayloads.length > 0) {
        const frames = [...new Set(scalePayloads.map((keyframe) => keyframe.frame))]
        const fromFrame = Math.min(...frames)
        const toFrame = Math.max(...frames)
        vectorApplies.push({
          itemId: item.id,
          property: 'scale',
          keyframes: frames.map((frame) => {
            const pose = resolveAnimatedTransform(base, vectorEvaluationKeyframes, frame)
            const width = scalePayloads.find(
              (keyframe) => keyframe.frame === frame && keyframe.property === 'width',
            )
            const height = scalePayloads.find(
              (keyframe) => keyframe.frame === frame && keyframe.property === 'height',
            )
            const style = width ?? height!
            const resolvedWidth = width?.value ?? pose.width
            const resolvedHeight = height?.value ?? pose.height
            return {
              frame,
              value: {
                x: base.width === 0 ? 100 : (resolvedWidth / base.width) * 100,
                y: base.height === 0 ? 100 : (resolvedHeight / base.height) * 100,
              },
              easing: style.easing,
              easingConfig: style.easingConfig,
              source,
            }
          }),
          ...(replace && { replaceRange: { fromFrame, toFrame } }),
        })
        vectorControlledScalars.add('width')
        vectorControlledScalars.add('height')
      }
    }

    for (const keyframe of built) {
      if (!vectorControlledScalars.has(keyframe.property)) {
        payloads.push({ itemId: item.id, ...keyframe, source })
      }
    }

    if (replace) {
      const frames = built.map((keyframe) => keyframe.frame)
      const fromFrame = Math.min(...frames)
      const toFrame = Math.max(...frames)
      for (const property of MOTION_PRESET_PROPERTIES) {
        clears.push({ itemId: item.id, property, fromFrame, toFrame })
      }
    }
  }

  if (additiveLayer) {
    const layers = applyMotionLayersToItems(layerAssignments)
    return {
      applied: layers > 0,
      keyframes: 0,
      layers,
      ...(layers === 0 && { reason: 'transition-blocked' as const }),
    }
  }

  const mergePayloads = replace
    ? payloads
    : payloads.filter((payload) => {
        const lane = keyframesByItemId[payload.itemId]?.properties.find(
          (candidate) => candidate.property === payload.property,
        )
        return !lane?.keyframes.some((keyframe) => keyframe.frame === payload.frame)
      })
  const ids = applyMotionPresetKeyframes(mergePayloads, replace ? clears : [], vectorApplies)
  return {
    applied: ids.length > 0,
    keyframes: ids.length,
    layers: 0,
    ...(ids.length === 0 && { reason: 'transition-blocked' as const }),
  }
}
