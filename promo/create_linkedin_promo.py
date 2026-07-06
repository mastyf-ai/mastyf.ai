from __future__ import annotations

import math
import subprocess
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "promo"
WIDTH, HEIGHT = 1920, 1080
FPS = 30
SLIDE_SECONDS = 6.25

VOICEOVER = (
    "AI agents are now connecting to MCP servers, tools, APIs, and enterprise data. "
    "That creates a new security and compliance layer teams must manage in real time. "
    "Mastyf dot A I acts as a runtime trust layer for agentic systems. "
    "It enforces policies, detects threats, monitors tool calls, and records every decision in an audit trail. "
    "From the dashboard, teams can see protected traffic, framework posture, certifications, "
    "and downloadable compliance evidence for SOC 2, ISO 27001, HIPAA, PCI DSS, and FedRAMP. "
    "Secure AI agents. Prove compliance. Reduce risk with Mastyf dot A I."
)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


F_TITLE = font(76, True)
F_SUBTITLE = font(34)
F_H2 = font(42, True)
F_BODY = font(27)
F_SMALL = font(22)
F_BADGE = font(26, True)


def bg() -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), "#061020")
    draw = ImageDraw.Draw(img)
    for y in range(HEIGHT):
        ratio = y / HEIGHT
        r = int(5 + 5 * ratio)
        g = int(13 + 10 * ratio)
        b = int(32 + 25 * ratio)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b))
    for x in range(0, WIDTH, 80):
        draw.line([(x, 0), (x, HEIGHT)], fill=(18, 55, 92), width=1)
    for y in range(0, HEIGHT, 80):
        draw.line([(0, y), (WIDTH, y)], fill=(18, 55, 92), width=1)
    for cx, cy, radius, color in [
        (430, 230, 360, (0, 92, 255)),
        (1450, 720, 420, (0, 220, 190)),
    ]:
        glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*color, 32))
        img = Image.alpha_composite(img.convert("RGBA"), glow.filter(ImageFilter.GaussianBlur(85))).convert("RGB")
    return img


def rounded(draw: ImageDraw.ImageDraw, box, fill, outline=(37, 157, 255), width=2, radius=26):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def text(draw: ImageDraw.ImageDraw, xy, value, fnt, fill="#F4FAFF", anchor=None):
    draw.text(xy, value, font=fnt, fill=fill, anchor=anchor)


def wrap(draw: ImageDraw.ImageDraw, value: str, fnt, max_width: int) -> list[str]:
    words = value.split()
    lines: list[str] = []
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=fnt)[2] <= max_width:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def draw_logo(draw: ImageDraw.ImageDraw, x: int, y: int, size: int = 72):
    logo_path = ROOT / "logo.jpeg"
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA").resize((size, size))
        mask = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(mask)
        md.rounded_rectangle((0, 0, size, size), radius=18, fill=255)
        return logo, mask
    draw.rounded_rectangle((x, y, x + size, y + size), radius=18, outline="#2DD4FF", width=4)
    draw.line((x + size * 0.28, y + size * 0.52, x + size * 0.43, y + size * 0.68, x + size * 0.74, y + size * 0.32), fill="#31F6C9", width=5)
    return None, None


def paste_logo(img: Image.Image, x: int, y: int, size: int = 72):
    draw = ImageDraw.Draw(img)
    logo, mask = draw_logo(draw, x, y, size)
    if logo is not None and mask is not None:
        img.paste(logo, (x, y), mask)
    text(draw, (x + size + 22, y + 8), "Mastyf.ai", font(46, True))
    text(draw, (x + size + 24, y + 60), "Secure AI agents. Prove compliance.", F_SMALL, "#A9C6E8")


def panel(draw, x, y, w, h, title, body, accent="#2DD4FF"):
    rounded(draw, (x, y, x + w, y + h), fill=(7, 24, 48), outline=accent, width=2, radius=28)
    text(draw, (x + 28, y + 24), title, F_H2, "#FFFFFF")
    yy = y + 90
    for line in wrap(draw, body, F_BODY, w - 56):
        text(draw, (x + 28, yy), line, F_BODY, "#B8D2EC")
        yy += 38


def badge(draw, x, y, label, accent="#31F6C9"):
    tw = draw.textbbox((0, 0), label, font=F_BADGE)[2]
    rounded(draw, (x, y, x + tw + 44, y + 52), fill=(5, 28, 43), outline=accent, width=2, radius=20)
    text(draw, (x + 22, y + 12), label, F_BADGE, "#EFFFFB")
    return tw + 56


def scene(title: str, subtitle: str, cards: list[tuple[str, str, str]], footer: str) -> Image.Image:
    img = bg()
    draw = ImageDraw.Draw(img, "RGBA")
    paste_logo(img, 70, 58, 74)
    text(draw, (WIDTH // 2, 150), title, F_TITLE, anchor="mm")
    for i, line in enumerate(wrap(draw, subtitle, F_SUBTITLE, 1120)):
        text(draw, (WIDTH // 2, 220 + i * 44), line, F_SUBTITLE, "#BFD8F2", anchor="mm")
    start_x = 110
    gap = 38
    card_w = (WIDTH - 2 * start_x - 2 * gap) // 3
    for idx, (t, b, a) in enumerate(cards):
        panel(draw, start_x + idx * (card_w + gap), 355, card_w, 390, t, b, a)
    rounded(draw, (230, 835, WIDTH - 230, 920), fill=(4, 22, 39), outline="#2DD4FF", width=2, radius=30)
    text(draw, (WIDTH // 2, 878), footer, F_H2, "#DFFBFF", anchor="mm")
    return img


def dashboard_scene() -> Image.Image:
    img = bg()
    draw = ImageDraw.Draw(img, "RGBA")
    paste_logo(img, 72, 54, 74)
    text(draw, (WIDTH // 2, 135), "The Mastyf.ai Dashboard", F_TITLE, anchor="mm")
    text(draw, (WIDTH // 2, 205), "One operational view for AI agent security, compliance, and evidence.", F_SUBTITLE, "#BFD8F2", anchor="mm")
    rounded(draw, (170, 295, 1750, 850), fill=(6, 22, 44), outline="#2DD4FF", width=3, radius=34)
    # Sidebar
    rounded(draw, (205, 335, 465, 810), fill=(4, 17, 34), outline="#113E70", width=2, radius=22)
    for i, item in enumerate(["Protection", "Threats", "Servers", "Compliance", "Evidence"]):
        y = 375 + i * 76
        color = "#31F6C9" if item in {"Compliance", "Evidence"} else "#7FB4FF"
        rounded(draw, (235, y, 435, y + 48), fill=(8, 34, 64), outline=color, width=1, radius=18)
        text(draw, (258, y + 12), item, F_SMALL, "#DDF4FF")
    # Main panels
    panel(draw, 515, 340, 360, 205, "Runtime Guardrails", "Policy decisions across MCP tool calls, APIs, and agent workflows.", "#31F6C9")
    panel(draw, 905, 340, 360, 205, "Threat Detection", "Prompt injection, path traversal, exfiltration, and suspicious behavior.", "#8B5CF6")
    panel(draw, 1295, 340, 360, 205, "Compliance Posture", "Framework scores and gaps from live policy, audit, and scan signals.", "#FBBF24")
    panel(draw, 515, 590, 540, 205, "Evidence Library", "Generate and download full audit-ready evidence packages on demand.", "#2DD4FF")
    panel(draw, 1085, 590, 570, 205, "Certification & Attestation", "Track certified servers and signed attestations for agentic infrastructure.", "#31F6C9")
    return img


def framework_scene() -> Image.Image:
    img = bg()
    draw = ImageDraw.Draw(img, "RGBA")
    paste_logo(img, 72, 54, 74)
    text(draw, (WIDTH // 2, 145), "From Runtime Signals to Compliance Evidence", F_TITLE, anchor="mm")
    text(draw, (WIDTH // 2, 215), "Live telemetry, policy decisions, and security scans become downloadable reports.", F_SUBTITLE, "#BFD8F2", anchor="mm")
    x = 180
    for label in ["Live telemetry", "Policy decisions", "Security scans", "Audit trail"]:
        panel(draw, x, 330, 330, 190, label, "Captured as real operational evidence, not synthetic dashboard filler.", "#2DD4FF")
        x += 390
    draw.line((360, 610, 1560, 610), fill="#31F6C9", width=6)
    for cx in [360, 750, 1140, 1530]:
        draw.ellipse((cx - 18, 592, cx + 18, 628), fill="#31F6C9")
    text(draw, (WIDTH // 2, 680), "Compliance Framework Coverage", F_H2, "#FFFFFF", anchor="mm")
    x = 270
    for label in ["SOC 2", "ISO 27001", "HIPAA", "PCI DSS", "FedRAMP"]:
        x += badge(draw, x, 735, label, "#31F6C9")
    return img


def save_slides() -> list[Path]:
    slides = [
        scene(
            "Secure AI Agents. Prove Compliance.",
            "Mastyf.ai gives teams a runtime trust layer for agentic systems connected to tools, MCP servers, APIs, and enterprise data.",
            [
                ("AI Agent Risk", "Agents can call tools, read files, invoke APIs, and touch sensitive business data.", "#2DD4FF"),
                ("Runtime Control", "Policies enforce what agents can do while capturing every decision.", "#31F6C9"),
                ("Audit Readiness", "Security activity becomes evidence for compliance and review.", "#FBBF24"),
            ],
            "Built for the agentic cybersecurity era",
        ),
        dashboard_scene(),
        scene(
            "Protect Every Tool Call",
            "Mastyf.ai monitors agent actions in real time so security teams can detect and control risky behavior before it spreads.",
            [
                ("Policy Enforcement", "Allow, block, audit, and route decisions based on context-aware rules.", "#31F6C9"),
                ("Threat Detection", "Detect prompt injection, path traversal, exfiltration, and anomalous calls.", "#8B5CF6"),
                ("Audit Trail", "Record tool, server, policy, decision, and evidence metadata for review.", "#2DD4FF"),
            ],
            "Runtime guardrails for MCP and agentic workloads",
        ),
        framework_scene(),
        scene(
            "Compliance Without Guesswork",
            "Generate full evidence reports from live policy, proxy audit records, and security scan signals.",
            [
                ("Framework Posture", "See framework scores, satisfied controls, audit evidence, and open gaps.", "#FBBF24"),
                ("Evidence Library", "Download detailed compliance evidence artifacts for auditors and stakeholders.", "#2DD4FF"),
                ("Certifications", "Track server certifications, attestations, and operational readiness.", "#31F6C9"),
            ],
            "Live security signals become compliance evidence",
        ),
        scene(
            "Mastyf.ai",
            "AI agent security, runtime protection, and compliance evidence for teams building with MCP and autonomous tools.",
            [
                ("Reduce Risk", "Protect agent access to tools, APIs, files, and sensitive workflows.", "#31F6C9"),
                ("Move Faster", "Give teams visibility without slowing down agentic development.", "#2DD4FF"),
                ("Prove Trust", "Turn decisions and telemetry into audit-ready evidence.", "#FBBF24"),
            ],
            "Secure AI agents. Prove compliance. Reduce risk.",
        ),
    ]
    paths: list[Path] = []
    for idx, slide in enumerate(slides, start=1):
        path = OUT / f"linkedin-promo-slide-{idx:02d}.png"
        slide.save(path, quality=95)
        paths.append(path)
    return paths


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    script_path = OUT / "mastyf-ai-linkedin-promo-voiceover.txt"
    script_path.write_text("\n".join(textwrap.wrap(VOICEOVER, width=90)) + "\n", encoding="utf-8")
    slides = save_slides()

    voice_aiff = OUT / "mastyf-ai-linkedin-promo-voiceover.aiff"
    subprocess.run(["say", "-v", "Samantha", "-r", "176", "-f", str(script_path), "-o", str(voice_aiff)], check=True)

    concat_path = OUT / "mastyf-ai-linkedin-promo-slides.txt"
    lines = []
    for slide in slides:
        lines.append(f"file '{slide}'")
        lines.append(f"duration {SLIDE_SECONDS}")
    lines.append(f"file '{slides[-1]}'")
    concat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    silent_video = OUT / "mastyf-ai-linkedin-promo-silent.mp4"
    final_video = OUT / "mastyf-ai-linkedin-promo.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_path),
            "-vf",
            f"fps={FPS},format=yuv420p",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(silent_video),
        ],
        check=True,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(silent_video),
            "-i",
            str(voice_aiff),
            "-filter_complex",
            "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.2[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-shortest",
            str(final_video),
        ],
        check=True,
    )

    print(final_video)


if __name__ == "__main__":
    main()
