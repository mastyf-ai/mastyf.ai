<p align="center">
  <img src="docs/assets/logo.jpeg" alt="mastyf.ai logo" width="160" />
</p>

<h1 align="center">mastyf.ai</h1>

<p align="center"><strong>Your model proposes. Mastyf decides.</strong></p>

<p align="center">A local reference monitor and security gateway for AI agents and MCP.<br>Every tool call your agent makes is checked against your policy before it runs. Unsafe calls never reach your files, shell or network.</p>

<p align="center">
  <a href="https://www.mastyf.ai">Website</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#sign-in-for-the-first-time">First sign-in</a> ·
  <a href="#connect-your-agents">Connect agents</a> ·
  <a href="#the-dashboard">Dashboard</a> ·
  <a href="#free-and-shield">Free and Shield</a> ·
  <a href="https://www.mastyf.ai/docs">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/mastyf-ai/mastyf.ai/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/mastyf-ai/mastyf.ai/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI" alt="CI status"></a>
  <a href="https://github.com/mastyf-ai/mastyf.ai/actions/workflows/codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/mastyf-ai/mastyf.ai/codeql.yml?style=flat-square&logo=github&label=CodeQL" alt="CodeQL status"></a>
  <a href="https://github.com/mastyf-ai/mastyf.ai/actions/workflows/gitleaks.yml"><img src="https://img.shields.io/github/actions/workflow/status/mastyf-ai/mastyf.ai/gitleaks.yml?style=flat-square&label=secret%20scan" alt="Secret scan status"></a>
  <a href="https://github.com/mastyf-ai/mastyf.ai/actions/workflows/corpus-eval.yml"><img src="https://img.shields.io/github/actions/workflow/status/mastyf-ai/mastyf.ai/corpus-eval.yml?style=flat-square&label=attack%20corpus" alt="Attack corpus status"></a>
<br>
  <a href="https://github.com/mastyf-ai/mastyf.ai/commits/main"><img src="https://img.shields.io/github/last-commit/mastyf-ai/mastyf.ai?style=flat-square&color=B49A5E" alt="Last commit"></a>
  <a href="https://github.com/mastyf-ai/mastyf.ai/graphs/commit-activity"><img src="https://img.shields.io/github/commit-activity/m/mastyf-ai/mastyf.ai?style=flat-square&color=B49A5E" alt="Commits per month"></a>
  <a href="https://github.com/mastyf-ai/mastyf.ai/blob/main/package.json"><img src="https://img.shields.io/github/package-json/v/mastyf-ai/mastyf.ai?style=flat-square&color=B49A5E&label=version" alt="Version"></a>
  <a href="https://github.com/mastyf-ai/mastyf.ai/stargazers"><img src="https://img.shields.io/github/stars/mastyf-ai/mastyf.ai?style=flat-square&color=B49A5E" alt="Stars"></a>
  <a href="https://github.com/mastyf-ai/mastyf.ai/issues"><img src="https://img.shields.io/github/issues/mastyf-ai/mastyf.ai?style=flat-square" alt="Open issues"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-5c5c56?style=flat-square" alt="License"></a>
  <a href="https://doi.org/10.5281/zenodo.22179415"><img src="https://img.shields.io/badge/DOI-10.5281%2Fzenodo.22179415-5c5c56?style=flat-square" alt="Zenodo DOI"></a>
</p>

> [!NOTE]
> **Enterprise and cloud:** Mastyf runs as a native `CONTENT_AUTHZ` Service Extension for **Google Cloud Agent Gateway** (`us-central1`), with distributed Redis state, sub-second fail-closed enforcement and BigQuery audit logging. See the [Google Agent Gateway runbook](deploy/GOOGLE_AGENT_GATEWAY.md).

<p align="center">
  <img src="docs/assets/dashboard/tour.gif" alt="The Mastyf dashboard: home, activity, security, policy and servers, the Ctrl K page search, and the light theme" width="900" />
  <br><sub>The local dashboard at <code>http://localhost:4000</code>, recorded from a real install.</sub>
</p>

---

## Why Mastyf

AI agents read your files, push code, query databases, run shell commands and call APIs, on their own and at machine speed. A single poisoned web page or tool result can steer them into doing something you never asked for.

Mastyf sits between the agent and its tools. The agent still decides what it wants to do; Mastyf decides whether that action reaches the real world.

```mermaid
flowchart LR
  A["AI agent<br/>Claude Code, Cursor, LangChain..."] -->|tool call| M
  subgraph M["Mastyf, on your machine"]
    direction TB
    R["Your policy rules<br/>about 1.5 ms"] --> P["Protocol X model<br/>Shield plan"]
  end
  M -->|allowed| T["Your tools<br/>files, shell, network, databases"]
  M -.->|blocked: 0 bytes sent| X["Agent gets a policy error"]
  M --> L[("Audit log and<br/>signed receipts")]
```

One call, start to finish:

```mermaid
sequenceDiagram
  autonumber
  participant A as Your agent
  participant M as Mastyf
  participant T as MCP server
  participant D as Dashboard
  A->>M: read_text_file("notes.txt")
  M->>M: check arguments against your policy
  M->>T: allowed, forwarded
  T-->>M: file contents
  M->>M: check the result too
  M-->>A: file contents
  M-)D: recorded as allowed
  A->>M: read_text_file(".ssh/id_rsa")
  M--xA: blocked, the server never sees it
  M-)D: recorded as blocked, with the rule
```

### What it stops

| Threat | What it looks like |
|--------|--------------------|
| Prompt injection | Instructions hidden in tool arguments or results that hijack the agent |
| Path traversal | Reads of `/etc/passwd`, `.ssh/id_rsa`, `.aws/credentials` |
| Secret exfiltration | API keys and tokens leaking out through tool arguments |
| Shell injection | Reverse shells, `rm -rf`, encoded PowerShell |
| Data exfiltration | Bulk SQL dumps, `git push`, `aws s3 cp`, unapproved uploads |
| SSRF | Calls to cloud metadata endpoints, localhost and private IP ranges |
| Encoding evasion | Base64 blobs and Unicode look-alikes used to slip past patterns |
| Cost abuse | Runaway agent loops burning through token budgets |
| Rug-pull attacks | Tool definitions that quietly change mid-session |

---

## Quick start

You need **Git** and **Node.js 20 or newer**. [Ollama](https://ollama.com/download) is optional and only needed for [Threat Lab](#threat-lab). Mastyf uses **pnpm**, which ships with Node through Corepack, so there is nothing else to install.

```bash
git clone https://github.com/mastyf-ai/mastyf.ai.git
cd mastyf.ai
corepack enable          # makes the pnpm command available
pnpm install             # about two minutes the first time
pnpm dashboard:proxy     # starts Mastyf and the dashboard
```

Open **http://localhost:4000** and follow [Sign in for the first time](#sign-in-for-the-first-time) below.

The repository ships prebuilt server code (`dist/`) and a prebuilt dashboard, so no build step is needed. If you change the source, run `pnpm build`, and `pnpm dashboard:build` for the dashboard.

<details>
<summary><strong>Windows</strong></summary>

`pnpm dashboard:proxy` runs a small shell script, so start it from **Git Bash** (installed with Git for Windows). From PowerShell or Command Prompt, run the same thing directly:

```powershell
node dist/cli.js start --policy default-policy.yaml --blocking-mode block
```

If `corepack enable` says it needs administrator rights, run `corepack pnpm install` and `corepack pnpm dashboard:proxy` instead; they work without it.

</details>

<details>
<summary><strong>Linux with Nix</strong></summary>

`./setup.sh` installs Nix if needed, enables flakes, installs every dependency, builds the project and adds a `mastyf` shell alias. Afterwards, `mastyf` starts the same thing as `pnpm dashboard:proxy`.

```bash
chmod +x setup.sh && ./setup.sh
```

</details>

<details>
<summary><strong>What starting Mastyf changes on your computer</strong></summary>

- Creates `~/.mastyf/dashboard_api_key`, your dashboard key, readable only by you.
- Stores history and accounts in `~/.mastyf-ai/history.db`.
- Starts **Fleet Hub**: one checkpoint for each server config in the top level of `mastyf-ai-configs/`, on local ports 9101 and up. The examples in `mastyf-ai-configs/examples/` are not started; copy one up a level to use it. With none, the dashboard still starts and shows zero traffic until an agent calls a tool.
- Lists the AI agents on this computer and their MCP servers. It reads names only and changes nothing until you turn [protection](#connect-your-agents) on.

</details>

---

## Sign in for the first time

The dashboard always asks you to sign in, even on your own computer, so no other program on the machine can read your agents' activity. You sign in with an **API key** that Mastyf creates for you, and the first time you also create your own **administrator account**.

<p align="center">
  <img src="docs/assets/dashboard/first-run.gif" alt="First run: open the dashboard, find the API key, paste it, create the administrator account and land signed in" width="860" />
</p>

### Step 1. Start Mastyf

Run `pnpm dashboard:proxy` (see [Quick start](#quick-start)). The first time it runs, it creates your API key and saves it in a file. It never prints the key in the logs.

### Step 2. Get your API key

Run this in the `mastyf.ai` folder. It prints the key and where it is stored:

```bash
pnpm dashboard:key
```

Or read the file yourself:

| Your system | Command |
|-------------|---------|
| Windows (PowerShell) | `Get-Content "$HOME\.mastyf\dashboard_api_key"` |
| macOS or Linux | `cat ~/.mastyf/dashboard_api_key` |

The key is a long line of letters and numbers. Treat it like a password: anyone who has it can sign in to your dashboard.

### Step 3. Open the dashboard and create your account

Go to **http://localhost:4000**. The first time, you see **Set up your dashboard**:

1. Paste your **API key**. This proves you are the person who installed Mastyf on this computer.
2. Pick a **username** and enter your **email**.
3. Choose a **password**: at least 12 characters, with an uppercase letter, a lowercase letter, a number and a symbol, and not containing your username. The form tells you as you type whether it is strong enough.
4. Select **Create account and sign in**.

You are signed in straight away and land on the home page. The setup screen never appears again.

### Every time after that

Open http://localhost:4000 and sign in either way:

- **API key**: paste the key from step 2. Quickest on your own machine.
- **Username and password**: the account you created, or one an administrator made for you under **Settings, Users**.

<p align="center">
  <img src="docs/assets/dashboard/signin.png" alt="The sign-in screen with the API key and Username and password options" width="820" />
</p>

### If something goes wrong

| Problem | What to do |
|---------|------------|
| "That API key does not match this dashboard" | Copy the key again with `pnpm dashboard:key`. Make sure the whole line was pasted with no spaces. |
| You forgot your password | Sign in with the API key instead. Then open **Settings, Users**, choose **Reset password** on your account, sign out, and sign in with the temporary password it shows; you are asked to pick a new one. |
| You lost the key file | Delete `~/.mastyf/dashboard_api_key` and restart Mastyf. A new key is created; your account and history are kept. |
| "Create the first administrator account before signing in with the API key" | Nobody has finished setup yet. Open http://localhost:4000 and complete step 3. |
| The page says the Mastyf service is not answering | Mastyf is not running. Start it with `pnpm dashboard:proxy` and refresh. |

---

## Connect your agents

Open **Home** and turn **Protection** on. That is all.

<p align="center">
  <img src="docs/assets/dashboard/protection.gif" alt="Turning protection on in the dashboard: the agent's MCP server becomes protected, then a second server added to the agent is found and protected by itself" width="860" />
  <br><sub>Recorded from a real run. A second server is added to the agent while protection is on, and it is picked up by itself.</sub>
</p>

Mastyf finds the MCP servers of Claude Code, Claude Desktop, Cursor, VS Code, Windsurf and Cline, and has them start through the proxy. It keeps watching, so a server you add next week is protected within seconds. Restart an agent after its settings change.

```mermaid
stateDiagram-v2
  [*] --> Off
  Off --> On: turn on
  On --> On: new MCP server found, protected by itself
  On --> Off: turn off, every setting put back
  Off: Off. Agents are listed, nothing is changed
  On: On. Every call is checked and recorded
```

| | What happens |
|---|---|
| Turning on | Backs up each agent's settings file next to it, then points its local MCP servers at the proxy. Other settings stay as they are. |
| While on | Checks the settings files every few seconds and protects anything new. The choice survives a restart of Mastyf. |
| Turning off | Puts the original server entries back. Entries you changed yourself in the meantime are left alone. |
| Left as they are | Servers already behind another Mastyf (such as the Shield app), remote URL servers, servers in a Claude Code project, and servers that use agent variables such as `${workspaceFolder}`. |

Prefer the command line? `node dist/cli.js connect` and `node dist/cli.js disconnect` do the same once. For an agent Mastyf does not know, `node dist/cli.js connect --print-config <name> --command "<server command>"` prints the entry to paste into its settings.

**Which files can a connected agent reach?** Only the folders you name in the server's own arguments, such as `C:/Users/you/projects` above, plus `/home`, `/tmp`, `/workspace` and `/app`. Paths with `..`, and links that lead out of those folders, are refused. Key files, `.env`, `.ssh`, `.aws` and other credential files are refused everywhere. To use a different list of folders, set `MASTYF_AI_ALLOWED_PATHS` where the proxy is started, for example `D:/data/*,D:/work/*`. The check covers path arguments of tool calls; it cannot see paths inside shell commands, which the policy rules handle.

---

## The dashboard

The dashboard is where you see what your agents did, what was stopped and why, and where you tune your policy. It uses the same design as [mastyf.ai](https://www.mastyf.ai) and the Shield app: dark by default, with a light theme one click away in the header.

<table>
  <tr>
    <td width="50%"><img src="docs/assets/dashboard/home-dark.png" alt="Home page, dark theme" /></td>
    <td width="50%"><img src="docs/assets/dashboard/home-light.png" alt="Home page, light theme" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Home, dark (Shield)</sub></td>
    <td align="center"><sub>Home, light (mastyf.ai)</sub></td>
  </tr>
</table>

**Home** answers three questions at a glance: is protection on, what happened in the period you picked (checked, allowed, blocked, average time per call), and which AI agents on this computer go through Mastyf. Every number comes from your own install; nothing is sample data.

Numbers, the agent list and the activity feed update by themselves while the page is open. To read the same figures from a script:

```bash
curl -s -H "Authorization: Bearer $(cat ~/.mastyf/dashboard_api_key)" http://localhost:4000/api/protection
```

### Try an attack against Protocol X

Protocol X is the decision model inside Shield. It reads each tool call and result in context and catches attacks that fixed rules miss. The home page lets you try it: pick what the attacker wants and how they hide it, then send it through.

<p align="center">
  <img src="docs/assets/dashboard/playground.gif" alt="The Protocol X playground: choosing an attack and a disguise, sending it, and comparing the verdict of your rules with Protocol X" width="860" />
</p>

- **Your rules** check the payload live, on your computer, with your own policy. This is the free policy engine.
- **Protocol X** shows the verdict it gave on that exact text in Mastyf's red-team runs: the probability of an attack and the time it took on a laptop CPU. Every example is a recorded run; nothing is invented.
- Edit the text and your rules still check it live. Protocol X reads text it has never seen only inside [Shield](#free-and-shield).

### What Shield adds

Below the playground, pick an everyday task (summarize a web page, debug a config error, fix a failing test) and watch an attack ride along with it. The final tool call is checked live against your rules, next to the Shield layer that stops it and why: DIFC taint tracking, the causal gate or the argument-intent auditor.

### Every workspace

The header has three tabs, like the Shield app. **Home** is the page above. **Security Center** holds Activity, Security, Policy and Logs. **Engineering** holds the Dashboard overview, MCP Servers, Cost, Compliance, Settings and Help. Each tab has its own sidebar. Use them, or press <kbd>Ctrl</kbd> <kbd>K</kbd> (<kbd>⌘</kbd> <kbd>K</kbd> on a Mac) to jump to any page by name.

| Workspace | What you can do there |
|-----------|-----------------------|
| **Activity** | Live feed of every tool call, the full audit trail with filters, traffic analytics and infrastructure health |
| **Security** | Security posture, Threat Lab, threat intel, vulnerability discovery, the attack swarm, AI learning, quarantine, threat feeds |
| **Policy** | Active rules (switch any rule on or off), the YAML editor with hot reload, test any tool call, policy eval, corpus review, and **version history** with a diff and one-click restore |
| **MCP Servers** | Inventory, health and latency, certifications, and the tool registry |
| **Cost** | Token usage and spend per server and tool, and a **monthly budget** with an alert threshold |
| **Compliance** | Posture against compliance frameworks, and the evidence files behind it to download |
| **Logs** | Event log, system log and retention |
| **Settings** | Users, groups, roles, SSO, security settings, hooks, the audit log, your profile, cloud link, and the status of **block alerts** (Slack, PagerDuty, any webhook) and **SIEM export** (Splunk, Elastic, OpenTelemetry, syslog) |

<table>
  <tr>
    <td width="50%"><img src="docs/assets/dashboard/activity.png" alt="Activity: audit trail" /></td>
    <td width="50%"><img src="docs/assets/dashboard/policy-test.png" alt="Policy: test a tool call" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Activity, audit trail</sub></td>
    <td align="center"><sub>Policy, test a tool call</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/dashboard/policy-history.png" alt="Policy: version history with a line diff" /></td>
    <td width="50%"><img src="docs/assets/dashboard/servers.png" alt="MCP servers: inventory" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Policy, version history</sub></td>
    <td align="center"><sub>MCP servers, inventory</sub></td>
  </tr>
</table>

---

## Free and Shield

Everything in this repository is free and open source under AGPL-3.0 and runs on your own machines, with no account. The paid **Mastyf Shield** plan adds the desktop app, Protocol X and the layers that need Mastyf's servers. The dashboard shows which plan you are on in the header.

| | Free | Shield |
|---|:---:|:---:|
| Policy engine: blocked paths, secret and data-leak patterns, injection patterns, tool fingerprints (about 1.5 ms per call) | Yes | Yes |
| Python library (`pip install mastyf-ai`) with LangChain and OpenAI Agents adapters | Yes | Yes |
| Check service any agent in any language can call | Yes | Yes |
| GitHub Copilot hooks | Yes | Yes |
| Security Swarm and Threat Lab attack tests | Yes | Yes |
| This local dashboard | Yes | Yes |
| Protection switch: finds the MCP servers of your agents and keeps protecting new ones | Yes | Yes |
| Shield desktop app: finds your agents and protects them with no code changes | | Yes |
| Automatic protection for Claude Code, Cursor and VS Code, including the agent's own shell commands and file reads | | Yes |
| Protocol X model checks on calls your rules allow | | Yes |
| DIFC taint tracking: untrusted data cannot flow out | | Yes |
| Argument-intent auditor: arguments must match what you asked for | | Yes |
| Causal gate: stops calls set off by untrusted content instead of by you | | Yes |
| mastyf.ai dashboard and hosted check API | | Yes |

Plans and prices: **[mastyf.ai/pricing](https://www.mastyf.ai/pricing)**.

---

## How enforcement works

Every tool call passes through three layers before it reaches your infrastructure.

1. **Pattern detection.** Regex scanning for injection, dangerous paths, leaked secrets, shell commands and encoding tricks. Runs in microseconds with no external dependencies.
2. **Schema validation.** Rejects malformed payloads, oversized arguments and JSON-RPC violations before policy evaluation.
3. **Semantic review.** An optional local model (Ollama) or Protocol X in Shield evaluates calls that pass the pattern checks. With no model configured, Mastyf falls back to heuristics.

Anything that fails is blocked, the tool never runs, and the decision is logged. Tool **results** are checked on the way back too, so a poisoned web page or file never reaches the agent.

### Results

```mermaid
xychart-beta
  title "Attacker success on AgentDojo's attacked cases (249 cases)"
  x-axis ["No defense", "With Protocol X"]
  y-axis "Attacks that succeeded (%)" 0 --> 30
  bar [25, 0]
```

```mermaid
pie showData
  title Local corpus, rules only: 293 attacks
  "Blocked" : 285
  "Not caught by rules alone" : 8
```

```mermaid
xychart-beta
  title "Attack defense in the paper (%)"
  x-axis ["AgentDojo", "InjecAgent"]
  y-axis "Attacks stopped (%)" 90 --> 100
  bar [99.52, 98.43]
```

| Measure | Result | Source |
|---------|--------|--------|
| Attack defense, AgentDojo | 99.52% | [Paper](https://doi.org/10.5281/zenodo.22179415), 629 interactive episodes |
| Attack defense, InjecAgent | 98.43% | [Paper](https://doi.org/10.5281/zenodo.22179415), 4,216 benchmark instances |
| Novel red-team attacks tested | 777 | Mastyf red-team suite, none in the model's training data |
| Ordinary tool calls allowed | 40 of 40 | Benign corpus scored on the same day |
| Rule check, median | about 1.5 ms | Laptop CPU, 95th percentile about 5 ms |
| Local corpus, rules only | 285 of 293 attacks blocked, 79 of 79 harmless allowed | `corpus/run-eval.ts` on this repository |
| Bytes reaching a tool on block | 0 | Complete mediation |

---

## Policy

Your rules live in `default-policy.yaml`. You own them; Mastyf enforces them. Edit them in the dashboard (**Policy, Policy Editor**) or in any text editor; changes reload automatically, and every save from the dashboard is kept in **Version history**.

```yaml
policy:
  mode: block
  default_action: pass
  unicode_strict: true
  rules:
    - name: block-sensitive-paths
      action: block
      argPatterns:
        - field: path
          patterns: ['^/etc/', '/\.ssh', '/\.aws/credentials']

    - name: rate-limit-tool-calls
      action: block
      maxCallsPerMinute: 120

    - name: block-shell-injection
      action: block
      patterns: ['rm\s+-rf', 'curl\s', 'wget\s', '`[^`]+`']
```

Roll out safely with three modes:

| Mode | Behavior | When to use |
|------|----------|-------------|
| `audit` | Log everything, block nothing | First week: learn what your agents do |
| `warn` | Log and flag, still forward | Tuning before you enforce |
| `block` | Stop violations before they run | Production |

Ready-made templates for HIPAA, PCI-DSS, GxP and data residency are in [`policy-templates/`](policy-templates/).

---

## Architecture

Mastyf runs two coordinated swarms. The CI Swarm attacks your policy before code ships. The Runtime Swarm enforces and learns from every live tool call. Four feedback loops connect them, so the system gets harder to bypass over time.

```mermaid
flowchart TB
  AI["AI clients<br/>Cursor, Claude Desktop, Cline"]

  subgraph CI["CI Swarm (pull requests and nightly)"]
    direction LR
    Scout["Scout<br/>SAST, deps, config scan"]
    Corpus["Corpus<br/>attack fixtures"]
    Evasion["Evasion<br/>120+ probes, generates new ones"]
    Parity["Parity<br/>Node vs Python"]
    ProxyA["Proxy<br/>live stdio MCP tests"]
    Report["Report<br/>security-swarm/latest.json"]
    Scout --> Corpus --> Evasion --> Parity --> ProxyA --> Report
  end

  subgraph Runtime["Runtime Swarm (production proxy)"]
    direction LR
    BG["BlockGuard<br/>synchronous policy"]
    IL["InstantLearner<br/>per-block stats"]
    SA["SemanticAuditor<br/>async model, optional"]
    PS["PatternSynthesizer<br/>batch suggestions"]
    Cal["Calibrator<br/>labels and thresholds"]
    BG --> IL --> PS --> Cal
    BG --> SA --> PS
  end

  Tools["MCP tools<br/>filesystem, GitHub, databases, APIs"]

  AI -->|every tool call| BG
  BG -->|allowed| Tools
  Report -->|"Loop A: bypasses to corpus"| Corpus
  Cal -->|"Loop B: blocks to rules"| BG
  Cal -->|"Loop C: labels to the model"| SA
  Report -->|"Loop D: weekly CI metrics"| Cal

  style CI fill:#1b1b1f,stroke:#b49a5e,color:#ededea
  style Runtime fill:#1b1b1f,stroke:#7fd28e,color:#ededea
```

**Corpus gate, measured on this repository** (`node --import tsx corpus/run-eval.ts`, rules only, no model): 285 of 293 attacks blocked (97.3%), 79 of 79 harmless entries allowed, no false positives. The 8 misses are in the deserialization and edge-case sets.

### CI Swarm

Runs on every pull request and nightly. Six agents work in sequence, each hardening what the previous one found.

| Agent | What it does |
|-------|-------------|
| Scout | SAST scan, dependency audit, config review |
| Corpus | Runs every attack and harmless fixture in `corpus/` (372 today) against the current policy |
| Evasion | Runs 120+ bypass probes and generates new ones with a model |
| Parity | Checks the Node and Python engines make identical decisions |
| Proxy | Live stdio MCP session tests against a running proxy |
| Report | Writes `security-swarm/latest.json` with full results |

### Runtime Swarm

Runs inside the proxy on every tool call.

| Component | What it does |
|-----------|-------------|
| BlockGuard | Enforces the active policy synchronously on every call. Fail-closed. |
| InstantLearner | Tracks per-block statistics and suggests rules as they emerge |
| SemanticAuditor | Optional async model review of calls that pass the patterns but look suspicious |
| PatternSynthesizer | Batches suggestions into candidate rules |
| Calibrator | Labels candidates, tunes thresholds and promotes approved rules into BlockGuard |

### Feedback loops

| Loop | Signal | Effect |
|------|--------|--------|
| A | CI finds a bypass | Added to the corpus; CI guards against it from then on |
| B | Runtime block pattern | Turned into a new rule and promoted to BlockGuard |
| C | Calibrator label | Used to tune the SemanticAuditor's thresholds |
| D | Weekly CI metrics | Update runtime config so CI and production stay in step |

The proxy supports five transports: stdio, HTTP, SSE, streamable HTTP and WebSocket. For Redis, Postgres and Kubernetes deployments see [`docs/ENTERPRISE_DEPLOYMENT.md`](docs/ENTERPRISE_DEPLOYMENT.md).

---

## Threat Lab

Threat Lab uses a local AI model to propose new attack tests when it spots something suspicious. Nothing is applied automatically: you review and approve every suggestion in **Security Center, Threat Lab** before it becomes a rule. Approved discoveries feed the attack corpus.

> [!IMPORTANT]
> **Threat Lab needs [Ollama](https://ollama.com/download) on your computer.** It is free and runs the model locally, so nothing is sent anywhere. Until it is set up, the Threat Lab page shows these steps and ticks them off as you finish them.

| Step | Windows | macOS | Linux |
|---|---|---|---|
| 1. Install | `winget install Ollama.Ollama` | `brew install ollama` | `curl -fsSL https://ollama.com/install.sh \| sh` |
| 2. Start | open the Ollama app, or `ollama serve` | `ollama serve` | `ollama serve` |
| 3. Download the model, once | `ollama pull qwen3:8b` | `ollama pull qwen3:8b` | `ollama pull qwen3:8b` |

```mermaid
flowchart LR
  B["Blocked calls and<br/>missed attacks"] --> O["Local model<br/>in Ollama"]
  O --> C["Proposed attack test<br/>and rule"]
  C --> V["Checked automatically"]
  V --> R{"You review it"}
  R -->|accept| P["Added to your policy"]
  R -->|reject| X["Discarded"]
```

`pnpm dashboard:proxy` already points Mastyf at `http://127.0.0.1:11434`. To use another address or model, set `OLLAMA_BASE_URL` or `MASTYF_AI_LLM_MODEL` before starting. Everything else in Mastyf, including **Run Analysis**, works without Ollama.

---

## Python gateway and protected agent

A separate Python package runs the reference monitor, MCP discovery and a plain-English protected agent:

```bash
cd mastyf_gateway
pip install -e .
mastyf                     # first run: discovers your tools, asks what to allow, then starts the agent
```

| Command | What it does |
|---------|-------------|
| `mastyf -m "Find unpaid customer invoices"` | Run one query without the interactive prompt |
| `mastyf policy "Allow reading invoices, but never delete data or make HTTP calls"` | Propose a policy change in plain English |
| `mastyf policy status` | Compare the proposed policy with the active one |
| `mastyf policy activate` | Make the proposed policy active |
| `mastyf proxy -- uvx mcp-server-sqlite --db /tmp/test.db` | Put Mastyf in front of any MCP server over stdio |
| `mastyf audit verify --ledger ~/.mastyf/receipts.jsonl` | Verify the tamper-evident receipt ledger |
| `mastyf demo --scenario all` | Run the action-boundary failure demonstrations |

Every non-allowed action dispatches **0 bytes** to the tool backend, and every decision gets a signed receipt.

---

## MCP package trust scores

Before installing an MCP server from npm, check its trust score at [mastyf.ai/certified](https://www.mastyf.ai/certified): known CVEs, typo-squat risk, maintainer signals and known attack patterns. Free, no account needed.

---

## Common commands

| Command | What it does |
|---------|-------------|
| `pnpm dashboard:proxy` | Start Mastyf (Fleet Hub) and the dashboard on port 4000 |
| `pnpm dashboard:key` | Print your dashboard API key and where it is stored |
| `pnpm dashboard:key --path` | Print only where the key file is |
| `node dist/cli.js start` | The same start-up, without the shell script (handy on Windows) |
| `node dist/cli.js onboard` | Route your IDE's MCP config through Mastyf |
| `node dist/cli.js doctor` | Check the database, policy and environment |
| `node dist/cli.js scan --all` | Scan MCP configs for CVEs and injection risks |
| `pnpm dashboard:build` | Rebuild the dashboard after changing its source |
| `pnpm build` | Rebuild the server after changing its source |
| `pnpm test` | Run the full test suite |
| `pnpm security-swarm:fast` | Quick security regression, 5 to 15 minutes |
| `pnpm security-swarm:analyze` | Full adversarial analysis |

## Configuration

Set these in the environment before starting Mastyf. All are optional.

| Variable | Default | What it does |
|----------|---------|--------------|
| `DASHBOARD_PORT` | `4000` | Port of the dashboard and its API |
| `MASTYF_HOME` | `~/.mastyf` | Folder that holds `dashboard_api_key` |
| `MASTYF_AI_DB_PATH` | `~/.mastyf-ai/history.db` | History and accounts database. The proxy and the dashboard must use the same one. |
| `MASTYF_AI_COST_BUDGET_USD` | none | Monthly spend budget. A budget saved in **Cost, Budgets** overrides it. |
| `ALERT_SLACK_WEBHOOK`, `ALERT_PAGERDUTY_KEY`, `ALERT_GENERIC_WEBHOOK` | none | Where block alerts are sent |
| `MASTYF_AI_SIEM_ENABLED`, `MASTYF_AI_SIEM_PROTOCOL`, `MASTYF_AI_SIEM_ENDPOINT` | off | Forward every decision to your SIEM (`cef`, `syslog` or `splunk-hec`) |
| `MASTYF_AI_CONTROL_PLANE_URL`, `MASTYF_AI_CLOUD_API_KEY`, `MASTYF_AI_TENANT_ID` | none | Link this install to your mastyf.ai workspace. See [Connect](https://www.mastyf.ai/docs/connect). |
| `OLLAMA_BASE_URL`, `MASTYF_AI_LLM_PROVIDER`, `MASTYF_AI_LLM_MODEL` | none | Local model for Threat Lab and semantic review |
| `DASHBOARD_AUTH_DISABLED` | `false` | Turns off dashboard sign-in. Only for isolated local tests; refused on any address other than localhost. |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Sign-in problems | See [If something goes wrong](#if-something-goes-wrong) under the first sign-in guide |
| Dashboard shows no data | The proxy and the dashboard must share the same `MASTYF_AI_DB_PATH` (default `~/.mastyf-ai/history.db`). Numbers also depend on the period picked at the top right. |
| Port 4000 is already in use | Stop the other program, or start with `DASHBOARD_PORT=4100 pnpm dashboard:proxy` |
| `pnpm: command not found` | Run `corepack enable`, or put `corepack` in front of each pnpm command |
| `sh: command not found` on Windows | Start from Git Bash, or use `node dist/cli.js start --policy default-policy.yaml --blocking-mode block` |
| `dist/cli.js` not found | Run `pnpm build` |
| Agents still reach tools directly | Run `node dist/cli.js onboard --apply` |
| Threat Lab says it needs Ollama | Follow the three steps in [Threat Lab](#threat-lab). The page updates by itself when Ollama is ready. |
| `npm install` fails | Use `pnpm install`; the npm package is not published yet |
| Home says "Nothing routed yet" | Mastyf is running but no agent has sent a tool call through it. Run `node dist/cli.js onboard --apply`, restart your agent, and use a tool. |
| Security Swarm steps fail on Windows | Install Python 3 from python.org (the Microsoft Store shortcut is not enough) for the harness steps, and start Mastyf with `pnpm dashboard:proxy` so the swarm can find pnpm |

---

## Learn more

- [Enterprise deployment (Redis, Postgres, Helm)](docs/ENTERPRISE_DEPLOYMENT.md)
- [Dashboard runbook](docs/DASHBOARD_CANONICAL_RUNBOOK.md)
- [Defense pipeline in depth](docs/DEFENSE_FABRIC.md)
- [Security Swarm and CI red-teaming](security-swarm/README.md)
- [Real-world MCP integration examples](docs/REAL_WORLD_INTEGRATION.md)
- [Core detection engine](packages/core/README.md)

---

## Research paper and citation

If you use Mastyf Guard, its benchmark method or the Cognitive Harvard Architecture in research or production, please cite the open-access paper:

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22179415.svg)](https://doi.org/10.5281/zenodo.22179415)

> **Das, R. (2026).** *Cognitive Harvard Architectures for AI Agent Perimeter Defense: Resolving the Confused Deputy Problem in Model Context Protocol via Capability-Based Access Control.* **Zenodo**. doi: [10.5281/zenodo.22179415](https://doi.org/10.5281/zenodo.22179415).

```bibtex
@article{das2026cognitive,
  title={Cognitive Harvard Architectures for AI Agent Perimeter Defense: Resolving the Confused Deputy Problem in Model Context Protocol via Capability-Based Access Control},
  author={Das, Rudraneel},
  journal={Zenodo},
  year={2026},
  doi={10.5281/zenodo.22179415},
  url={https://doi.org/10.5281/zenodo.22179415}
}
```
