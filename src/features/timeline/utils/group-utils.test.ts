// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { TimelineTrack } from '@/types/timeline'
import {
  getTimelineDescendantTrackIds,
  getTimelineDisplayTracks,
  getVisibleTrackIds,
  pruneEmptyLayerGroupHierarchy,
  pruneEmptyLayerGroups,
  resolveEffectiveTrackStates,
} from './group-utils'

function makeTrack(overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'track-1',
    name: 'Track 1',
    kind: 'video',
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    order: 0,
    items: [],
    ...overrides,
  }
}

describe('group-utils', () => {
  it('keeps a collapsed group row while hiding all of its nested lanes', () => {
    const tracks = [
      makeTrack({ id: 'group-1', isGroup: true, isCollapsed: true, order: 0 }),
      makeTrack({ id: 'child-1', parentTrackId: 'group-1', order: 1 }),
      makeTrack({
        id: 'nested-group',
        isGroup: true,
        parentTrackId: 'group-1',
        order: 2,
      }),
      makeTrack({ id: 'nested-child', parentTrackId: 'nested-group', order: 3 }),
      makeTrack({ id: 'top-level', order: 4 }),
    ]

    expect(getTimelineDisplayTracks(tracks).map((track) => track.id)).toEqual([
      'group-1',
      'top-level',
    ])
  })

  it('reveals expanded children and keeps orphaned or cyclic tracks accessible', () => {
    const tracks = [
      makeTrack({ id: 'group-1', isGroup: true, isCollapsed: false, order: 0 }),
      makeTrack({ id: 'child-1', parentTrackId: 'group-1', order: 1 }),
      makeTrack({ id: 'orphan', parentTrackId: 'missing', order: 2 }),
      makeTrack({ id: 'cycle-a', isGroup: true, parentTrackId: 'cycle-b', order: 3 }),
      makeTrack({ id: 'cycle-b', isGroup: true, parentTrackId: 'cycle-a', order: 4 }),
    ]

    expect(getTimelineDisplayTracks(tracks).map((track) => track.id)).toEqual(
      tracks.map((track) => track.id),
    )
  })

  it('collects nested group descendants once even when the hierarchy is cyclic', () => {
    const tracks = [
      makeTrack({ id: 'group-1', isGroup: true }),
      makeTrack({ id: 'child-1', parentTrackId: 'group-1' }),
      makeTrack({ id: 'nested-group', isGroup: true, parentTrackId: 'group-1' }),
      makeTrack({ id: 'nested-child', parentTrackId: 'nested-group' }),
      makeTrack({ id: 'cycle-back', parentTrackId: 'nested-child' }),
    ]
    tracks[0] = { ...tracks[0]!, parentTrackId: 'cycle-back' }

    expect(getTimelineDescendantTrackIds(tracks, 'group-1')).toEqual(
      new Set(['child-1', 'nested-group', 'nested-child', 'cycle-back']),
    )
  })

  it('filters out group container tracks while preserving child ordering', () => {
    const tracks = resolveEffectiveTrackStates([
      makeTrack({ id: 'group-1', isGroup: true, order: 0 }),
      makeTrack({ id: 'child-1', parentTrackId: 'group-1', order: 1 }),
      makeTrack({ id: 'child-2', order: 2 }),
    ])

    expect(tracks.map((track) => track.id)).toEqual(['child-1', 'child-2'])
  })

  it('propagates parent layer-group mute, visibility, lock, and solo state to children', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({
        id: 'group-1',
        isGroup: true,
        locked: true,
        muted: true,
        visible: false,
        solo: true,
      }),
      makeTrack({
        id: 'child-1',
        parentTrackId: 'group-1',
      }),
    ])

    expect(effectiveChild).toMatchObject({
      id: 'child-1',
      locked: true,
      muted: true,
      visible: false,
      solo: true,
    })
  })

  it('propagates effective state through nested layer groups', () => {
    const [effectiveChild] = resolveEffectiveTrackStates([
      makeTrack({ id: 'root', isGroup: true, visible: false, solo: true }),
      makeTrack({
        id: 'nested',
        isGroup: true,
        parentTrackId: 'root',
        locked: true,
      }),
      makeTrack({ id: 'child', parentTrackId: 'nested', muted: true }),
    ])

    expect(effectiveChild).toMatchObject({
      id: 'child',
      locked: true,
      muted: true,
      visible: false,
      solo: true,
    })
  })

  it('uses propagated visibility when collecting visible track ids', () => {
    const visibleTrackIds = getVisibleTrackIds([
      makeTrack({ id: 'group-1', isGroup: true, visible: false }),
      makeTrack({ id: 'child-hidden', parentTrackId: 'group-1', visible: true }),
      makeTrack({ id: 'child-visible', visible: true }),
    ])

    expect(visibleTrackIds).toEqual(new Set(['child-visible']))
  })

  it('prunes empty layer groups while retaining populated groups and their children', () => {
    const populatedGroup = makeTrack({ id: 'group-populated', isGroup: true })
    const emptyGroup = makeTrack({ id: 'group-empty', isGroup: true })
    const child = makeTrack({ id: 'child', parentTrackId: populatedGroup.id })

    expect(pruneEmptyLayerGroups([populatedGroup, emptyGroup, child])).toEqual([
      populatedGroup,
      child,
    ])
  })

  it('retains every ancestor group of a nested populated lane', () => {
    const root = makeTrack({ id: 'root', isGroup: true })
    const nested = makeTrack({ id: 'nested', isGroup: true, parentTrackId: root.id })
    const child = makeTrack({ id: 'child', parentTrackId: nested.id })

    expect(pruneEmptyLayerGroups([root, nested, child])).toEqual([root, nested, child])
  })

  it('prunes empty child lanes without removing empty top-level classic tracks', () => {
    const group = makeTrack({ id: 'group', isGroup: true })
    const populatedChild = makeTrack({ id: 'child-populated', parentTrackId: group.id })
    const emptyChild = makeTrack({ id: 'child-empty', parentTrackId: group.id })
    const emptyClassicTrack = makeTrack({ id: 'classic-empty' })

    expect(
      pruneEmptyLayerGroupHierarchy(
        [group, populatedChild, emptyChild, emptyClassicTrack],
        [{ trackId: populatedChild.id }],
      ),
    ).toEqual([group, populatedChild, emptyClassicTrack])
  })
})
