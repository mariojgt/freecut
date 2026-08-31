import type { DocPageContent } from '../docs-content'

const page = {
  order: 1,
  slug: 'getting-started',
  title: 'Getting Started',
  description:
    'What FreeCut is, what your browser needs, and your first edit from launch to export.',
  category: 'Start',
  related: ['concepts', 'workspaces', 'export'],
  sections: [
    {
      title: 'What FreeCut is',
      blocks: [
        {
          kind: 'paragraph',
          text: 'FreeCut is a **local-first** video editor. By default there is no account, upload, or server render: editing, effects, color, AI tools, and export run on your own machine using your GPU and CPU. Optional local model and headless automation services can also run on your computer.',
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'Your media stays on your device. Chromium can use a **workspace folder** you choose; Firefox uses a private browser workspace. Nothing is sent to the cloud.',
        },
      ],
    },
    {
      title: 'What your browser needs',
      blocks: [
        {
          kind: 'paragraph',
          text: 'FreeCut relies on modern web APIs. Chrome and Edge provide the broadest feature set, while Firefox uses browser-private storage and enables features according to its WebGPU and codec support.',
        },
        {
          kind: 'table',
          headers: ['Browser', 'Status'],
          rows: [
            ['Chrome / Edge 113+', 'Fully supported'],
            ['Brave', 'Works after enabling the File System Access API flag'],
            ['Firefox', 'Supported with a browser-private OPFS workspace'],
            ['Safari', 'Feature-dependent; test the required codecs and WebGPU tools'],
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'FreeCut uses the File System Access API (workspace folders), WebCodecs (decode and export), WebGPU (effects, color, AI), and OPFS (caches). Keep hardware acceleration on and GPU drivers current.',
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Brave may block folder access. Open `brave://flags/#file-system-access-api`, set it to **Enabled**, then relaunch Brave.',
        },
      ],
    },
    {
      title: 'Your first edit',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open FreeCut in a supported browser. Pick a **workspace folder** in Chromium. In Firefox, start an empty browser workspace or import a copy of an existing FreeCut workspace folder.',
            'On the Projects page, choose **New Project** and set the resolution and frame rate for the edit.',
            'Open the **Media** tab and use **Import** to add files, or drag media straight into the library.',
            'Drag a clip from the Media panel onto a timeline track.',
            'Press `Space` to play, and use `Left` and `Right` to step one frame at a time.',
            'Save with `Ctrl+S` as you work, then choose **Export** to render the finished video.',
          ],
        },
      ],
    },
    {
      title: 'Confirm your setup works',
      blocks: [
        {
          kind: 'list',
          items: [
            'Chromium accepts a normal writable workspace folder. Firefox opens a browser-private workspace and can import a selected folder as a private copy.',
            'Imported media appears as cards in the Media panel with thumbnails.',
            'Playback starts from the timeline when you press `Space`.',
            'Export opens and the preflight check reports no blocking problems.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'If any step fails, see the **Troubleshooting** page for the matching symptom.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
