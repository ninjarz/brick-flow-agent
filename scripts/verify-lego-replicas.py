#!/usr/bin/env python3
"""Verify every bundled replica and its transitive LDraw part dependencies."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "lego-replicas"
MANIFEST = ROOT / "src" / "data" / "legoReplicaManifest.json"


def refs(text):
    for line in text.splitlines():
        if line.startswith("1 "):
            fields = line.split(maxsplit=14)
            if len(fields) == 15:
                yield fields[14].replace("\\", "/").strip()


def embedded(text):
    files = {}
    current = None
    lines = []
    for line in text.splitlines():
        if line.startswith("0 FILE "):
            if current is not None:
                files[current.lower()] = "\n".join(lines)
            current, lines = line[7:].strip().replace("\\", "/"), []
        elif current is not None:
            lines.append(line)
    if current is not None:
        files[current.lower()] = "\n".join(lines)
    return files


def main():
    manifest = json.loads(MANIFEST.read_text())
    file_map = json.loads((DATA / "fileMap.json").read_text())
    checked = set()

    def check_ref(reference):
        mapped = file_map.get(reference, file_map.get(reference.lower()))
        if mapped is None:
            raise AssertionError(f"Unindexed LDraw reference: {reference}")
        target = (DATA / "parts" / mapped).resolve()
        if not target.is_relative_to(DATA.resolve()) or not target.is_file():
            raise AssertionError(f"Missing LDraw dependency: {reference} -> {target}")
        if target not in checked:
            checked.add(target)
            for child in refs(target.read_text(errors="replace")):
                check_ref(child)
        return target

    for item in manifest:
        model = DATA / "models" / f"{item['number']}-1.mpd"
        raw = model.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item["modelSha256"], model
        text = raw.decode("utf-8-sig")
        files = embedded(text)
        assert files, model
        piece_count = 0
        primitive_count = 0

        def is_embedded_piece(name):
            return any(
                line.startswith("0 !LDRAW_ORG ") and
                ("Part" in line or "Shortcut" in line) and
                "Subpart" not in line
                for line in files[name.lower()].splitlines()
            )

        def check_embedded_dependencies(name, ancestry=()):
            key = name.lower()
            if key in ancestry:
                raise AssertionError(f"Cyclic embedded part {item['number']}: {key}")
            for reference in refs(files[key]):
                if reference.lower() in files:
                    check_embedded_dependencies(reference, (*ancestry, key))
                else:
                    check_ref(reference)

        def expand(name, ancestry=()):
            nonlocal piece_count, primitive_count
            key = name.lower()
            if key in ancestry:
                raise AssertionError(f"Cyclic model {item['number']}: {key}")
            for reference in refs(files[key]):
                if reference.lower() in files:
                    if is_embedded_piece(reference):
                        piece_count += 1
                        check_embedded_dependencies(reference)
                    else:
                        expand(reference, (*ancestry, key))
                else:
                    target = check_ref(reference)
                    if "p" == target.relative_to(DATA).parts[0]:
                        primitive_count += 1
                    else:
                        piece_count += 1

        expand(next(iter(files)))
        assert piece_count == item["modelPieceCount"], (model, piece_count)
        assert primitive_count == item["primitiveInstances"], (model, primitive_count)
        assert sum(line.strip() == "0 STEP" for line in text.splitlines()) == item["stepMarkers"]
        print(f"#{item['number']}: {piece_count} pieces, {len(files)} submodels, {item['stepMarkers']} step markers")

    print(f"All models and {len(checked)} library dependencies verified")


if __name__ == "__main__":
    main()
