/**
 * Timing a cut to a recorded read.
 *
 * Estimated timings drift. A beat authored at "about four seconds" is right once
 * and wrong after every re-record, every script edit and every take where the
 * narrator breathes differently — and the failure is invisible in a still, so it
 * survives review and shows up as animation that lands a beat off the word it
 * illustrates.
 *
 * Measured timings do not drift. A cue names the word it belongs to, and the
 * frame is derived from where that word actually falls in the audio. Re-record
 * the line and the cut follows it.
 *
 * Pure on purpose: word timings in, seconds and frames out. Transcription itself
 * belongs to ingest — the browser already does it on-device — so this layer only
 * consumes the result and never depends on a model being available.
 */

export interface NarrationWord {
  text: string
  /** Seconds from the start of the narration audio. */
  start: number
  end: number
}

/** Which edge of a matched span a cue refers to. */
export type CueEdge = 'start' | 'end'

export interface WordCue {
  /** A single spoken word. Matched with punctuation and case ignored. */
  word: string
  /** 1-based, for a word the read uses more than once. Defaults to the first. */
  occurrence?: number
  edge?: CueEdge
  /** Nudge, in seconds. Negative anticipates the word, which is how a reveal
   * lands ON it rather than after it. */
  offsetSeconds?: number
}

export interface PhraseCue {
  /** Consecutive words. Matched the same way, so punctuation does not matter. */
  phrase: string
  occurrence?: number
  edge?: CueEdge
  offsetSeconds?: number
}

export interface TimeCue {
  atSeconds: number
  offsetSeconds?: number
}

export type NarrationCue = WordCue | PhraseCue | TimeCue

/**
 * Reduce a token to what matching should care about.
 *
 * ASR emits "password," and "Password" and sometimes "password's"; a cue is
 * written by a human reading a script. Comparing raw text makes the feature fail
 * for reasons the author cannot see.
 */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Levenshtein distance, capped — only used to suggest a near miss. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0 || b.length === 0) return Math.max(a.length, b.length)
  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[b.length]!
}

/**
 * Words the author might have meant.
 *
 * The point of naming them is that the caller can correct itself: an unmatched
 * cue is nearly always a transcription difference ("log in" vs "login") rather
 * than a word the read does not contain.
 */
function suggestions(words: readonly NarrationWord[], target: string): string[] {
  const normalized = normalizeWord(target)
  const scored = new Map<string, number>()
  for (const word of words) {
    const candidate = normalizeWord(word.text)
    if (!candidate) continue
    const distance = editDistance(normalized, candidate)
    if (distance > Math.max(1, Math.floor(normalized.length / 3))) continue
    const best = scored.get(candidate)
    if (best === undefined || distance < best) scored.set(candidate, distance)
  }
  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word)
}

export interface MatchedSpan {
  startIndex: number
  endIndex: number
  startSeconds: number
  endSeconds: number
}

/**
 * Find the nth run of consecutive words matching a phrase.
 *
 * Empty tokens are skipped rather than failing the match: ASR sometimes emits a
 * bare punctuation token, and a phrase should not stop matching because of it.
 */
export function findPhrase(
  words: readonly NarrationWord[],
  phrase: string,
  occurrence = 1,
): MatchedSpan | undefined {
  const wanted = phrase.split(/\s+/).map(normalizeWord).filter(Boolean)
  if (wanted.length === 0) return undefined

  const usable = words
    .map((word, index) => ({ index, text: normalizeWord(word.text) }))
    .filter((entry) => entry.text.length > 0)

  let seen = 0
  for (let start = 0; start + wanted.length <= usable.length; start++) {
    let matched = true
    for (let offset = 0; offset < wanted.length; offset++) {
      if (usable[start + offset]!.text !== wanted[offset]) {
        matched = false
        break
      }
    }
    if (!matched) continue
    seen++
    if (seen < occurrence) continue
    const first = words[usable[start]!.index]!
    const last = words[usable[start + wanted.length - 1]!.index]!
    return {
      startIndex: usable[start]!.index,
      endIndex: usable[start + wanted.length - 1]!.index,
      startSeconds: first.start,
      endSeconds: last.end,
    }
  }
  return undefined
}

/** How many times a phrase occurs, so the failure can say what is actually there. */
function countOccurrences(words: readonly NarrationWord[], phrase: string): number {
  let found = 0
  while (findPhrase(words, phrase, found + 1)) found++
  return found
}

/**
 * Why a cue did not match, in terms the caller can act on.
 *
 * An unmatched cue is nearly always a transcription difference — "log in" for
 * "login", a swallowed word, a name the model spelled its own way — rather than
 * a word the read genuinely lacks. Naming the near misses is what lets a caller
 * fix it without re-reading the whole transcript.
 */
function unmatchedCue(
  words: readonly NarrationWord[],
  cue: WordCue | PhraseCue,
  phrase: string,
  occurrence: number,
): Error {
  if (words.length === 0) {
    return new Error(
      `Cannot resolve the cue "${phrase}": no narration is attached. Use setNarration first.`,
    )
  }

  const kind = 'phrase' in cue ? 'phrase' : 'word'
  const found = countOccurrences(words, phrase)
  if (found > 0) {
    return new Error(
      `The narration says the ${kind} "${phrase}" ${found} time${found === 1 ? '' : 's'}, ` +
        `so occurrence ${occurrence} does not exist.`,
    )
  }

  const near = suggestions(words, phrase)
  return new Error(
    `The narration never says the ${kind} "${phrase}"` +
      (near.length > 0 ? `. Did you mean: ${near.join(', ')}?` : '.'),
  )
}

function isTimeCue(cue: NarrationCue): cue is TimeCue {
  return 'atSeconds' in cue
}

function cueText(cue: NarrationCue): string {
  if (isTimeCue(cue)) return `${cue.atSeconds}s`
  return 'phrase' in cue ? cue.phrase : cue.word
}

/**
 * Resolve a cue to a time in the narration, in seconds.
 *
 * Throws rather than falling back to zero. A cue that silently resolved to the
 * start of the audio would put the beat somewhere plausible and wrong, which is
 * exactly the failure this whole mechanism exists to remove.
 */
export function resolveCue(words: readonly NarrationWord[], cue: NarrationCue): number {
  if (isTimeCue(cue)) return cue.atSeconds + (cue.offsetSeconds ?? 0)

  const phrase = 'phrase' in cue ? cue.phrase : cue.word
  const occurrence = Math.max(1, Math.floor(cue.occurrence ?? 1))
  const span = findPhrase(words, phrase, occurrence)

  if (!span) throw unmatchedCue(words, cue, phrase, occurrence)

  const edge = cue.edge ?? 'start'
  return (edge === 'end' ? span.endSeconds : span.startSeconds) + (cue.offsetSeconds ?? 0)
}

export interface BeatSpec {
  from: NarrationCue
  /** End of the beat. Mutually exclusive with `forSeconds`. */
  until?: NarrationCue
  forSeconds?: number
}

export interface ResolvedBeat {
  from: number
  durationInFrames: number
  fromSeconds: number
  untilSeconds: number
}

/** Shortest beat that can still carry a curve. */
const MIN_BEAT_FRAMES = 1

/**
 * Turn a cue pair into composition frames.
 *
 * Frames, not seconds, because that is what every op downstream takes — and
 * rounding once here means two beats cued to the same word land on the same
 * frame rather than a frame apart.
 */
export function resolveBeat(
  words: readonly NarrationWord[],
  spec: BeatSpec,
  fps: number,
): ResolvedBeat {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('resolveBeat needs a positive fps.')
  if (spec.until && spec.forSeconds !== undefined) {
    throw new Error('A beat takes either `until` or `forSeconds`, not both.')
  }

  const fromSeconds = resolveCue(words, spec.from)
  const untilSeconds = spec.until
    ? resolveCue(words, spec.until)
    : fromSeconds + (spec.forSeconds ?? 1)

  if (untilSeconds < fromSeconds) {
    throw new Error(
      `The beat ends before it starts: "${cueText(spec.from)}" is at ${fromSeconds.toFixed(2)}s ` +
        `and "${spec.until ? cueText(spec.until) : `+${spec.forSeconds ?? 1}s`}" is at ` +
        `${untilSeconds.toFixed(2)}s. Cues follow the read, so check their order in the script.`,
    )
  }

  const from = Math.max(0, Math.round(fromSeconds * fps))
  const end = Math.max(0, Math.round(untilSeconds * fps))
  return {
    from,
    durationInFrames: Math.max(MIN_BEAT_FRAMES, end - from),
    fromSeconds,
    untilSeconds,
  }
}

/**
 * Position a cue takes inside an already-resolved beat, 0..1.
 *
 * This is what lets a pose sequence follow the read: the steps stay normalized,
 * so the gesture machinery is unchanged, but where each one falls is measured
 * rather than guessed.
 */
export function cuePositionInBeat(
  words: readonly NarrationWord[],
  cue: NarrationCue,
  beat: { fromSeconds: number; untilSeconds: number },
): number {
  const span = beat.untilSeconds - beat.fromSeconds
  if (span <= 0) return 0
  const at = resolveCue(words, cue)
  return Math.min(1, Math.max(0, (at - beat.fromSeconds) / span))
}

/** Flatten transcript segments into the word list cues resolve against. */
export function wordsFromSegments(
  segments: readonly { words?: readonly NarrationWord[] }[],
): NarrationWord[] {
  return segments.flatMap((segment) => [...(segment.words ?? [])])
}
