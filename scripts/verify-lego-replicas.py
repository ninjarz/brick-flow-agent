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
        distinct_pieces = set()

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
                        distinct_pieces.add(reference.lower())
                        check_embedded_dependencies(reference)
                    else:
                        expand(reference, (*ancestry, key))
                else:
                    target = check_ref(reference)
                    if "p" == target.relative_to(DATA).parts[0]:
                        primitive_count += 1
                    else:
                        piece_count += 1
                        distinct_pieces.add(reference.lower())

        expand(next(iter(files)))
        assert piece_count == item["modelPieceCount"], (model, piece_count)
        assert primitive_count == item["primitiveInstances"], (model, primitive_count)
        assert len(distinct_pieces) == item['distinctPieces'], (model, len(distinct_pieces))
        assert sum(line.strip() == "0 STEP" for line in text.splitlines()) == item["stepMarkers"]
        if 'manualSteps' in item:
            # These models intentionally have one flat assembly step per official diagram.
            assembly_steps = text.split('\n0 STEP\n')
            assert len(assembly_steps) == len(item['manualSteps']), model
            total = 0
            for assembly, description in zip(assembly_steps, item['manualSteps']):
                added = len(list(refs(assembly)))
                total += added
                assert added == description['addedPieces'], (model, description['title'])
                assert total == description['totalPieces'], (model, description['title'])
            assert total == item['officialPieceCount'], model
        print(f"#{item['number']}: {piece_count} pieces, {len(files)} submodels, {item['stepMarkers']} step markers")

    # Native Architecture sources use the main editor's public/ldraw library.
    native_library = ROOT / "public" / "ldraw"
    native_checked = set()

    def check_native_ref(reference, parent=None):
        reference = reference.replace("\\", "/").lower()
        candidates = [native_library / "parts" / reference, native_library / "p" / reference]
        if parent is not None:
            candidates.insert(0, parent.parent / reference)
        target = next((path.resolve() for path in candidates if path.is_file()), None)
        assert target and target.is_relative_to(native_library.resolve()), reference
        if target in native_checked:
            return
        native_checked.add(target)
        for child in refs(target.read_text(errors="replace")):
            check_native_ref(child, target)

    configs = json.loads((ROOT / "scripts" / "architectureReplicaSources.json").read_text())
    for config in configs:
        model = DATA / "models" / f"{config['set']}-1.mpd"
        raw = model.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == config["sha256"], model
        text = raw.decode("utf-8-sig")
        files = embedded(text) or {"root": text}

        def expand_native(name, ancestry=()):
            key = name.lower()
            assert key not in ancestry, f"Cyclic native source: {key}"
            count = 0
            for reference in refs(files[key]):
                if reference.lower() in files:
                    count += expand_native(reference, (*ancestry, key))
                else:
                    check_native_ref(reference)
                    count += 1
            return count

        assert expand_native(next(iter(files))) == config["pieces"], model
        membership = [index for group in config["groups"] for index in group]
        assert sorted(membership) == list(range(1, config["pieces"] + 1)), model
        plan = json.loads((ROOT / "src" / "data" / f"{config['output']}.json").read_text())
        assert len(plan["bricks"]) == config["pieces"], model
        assert len(plan["steps"]) == len(config["pages"]), model
        for step, group in zip(plan["steps"], config["groups"]):
            assert step["brickIds"] == [f"{config['id']}-{index}" for index in group], step["title"]
        print(f"#{config['set']}: {config['pieces']} native pieces, {len(plan['steps'])} official main steps")

    print(f"All archived and native batch models verified; {len(checked)} archive and {len(native_checked)} editor dependencies")


if __name__ == "__main__":
    main()
