"""Cyrillic/Greek homoglyph folding (mirrors src/utils/confusables.ts fast path)."""

HOMOGLYPH_MAP: dict[int, str] = {
    0x0430: "a",
    0x0435: "e",
    0x043E: "o",
    0x0438: "i",
    0x0433: "g",
    0x043D: "n",
    0x0442: "t",
    0x0440: "p",
    0x0441: "c",
    0x0443: "y",
    0x0445: "x",
    0x0456: "i",
    0x03BF: "o",
    0x03C1: "p",
    0x03B1: "a",
    0x03B5: "e",
    0x03B9: "i",
    0x03C3: "s",
}


def fold_homoglyphs(text: str) -> str:
    out: list[str] = []
    for ch in text:
        code = ord(ch)
        out.append(HOMOGLYPH_MAP.get(code, ch))
    return "".join(out)
