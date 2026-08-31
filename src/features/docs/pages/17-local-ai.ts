import type { DocPageContent } from '../docs-content'

const page = {
  order: 17,
  slug: 'local-ai',
  title: 'Local AI Tools',
  description:
    'Editing assistant, text to speech, music generation, and transcription with local models.',
  category: 'Creative Tools',
  related: ['scene-browser', 'text-captions-subtitles', 'audio'],
  sections: [
    {
      title: 'How local AI works',
      blocks: [
        {
          kind: 'list',
          items: [
            'Bundled AI tools run in your browser using your own hardware. The editing assistant can alternatively use a local Ollama, LM Studio, or LocalAI server you configure.',
            'The first time you use a model it downloads once and is then cached locally for reuse.',
            'A status pill shows loading, active, ready, and error states while a model runs.',
          ],
        },
        {
          kind: 'note',
          tone: 'info',
          text: 'Some tools require Chrome or Edge 113+ (or Safari 26+) and WebGPU support. The first model download can be large.',
        },
      ],
    },
    {
      title: 'Editing assistant and local LLMs',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open **AI → Assistant** and describe a timeline edit in plain language.',
            'Choose **Qwen 3.5 0.8B** for the fastest browser download, **Gemma 4 E2B** for balance, or **Gemma 4 E4B** for the strongest browser quality. Each runs in a WebGPU worker.',
            'The loader downloads text-only weights, shows aggregate bytes and progress, and lets you cancel or retry without leaving the chat stuck.',
            'FreeCut sends the selected model a compact timeline description and a strict catalog of editing tools.',
            'The assistant returns a JSON plan. FreeCut validates every tool and argument, then shows the plan for confirmation before applying changes.',
            'Clear editing requests are retried when a small model answers with instructions instead of actions. Common title, fade, transition, split, and timed-cut requests also have a validated fallback planner.',
            'It can find clips, search transcripts, select clips, move the playhead, add and style titles, split, remove exact time ranges, ripple-delete, trim, change speed or volume, transform clips, add edge fades or bulk transitions, and open reviewed silence or filler-word removal.',
            'Bulk edits such as “add fade transitions to all videos” run as one plan step. Destructive cuts require exact times and remain review-before-apply.',
            'Choose **Local server (Ollama / LM Studio)** to use a larger or CPU-backed model through an OpenAI-compatible `/v1` endpoint.',
            'The local server must be running, contain the configured model, and allow browser requests from the FreeCut origin.',
          ],
        },
        {
          kind: 'note',
          tone: 'warning',
          text: 'A local server endpoint is under your control. Prompts leave the browser and go to that endpoint, so use `127.0.0.1` unless you intentionally trust another host.',
        },
      ],
    },
    {
      title: 'External LLMs and MCP',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Start the Docker **automation** service with a workspace folder and API token.',
            'On the Projects page choose **MCP setup** (or open **AI → MCP** inside the editor), then select **Copy MCP config**.',
            'Paste the JSON into the MCP server settings for Codex, Claude, or another compatible client.',
          ],
        },
        {
          kind: 'list',
          items: [
            'The MCP server can inspect projects and media, execute the full validated headless edit contract, inspect layouts, grab frames, and render output.',
            'Persistent edits use project revisions and writer locking. `edit_project` is a dry run unless the client explicitly requests persistence.',
          ],
        },
      ],
    },
    {
      title: 'Text to speech',
      blocks: [
        {
          kind: 'steps',
          items: [
            'Open the **AI** tab and expand **Text to Speech**, then type or paste your script.',
            'Pick an engine (see the table), then choose a voice and, where supported, speed, language, and expressive tags.',
            'Preview the result, then **Save and Insert** to drop linked audio at the playhead, or **Save to Library**.',
          ],
        },
        {
          kind: 'table',
          headers: ['Engine', 'Languages', 'Runs on'],
          rows: [
            ['Kokoro', 'English', 'WebGPU'],
            ['MOSS Nano', '20 languages', 'CPU'],
            ['Supertonic 3', '31 languages', 'Local ONNX'],
          ],
        },
      ],
    },
    {
      title: 'Music generation',
      blocks: [
        {
          kind: 'list',
          items: [
            'Expand **Music Generation** and describe the track with a prompt, or start from a preset such as Lo-fi chill or Upbeat EDM.',
            'Set the length in seconds, then **Generate Music**; the first run downloads the model and caches it.',
            'Preview the clip, then **Save and Insert** into the timeline or **Save to Library**.',
          ],
        },
      ],
    },
    {
      title: 'Transcription',
      blocks: [
        {
          kind: 'list',
          items: [
            'Transcription lives in the Media library and Transcript workflow, separate from the AI tab.',
            '**Parakeet** is the fast default engine and covers many European languages.',
            'Whisper models (Tiny, Base, Small, Large v3 Turbo) are also available, and FreeCut falls back to Whisper when needed.',
          ],
        },
        {
          kind: 'note',
          tone: 'tip',
          text: 'A transcript powers captions, transcript search, and filler-word removal — generate one early.',
        },
      ],
    },
    {
      title: 'Manage models and runtimes',
      blocks: [
        {
          kind: 'list',
          items: [
            'Open **Storage** settings to manage Local AI.',
            'Use **Local AI Model Cache** to inspect or clear downloaded models — useful if a download is corrupt.',
            'Use **Unload Local Models** to release runtimes and free memory.',
            'Assistant provider, browser-model, endpoint, and server-model preferences stay in this browser. Model downloads are cache data rather than part of a project bundle.',
            'Model downloads and long jobs can be cancelled if you no longer need them.',
          ],
        },
      ],
    },
  ],
} satisfies DocPageContent

export default page
