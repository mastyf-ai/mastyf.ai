# Tutorial videos

| File | Description |
| ---- | ----------- |
| [site-walkthrough-video-script.md](../site-walkthrough-video-script.md) | **Wispr Flow** narration script (~2 min) — full website tour |
| [site-walkthrough-demo.webm](./site-walkthrough-demo.webm) | Screen recording — landing, architecture, live score lookup |

**Watch on the live site (after deploy):**

- [mastyf-ai-cloud-jet.vercel.app/tutorials/site-walkthrough](https://mastyf-ai-cloud-jet.vercel.app/tutorials/site-walkthrough)
- Direct file: […/tutorials/site-walkthrough-demo.webm](https://mastyf-ai-cloud-jet.vercel.app/tutorials/site-walkthrough-demo.webm)

## Record

```bash
BASE_URL=https://mastyf-ai-cloud-jet.vercel.app pnpm tutorial:record-site
```

## Add Wispr Flow voiceover

1. Open [Wispr Flow](https://wisprflow.ai).
2. Play `site-walkthrough-demo.webm` in a video editor.
3. Hold **Fn** and dictate from [site-walkthrough-video-script.md](../site-walkthrough-video-script.md).

Or merge a recorded audio track:

```bash
pnpm tutorial:merge-voiceover -- path/to/narration.m4a
```
