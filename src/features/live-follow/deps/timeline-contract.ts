/**
 * Adapter exports for timeline dependencies.
 * Live-follow modules should import timeline stores from here.
 */

export { hydrateTimelineStoresFromProject } from '@/features/timeline/stores/timeline-persistence'
export { useItemsStore } from '@/features/timeline/stores/items-store'
