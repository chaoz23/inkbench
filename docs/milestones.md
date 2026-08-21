# Milestones

## v0.1.0 — credible vertical slice

- Versioned fixture, observation, strategy, run, and dataset schemas.
- Seeded generators for all initial adversarial families.
- In-process runtime with exact choice-index repro paths.
- Random, systematic, simple coverage, and minimal InkSwarm strategies.
- Optional InkCheck CLI adapter.
- Repeated fixed-budget experiments with raw records, probability tables, Kaplan–Meier survival points, competence maps, and complementarity.
- Cross-platform CI and deterministic regression tests.
- Pinned, licensed three-project authored corpus with official compiled artifacts and separate coverage/complementarity reporting.

## v0.2.0 — measurement validity

- Resource-bounded isolated workers with heap/time guards, streamed progress, partial evidence, and execution-fingerprint-safe matrix resume. **Implemented.**
- Explicit checkpoint ownership and separate process/snapshot/checkpoint/coverage memory accounting.
- Cold-start versus mature logarithmic-budget regimes through 10 million native work units with 30 paired held-out repetitions.
- Official `inklecate` compile/replay validation and compiler-version provenance.
- Multiple bug/oracle classes, multi-bug fixtures, and exhaustive small-fixture ground truth.
- Root-replay and checkpoint-restore budget regimes.
- External-process CPU accounting beyond current worker-local CPU and parent-observed wall time.
- Frozen training/validation/evaluation seed partitions, structural-seed replication, counterbalanced serial schedules, and preregistration files. **Initial generated/authored/mutant contract implemented; a truly blind external holdout remains open.**
- Statistical intervals and paired significance/effect-size reporting. **Wilson intervals and honest observed-prefix survival are implemented; paired effect sizes and informative-censoring models remain open.**

Implemented ahead of the remaining v0.2 items: first-class planned wall-time budgets, 20/60-minute marathon presets, oracle-neutral InkCheck replay scoring, globally elapsed InkCheck evidence timestamps with pass-local work labels, and a lazy coverage-priority heap suitable for long runs.

## v0.3.0 — corpus expansion and adapters

- Deterministic static/runtime corpus-complexity coordinates, a checked public scale envelope, and an aggregate-only private/local analyzer. **Implemented; broader licensed and owner-authorized evidence remains open.**
- Broader real public Ink story corpus with licensing/provenance records and representativeness analysis. **External acquisition remains open.**
- Stable adapter SDK and conformance suite.
- Fully automated InkCheck adapter installation/version pinning.
- Importable adapters for future searchers and hosted runners.

## v0.4.0 — longitudinal maintenance value

- Deterministic 1–30 revision streams spanning text, branch, threshold, bug introduction/fix/reintroduction, rare history, revisit, local refactor, and broad invalidating refactor edits. **Implemented.**
- Cold, warm, periodic-rebuild, persistent-swarm, and no-rogue arms with fully charged replay/rebase and bounded portable route corpora. **Implemented.**
- Atomic exact resume, revision-bound witnesses, learning curves, edit-class competence, complementarity, storage, and break-even accounting. **Implemented.**
- Repeated validation and blind evaluation sequences demonstrating creator-cost value. **Evidence remains open.**

## InkSwarm research sequence

Only promote a mechanism after a benchmark shows the failure it addresses:

1. establish minimal novelty + saturation + saved deep colonies + rogues;
2. measure boring-corridor, casino, false-novelty, delayed, loop, revisit, and combination failures;
3. test one mechanism at a time with ablations;
4. add backward frontier credit, colony yield allocation, and pruning only when paired evidence clears a preregistered threshold; and
5. retain random/systematic floors so gains never erase critical baseline discoveries unnoticed.
