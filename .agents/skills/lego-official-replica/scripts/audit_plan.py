"""Bookkeeping audit for a native BuildPlan; not a mechanical or visual certificate."""
import argparse
import collections
import hashlib
import json
import math
from pathlib import Path


def audit(path, expected=None):
    raw = Path(path).read_bytes()
    plan = json.loads(raw)
    bricks = plan['bricks']
    ids = [b['id'] for b in bricks]
    errors = []
    if len(set(ids)) != len(ids):
        errors.append('Duplicate piece IDs')
    if expected is not None and len(bricks) != expected:
        errors.append(f'Expected {expected} pieces; got {len(bricks)}')
    assigned = [i for step in plan['steps'] for i in step['brickIds']]
    counts = collections.Counter(assigned)
    if set(assigned) != set(ids) or any(n != 1 for n in counts.values()):
        errors.append('Each piece must belong to exactly one step, without unknown IDs')
    for brick in bricks:
        pose = brick['pose']
        values = [pose.get(k) for k in ('xStud', 'yStud', 'zStud')]
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in values):
            errors.append(f"{brick['id']}: invalid position")
        for k in ('rotationQuarterTurns', 'verticalQuarterTurns', 'rollQuarterTurns'):
            if type(pose.get(k, 0)) is not int or pose.get(k, 0) not in (0, 1, 2, 3):
                errors.append(f"{brick['id']}: invalid {k}")
        matrix = pose.get('orientationMatrix')
        if matrix is None:
            continue
        if (not isinstance(matrix, list) or len(matrix) != 9 or any(type(v) not in (int, float) or not math.isfinite(v) for v in matrix)):
            errors.append(f"{brick['id']}: invalid orientation matrix")
            continue
        if any(abs(sum(matrix[r*3+k]*matrix[s*3+k] for k in range(3)) - int(r == s)) > 1e-4 for r in range(3) for s in range(3)):
            errors.append(f"{brick['id']}: orientation stretches or shears the part")
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'pieces': len(bricks), 'steps': len(plan['steps']), 'errors': errors}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('plan')
    parser.add_argument('--expected-pieces', type=int)
    args = parser.parse_args()
    report = audit(args.plan, args.expected_pieces)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(bool(report['errors']))
