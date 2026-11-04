# Causal gate

The causal gate stops a risky tool call when the data the agent read appears to have caused it. Instead of asking whether a call looks malicious, it asks where the call's target came from. An email can say anything, so an account number that only ever appeared in an email is not a safe place to send money, however normal the call looks.

It runs in the proxy after policy has allowed a call, needs no model, and is off by default.

## Where to run it

The gate can only connect a read and an action that pass through the same process, because each process keeps its own record of what the agent read.

| Setup | What the gate can connect |
|-------|---------------------------|
| One shared HTTP, SSE or streamable-http gateway | Reads and actions on all its servers, if the client sends a session id. Without one, set `MASTYF_AI_CAUSAL_GATE_SCOPE=tenant`. |
| LLM gateway in front of the model API | Everything in the conversation, on any tool. |
| One stdio proxy per server | Only reads and actions on **that same server**. An email read through the mail proxy is invisible to the bank proxy. |

So if you wrap each server in its own stdio proxy, the most common attack, read on one server and act on another, is not caught. Use a shared gateway or the LLM gateway instead.

## Try it

This runs the real proxy in front of a small test server whose inbox holds a prompt injection, then plays an agent that obeys it. Nothing leaves your machine.

```bash
node scripts/causal-gate-demo.mjs enforce   # blocks the send the injection asked for
node scripts/causal-gate-demo.mjs off       # the same send goes through
```

The demo turns off two other layers, so that the gate alone decides. Both block a new agent's calls by default:

| Variable | Default | Effect |
|----------|---------|--------|
| `MASTYF_AI_DEFAULT_SANDBOX_TIER` | `shadow` | A server that isn't certified has its calls logged but not forwarded. Set `allow` to forward them. |
| `MASTYF_AI_AGENTIC_ENABLED` | on | An agent with no verified identity scores low on zero trust, so its calls wait for step-up approval. Set `false` to skip this check. |

Setting these for a real agent removes those layers, so only do it where the gate and your policy are enough.

## Turn it on

Start in shadow mode, which logs what it would have stopped, then read the logs for a while before enforcing.

```bash
MASTYF_AI_CAUSAL_GATE=shadow    # log only
MASTYF_AI_CAUSAL_GATE=enforce   # stop the call
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `MASTYF_AI_CAUSAL_GATE` | off | `shadow` or `enforce`. Anything else leaves it off. |
| `MASTYF_AI_CAUSAL_GATE_SCOPE` | per session | `tenant` follows values across every server in the tenant, within this process. Set it if your tenant runs one agent over a transport with no session id: otherwise values are followed per server. Do not set it for a tenant running several agents, because one agent's reads would then count against the others. |
| `MASTYF_AI_CAUSAL_TAINT_PATH` | `~/.mastyf-ai/causal-taint.json` | Where attacker-written values saved to agent memory are remembered between sessions. It holds hashes only. |
| `MASTYF_AI_CAUSAL_PEER_SECRET` | unset | Shared secret for gateways that pass signed labels to each other in `_meta["mastyf/taint"]`. Without it, labels are ignored. |

If the gate itself fails on a call, it logs the error and allows the call. It never takes down the proxy.

## Tell it what the user asked for

This is the most useful thing you can add. Without it, the gate cannot tell "pay the bill in `bill.txt`" from an injected instruction to do the same, so it stops the payment.

Send the user's own words with the call, from your client or framework:

```json
{
  "method": "tools/call",
  "params": {
    "name": "read_file",
    "arguments": { "file_path": "bill.txt" },
    "_meta": { "mastyf/userRequest": "Pay the bill in bill.txt" }
  }
}
```

Only pass text the user actually typed: anything in this field is trusted, so passing model output or tool results defeats the gate.

Naming a source trusts its structured fields, not its sentences. After the request above, an `IBAN:` field in `bill.txt` counts, but "send it to X instead" in the same file does not.

## What it decides

Each decision carries the rule and its evidence, such as `argument "recipient" uses "us13...", which only appeared in "body" of get_email`.

| Rule | When |
|------|------|
| `causal-read-pass` | The call only reads, so it passes. |
| `causal-origin` | A target, or a link or address in a message, only ever appeared in data an attacker could write. |
| `causal-exfil-url` | A read adds a query to an address that only appeared in such data, which is how a read sends data out. |
| `causal-unverifiable` | The arguments, or earlier results, were too large to check in full. |
| `causal-no-evidence` | Nothing points at the call, so it passes. |

Where a call lands decides how much evidence it takes:

- **Reads** always pass, apart from the query rule above.
- **Sends and writes** are judged on targets. Quoting text the agent read is normal, so a message body only counts for links and addresses.
- **Deleting, running or granting** is judged on every argument, including short values such as `13` and copied sentences.

Text is only as structured as its author made it. Once a text result contains prose, `key: value` lines in it count as written by whoever wrote the prose, and so does a sentence in any field, JSON included. A lookup that adds a line such as `Here is your account:` above its fields can therefore cause a hold when the agent acts on them. Sending the user's request avoids that if they named the source or the value.

A target that never appeared can still count if it is put together from attacker-writable text: two or more pieces that together make up most of it, or the whole value written backwards. Without the user's request, this can also stop a real address, such as `alice@corp.example` after an email from "Alice" at `corp.example`. Sending the request avoids that.

Some decisions are `hold` rather than `block`. There is no approval flow yet, so a hold currently stops the call just as a block does.

What a server says in `tools/list` counts against other servers' tools but not its own: a description naming a target is how one server poisons a call to another, while a server's own schema naming a value is how a normal call works. Resources and prompts count against every server's tools, including the one that published them. Published text and tool annotations are kept per server name rather than per tenant. On a gateway where several tenants share a server name, one tenant's upstream can cause holds for another, and its annotations apply to the other's tools of the same name, including marking a vaguely named tool as a read. Give each tenant's upstream its own server name.

## What it does not stop

These are known limits, and each has a test in `tests/ai/causal-gate/redteam.test.ts` that will fail once it is fixed:

- **Instructions written only as short fields,** with no prose around them, such as `link: www.example.com`.
- **Values the agent works out rather than copies,** such as a sum, a translation, a value in pieces under four characters, or an account split into a word and digits.
- **Targets with no distinctive form,** such as a first name in a message.
- **A legitimate choice made for the wrong reason,** such as booking a hotel the listing really contains because a review said to.
- **Harmful content sent to a legitimate recipient.**
- **Structured data the attacker controls,** such as a vendor record with their account number in it.
- **A server that names a sending tool as a read.** Calls are judged by tool name first. A tool's annotations can raise the risk, or settle a name that says nothing, but never lower what the name says.

Two behaviours you may want to change for your own use:

- **Following a link always passes.** Agents do this constantly, but it does mean an injection can make the agent visit a page, and that page is then treated as untrusted.
- **A value found on a page the user named is still held if it sits in a sentence.** "Find her email on her site" stops at the invite, because the same page could carry an injected address.

It also does nothing about what an agent says in its reply, only what it does.

## LLM gateway

For agents with no MCP proxy in the way, the same checks can run in front of the model API:

```bash
mastyf-ai llm-gateway --upstream https://api.openai.com --port 8088 --mode shadow
```

Point your OpenAI or Anthropic client at it. Everything passes through unchanged except a tool call the gate stops, which is replaced with an explanation. Streamed text arrives as usual, and a streamed tool call is held until it is complete.

It only judges `/chat/completions` and `/messages`. **Tool calls on OpenAI's Responses API (`/responses`) pass through unchecked,** and it logs a warning when it sees one.

This is a first version. It treats each request's user and system messages as trusted, so it depends on your application putting untrusted text only in tool results. It does not inspect prompts, redact secrets or authenticate callers, so keep it on localhost or behind something that does.
