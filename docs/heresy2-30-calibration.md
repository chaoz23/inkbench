# Heresy II-30 fixture calibration

This is fixture-validation evidence, not a comparative result. It checks that the 30-bug derivative is reachable, internally diverse, and not already saturated by a tiny development run.

- Build-only reachability/search seed: 101.
- Development smoke seed: 201.
- Frozen marathon seeds: 301, 302, 303; not run during fixture construction.
- Artifact: official `inklecate` 1.2.1 output, with one exact verified root replay per bug.
- Layout: 30 defects at 30 knots in five narrative files within the complete 21-file Heresy II runtime.
- Trigger mix: eight exposed controls and 22 exact observable rolling-history preconditions.

At 250 choice transitions, the seed-201 smoke found 6 bugs with random, 11 with systematic, 22 with simple coverage, 2 with novelty-only swarm, 14 with colony-only swarm, and 15 with colony-plus-rogues swarm. At 5,000 transitions, a second smoke found 13, 11, 22, and 20 bugs for random, systematic, coverage, and full swarm respectively.

The useful conclusion is only that the vertical slice runs and leaves unresolved bugs at 5,000 transitions. The result is single-seed, was observed during fixture construction, excludes InkCheck, and must not be used to rank strategies. The 20-minute matrix on untouched seeds is the first protocol-calibration run; promotion gates still apply before any 60-minute interpretation.
