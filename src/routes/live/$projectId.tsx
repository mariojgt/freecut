import { createFileRoute } from '@tanstack/react-router'

// No loader: the live-follow hook owns fetching and error states so the
// initial load and the revision poll share one code path.
export const Route = createFileRoute('/live/$projectId')({})
