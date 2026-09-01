#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as z from 'zod/v4'
import { FreeCutApiClient } from './freecut-api-client.mjs'
import { ApiSupervisor } from './api-autostart.mjs'

const projectId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
const revision = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const editOperation = z.record(z.string(), z.unknown()).refine((value) => 'op' in value, {
  message: 'Each operation needs an op field.',
})

// Normalizes object and scalar tool results into the MCP structured-content contract.
// fallow-ignore-next-line complexity
function success(data, summary) {
  const structuredContent =
    data !== null && typeof data === 'object' && !Array.isArray(data) ? data : { result: data }
  return {
    content: [{ type: 'text', text: summary ?? JSON.stringify(data, null, 2) }],
    structuredContent,
  }
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  }
}

function registerTool(server, name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return await handler(args)
    } catch (error) {
      return failure(error)
    }
  })
}

export function createFreeCutMcpServer(options = {}) {
  const api = options.apiClient ?? new FreeCutApiClient(options)
  const server = new McpServer(
    { name: 'freecut', version: '1.0.0' },
    {
      instructions:
        'Use get_project before persistent edits and pass its revision as expectedRevision. ' +
        'Call edit_project with persist=false to preview risky changes, then persist only after review. ' +
        'When animating, close the loop rather than guessing: list_blocks to see which rigs, ' +
        'gestures and poses exist, then after each edit call check_scene for named faults and ' +
        'sample_motion to confirm the motion you intended actually resolved. Read contact_sheet ' +
        'when judging timing, and grab_frame only for a single pose. Render last. ' +
        'Prefer intent over coordinates: directAction (enter/exit/emphasize/moveTo/shake/reveal) ' +
        'and setCamera (push/pull/pan/rise/settle) choose distance, overshoot, arc and stagger ' +
        'for you, and attachToSlot with fit=contain keeps a child inside its container. Reach for ' +
        'addKeyframe only when no recipe fits. ' +
        'When the library has no block for the subject, draw one: give every shape an id in the ' +
        'SVG, then defineBlock a rig over those ids with parents and pivots, and addBlock it in ' +
        'the SAME call — a generated definition lives for one edit call.',
    },
  )

  registerTool(
    server,
    'get_capabilities',
    {
      title: 'Get FreeCut capabilities',
      description: 'List supported edit operations, codecs, containers, and API limits.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => success(await api.requestJson('/v1/capabilities')),
  )

  registerTool(
    server,
    'list_blocks',
    {
      title: 'List rigged blocks',
      description:
        'List the committed illustration blocks an animation can be built from — their parts, ' +
        'named slots, and the gestures each rig can perform. Call this before addBlock so you ' +
        'choose parts and gestures that exist; blocks cannot be authored, only selected.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => success(await api.requestJson('/v1/blocks')),
  )

  registerTool(
    server,
    'list_projects',
    {
      title: 'List projects',
      description: 'List projects in the mounted FreeCut workspace with their current revisions.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(1000).default(100),
        cursor: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ limit, cursor }) => {
      const query = new URLSearchParams({ limit: String(limit) })
      if (cursor) query.set('cursor', cursor)
      return success(await api.requestJson(`/v1/projects?${query}`))
    },
  )

  registerTool(
    server,
    'get_project',
    {
      title: 'Get project',
      description: 'Read a complete project document and its revision before planning edits.',
      inputSchema: z.object({ projectId }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ projectId: id }) =>
      success(await api.requestJson(`/v1/projects/${encodeURIComponent(id)}`)),
  )

  registerTool(
    server,
    'create_project',
    {
      title: 'Create project',
      description: 'Create a new project in the mounted workspace.',
      inputSchema: z.object({
        id: projectId.optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        fps: z.number().positive().optional(),
        backgroundColor: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (body) => success(await api.requestJson('/v1/projects', { method: 'POST', body })),
  )

  registerTool(
    server,
    'update_project',
    {
      title: 'Update project metadata',
      description: 'Update project name, description, dimensions, frame rate, or background.',
      inputSchema: z.object({
        projectId,
        expectedRevision: revision.optional(),
        force: z.boolean().default(false),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        fps: z.number().positive().optional(),
        backgroundColor: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ projectId: id, expectedRevision, force, ...updates }) =>
      success(
        await api.requestJson(`/v1/projects/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { updates, expectedRevision, force },
        }),
      ),
  )

  registerTool(
    server,
    'edit_project',
    {
      title: 'Edit project timeline',
      description:
        'Apply validated timeline operations. Supports clips, tracks, titles, transforms, effects, ' +
        'transitions and keyframes; rigged blocks (defineBlock, addBlock, applyGesture, applyPose, ' +
        'attachToSlot); ' +
        'intent-driven motion (directAction, setCamera); and vector work (importSvg, morphPath). ' +
        'Call get_capabilities for every operation and its fields. Defaults to a dry run.',
      inputSchema: z.object({
        projectId,
        operations: z.array(editOperation).min(1),
        persist: z.boolean().default(false),
        expectedRevision: revision.optional(),
        force: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ projectId: id, operations, persist, expectedRevision, force }) =>
      success(
        await api.requestJson(`/v1/projects/${encodeURIComponent(id)}/edit`, {
          method: 'POST',
          body: { ops: operations, persist, expectedRevision, force },
        }),
        persist ? 'Edit applied and saved.' : 'Dry run complete; the workspace was not changed.',
      ),
  )

  registerTool(
    server,
    'list_media',
    {
      title: 'List media',
      description: 'List media available in the workspace.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => success(await api.requestJson('/v1/media')),
  )

  registerTool(
    server,
    'get_media',
    {
      title: 'Get media metadata',
      description: 'Read metadata and revision for one workspace media item.',
      inputSchema: z.object({ mediaId: projectId }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ mediaId }) =>
      success(await api.requestJson(`/v1/media/${encodeURIComponent(mediaId)}`)),
  )

  registerTool(
    server,
    'probe_media',
    {
      title: 'Probe media',
      description:
        'Inspect a media source and optionally persist refreshed codec/duration metadata.',
      inputSchema: z.object({
        mediaId: projectId,
        persist: z.boolean().default(false),
        expectedRevision: revision.optional(),
        force: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ mediaId, persist, expectedRevision, force }) =>
      success(
        await api.requestJson(`/v1/media/${encodeURIComponent(mediaId)}/probe`, {
          method: 'POST',
          body: { persist, expectedRevision, force },
        }),
      ),
  )

  registerTool(
    server,
    'dump_layout',
    {
      title: 'Inspect frame layout',
      description: 'Return computed on-canvas bounds and properties without rendering an image.',
      inputSchema: z.object({
        projectId,
        frame: z.number().int().nonnegative().optional(),
        atSeconds: z.number().nonnegative().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ projectId: id, ...position }) =>
      success(
        await api.requestJson('/layout', {
          method: 'POST',
          body: { project: id, ...position },
        }),
      ),
  )

  registerTool(
    server,
    'grab_frame',
    {
      title: 'Render one frame',
      description:
        'Render a project frame to an image file in the configured MCP output directory.',
      inputSchema: z.object({
        projectId,
        frame: z.number().int().nonnegative().optional(),
        atSeconds: z.number().nonnegative().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        format: z.enum(['png', 'jpg', 'jpeg', 'webp']).default('png'),
        quality: z.number().min(0).max(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ projectId: id, format, ...settings }) =>
      success(
        await api.requestFile('/frame', {
          body: { project: id, format, ...settings },
          fallbackName: `frame.${format === 'jpeg' ? 'jpg' : format}`,
        }),
      ),
  )

  registerTool(
    server,
    'sample_motion',
    {
      title: 'Measure motion over a range',
      description:
        'Resolve each item transform across a frame range and return motion statistics — ' +
        'travel, net displacement, peak speed, and per-channel ranges — plus a `moved` flag. ' +
        'Use this to confirm keyframes you just wrote actually animate something, and how far. ' +
        'Costs no render: it is transform maths, so it is cheap enough to run after every edit.',
      inputSchema: z.object({
        projectId,
        from: z.number().int().nonnegative().optional(),
        to: z.number().int().nonnegative().optional(),
        samples: z.number().int().min(1).max(600).default(24),
        itemIds: z.array(z.string()).max(500).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ projectId: id, ...range }) =>
      success(
        await api.requestJson('/v1/motion', { method: 'POST', body: { project: id, ...range } }),
      ),
  )

  registerTool(
    server,
    'check_scene',
    {
      title: 'Check a scene for visual faults',
      description:
        'Run semantic gates over a frame range and report named failures a rendered image ' +
        'cannot tell you about: items off canvas or clipped, layers left at ghost opacity, ' +
        'text crossing the title-safe area, degenerate or non-finite transforms, two ' +
        'full-frame backdrops ghosting over each other, frames with nothing drawn, and ' +
        'items that never move. Run this before rendering; errors mean the frame is broken.',
      inputSchema: z.object({
        projectId,
        from: z.number().int().nonnegative().optional(),
        to: z.number().int().nonnegative().optional(),
        samples: z.number().int().min(1).max(600).default(24),
        titleSafe: z.number().min(0.1).max(1).optional(),
        ghostOpacity: z.number().min(0).max(1).optional(),
        offCanvasTolerance: z.number().min(0).max(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ projectId: id, ...options }) =>
      success(
        await api.requestJson('/v1/check', { method: 'POST', body: { project: id, ...options } }),
      ),
  )

  registerTool(
    server,
    'contact_sheet',
    {
      title: 'Render a contact sheet',
      description:
        'Render several frames across a range and tile them into one labelled image in the ' +
        'MCP output directory. This is how you see timing: whether a move eases or snaps, ' +
        'whether a reveal lands on its beat, whether a limb passes through a body. Prefer it ' +
        'over repeated grab_frame calls when reviewing motion rather than a single pose.',
      inputSchema: z.object({
        projectId,
        from: z.number().int().nonnegative().optional(),
        to: z.number().int().nonnegative().optional(),
        count: z.number().int().min(1).max(64).default(9),
        columns: z.number().int().min(1).max(16).optional(),
        cellWidth: z.number().int().positive().max(4096).optional(),
        label: z.boolean().default(true),
        format: z.enum(['png', 'jpg', 'jpeg', 'webp']).default('png'),
        quality: z.number().min(0).max(1).optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ projectId: id, format, ...settings }) =>
      success(
        await api.requestFile('/v1/contact-sheet', {
          body: { project: id, format, ...settings },
          fallbackName: `contact-sheet.${format === 'jpeg' ? 'jpg' : format}`,
        }),
      ),
  )

  registerTool(
    server,
    'render_project',
    {
      title: 'Render project',
      description: 'Render a project to a video/audio file in the configured MCP output directory.',
      inputSchema: z.object({
        projectId,
        codec: z.enum(['h264', 'h265', 'vp8', 'vp9', 'av1']).optional(),
        container: z.enum(['mp4', 'webm', 'mov', 'mkv', 'mp3', 'wav', 'm4a']).optional(),
        resolution: z.string().optional(),
        fps: z.number().positive().optional(),
        quality: z.enum(['low', 'medium', 'high', 'ultra']).optional(),
        in: z.number().nonnegative().optional(),
        outSec: z.number().nonnegative().optional(),
        duration: z.number().positive().optional(),
        audioOnly: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ projectId: id, ...settings }) =>
      success(
        await api.requestFile('/v1/render', {
          body: { project: id, ...settings },
          fallbackName: 'freecut-render.bin',
        }),
      ),
  )

  return server
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isEntrypoint) {
  // Bring the API up before serving, so the first tool call does not fail while
  // a cold Chrome and a dist/ build are still coming online.
  const supervisor = new ApiSupervisor()
  await supervisor.ensure()

  serveStdio(() => createFreeCutMcpServer(), {
    onerror: (error) => console.error('[freecut-mcp]', error.message),
  })
  console.error(
    `FreeCut MCP server connected to ${process.env.FREECUT_API_URL || 'http://127.0.0.1:8787'}`,
  )
}
