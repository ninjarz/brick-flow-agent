#!/usr/bin/env python3
"""Extract the LDraw dependencies needed by the curated OMR models.

Usage: python3 scripts/prepare-lego-replicas.py COMPLETE_ZIP SOURCE_MPD_DIR
The source directory must contain an MPD for every set in MODELS.
"""

from __future__ import annotations

import hashlib
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "lego-replicas"
MODELS = (
    ("10030", "Imperial Star Destroyer", "Roland Dahl", 3104),
    ("8099", "Midi-scale Imperial Star Destroyer", "Orion Pobursky", 423),
    ("10124", "Wright Flyer", "Marc Giraudet", 666),
    ("10182", "Café Corner", "Max Martin Richter", 2058),
    ("10258", "London Bus", "Philippe Hurbain", 1686),
    ("10134", "Y-wing Attack Starfighter", "Roland Dahl", 1489),
)


def references(text: str):
    for line in text.splitlines():
        if line.startswith("1 "):
            fields = line.split(maxsplit=14)
            if len(fields) == 15:
                yield fields[1], fields[14].replace("\\", "/").strip()


def embedded_files(text: str):
    files = {}
    current = None
    lines = []
    for line in text.splitlines():
        if line.startswith("0 FILE "):
            if current is not None:
                files[current.lower()] = "\n".join(lines)
            current = line[7:].strip().replace("\\", "/")
            lines = []
        elif current is not None:
            lines.append(line)
    if current is not None:
        files[current.lower()] = "\n".join(lines)
    return files


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    archive_path, source_dir = Path(sys.argv[1]), Path(sys.argv[2])
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = []
    all_needed = set()
    file_map = {}

    with zipfile.ZipFile(archive_path) as archive:
        names = {name.lower(): name for name in archive.namelist()}

        def resolve(reference):
            reference = reference.lower()
            if reference.startswith("s/"):
                candidates = ("ldraw/parts/" + reference,)
            elif reference.startswith("48/") or reference.startswith("8/"):
                candidates = ("ldraw/p/" + reference,)
            else:
                candidates = (
                    "ldraw/parts/" + reference,
                    "ldraw/p/" + reference,
                    "ldraw/" + reference,
                )
            return next((candidate for candidate in candidates if candidate in names), None)

        def loader_path(resolved):
            # Three's LDrawLoader tries "parts/" before every mapped path. Vite
            # serves its HTML shell for missing paths, so make that first URL exact.
            if resolved.startswith("ldraw/parts/"):
                return resolved.removeprefix("ldraw/parts/")
            if resolved.startswith("ldraw/p/"):
                return "../p/" + resolved.removeprefix("ldraw/p/")
            raise RuntimeError(f"Unexpected library location: {resolved}")

        pending = []
        for number, title, author, official_count in MODELS:
            source_path = source_dir / f"{number}-1.mpd"
            raw = source_path.read_bytes()
            text = raw.decode("utf-8-sig")
            embedded = embedded_files(text)
            if not embedded:
                raise RuntimeError(f"No embedded files in {source_path}")
            main_name = next(iter(embedded))
            pieces = Counter()
            primitive_refs = Counter()

            def is_embedded_piece(name):
                return any(
                    line.startswith("0 !LDRAW_ORG ") and
                    ("Part" in line or "Shortcut" in line) and
                    "Subpart" not in line
                    for line in embedded[name.lower()].splitlines()
                )

            def add_external(ref):
                target = ref.lower()
                resolved = resolve(target)
                if not resolved:
                    raise RuntimeError(f"Missing library dependency: {ref} in {number}")
                file_map[ref] = loader_path(resolved)
                file_map[target] = loader_path(resolved)
                pending.append(target)
                return resolved

            def scan_embedded_dependencies(name, ancestry=()):
                key = name.lower()
                if key in ancestry:
                    raise RuntimeError(f"Cyclic embedded part: {ancestry} -> {key}")
                for _, ref in references(embedded[key]):
                    if ref.lower() in embedded:
                        scan_embedded_dependencies(ref, (*ancestry, key))
                    else:
                        add_external(ref)

            def expand(name, ancestry=()):
                key = name.lower()
                if key in ancestry:
                    raise RuntimeError(f"Cyclic model: {ancestry} -> {key}")
                for color, ref in references(embedded[key]):
                    target = ref.lower()
                    if target in embedded:
                        if is_embedded_piece(target):
                            pieces[(target, color)] += 1
                            scan_embedded_dependencies(target)
                        else:
                            expand(target, (*ancestry, key))
                    else:
                        resolved = add_external(ref)
                        if resolved.startswith("ldraw/p/"):
                            primitive_refs[target] += 1
                        else:
                            pieces[(target, color)] += 1

            expand(main_name)
            steps = sum(line.strip() == "0 STEP" for line in text.splitlines())
            target = OUTPUT / "models" / f"{number}-1.mpd"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            manifest.append({
                "number": number,
                "title": title,
                "modelAuthor": author,
                "officialPieceCount": official_count,
                "modelPieceCount": sum(pieces.values()),
                "primitiveInstances": sum(primitive_refs.values()),
                "stepMarkers": steps,
                "distinctPieces": len({part for part, _ in pieces}),
                "modelSha256": hashlib.sha256(raw).hexdigest(),
                "modelUrl": f"lego-replicas/models/{number}-1.mpd",
                "officialInstructionsUrl": f"https://www.lego.com/en-us/service/building-instructions/{number}",
                "modelSourceUrl": f"https://library.ldraw.org/library/omr/{number}-1.mpd",
            })

        while pending:
            reference = pending.pop()
            resolved = resolve(reference)
            if not resolved:
                raise RuntimeError(f"Missing library dependency: {reference}")
            file_map[reference] = loader_path(resolved)
            file_map[reference.lower()] = loader_path(resolved)
            if resolved in all_needed:
                continue
            all_needed.add(resolved)
            content = archive.read(names[resolved])
            for _, child in references(content.decode("utf-8-sig", errors="replace")):
                pending.append(child)
            destination = OUTPUT / resolved.removeprefix("ldraw/")
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)

        for name in ("LDConfig.ldr", "CAreadme.txt", "CAlicense.txt", "CAlicense4.txt"):
            (OUTPUT / name).write_bytes(archive.read(names[f"ldraw/{name}".lower()]))

    (ROOT / "src" / "data" / "legoReplicaManifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    (OUTPUT / "fileMap.json").write_text(json.dumps(file_map, sort_keys=True) + "\n")
    expected = {
        *(OUTPUT / path.removeprefix("ldraw/") for path in all_needed),
        *(OUTPUT / "models" / f"{number}-1.mpd" for number, *_ in MODELS),
        *(OUTPUT / name for name in ("LDConfig.ldr", "CAreadme.txt", "CAlicense.txt", "CAlicense4.txt", "fileMap.json")),
    }
    for path in OUTPUT.rglob("*"):
        if path.is_file() and path not in expected:
            path.unlink()
    print(json.dumps({"models": manifest, "dependencyFiles": len(all_needed)}, indent=2))


if __name__ == "__main__":
    main()
