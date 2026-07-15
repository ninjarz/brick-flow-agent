# Stability and disaster model

The stability lab is a deterministic, game-oriented structural approximation. It is designed to give immediate and explainable feedback inside the editor; it is not a finite-element solver and must not be used for real-world engineering decisions.

## Static analysis

For every placed brick the analyzer derives:

- mass from its structural bounding volume;
- connection count from the existing stud, tube, mechanical-connector, and vertical-contact graph;
- support coverage from the overlap between its base and directly supporting bricks;
- load above it from vertically overlapping higher bricks;
- height ratio, grounded reachability, and cantilever risk.

The global center of mass is the mass-weighted average of brick centers. Ground-contact corners form a convex support hull. The signed distance from the center-of-mass projection to this hull becomes the tipping margin: positive is inside the support area, negative is outside.

The static score combines grounded mass (30%), tipping margin (30%), average support coverage (25%), and connection redundancy (15%). Structure X-ray colors each brick from green through yellow and orange to red, draws the support hull, and projects the center of mass to the ground.

## Dynamic disasters

Each simulation uses 90 deterministic time steps and compares environmental demand with the connection capacity of every brick. Capacity increases with connection count, support coverage, mass, and direct ground contact. A small stable hash per brick avoids every connection failing on the same frame without introducing random results.

- **Wind:** applies gust-modulated lateral pressure using exposed side area, height, wind direction, and squared intensity.
- **Heavy rain:** adds top-area load and progressively reduces connection grip.
- **Earthquake:** applies oscillating inertial load based on mass and height, with visible elastic sway.

When a brick exceeds its stress threshold, its connection fails. The graph is then traversed again from surviving ground contacts; bricks that no longer have a path to the ground also fail. Failed bricks fall and drift according to elapsed failure time and the active hazard.

## Game score

The final bridge-game-style score is weighted as follows:

| Category | Weight | Meaning |
| --- | ---: | --- |
| Structure survival | 55% | Mass that remains connected after the selected disaster |
| Static stability | 20% | Initial support, center-of-mass, and redundancy score |
| Effective span | 15% | Longest horizontal model span, capped at 16 studs |
| Material efficiency | 10% | Span achieved relative to structural mass |

Grades are `S` (90+), `A` (78+), `B` (64+), `C` (48+), and `D` below 48.

## Known limits

- Bricks are treated as rigid masses; deformation is visual rather than a full constraint solve.
- Connector capacity is relative and calibrated for gameplay, not measured ABS pull-out force.
- Aerodynamics, water pooling, friction, and collision after failure are simplified.
- The support hull is convex and can overestimate a base with large internal gaps.

Regression tests cover support hull generation, grounded versus detached structures, cantilevers, deterministic simulation, failure propagation, displacement, and score bounds.
