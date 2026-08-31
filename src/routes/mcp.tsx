import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { FreeCutLogo } from '@/components/brand/freecut-logo'
import { Button } from '@/components/ui/button'
import { McpSetupPanel } from '@/features/editor/components/mcp-setup-panel'

export const Route = createFileRoute('/mcp')({
  component: McpSetupPage,
})

function McpSetupPage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-background">
      <header className="panel-header border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/">
            <FreeCutLogo variant="full" size="md" />
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/projects">
                <ArrowLeft className="h-4 w-4" />
                {t('toolbar.backToProjects')}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/docs/$slug" params={{ slug: 'local-ai' }}>
                <BookOpen className="h-4 w-4" />
                {t('projects.workspaceGate.workspaceGuide')}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto h-[calc(100vh-73px)] max-w-2xl p-4 sm:p-6">
        <McpSetupPanel />
      </main>
    </div>
  )
}
