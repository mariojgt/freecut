import type { DocPageContent } from '../docs-content'

const page = {
  order: 2,
  slug: 'workspaces',
  title: 'Workspaces and Storage',
  description:
    'How the workspace folder works, where files live, permissions, and cache maintenance.',
  category: 'Start',
  related: ['concepts', 'projects', 'troubleshooting'],
  sections: [
    {
      title: 'The workspace model',
      blocks: [
        {
          kind: 'list',
          items: [
            'A **workspace** is the storage root that FreeCut reads from and writes to.',
            'Chrome, Edge, and other compatible Chromium browsers can use a normal folder you select on disk.',
            'Firefox uses the origin-private file system (OPFS), which belongs to this site and is not shown as a normal folder in the operating system.',
            'Firefox can select an existing workspace folder through **Import workspace folder**. FreeCut preserves the directory tree while copying it into a new private workspace.',
            'Everything FreeCut generates lives there: project files, media metadata, thumbnails, waveforms, transcripts, scene data, AI assets, caches, and exports.',
            'Chromium can link original source files or copy them into the workspace. Browsers without a native file picker copy imported media into the workspace.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A Chromium workspace folder can be backed up or synced like any directory. A folder imported in Firefox is a one-time copy and does not sync changes back to disk. Export `.freecut.zip` project bundles regularly; clearing this site’s browser data also clears its OPFS workspace.',
        },
      ],
    },
    {
      title: 'Choosing and switching workspaces',
      blocks: [
        {
          kind: 'list',
          items: [
            'On first launch FreeCut asks you to pick a writable folder, start an empty browser workspace, or import an existing workspace folder, depending on browser support.',
            'Pick a normal folder you own — for example a folder in Documents. Avoid protected system locations.',
            'Use the **Workspaces** control to add, import, switch between, or remove known workspaces.',
            'Switching changes which folder FreeCut uses; it does not move your source media.',
          ],
        },
      ],
    },
    {
      title: 'Portable projects',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Export Project** to create a `.freecut.zip` bundle containing the project document, media, cover, and reusable animation presets.',
            'Importing a bundle copies its media into the active workspace, so the imported project does not depend on origin-specific file handles.',
            'Bundles can move between Chromium folders, Firefox browser storage, another computer, and the headless/MCP service.',
          ],
        },
      ],
    },
    {
      title: 'Permissions and reconnecting',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Browsers can expire folder permission between sessions for security.',
        },
        {
          kind: 'list',
          items: [
            'When FreeCut shows **Reconnect your workspace**, choose **Reconnect** and grant read and write access to the same folder.',
            'If access is denied, pick the folder again and allow access when the browser prompts.',
            'If the folder was moved, renamed, or deleted, choose a different folder instead.',
          ],
        },
      ],
    },
    {
      title: 'Missing media',
      blocks: [
        {
          kind: 'list',
          items: [
            'Missing Media means FreeCut cannot currently read one or more linked source files.',
            'Use **Grant Access** when a file only needs renewed browser permission.',
            'Use **Locate** or **Locate Folder** when a file or its folder was moved.',
            'Use **Browse Another Folder** to point FreeCut at a new copy of the media.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'Use **Work Offline** only when you plan to relink the files later; clips stay as broken references until then.',
        },
      ],
    },
    {
      title: 'Moving projects and clearing caches',
      blocks: [
        {
          kind: 'list',
          items: [
            'Use **Export Project** to package a project and its media into a portable bundle another workspace can import.',
            'Project cache actions clear regenerated data such as waveforms, filmstrips, GIF frames, and decoded audio.',
            'Storage settings also let you regenerate thumbnails, generate missing proxies, and delete proxies.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Clearing caches never deletes your source media; FreeCut regenerates previews when the project needs them.',
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
