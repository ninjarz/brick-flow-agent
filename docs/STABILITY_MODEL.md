# Stability and disaster model

The Stability Disaster Lab estimates how a brick model carries self-weight and how its load paths change under wind, retained water, and horizontal ground acceleration. Use Real scale and select the actual base condition when comparing an on-screen model to a physical build.

## Geometry and self-weight

The single-case, suite, and reinforcement workers use the editor's structural geometry. A bearing surface comes from overlapping material faces. Matched studs, sockets, and other connectors supply additional load paths. Discarding micrometre-scale overlap prevents numerical slivers on imported parts from becoming structural supports.

The model starts with a gravity-only equilibrium pass. Each subsequent pass still includes full self-weight. Eleven standard brick sizes use the measured masses in *Legolization*. Other parts use an estimated mass from their nominal volume or the sampled shell volume, whichever gives the lower estimate. The shell model uses the sampled mould and measured mass of a standard 2 × 6 brick as its density reference. For shell estimates the model also uses the sampled centroid. The reported total mass combines measurements and estimates. [Luo et al., Table 1 and Appendix A](https://www.cg.it.aoyama.ac.jp/yonghao/siga15/luo-Legolization.pdf)

## Applying a hazard

| Hazard | Real scale at 100% | Challenge multiplier | Load model |
| --- | ---: | ---: | --- |
| Wind | 30 m/s | 2× | Drag scales with air density, visible projected area, and wind speed squared. Occlusion changes as parts detach. |
| Heavy rain | 30 mm equivalent ponding | 20× | The retained-water load grows over the scenario. Water mass comes from depth and exposed plan area. |
| Earthquake | 2 g prescribed peak input | 5× | A signed horizontal waveform applies inertia to each brick through its estimated mass. |

An intensity of zero produces zero external load in every scenario. The rain depth is equivalent retained water, so a real comparison needs an estimated or measured water depth on the build. A free-standing model uses an assumed base friction coefficient of 0.45. Above the friction limit, the model estimates sliding onset and solves the internal loads in the accelerating frame of the component. An anchored model fixes its ground contacts. A free-standing component can start rocking when its resultant passes outside its support footprint. The lab reports that onset as base overturning.

## Support reactions and failure

The solver routes force and moment toward the ground through bearing patches and qualified alternate joints. Compression can shift across a support footprint. If the resultant passes beyond it, matched studs can resist the extra moment in tension. The solver checks per-stud pullout, friction, shear, and compression. The reference pullout threshold of about 0.70 N comes from the measured connection in *Legolization*. Shear, surface friction, bearing limits, and special joint strength are estimates. The approach borrows the breaking of individual bonds and the separation of connected fragments from graph-based destruction solvers. [Luo et al., Appendix A](https://www.cg.it.aoyama.ac.jp/yonghao/siga15/luo-Legolization.pdf) · [NVIDIA Blast stress solver](https://docs.omniverse.nvidia.com/kit/docs/blast-sdk/latest/docs/api/extensions/ext_stress.html)

When an evaluated bond exceeds its threshold, the solver disconnects that bond and redistributes load at the same instant. Independent overloads may release together. A brick remains in the structure while it has a viable route to the ground. A broken connection and a detached brick are reported separately. If the available geometry cannot establish a resisting moment, the solver passes on the compressive load it can account for and flags the unresolved path. It also flags overloaded specialty connections whose fracture strengths are unknown. Purple parts need review and are excluded from the confirmed failure count unless another resolved failure detaches them.

The static X-ray score uses grounded mass, support coverage, tipping margin, and redundancy. The simulation's game score adds surviving mass, span, and material efficiency. Use the measured inputs, failure modes, and unresolved-path indications when comparing physical builds.

## Validation and limits

```sh
node scripts/profile-hogwarts-disaster.mjs --refine
```

The benchmark uses all 6,025 editable pieces in LEGO 71043, prepares the same cached moulds used by the worker, and tests both base conditions. It emits load-case timings and a hash of the failed part IDs. Gravity-only cases should agree across hazards. The 48/96/192-step runs show sensitivity to load sampling. Tests also cover eccentric reaction balance, simultaneous independent fractures, zero input, gravity tipping, floor slip, and the effect of upper-storey inertia.

With Real scale, intensity 70, a free-standing base, and 25° wind or shake direction, the 48/96/192-step failure counts were 317/327/327 for wind, 41/41/41 for ponding, and 42/42/42 for earthquake. Part IDs matched between the last two wind runs and across all three rain and earthquake runs. The default now uses 96 steps for nonzero Real scale wind on models above 1,000 parts. Every zero-input case reported the same 41 gravity-stage failures. Among the nonzero cases, the solver still flagged 1,058 wind, 181 rain, and 610 earthquake load paths for review at the corresponding default resolution.

This is a quasi-static load-path approximation. It estimates loss of equilibrium and connection failure. Timing and motion after release use illustrative playback. The model does not solve structural resonance, impacts and re-seating, water drainage, or flow around detailed mould surfaces. Real comparison still requires weighing the relevant parts and testing their joints, surface friction, and onset of failure under representative loads.
