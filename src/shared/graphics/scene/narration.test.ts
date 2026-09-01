// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import {
  cuePositionInBeat,
  findPhrase,
  normalizeWord,
  resolveBeat,
  resolveCue,
  wordsFromSegments,
  type NarrationWord,
} from './narration'

/** "This is how a login page works. You type an email and a password." */
const READ: NarrationWord[] = [
  { text: 'This', start: 0.0, end: 0.2 },
  { text: 'is', start: 0.2, end: 0.3 },
  { text: 'how', start: 0.3, end: 0.5 },
  { text: 'a', start: 0.5, end: 0.6 },
  { text: 'login', start: 0.6, end: 0.9 },
  { text: 'page', start: 0.9, end: 1.2 },
  { text: 'works.', start: 1.2, end: 1.6 },
  { text: 'You', start: 2.0, end: 2.2 },
  { text: 'type', start: 2.2, end: 2.5 },
  { text: 'an', start: 2.5, end: 2.6 },
  { text: 'Email,', start: 2.6, end: 3.0 },
  { text: 'and', start: 3.0, end: 3.2 },
  { text: 'a', start: 3.2, end: 3.3 },
  { text: 'password', start: 3.3, end: 3.9 },
]

describe('normalizeWord', () => {
  it('ignores case and punctuation, which is all ASR disagrees about', () => {
    expect(normalizeWord('Email,')).toBe('email')
    expect(normalizeWord('"works."')).toBe('works')
    expect(normalizeWord('log-in')).toBe('login')
  })

  it('strips accents so a cue written plainly still matches', () => {
    expect(normalizeWord('café')).toBe('cafe')
  })

  it('reduces a punctuation-only token to nothing', () => {
    expect(normalizeWord('—')).toBe('')
  })
})

describe('findPhrase', () => {
  it('finds a run of consecutive words', () => {
    const span = findPhrase(READ, 'login page')
    expect({ start: span?.startSeconds, end: span?.endSeconds }).toEqual({ start: 0.6, end: 1.2 })
  })

  it('matches across punctuation and case', () => {
    expect(findPhrase(READ, 'an email')?.startSeconds).toBe(2.5)
  })

  it('returns nothing for words that are not consecutive', () => {
    expect(findPhrase(READ, 'login works')).toBeUndefined()
  })

  it('skips empty tokens rather than breaking the run', () => {
    const withNoise: NarrationWord[] = [
      { text: 'a', start: 0, end: 0.1 },
      { text: '—', start: 0.1, end: 0.1 },
      { text: 'login', start: 0.1, end: 0.4 },
    ]
    expect(findPhrase(withNoise, 'a login')?.endSeconds).toBe(0.4)
  })

  it('counts occurrences from one', () => {
    expect(findPhrase(READ, 'a', 1)?.startSeconds).toBe(0.5)
    expect(findPhrase(READ, 'a', 2)?.startSeconds).toBe(3.2)
    expect(findPhrase(READ, 'a', 3)).toBeUndefined()
  })
})

describe('resolveCue', () => {
  it('resolves a word to where it is actually spoken', () => {
    expect(resolveCue(READ, { word: 'password' })).toBe(3.3)
  })

  it('resolves the end edge, for a beat that runs off a word', () => {
    expect(resolveCue(READ, { word: 'password', edge: 'end' })).toBe(3.9)
  })

  it('anticipates a word with a negative offset, so a reveal lands on it', () => {
    expect(resolveCue(READ, { word: 'password', offsetSeconds: -0.15 })).toBeCloseTo(3.15, 6)
  })

  it('resolves a phrase', () => {
    expect(resolveCue(READ, { phrase: 'login page' })).toBe(0.6)
  })

  it('takes an absolute time as an escape hatch', () => {
    expect(resolveCue(READ, { atSeconds: 5 })).toBe(5)
    expect(resolveCue(READ, { atSeconds: 5, offsetSeconds: 0.5 })).toBe(5.5)
  })

  it('picks a later occurrence', () => {
    expect(resolveCue(READ, { word: 'a', occurrence: 2 })).toBe(3.2)
  })

  it('refuses a word the read never says, and suggests near misses', () => {
    expect(() => resolveCue(READ, { word: 'passwrd' })).toThrow(
      /never says.*Did you mean.*password/s,
    )
  })

  it('says how many times a word occurs when the occurrence is too high', () => {
    expect(() => resolveCue(READ, { word: 'login', occurrence: 3 })).toThrow(
      /says the word "login" 1 time, so occurrence 3 does not exist/,
    )
  })

  it('says plainly when no narration is attached at all', () => {
    expect(() => resolveCue([], { word: 'password' })).toThrow(/no narration is attached/)
  })

  it('never silently resolves to zero', () => {
    // A cue that fell back to the start of the audio would put the beat
    // somewhere plausible and wrong, which is the failure this exists to remove.
    expect(() => resolveCue(READ, { word: 'nonexistent' })).toThrow()
  })
})

describe('resolveBeat', () => {
  it('spans two cues, in frames', () => {
    const beat = resolveBeat(READ, { from: { word: 'login' }, until: { word: 'password' } }, 30)
    expect({ from: beat.from, durationInFrames: beat.durationInFrames }).toEqual({
      from: 18,
      durationInFrames: 81,
    })
  })

  it('takes a duration in seconds instead of an end cue', () => {
    const beat = resolveBeat(READ, { from: { word: 'password' }, forSeconds: 1 }, 30)
    expect({ from: beat.from, durationInFrames: beat.durationInFrames }).toEqual({
      from: 99,
      durationInFrames: 30,
    })
  })

  it('refuses both an end cue and a duration', () => {
    expect(() =>
      resolveBeat(
        READ,
        { from: { word: 'login' }, until: { word: 'password' }, forSeconds: 1 },
        30,
      ),
    ).toThrow(/either `until` or `forSeconds`/)
  })

  it('refuses a beat whose cues are out of order, and says where each landed', () => {
    expect(() =>
      resolveBeat(READ, { from: { word: 'password' }, until: { word: 'login' } }, 30),
    ).toThrow(/ends before it starts.*3\.30s.*0\.60s/s)
  })

  it('keeps a zero-length beat renderable', () => {
    const beat = resolveBeat(READ, { from: { word: 'login' }, until: { word: 'login' } }, 30)
    expect(beat.durationInFrames).toBe(1)
  })

  it('rounds once, so two beats on the same word share a frame', () => {
    const a = resolveBeat(READ, { from: { word: 'email' }, forSeconds: 1 }, 30)
    const b = resolveBeat(READ, { from: { phrase: 'an email' }, forSeconds: 1 }, 30).from
    expect(a.from).toBe(78)
    expect(b).toBe(75)
  })

  it('refuses a nonsense frame rate', () => {
    expect(() => resolveBeat(READ, { from: { word: 'login' } }, 0)).toThrow(/positive fps/)
  })

  it('reports the seconds it measured, for a caller that wants to check', () => {
    const beat = resolveBeat(READ, { from: { word: 'login' }, until: { word: 'works' } }, 30)
    expect({ from: beat.fromSeconds, until: beat.untilSeconds }).toEqual({ from: 0.6, until: 1.2 })
  })
})

describe('cuePositionInBeat', () => {
  const beat = { fromSeconds: 2.0, untilSeconds: 4.0 }

  it('places a cue proportionally inside the beat', () => {
    expect(cuePositionInBeat(READ, { word: 'email' }, beat)).toBeCloseTo(0.3, 6)
  })

  it('clamps a cue that falls outside the beat', () => {
    expect(cuePositionInBeat(READ, { word: 'login' }, beat)).toBe(0)
    expect(cuePositionInBeat(READ, { atSeconds: 99 }, beat)).toBe(1)
  })

  it('collapses to the start when the beat has no length', () => {
    expect(cuePositionInBeat(READ, { word: 'email' }, { fromSeconds: 2, untilSeconds: 2 })).toBe(0)
  })
})

describe('wordsFromSegments', () => {
  it('flattens a transcript into one word list', () => {
    const words = wordsFromSegments([
      { words: [{ text: 'a', start: 0, end: 1 }] },
      { words: [{ text: 'b', start: 1, end: 2 }] },
      {},
    ])
    expect(words.map((word) => word.text)).toEqual(['a', 'b'])
  })
})
