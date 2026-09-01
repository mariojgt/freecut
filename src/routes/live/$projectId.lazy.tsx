import { createLazyFileRoute } from '@tanstack/react-router'
import { LiveFollowPage } from '@/features/live-follow/components/live-follow-page'

export const Route = createLazyFileRoute('/live/$projectId')({
  component: LivePage,
})

function LivePage() {
  const { projectId } = Route.useParams()
  return <LiveFollowPage projectId={projectId} />
}
