import type { Metadata } from 'next';
import Link from 'next/link';
import { DocCode } from '@/components/docs/DocCode';
import { DocPage, DocSection } from '@/components/docs/DocPage';
import { DocTable } from '@/components/docs/DocVisuals';

export const metadata: Metadata = {
  title: 'Python library — Mastyf docs',
  description:
    'pip install mastyf-ai: check every tool call and tool result of a LangChain, LangGraph, OpenAI Agents SDK or hand-written Python agent, on your own machine.',
};

const INSTALL = `pip install "mastyf-ai[langchain]"      # LangChain
pip install "mastyf-ai[langgraph]"      # LangGraph
pip install "mastyf-ai[openai-agents]"  # OpenAI Agents SDK
pip install mastyf-ai                   # any other framework`;

const LANGCHAIN = `from langchain.agents import create_agent
from mastyf_ai.langchain import guard_tools

agent = create_agent(model, tools=guard_tools([search, read_file]))`;

const LANGGRAPH = `from langgraph.prebuilt import ToolNode
from mastyf_ai.langgraph import guard_tool_node

graph.add_node("tools", guard_tool_node(ToolNode([search, read_file])))`;

const OPENAI = `from agents import Agent
from mastyf_ai.openai_agents import guard_function_tools

agent = Agent(name="helper", tools=guard_function_tools([search, read_file]))`;

const ANY = `from mastyf_ai import Guard

guard = Guard()                      # one Guard per agent run

def run_read_file(path: str):
    verdict = guard.check_call("read_file", {"path": path})
    if verdict.blocked:
        return verdict.model_message()   # "Blocked by Mastyf (policy: semantic-path-guard)."

    result = read_file(path)

    after = guard.check_result("read_file", result, {"path": path})
    if after.blocked:
        return after.model_message()
    return after.result if after.decision == "redact" else result`;

const SESSIONS = `guard = Guard()
tools = guard_tools([search, read_file], guard=guard)

async def handle(request):
    with guard.session(request.id):          # one session per user request
        return await agent.ainvoke(request.messages)`;

const UNAVAILABLE = `from mastyf_ai import Guard, MastyfUnavailable

guard = Guard()                              # default: no check means no call
guard = Guard(on_unavailable="allow")        # let calls through, with a warning each time`;

const CLI = `mastyf-ai status
# Mastyf checks in use: free tier.

mastyf-ai check read_file '{"path": "/etc/passwd"}'
# prints the verdict; exit code 2 when blocked`;

export default function PythonDocsPage() {
  return (
    <DocPage slug="python">
      <DocSection id="install" title="Install">
        <p>Python 3.10 or newer. Pick the extra for your framework:</p>
        <DocCode code={INSTALL} label="Install mastyf-ai" />
        <p>
          The first check starts Mastyf&rsquo;s free check program on your machine. It is downloaded once from the
          project&rsquo;s GitHub release, run only if its SHA-256 matches the one built into the package, and stopped
          when your program stops. Nothing is sent to Mastyf.
        </p>
        <DocTable
          head={['Platform', 'Supported']}
          rows={[
            ['Windows', 'x64'],
            ['macOS', 'Apple silicon and Intel'],
            ['Linux', 'x64 and arm64'],
          ]}
        />
      </DocSection>

      <DocSection id="langchain" title="LangChain">
        <p>Wrap the tools you give the agent. Everything else stays the same.</p>
        <DocCode code={LANGCHAIN} label="LangChain" />
      </DocSection>

      <DocSection id="langgraph" title="LangGraph">
        <p>Wrap the tool node.</p>
        <DocCode code={LANGGRAPH} label="LangGraph" />
      </DocSection>

      <DocSection id="openai-agents" title="OpenAI Agents SDK">
        <DocCode code={OPENAI} label="OpenAI Agents SDK" />
        <DocTable
          head={['Tool type', 'What happens']}
          rows={[
            ['Your function tools', 'Every call and result is checked.'],
            ['Hosted tools (web search, file search, code interpreter)', 'Run on OpenAI’s servers, where no local check can reach. Passed through unchanged, with a warning in the log.'],
            ['Shell, computer and apply-patch tools', 'Run on your machine but can’t be checked yet, so guard_function_tools() refuses them instead of letting them through silently.'],
          ]}
        />
      </DocSection>

      <DocSection id="any-framework" title="Any other framework">
        <p>
          Ask the guard before a tool runs and again before its result goes back to the model. This is everything the
          adapters above do for you.
        </p>
        <DocCode code={ANY} label="Guard in a hand-written tool" />
        <DocTable
          head={['Verdict field', 'Meaning']}
          rows={[
            [<code key="d">decision</code>, <><code>allow</code>, <code>block</code> or <code>redact</code> (a result with a secret replaced)</>],
            [<code key="b">blocked</code>, <>True when <code>decision</code> is <code>block</code></>],
            [<code key="r">result</code>, <>The cleaned result, when <code>decision</code> is <code>redact</code></>],
            [<><code>layer</code>, <code>rule</code></>, 'Which check decided, and which rule in it'],
            [<code key="re">reason</code>, 'A plain description of why'],
            [<code key="m">model_message()</code>, 'What to hand the model instead: names the check, never the matched text'],
          ]}
        />
      </DocSection>

      <DocSection id="sessions" title="Many users, one agent">
        <p>
          Some checks look at a whole run, for example reading a secret file and then sending data out. A server that
          handles many users should give each request its own session, so one user&rsquo;s run never affects
          another&rsquo;s.
        </p>
        <DocCode code={SESSIONS} label="One session per request" />
      </DocSection>

      <DocSection id="unavailable" title="When no check can be made">
        <p>
          By default a call raises <code>MastyfUnavailable</code> instead of running unchecked. You can choose to let
          calls through instead. An input the check refuses, for example one too large to check, is blocked in either
          mode.
        </p>
        <DocCode code={UNAVAILABLE} label="Choosing what happens when no check can be made" />
      </DocSection>

      <DocSection id="settings" title="Settings and commands">
        <DocTable
          head={['Setting', 'What it does']}
          rows={[
            [<code key="u">MASTYF_CHECK_URL</code>, <>Use a check service you run yourself (see <Link href="/docs/check">Check program</Link>) instead of starting one.</>],
            [<code key="t">MASTYF_CHECK_TOKEN</code>, 'The token for that service.'],
            [<code key="b">MASTYF_CHECK_BIN</code>, 'Use a copy of the check program you already have instead of downloading one.'],
            [<code key="a">MASTYF_AI_AGENT</code>, <>This agent&rsquo;s name in Shield&rsquo;s dashboard. Same as <code>Guard(agent=&quot;billing-bot&quot;)</code>.</>],
          ]}
        />
        <DocCode code={CLI} label="mastyf-ai commands" />
        <p className="doc-note">
          With the <Link href="/docs/shield">Shield app</Link> running on the same computer, the library uses it on its
          own, with no change to your code: calls get Shield&rsquo;s paid checks and appear in your dashboard, and{' '}
          <code>guard.tier</code> reads <code>&quot;shield&quot;</code>. The library only talks to Shield on 127.0.0.1,
          and only after Shield proves it holds the key in its own file.
        </p>
      </DocSection>

      <DocSection id="upgrade" title="Upgrading from 4.x">
        <p>
          4.x sent tool calls to a Mastyf proxy (<code>MastyfProxy(&quot;http://localhost:4000&quot;)</code>). 5.x needs no
          proxy: replace <code>MastyfProxy</code> and the old middleware with <code>guard_tools</code>,{' '}
          <code>guard_tool_node</code>, <code>guard_function_tools</code> or <code>Guard</code> as shown above.
        </p>
        <p className="doc-note">
          The library is MIT. The check program it starts is AGPL-3.0 and runs as a separate program.
        </p>
      </DocSection>
    </DocPage>
  );
}
