"""Generate the README graphics (dark and light pairs) in docs/assets/readme/.

    python docs/assets/readme/make_svgs.py

Colours are the dashboard's (Shield) tokens. Numbers are the measured ones quoted in the README;
change them here and in the README together. Animations stop under prefers-reduced-motion.
"""
import base64
import io
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
MARK = os.path.join(ROOT, 'deploy', 'dashboard-spa', 'public', 'brand', 'mark-128.png')

SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

THEMES = {
    'dark': dict(bg='#0a0a0b', card='#151518', rule='#26262a', ink='#f7f7f3', body='#c4c4bc', dim='#8f8f88',
                 faint='#4a4a48', gold='#c4ab70', allow='#7fd28e', block='#ef6b5b', wash='rgba(196,171,112,0.10)',
                 allow_wash='rgba(127,210,142,0.12)', block_wash='rgba(239,107,91,0.13)'),
    'light': dict(bg='#fbf8f4', card='#ffffff', rule='#e4d7c5', ink='#2b1f14', body='#4f3e2d', dim='#75634f',
                  faint='#cdbfa9', gold='#7a5130', allow='#2a7340', block='#ab3426', wash='rgba(122,81,48,0.08)',
                  allow_wash='rgba(42,115,64,0.10)', block_wash='rgba(171,52,38,0.09)'),
}


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def mark_png(colour):
    """The Mastyf mark, recoloured: white line art for dark, ink for light."""
    im = Image.open(MARK).convert('RGBA')
    r, g, b = (int(colour[i:i + 2], 16) for i in (1, 3, 5))
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            a = px[x, y][3]
            px[x, y] = (r, g, b, a)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


def text(x, y, s, size, fill, weight=None, mono=False, anchor=None, spacing=None, cls=None, style=None):
    attrs = [f'x="{x}"', f'y="{y}"', f'font-family="{MONO if mono else SANS}"', f'font-size="{size}"', f'fill="{fill}"']
    if weight:
        attrs.append(f'font-weight="{weight}"')
    if anchor:
        attrs.append(f'text-anchor="{anchor}"')
    if spacing is not None:
        attrs.append(f'letter-spacing="{spacing}"')
    if cls:
        attrs.append(f'class="{cls}"')
    if style:
        attrs.append(f'style="{style}"')
    return f'<text {" ".join(attrs)}>{esc(s)}</text>'


def svg(w, h, title, desc, body, style=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" '
            f'aria-labelledby="t d">\n<title id="t">{esc(title)}</title><desc id="d">{esc(desc)}</desc>\n'
            f'<style>{style}</style>\n{body}\n</svg>\n')


# ── Banner ──────────────────────────────────────────────────────────────────────────────────────
LANES = [  # (label, tool, allowed)
    ('read_file notes.md', 'files', True),
    ('shell: rm -rf ~/', 'shell', False),
    ('create_pull_request', 'github', True),
    ('POST .env → evil.io', 'network', False),
]


def banner(t, logo):
    W, H = 1280, 420
    x0, gate, tool_x = 652, 1012, 1104
    pill_w = 192
    lane_y = [124, 180, 236, 292]
    style = f"""
.in{{animation:in .9s cubic-bezier(.16,1,.3,1) both}}
@keyframes in{{from{{opacity:0;transform:translateY(8px)}}}}
.pk{{opacity:0;animation-duration:8s;animation-iteration-count:infinite;animation-timing-function:cubic-bezier(.4,0,.2,1)}}
.ok{{animation-name:ok}}.no{{animation-name:no}}
@keyframes ok{{0%{{opacity:0;transform:translateX(0)}}4%{{opacity:1}}30%{{opacity:1;transform:translateX({gate - x0 - pill_w}px)}}48%{{opacity:0;transform:translateX({tool_x - x0 - pill_w + 70}px)}}100%{{opacity:0;transform:translateX({tool_x - x0 - pill_w + 70}px)}}}}
@keyframes no{{0%{{opacity:0;transform:translateX(0)}}4%{{opacity:1}}30%{{transform:translateX({gate - x0 - pill_w}px)}}32%{{transform:translateX({gate - x0 - pill_w - 7}px)}}34%{{transform:translateX({gate - x0 - pill_w}px)}}46%{{opacity:1;transform:translateX({gate - x0 - pill_w}px)}}56%{{opacity:0;transform:translateX({gate - x0 - pill_w}px)}}100%{{opacity:0;transform:translateX({gate - x0 - pill_w}px)}}}}
.pr{{animation-duration:8s;animation-iteration-count:infinite}}
.pr.ok{{animation-name:prok}}.pr.no{{animation-name:prno}}
@keyframes prok{{0%,26%{{stroke:{t['rule']};fill:{t['card']}}}31%,100%{{stroke:{t['allow']};fill:{t['allow_wash']}}}}}
@keyframes prno{{0%,26%{{stroke:{t['rule']};fill:{t['card']}}}31%,100%{{stroke:{t['block']};fill:{t['block_wash']}}}}}
.x{{opacity:0;animation:x 8s infinite;transform-box:fill-box;transform-origin:center}}
@keyframes x{{0%,29%{{opacity:0;transform:scale(.4)}}33%{{opacity:1;transform:scale(1.15)}}36%,50%{{opacity:1;transform:scale(1)}}60%,100%{{opacity:0}}}}
.tg{{animation:tg 8s infinite}}
@keyframes tg{{0%,40%{{stroke:{t['rule']}}}46%,56%{{stroke:{t['allow']}}}70%,100%{{stroke:{t['rule']}}}}}
.gl{{animation:gl 2.4s ease-in-out infinite}}
@keyframes gl{{50%{{opacity:.45}}}}
@media (prefers-reduced-motion: reduce){{.in,.pk,.pr,.x,.tg,.gl{{animation:none}}.pk{{opacity:1}}}}
"""
    out = [f'<rect width="{W}" height="{H}" rx="18" fill="{t["bg"]}"/>']
    # Brand
    out.append(f'<image href="data:image/png;base64,{logo}" x="72" y="62" width="52" height="52"/>')
    out.append(text(138, 97, 'MASTYF', 19, t['ink'], mono=True, spacing=5))
    out.append(text(70, 208, 'mastyf.ai', 84, t['ink'], weight=800, spacing=-3, cls='in'))
    out.append(text(72, 264, 'Your model proposes. Mastyf decides.', 31, t['gold'], weight=600, cls='in', style='animation-delay:.2s'))
    out.append(text(73, 314, 'Checks every tool call your AI agents make, before it runs.', 19, t['body'], cls='in', style='animation-delay:.4s'))
    out.append(text(73, 340, 'Unsafe calls never reach your files, shell or network.', 19, t['body'], cls='in', style='animation-delay:.4s'))
    out.append(text(73, 388, 'OPEN SOURCE · AGPL-3.0 · RUNS ON YOUR MACHINE', 14, t['dim'], mono=True, spacing=2.5))
    # Scene labels
    out.append(text(x0, 84, 'Tool calls from your agent', 14, t['dim'], mono=True))
    out.append(text(tool_x, 84, 'Your tools', 14, t['dim'], mono=True))
    # Gate
    out.append(f'<rect class="gl" x="{gate - 7}" y="100" width="14" height="220" rx="7" fill="{t["wash"]}"/>')
    out.append(f'<line x1="{gate}" y1="100" x2="{gate}" y2="320" stroke="{t["gold"]}" stroke-width="2.5" stroke-linecap="round"/>')
    out.append(f'<circle cx="{gate}" cy="348" r="18" fill="{t["card"]}" stroke="{t["gold"]}" stroke-width="1.5"/>')
    out.append(f'<image href="data:image/png;base64,{logo}" x="{gate - 12}" y="336" width="24" height="24"/>')
    out.append(text(gate + 28, 353, 'Mastyf', 15, t['ink'], weight=600))
    for i, ((label, tool, ok), y) in enumerate(zip(LANES, lane_y)):
        d = f'animation-delay:{i * 2}s'
        out.append(f'<line x1="{x0}" y1="{y}" x2="{tool_x}" y2="{y}" stroke="{t["rule"]}" stroke-width="1.5" stroke-dasharray="2 7"/>')
        # Tool card
        out.append(f'<rect class="{"tg" if ok else ""}" style="{d}" x="{tool_x}" y="{y - 17}" width="146" height="34" rx="9" fill="{t["card"]}" stroke="{t["rule"]}" stroke-width="1.5"/>')
        out.append(text(tool_x + 16, y + 5, tool, 14, t['body'], mono=True))
        # Packet
        k = 'ok' if ok else 'no'
        out.append(f'<g class="pk {k}" style="{d}">'
                   f'<rect class="pr {k}" style="{d}" x="{x0}" y="{y - 15}" width="{pill_w}" height="30" rx="15" fill="{t["card"]}" stroke="{t["rule"]}" stroke-width="1.5"/>'
                   + text(x0 + 16, y + 5, label, 12.5, t['ink'], mono=True) + '</g>')
        if not ok:
            out.append(f'<g class="x" style="{d}"><circle cx="{gate}" cy="{y}" r="11" fill="{t["block"]}"/>'
                       f'<path d="M{gate - 4} {y - 4} l8 8 M{gate + 4} {y - 4} l-8 8" stroke="{t["bg"]}" stroke-width="2.2" stroke-linecap="round"/></g>')
    # Legend
    out.append(f'<circle cx="{tool_x + 6}" cy="342" r="5" fill="{t["allow"]}"/>')
    out.append(text(tool_x + 18, 347, 'allowed, forwarded', 13, t['dim']))
    out.append(f'<circle cx="{tool_x + 6}" cy="366" r="5" fill="{t["block"]}"/>')
    out.append(text(tool_x + 18, 371, 'blocked, 0 bytes sent', 13, t['dim']))
    return svg(W, H, 'mastyf.ai', 'Your model proposes. Mastyf decides. Tool calls from an agent reach Mastyf; safe ones are forwarded to files and GitHub, an rm -rf and a secret upload are stopped at the gate.', '\n'.join(out), style)


# ── Results panel ───────────────────────────────────────────────────────────────────────────────
STATS = [
    ('99.52%', 'AGENTDOJO', ['attacks stopped with', 'Protocol X, 629 episodes']),
    ('98.43%', 'INJECAGENT', ['attacks stopped with', 'Protocol X, 4,216 cases']),
    ('~1.5 ms', 'PER CALL', ['median rule check', 'on a laptop CPU']),
    ('0 bytes', 'ON BLOCK', ['reach the tool when', 'a call is stopped']),
    ('285 / 293', 'FREE RULES', ['corpus attacks blocked,', 'no harmless call stopped']),
]


def stats(t):
    W, H, gap = 1280, 196, 14
    cw = (W - gap * 4) / 5
    style = """.c{animation:c .8s cubic-bezier(.16,1,.3,1) both}@keyframes c{from{opacity:0;transform:translateY(10px)}}
@media (prefers-reduced-motion: reduce){.c{animation:none}}"""
    out = []
    for i, (num, label, lines) in enumerate(STATS):
        x = round(i * (cw + gap), 1)
        out.append(f'<g class="c" style="animation-delay:{i * 0.12:.2f}s">')
        out.append(f'<rect x="{x}" y="1" width="{cw:.1f}" height="194" rx="14" fill="{t["card"]}" stroke="{t["rule"]}"/>')
        out.append(text(round(x + 22, 1), 74, num, 42, t['gold'], weight=800, spacing=-1.5))
        out.append(text(round(x + 24, 1), 104, label, 14, t['ink'], mono=True, spacing=2))
        for j, line in enumerate(lines):
            out.append(text(round(x + 24, 1), 146 + j * 22, line, 16, t['body']))
        out.append('</g>')
    desc = '; '.join(f'{n} {l.lower()}: {" ".join(ls)}' for n, l, ls in STATS)
    return svg(W, H, 'Results', desc, '\n'.join(out), style)


# ── How one call is decided ─────────────────────────────────────────────────────────────────────
STEPS = [
    ('Well formed?', ['Malformed, oversized and', 'invalid calls stop here'], 'BLOCK'),
    ('Your rules', ['Paths, secrets, injection,', 'shell, encoding: ~1.5 ms'], 'BLOCK'),
    ('Model review', ['Local model, or Protocol X', 'in Shield, reads context'], 'BLOCK'),
    ('Forwarded', ['Only now does the call', 'reach the MCP server'], 'ALLOW'),
    ('Result checked', ['Poisoned output is caught', 'before the agent sees it'], 'BLOCK'),
    ('Recorded', ['Audit log, signed receipt', 'and your dashboard'], 'LOGGED'),
]


def decide(t):
    W, H, n, gap, x0 = 1280, 432, 6, 18, 24
    cw = (W - 2 * x0 - gap * (n - 1)) / n
    style = f""".pulse{{animation:run 6s linear infinite}}@keyframes run{{0%{{transform:translateX(0);opacity:0}}6%{{opacity:1}}90%{{opacity:1}}100%{{transform:translateX({W - 2 * x0 - 20}px);opacity:0}}}}
@media (prefers-reduced-motion: reduce){{.pulse{{animation:none;opacity:0}}}}"""
    colour = {'BLOCK': t['block'], 'ALLOW': t['allow'], 'LOGGED': t['gold']}
    out = [f'<rect width="{W}" height="{H}" rx="18" fill="{t["bg"]}"/>']
    out.append(text(x0, 46, 'HOW ONE TOOL CALL IS DECIDED · BEFORE IT RUNS', 14, t['dim'], mono=True, spacing=3))
    out.append(f'<line x1="{x0}" y1="92" x2="{W - x0}" y2="92" stroke="{t["rule"]}" stroke-width="2" stroke-dasharray="2 6"/>')
    out.append(f'<circle class="pulse" cx="{x0 + 10}" cy="92" r="5" fill="{t["gold"]}"/>')
    for i, (title, lines, verdict) in enumerate(STEPS):
        x = x0 + i * (cw + gap)
        c = colour[verdict]
        out.append('<g>')
        out.append(f'<rect x="{x:.1f}" y="118" width="{cw:.1f}" height="214" rx="16" fill="{t["card"]}" stroke="{t["rule"]}"/>')
        out.append(f'<circle cx="{x + 30:.1f}" cy="152" r="15" fill="none" stroke="{t["gold"]}" stroke-width="1.6"/>')
        out.append(text(round(x + 30, 1), 157, str(i + 1), 14, t['gold'], mono=True, anchor='middle'))
        out.append(text(round(x + 18, 1), 204, title, 20, t['ink'], weight=700))
        for j, line in enumerate(lines):
            out.append(text(round(x + 18, 1), 234 + j * 21, line, 14, t['body']))
        wash = t['allow_wash'] if verdict == 'ALLOW' else t['block_wash'] if verdict == 'BLOCK' else t['wash']
        out.append(f'<rect x="{x + 14:.1f}" y="282" width="{cw - 28:.1f}" height="32" rx="8" fill="{wash}" stroke="{c}" stroke-opacity="0.55"/>')
        out.append(text(round(x + cw / 2, 1), 303, verdict, 12.5, c, weight=700, mono=True, anchor='middle', spacing=1.2))
        out.append('</g>')
        if i < n - 1:
            ax = x + cw + 2
            out.append(f'<path d="M{ax:.1f} 152 l{gap - 6} 0" stroke="{t["dim"]}" stroke-width="1.5"/>')
            out.append(f'<path d="M{ax + gap - 10:.1f} 147 l5 5 l-5 5" fill="none" stroke="{t["dim"]}" stroke-width="1.5"/>')
    out.append(text(x0, 376, 'A call that fails any check never runs: 0 bytes reach the tool, and the agent gets a policy error with the reason.', 17, t['body']))
    out.append(text(x0, 404, 'Steps 1, 2, 4, 5 and 6 are free. Step 3 uses a local model if you run one, or Protocol X with Shield.', 15, t['dim']))
    return svg(W, H, 'How one tool call is decided', 'Six steps before a tool call runs: well formed, your rules, model review, forwarded, result checked, recorded.', '\n'.join(out), style)


# ── Architecture ────────────────────────────────────────────────────────────────────────────────
AGENTS = ['Claude Code', 'Cursor', 'VS Code', 'Claude Desktop', 'Windsurf', 'Cline']
SERVERS = ['files', 'GitHub', 'databases', 'shell', 'browser', 'any MCP server']


def architecture(t, logo):
    W, H = 1280, 520
    style = f""".fl{{stroke-dasharray:5 7;animation:fl 1.6s linear infinite}}@keyframes fl{{to{{stroke-dashoffset:-24}}}}
@media (prefers-reduced-motion: reduce){{.fl{{animation:none}}}}"""
    out = [f'<rect width="{W}" height="{H}" rx="18" fill="{t["bg"]}"/>']
    out.append(text(24, 46, 'WHERE MASTYF SITS · ON YOUR MACHINE', 14, t['dim'], mono=True, spacing=3))
    ay = [96 + i * 44 for i in range(6)]
    # Agents
    out.append(text(24, 84, 'Your agents', 14, t['dim'], mono=True))
    for name, y in zip(AGENTS, ay):
        out.append(f'<rect x="24" y="{y}" width="196" height="34" rx="9" fill="{t["card"]}" stroke="{t["rule"]}"/>')
        out.append(text(40, y + 22, name, 15, t['ink']))
        out.append(f'<path class="fl" d="M220 {y + 17} C 280 {y + 17}, 290 228, 350 228" fill="none" stroke="{t["gold"]}" stroke-width="1.4" stroke-opacity=".7"/>')
    # Proxy
    px, py, pw, ph = 350, 96, 520, 264
    out.append(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="18" fill="{t["card"]}" stroke="{t["gold"]}" stroke-width="1.6"/>')
    out.append(f'<image href="data:image/png;base64,{logo}" x="{px + 22}" y="{py + 20}" width="34" height="34"/>')
    out.append(text(px + 66, py + 44, 'Mastyf proxy', 22, t['ink'], weight=700))
    out.append(text(px + 66, py + 66, 'one per MCP server, started by your agent', 14, t['dim']))
    boxes = [('Your rules', 'free, ~1.5 ms'), ('Model review', 'local model or Shield'), ('Result check', 'free')]
    bw = (pw - 44 - 2 * 14) / 3
    for i, (a, b) in enumerate(boxes):
        bx = px + 22 + i * (bw + 14)
        out.append(f'<rect x="{bx:.1f}" y="{py + 92}" width="{bw:.1f}" height="74" rx="12" fill="{t["bg"]}" stroke="{t["rule"]}"/>')
        out.append(text(round(bx + 14, 1), py + 122, a, 16, t['ink'], weight=600))
        out.append(text(round(bx + 14, 1), py + 146, b, 13, t['dim']))
    out.append(f'<rect x="{px + 22}" y="{py + 186}" width="{pw - 44}" height="54" rx="12" fill="{t["wash"]}" stroke="{t["gold"]}" stroke-opacity=".45"/>')
    out.append(text(px + 40, py + 210, 'Protection switch', 15, t['ink'], weight=600))
    out.append(text(px + 40, py + 230, 'routes every agent\'s servers here and picks up new ones by itself', 13, t['body']))
    # Servers
    sx = 1060
    out.append(text(sx, 84, 'Your MCP servers', 14, t['dim'], mono=True))
    for name, y in zip(SERVERS, ay):
        out.append(f'<rect x="{sx}" y="{y}" width="196" height="34" rx="9" fill="{t["card"]}" stroke="{t["rule"]}"/>')
        out.append(text(sx + 16, y + 22, name, 15, t['ink'], mono=name != 'any MCP server'))
        out.append(f'<path class="fl" d="M{px + pw} 228 C {px + pw + 70} 228, {sx - 80} {y + 17}, {sx} {y + 17}" fill="none" stroke="{t["allow"]}" stroke-width="1.4" stroke-opacity=".75"/>')
    out.append(text(px + pw + 26, 344, 'allowed calls only', 13, t['allow']))
    # Bottom row
    by = 412
    items = [
        (350, 'history.db', 'every decision, on disk'),
        (580, 'Dashboard', 'localhost:4000'),
        (810, 'Threat Lab', 'new attack tests, needs Ollama'),
        (1040, 'Security Swarm', 'attacks your policy on demand'),
    ]
    for i, (x, a, b) in enumerate(items):
        out.append(f'<rect x="{x}" y="{by}" width="216" height="72" rx="12" fill="{t["card"]}" stroke="{t["rule"]}"/>')
        out.append(text(x + 16, by + 30, a, 16, t['ink'], weight=600, mono=a == 'history.db'))
        out.append(text(x + 16, by + 52, b, 13, t['dim']))
    out.append(f'<path class="fl" d="M{px + 108} {py + ph} L{px + 108} {by}" stroke="{t["gold"]}" stroke-width="1.4" fill="none"/>')
    out.append(f'<path class="fl" d="M566 {by + 36} L580 {by + 36}" stroke="{t["dim"]}" stroke-width="1.4"/>')
    out.append(f'<path class="fl" d="M796 {by + 36} L810 {by + 36}" stroke="{t["dim"]}" stroke-width="1.4"/>')
    out.append(f'<path class="fl" d="M1026 {by + 36} L1040 {by + 36}" stroke="{t["dim"]}" stroke-width="1.4"/>')
    out.append(text(24, by + 30, 'Nothing leaves', 15, t['ink'], weight=600))
    out.append(text(24, by + 52, 'your computer', 15, t['ink'], weight=600))
    return svg(W, H, 'Where Mastyf sits', 'Agents such as Claude Code, Cursor and VS Code start their MCP servers through the Mastyf proxy, which checks every call with your rules, an optional model and a result check, then forwards allowed calls. Decisions go to history.db, read by the dashboard, Threat Lab and the Security Swarm.', '\n'.join(out), style)


# ── Results charts ──────────────────────────────────────────────────────────────────────────────
def results(t):
    """Left: AgentDojo attacker success without and with Protocol X. Right: the free rules on the local corpus."""
    W, H = 1280, 380
    style = """.grow{transform-box:fill-box;transform-origin:bottom;animation:grow 1.1s cubic-bezier(.16,1,.3,1) both}
@keyframes grow{from{transform:scaleY(0)}}
.ring{animation:ring 1.4s cubic-bezier(.16,1,.3,1) both}
@media (prefers-reduced-motion: reduce){.grow,.ring{animation:none}}"""
    out = [f'<rect width="{W}" height="{H}" rx="18" fill="{t["bg"]}"/>']
    # Left panel
    out.append(f'<rect x="24" y="24" width="604" height="332" rx="16" fill="{t["card"]}" stroke="{t["rule"]}"/>')
    out.append(text(48, 66, 'AgentDojo: attacks that succeeded', 20, t['ink'], weight=700))
    out.append(text(48, 92, '249 attacked cases, from the paper', 14, t['dim']))
    base, top = 312, 128
    scale = (base - top) / 30  # 0 to 30 %
    for v in (0, 10, 20, 30):
        y = base - v * scale
        out.append(f'<line x1="96" y1="{y:.1f}" x2="600" y2="{y:.1f}" stroke="{t["rule"]}" stroke-dasharray="{"0" if v == 0 else "3 5"}"/>')
        out.append(text(84, round(y + 5, 1), f'{v}%', 13, t['dim'], anchor='end'))
    bars = [('No defense', 25, t['block']), ('With Protocol X', 0, t['allow'])]
    for i, (label, v, c) in enumerate(bars):
        x = 160 + i * 230
        h = max(v * scale, 3)
        out.append(f'<rect class="grow" style="animation-delay:{0.2 + i * 0.15:.2f}s" x="{x}" y="{base - h:.1f}" width="120" height="{h:.1f}" rx="6" fill="{c}"/>')
        out.append(text(x + 60, round(base - h - 12, 1), f'{v}%', 26, c, weight=800, anchor='middle'))
        out.append(text(x + 60, base + 30, label, 15, t['body'], anchor='middle'))
    # Right panel: donut
    out.append(f'<rect x="652" y="24" width="604" height="332" rx="16" fill="{t["card"]}" stroke="{t["rule"]}"/>')
    out.append(text(676, 66, 'Free rules alone, on the attack corpus', 20, t['ink'], weight=700))
    out.append(text(676, 92, 'corpus/run-eval.ts on this repository, no model', 14, t['dim']))
    cx, cy, r = 800, 222, 86
    import math
    circ = 2 * math.pi * r
    blocked = 285 / 293
    out.append(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{t["block"]}" stroke-opacity=".85" stroke-width="26"/>')
    out.append(f'<style>@keyframes ring{{from{{stroke-dashoffset:{circ:.1f}}}}}</style>')
    out.append(f'<circle class="ring" cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{t["allow"]}" stroke-width="26" '
               f'stroke-dasharray="{circ * blocked:.1f} {circ:.1f}" transform="rotate(-90 {cx} {cy})"/>')
    out.append(text(cx, cy + 4, '97.3%', 30, t['ink'], weight=800, anchor='middle'))
    out.append(text(cx, cy + 28, 'blocked', 14, t['dim'], anchor='middle'))
    rows = [(t['allow'], '285 attacks blocked', 'of 293 in the corpus'), (t['block'], '8 attacks missed', 'deserialization and edge cases'), (t['gold'], '79 of 79 harmless calls', 'allowed, no false positives')]
    for i, (c, a, b) in enumerate(rows):
        y = 162 + i * 58
        out.append(f'<circle cx="942" cy="{y - 5}" r="7" fill="{c}"/>')
        out.append(text(960, y, a, 17, t['ink'], weight=600))
        out.append(text(960, y + 22, b, 14, t['dim']))
    return svg(W, H, 'Results', 'AgentDojo: 25% of attacks succeeded with no defense and 0% with Protocol X. Free rules alone on the corpus: 285 of 293 attacks blocked (97.3%), 8 missed, 79 of 79 harmless calls allowed.', '\n'.join(out), style)


# ── Badges ──────────────────────────────────────────────────────────────────────────────────────
# Kept in the repository: GitHub's image proxy often times out fetching shields.io badges.
BADGES = {
    'license': ('license', 'AGPL-3.0', '#b49a5e'),
    'free': ('free', 'no account needed', '#b49a5e'),
    'platforms': ('runs on', 'Windows · macOS · Linux', '#5c5c56'),
    'agents': ('protects', 'Claude Code · Cursor · VS Code · more', '#5c5c56'),
    'paper': ('paper', '10.5281/zenodo.22179415', '#5c5c56'),
}


def badge(label, message, colour):
    cw = 6.6  # average character width at 11px
    lw = round(len(label) * cw + 14)
    mw = round(len(message) * cw + 14)
    w = lw + mw
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="20" role="img" aria-label="{esc(label)}: {esc(message)}">'
            f'<title>{esc(label)}: {esc(message)}</title>'
            f'<rect width="{lw}" height="20" fill="#151518"/><rect x="{lw}" width="{mw}" height="20" fill="{colour}"/>'
            f'<g font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" fill="#fff">'
            f'<text x="{lw / 2}" y="14" text-anchor="middle">{esc(label)}</text>'
            f'<text x="{lw + mw / 2}" y="14" text-anchor="middle">{esc(message)}</text></g></svg>\n')


def main():
    for name, (label, message, colour) in BADGES.items():
        with open(os.path.join(HERE, f'badge-{name}.svg'), 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(badge(label, message, colour))
    for name, t in THEMES.items():
        logo = mark_png(t['ink'])
        files = {
            f'banner-{name}.svg': banner(t, logo),
            f'stats-{name}.svg': stats(t),
            f'decide-{name}.svg': decide(t),
            f'architecture-{name}.svg': architecture(t, logo),
            f'results-{name}.svg': results(t),
        }
        for fn, body in files.items():
            with open(os.path.join(HERE, fn), 'w', encoding='utf-8', newline='\n') as fh:
                fh.write(body)
            print(fn, len(body))


if __name__ == '__main__':
    main()
