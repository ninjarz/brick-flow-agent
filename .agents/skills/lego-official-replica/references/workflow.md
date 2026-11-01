# Workflow and acceleration methods

## Start from an indexed source

- Record manual revision, official PDF ID and SHA256. Printed booklet page numbers and PDF page indices may differ; prove the correspondence once.
- Extract BOM and inset regions at legible resolution before mapping a section. For a missing item, inspect every image in the bounded bag/page range; aspect/size filters can omit the small icon that matters.
- Build an inventory delta early, then per bag/component. Classify true missing parts, exact mould variants, assembly decomposition, unused reference extras, prints and packaging. Do not pad the final model to match the advertised count.
- A community model accelerates placement but can omit stickers, use substitute arches/trees or misplace bridges. Preserve its provenance and list reconciled deviations.

## Map stable identities and actual geometry

Maintain one canonical source and explicit correction functions. A correction should identify the part IDs, manual evidence and the original rigid transform. Regeneration should reproduce the same final hashes; avoid accumulating unrelated JSON edits.

Use real connector frames and collision volumes. Verify source-axis swaps and centre/origin conventions with representative parts before importing thousands. Preserve orthonormal transforms including reflected source frames where the mesh convention requires them. Round only to a precision that retains actual seats.

Solve articulated assemblies using their mechanical degrees of freedom: coaxial stud swivels, clip/bar rotation, hinge leaves and pin axes. Keep fixed support centres. A two-sided folded hinge may have only one seated leaf. Search all actual support plates of an ornament, and retain enough jointly compatible candidates rather than optimizing each seat independently.

Add stage metadata for temporary flipped/folded poses, repeated copies, blank-before-sticker variants and installation-only steps. Keep final presentation poses separate. A correct final dragon wing angle is not the earlier folded construction angle.

## Compare efficiently without losing evidence

For each stage, track booklet/page, numbered step, inset, piece IDs, expected count, native validation result, camera face, capture path, source hash and whether the capture was actually viewed. Mark ambiguity or occlusion explicitly instead of silently passing it.

Use small batches of sequential UI operations with fresh accessibility state after each change. Before capturing, assert component, numbered step, inset, isolation/focus mode and visible count. An HMR reset or JSON reload can return the viewer to a different component. Whole-assembly and isolated-inset helpers must set their own modes explicitly.

Match the manual's visible face before changing geometry. Use front/back, underside and installed views as needed; a correct red part can appear behind a wall from the opposite camera. Transparent parts, grey versus black, and sideways printed surfaces need close views. Enlarge ambiguous official insets; a downscaled contact sheet can hide the direction of a small ridge.

Inspect repeated elements individually when orientation or artwork differs. Natural rock caps can intentionally share, oppose or cross the tall slope's direction. Never extrapolate a single verified correction to every similar-looking part. Inspect all distinct face prints and flag/sticker ordering, including opposite-face variants.

After a correction, revisit the affected inset, its installed context, later prefixes and the joined model. A hinge can pass its own half-castle and collide with the other half. Keep only evidence tied to the accepted final geometry; supersede contacts from rejected experiments.

## Package and verify

Reconcile physical inventory separately from artwork. Decomposed hinges and two-wand sprues can change editable counts without a missing mould. State the counting convention in source metadata.

Keep fixed-colour mesh layers indexed into lazily loaded geometry instead of duplicating vertices for each printed colour. Check cold loading as well as warmed views. For large vertex sets, fill preallocated typed buffers directly instead of building nested temporary arrays; verify identical vertex bytes before accepting the optimization. Large JSON scene data may need the bundler's JSON-string mode to avoid build-memory explosions while retaining ordinary JSON imports for CLI tools. Bound simultaneous geometry transforms if many lazy chunks exhaust the build tool's default heap; verify the actual build instead of raising memory blindly. Trace only the required LDraw roots and transitive subparts/primitives; retain source author/license headers.

Check IDs and membership with the bundled bookkeeping script, then run native validation and round-trip tests. Use an isolated server/port for browser regression so an existing server cannot silently test the wrong checkout. Avoid concurrent CPU-heavy jobs when enforcing performance budgets. Profile a regression before changing limits: a full support cache that creates a fresh Map iterator for every single-entry eviction can spend most of its time rescanning deleted slots; batched FIFO eviction preserves semantics and bounds memory.

Finish with actual UI checks of the existing model card, complete render, save/reload and manual/export. The product may store final display poses; document temporary construction poses separately if its standard manual does not replay articulation. Keep source hashes, final evidence and commands recoverable, but exclude private research and unfinished assets from the production diff.
