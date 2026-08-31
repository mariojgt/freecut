import type { RawPlanStep } from './prompt'

export interface DeterministicEditPlan {
  reply: string
  steps: RawPlanStep[]
}

const EDIT_VERB =
  /\b(?:add|apply|create|insert|put|remove|delete|cut|trim|split|fade|change|set|move|rotate|mute|speed\s+up|slow\s+down)\b/i
const EDIT_TARGET =
  /\b(?:video|audio|clip|timeline|title|text|transition|fade|silence|filler|volume|speed|middle|part|playhead)\b/i

export function isLikelyEditRequest(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/^(?:how\s+(?:do|can|would)|what|why|where)\b/i.test(trimmed)) return false
  return EDIT_VERB.test(trimmed) && EDIT_TARGET.test(trimmed)
}

function wantsAll(text: string): boolean {
  return /\b(?:all|every|each)\b/i.test(text)
}

function durationSeconds(text: string): number | undefined {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\b/i)
  return match ? Number(match[1]) : undefined
}

function timelineRange(text: string): { startSeconds: number; endSeconds: number } | null {
  const match = text.match(
    /\b(?:from|between)\s+(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)?\s*(?:to|and|-)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)?\b/i,
  )
  if (!match) return null
  const first = Number(match[1])
  const second = Number(match[2])
  if (!Number.isFinite(first) || !Number.isFinite(second) || first === second) return null
  return { startSeconds: Math.min(first, second), endSeconds: Math.max(first, second) }
}

function titleText(text: string): string | null {
  const quoted = text.match(/["“](.+?)["”]/)
  if (quoted?.[1]?.trim()) return quoted[1].trim()
  const saying = text.match(/\b(?:saying|says?|reading|with\s+(?:the\s+)?text)\s*[:-]?\s*(.+)$/i)
  if (saying?.[1]?.trim()) return saying[1].trim().replace(/[.!?]+$/, '')
  return null
}

function transitionStyle(
  text: string,
): 'fade' | 'dissolve' | 'wipe' | 'slide' | 'flip' | 'iris' | 'pixelate' {
  if (/\bdissolve\b/i.test(text)) return 'dissolve'
  if (/\bwipe\b/i.test(text)) return 'wipe'
  if (/\bslide\b/i.test(text)) return 'slide'
  if (/\bflip\b/i.test(text)) return 'flip'
  if (/\biris\b/i.test(text)) return 'iris'
  if (/\bpixel(?:ate|ated)?\b/i.test(text)) return 'pixelate'
  return 'fade'
}

function scopeArgs(text: string): { scope?: 'all' } {
  return wantsAll(text) ? { scope: 'all' } : {}
}

/**
 * Last-resort planner for common edits. It only runs after the model has had a
 * correction attempt, keeping the local LLM in charge while guaranteeing that
 * high-frequency commands do not collapse into chat-only answers.
 */
function buildRangePlan(text: string): DeterministicEditPlan | null {
  const range = timelineRange(text)
  if (!range || !/\b(?:cut|remove|delete)\b/i.test(text)) return null
  return {
    reply: `I’ll remove ${range.startSeconds}–${range.endSeconds}s and close the gap.`,
    steps: [{ tool: 'remove_range', args: { ...range, scope: 'all' } }],
  }
}

function buildTransitionPlan(text: string): DeterministicEditPlan | null {
  if (!/\btransition(?:s)?\b/i.test(text)) return null
  const duration = durationSeconds(text)
  return {
    reply: 'I’ll add transitions across the requested clips.',
    steps: [
      {
        tool: 'add_transitions',
        args: {
          ...scopeArgs(text),
          type: transitionStyle(text),
          ...(duration !== undefined ? { durationSeconds: duration } : {}),
        },
      },
    ],
  }
}

function fadeDirection(text: string): 'in' | 'out' | 'both' {
  const fadesIn = /\bfade\s+in\b/i.test(text)
  const fadesOut = /\bfade\s+out\b/i.test(text)
  if (fadesIn && fadesOut) return 'both'
  if (fadesIn) return 'in'
  if (fadesOut) return 'out'
  return 'both'
}

function fadeKind(text: string): 'visual' | 'audio' | 'both' {
  const includesAudio = /\baudio\b/i.test(text)
  const includesVisual = /\b(?:video|visual)\b/i.test(text)
  if (includesAudio && includesVisual) return 'both'
  return includesAudio ? 'audio' : 'visual'
}

function buildFadePlan(text: string): DeterministicEditPlan | null {
  if (!/\bfade(?:s|\s+in|\s+out)?\b/i.test(text)) return null
  return {
    reply: 'I’ll apply the requested clip fades.',
    steps: [
      {
        tool: 'set_fades',
        args: {
          ...scopeArgs(text),
          direction: fadeDirection(text),
          kind: fadeKind(text),
          durationSeconds: durationSeconds(text) ?? 1,
        },
      },
    ],
  }
}

function titlePosition(text: string): 'lower-third' | 'top' | 'bottom' | undefined {
  if (/\blower[ -]?third\b/i.test(text)) return 'lower-third'
  if (/\btop\b/i.test(text)) return 'top'
  if (/\bbottom\b/i.test(text)) return 'bottom'
  return undefined
}

function buildTitlePlan(text: string): DeterministicEditPlan | null {
  if (!/\b(?:title|text)\b/i.test(text) || !/\b(?:add|create|insert|put)\b/i.test(text)) {
    return null
  }
  const content = titleText(text)
  if (!content) return { reply: 'What should the title say?', steps: [] }
  const position = titlePosition(text)
  return {
    reply: 'I’ll add that title to the timeline.',
    steps: [
      {
        tool: 'add_title',
        args: { text: content, ...(position ? { position } : {}) },
      },
    ],
  }
}

function buildSplitPlan(text: string): DeterministicEditPlan | null {
  if (!/\bsplit\b/i.test(text)) return null
  const at = text.match(/\b(?:at|@)\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)\b/i)
  return {
    reply: 'I’ll split the clips at the requested point.',
    steps: [{ tool: 'split', args: at ? { atSeconds: Number(at[1]) } : {} }],
  }
}

function buildMiddleCutClarification(text: string): DeterministicEditPlan | null {
  return /\b(?:cut|remove)\b.*\b(?:middle|center)\b/i.test(text)
    ? { reply: 'Which exact start and end times should I remove?', steps: [] }
    : null
}

export function buildDeterministicEditPlan(text: string): DeterministicEditPlan | null {
  return (
    buildRangePlan(text) ??
    buildTransitionPlan(text) ??
    buildFadePlan(text) ??
    buildTitlePlan(text) ??
    buildSplitPlan(text) ??
    buildMiddleCutClarification(text)
  )
}
