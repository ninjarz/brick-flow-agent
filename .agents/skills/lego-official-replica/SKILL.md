---
name: lego-official-replica
description: Reproduce an official LEGO set as native editable pieces from its instruction manuals, reconcile inventory and artwork, and compare every numbered and inset stage in the actual editor. Use for faithful set replicas and audits of existing replicas.
---

# Official LEGO replica

Keep the user's chosen editor and existing model-library presentation. Establish the set, manual revision and requested fidelity before mapping. Read [verification workflow](references/workflow.md) for the detailed checks and acceleration methods.

1. Record official PDF URLs, booklet/page counts and SHA256 hashes. Build a page/step/inset index and a shape–colour inventory. Treat community models as coordinate references; their object order does not identify official steps and their substitutions require reconciliation.
2. Work in an isolated, durable location when the user wants only a completed asset in the main project. Maintain a checkpoint containing exact paths, canonical commands, verified ranges and remaining gaps. A network reconnect does not establish that the local server failed.
3. Create native, independently editable pieces with actual moulds, colours and face artwork. Preserve rigid source transforms, real attachment axes, insertion depths and hinge degrees of freedom. Do not stretch parts, inflate collision clearances or replace awkward parts with visual approximations to make a check pass.
4. Keep a deterministic mapping from each official step and inset to piece IDs, booklet/page, pending stickers and temporary construction poses. Final display poses alone cannot establish that a folded or flipped intermediate assembly is correct.
5. Run the editor's mechanical checks on each cumulative prefix and isolated inset, then the joined model. Reconcile the whole shape–colour inventory. Explicitly distinguish factory assemblies, editable subcomponents and spare/packaging pieces in counts.
6. Manually operate the actual editor and compare every numbered/inset stage with the manual. Inspect the same visible face, the underside where needed, and printed faces before surrounding walls hide them. A screenshot saved without viewing it is not evidence of comparison. Mechanical success does not certify appearance.
7. Regenerate from canonical corrections, verify stable hashes, and repeat checks affected by each change. Reject incorrect experiments completely and mark their screenshots as superseded.
8. Once complete, publish only the final asset, required runtime geometry/data and source provenance through the existing model library. Run meaningful regression, import/export, production-browser and performance checks. Leave research PDFs, probes, intermediate plans and captures outside production.

Use `python3 scripts/audit_plan.py PLAN.json --expected-pieces COUNT` for a quick deterministic check of piece IDs, step membership and rigid transforms. This is a bookkeeping check; retain native mechanical validation and manual visual inspection separately.
