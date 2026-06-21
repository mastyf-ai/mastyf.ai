# Tutorial video: mastyf.ai website walkthrough

**Length:** ~2 minutes  
**Live site:** [mastyf-ai-cloud-jet.vercel.app](https://mastyf-ai-cloud-jet.vercel.app/)  
**Voiceover:** [Wispr Flow](https://wisprflow.ai) — hold **Fn** (Mac) and speak the lines below  

**Pre-recorded screen capture:** `docs/tutorials/videos/site-walkthrough-demo.webm`

---

## Before you record (manual + Wispr Flow)

1. Open [https://mastyf-ai-cloud-jet.vercel.app/](https://mastyf-ai-cloud-jet.vercel.app/) full screen.
2. Launch [Wispr Flow](https://wisprflow.ai) — default hotkey **Fn** on Mac.
3. Demo package: `@playwright/mcp`.

---

## Scene 1 — Welcome (0:00–0:15)

**Screen:** Landing page — hero “Know which MCP servers are safe to trust”

**Wispr Flow narration:**

> Welcome to mastyf.ai. This is a free website for MCP security — look up npm packages, get trust scores from zero to one hundred, embed badges in your README, and manage policy in the cloud console. No install required.

---

## Scene 2 — How detection works (0:15–0:35)

**Screen:** Scroll to **Architecture** — Security Swarm diagram

**Actions:** Click **Architecture** in the nav, pause on the Security Swarm image

**Narration:**

> Under the hood, mastyf.ai uses a Security Swarm — automated red-team tests in CI plus live policy checks on every tool call. The same engine powers public scores and the optional self-hosted proxy.

---

## Scene 3 — Look up a package (0:35–1:05)

**Screen:** `/certified` — search box

**Actions:**
1. Click **Security scores** or go to `/certified`
2. Type `@playwright/mcp` slowly
3. Pause on the **live badge preview** under the search bar

**Narration:**

> Go to Security scores. Type any npm MCP package name — here Playwright’s MCP server. Watch the badge preview update in real time. That SVG comes straight from our API — your score before you even open the full report.

---

## Scene 4 — Full score report (1:05–1:35)

**Screen:** Package page — score ring, grade, breakdown, embed section

**Actions:** Click **View score**, scroll through grade, summary, and **Embed badge**

**Narration:**

> Click View score for the full breakdown — numeric score, letter grade, and plain-English fixes. Static analysis runs on CVE posture, supply chain signals, and registry metadata. Copy the markdown here to embed the badge in your README.

---

## Scene 5 — REST API (1:35–1:55)

**Screen:** Browser tab showing JSON from the badge API

```bash
curl -s "https://mastyf-ai-cloud-jet.vercel.app/api/v1/badge/@playwright%2Fmcp/json"
```

**Narration:**

> For automation, hit the JSON badge endpoint. You get score, grade, scan tier, and timestamps — perfect for CI dashboards or internal tooling.

---

## Scene 6 — Outro (1:55–2:05)

**Screen:** Back on `/certified`

**Narration:**

> That’s mastyf.ai — look up any MCP package, share the badge, or poll the API. Sign in free at the cloud console when you want to manage policy for your own servers.

---

## Re-record screen capture automatically

```bash
BASE_URL=https://mastyf-ai-cloud-jet.vercel.app \
TUTORIAL_PACKAGE=@playwright/mcp \
pnpm tutorial:record-site
```

Output:
- `docs/tutorials/videos/site-walkthrough-demo.webm`
- `apps/cloud/public/tutorials/site-walkthrough-demo.webm`

---

## Add Wispr Flow voiceover to the WebM

1. Open `site-walkthrough-demo.webm` in iMovie, DaVinci Resolve, or CapCut.
2. Hold **Fn** in Wispr Flow and dictate each scene while watching the timeline — or record audio separately and sync.
3. Export as MP4 or WebM.

**Merge a separate audio file (optional):**

```bash
pnpm tutorial:merge-voiceover -- docs/tutorials/videos/narration.m4a
```

---

## Wispr Flow tips

- Dictate each scene into Flow Notes first, then replay while screen recording.
- Say *“make this more concise”* in Command Mode to tighten narration.
- Flow removes filler words — speak naturally; you do not need a perfect script read.
