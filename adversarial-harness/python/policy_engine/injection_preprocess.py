"""Injection text preprocessing — mirrors src/utils/injection-preprocess.ts."""

from __future__ import annotations

import re
import unicodedata

from .confusables import fold_homoglyphs

INVISIBLE_TO_SPACE_RE = re.compile(
    r"[\u200B-\u200F\uFEFF\u00AD\u2060-\u2064\u061C\u180E\u034F\u17B4\u17B5\u202A-\u202E\u2800\uFE00-\uFE0F]"
)
UNICODE_SPACE_RE = re.compile(r"[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u3164]")
ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07")
EMOJI_RE = re.compile(
    r"[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U00002300-\U000023FF]"
)
LEET_MAP = str.maketrans("013457@$", "oieastas")

EXTRA_HOMOGLYPHS: dict[int, str] = {
    0x0438: "i",
    0x0433: "g",
    0x043D: "n",
    0x0442: "t",
    0x0432: "b",
    0x043B: "l",
    0x043C: "m",
    0x0434: "d",
    0x0455: "s",
    0x04CF: "l",
}


def rot13(text: str) -> str:
    out: list[str] = []
    for ch in text:
        if "a" <= ch <= "z":
            out.append(chr((ord(ch) - 97 + 13) % 26 + 97))
        elif "A" <= ch <= "Z":
            out.append(chr((ord(ch) - 65 + 13) % 26 + 65))
        else:
            out.append(ch)
    return "".join(out)


def deleetspeak(text: str) -> str:
    return text.translate(LEET_MAP)


def strip_combining_marks(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(c for c in decomposed if unicodedata.category(c) != "Mn")
    return unicodedata.normalize("NFC", stripped)


def fold_extended_homoglyphs(text: str) -> str:
    out = fold_homoglyphs(text)
    result: list[str] = []
    for ch in out:
        code = ord(ch)
        if 0x1D400 <= code <= 0x1D7FF:
            offset = code - 0x1D400
            latin = offset % 26
            is_upper = (offset // 26) % 2 == 1
            result.append(chr((65 if is_upper else 97) + latin))
            continue
        result.append(EXTRA_HOMOGLYPHS.get(code, ch))
    return "".join(result)


def collapse_control_whitespace(text: str) -> str:
    text = INVISIBLE_TO_SPACE_RE.sub(" ", text)
    text = UNICODE_SPACE_RE.sub(" ", text)
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
    text = re.sub(r"[\t\r\n\f\v]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def preprocess_for_injection_match(text: str, unicode_strict: bool = True) -> str:
    current = INVISIBLE_TO_SPACE_RE.sub(" ", text)
    current = fold_extended_homoglyphs(current)
    if unicode_strict:
        try:
            from .confusables import normalize_confusables

            current = normalize_confusables(current)
        except Exception:
            pass
    current = strip_combining_marks(current)
    current = unicodedata.normalize("NFKC", current)
    current = ANSI_ESCAPE_RE.sub("", current)
    current = EMOJI_RE.sub(" ", current)
    return collapse_control_whitespace(current)


ROT13_VARIANT_PATTERN_IDS = frozenset(
    {"rot13-obfuscation", "ignore-instructions", "leetspeak-injection"}
)


def injection_match_variants(preprocessed: str, *, include_rot13: bool = False) -> list[str]:
    variants = {preprocessed, deleetspeak(preprocessed)}
    if include_rot13:
        r13 = rot13(preprocessed)
        variants.add(r13)
        variants.add(deleetspeak(r13))
    return list(variants)
