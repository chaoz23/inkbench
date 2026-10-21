# InkSwarm closeout

**Status: closed, 2026-10-21. The hypothesis was tested and not supported.**

InkBench was built to falsify the InkSwarm hypothesis. It did. That is the benchmark working
as designed, not a benchmark failure, and this note is the deliverable.

## The hypothesis

A finite population of explorers that allocates work toward unusual, deep, underexplored
narrative states may improve rare-state bug yield per fixed compute budget, or produce
discoveries that simpler strategies miss.

The narrow form mattered: InkSwarm never claimed to beat
[InkCheck](https://github.com/chaoz23/inkcheck)'s bounded deterministic search in general. It
claimed a complementary edge on rare, deep, or unusual states.

## What was measured

| Evidence | Finding |
|---|---|
| [v0.1 development matrix](v0.1-development-results.md) — 792 small cells | **No exclusive discovery.** Competitive on casino, loop, revisit and easy false-novelty controls; spent its budget *less* effectively than the simple baselines on rare prefixes, independent combinations, delayed causes, order, and the boring corridor. |
| [v0.1 Intercept-20 smoke](v0.1-intercept-20-smoke-results.md) | One apparent exclusive discovery on a single tiny cell — explicitly never a swarm claim without a repeated mature matrix. That matrix never cleared. |
| 20-minute matrix (120/120 canonical cells) | No advantage for the use cases the fixtures encode. |
| 60-minute matrix | Stopped at 54/120 under [#2](https://github.com/chaoz23/inkbench/issues/2) and preserved as explicitly partial. Never resumed, and it must not support a superiority claim in either direction. |

The controls were deliberately hostile to plausible swarm failure modes — casino, false-novelty,
boring-corridor, loop, delay, shallow — and across the use cases those fixtures represent, the
population approach did not earn its budget.

**What this does *not* claim.** It is not proof that no swarm-like searcher can ever help. It is
the honest result for these mechanisms, on these fixture families, at these budgets. The
`heresy2-30` fixture calibration figures are single-seed, were observed during fixture
construction, and must not be read as a ranking — see
[its calibration note](heresy2-30-calibration.md).

## What closes

- The **InkSwarm research sequence** in [milestones](milestones.md). Steps 4 and 5 — backward
  frontier credit, colony yield allocation, pruning promotion — are abandoned rather than
  pending. Nothing cleared the preregistered threshold they were gated on.
- The **persistent-swarm hypothesis** ([#8](https://github.com/chaoz23/inkbench/issues/8)): a
  longitudinal benchmark for warm, amortized search across story revisions. It existed to test
  the strongest version of the idea. With the one-shot form unsupported, the warm form is not
  worth the harness it would need.
- The `swarm-novelty` and `swarm-colony` ablation arms. They were never landed and will not be;
  they remain pinned at tag `heresy2-30-fixture-2026-08` for the record.

## What does not close

**InkBench itself.** The harness evaluates *any* searcher — `inkcheck` is an adapter, and the
authored-planted tier now carries 50 replay-verified planted bugs across two story families. Its
open validity work (oracle leakage, complete-case bias, cross-adapter regimes, corpus
representativeness) is about measurement, not about swarm, and stands on its own.

**The `swarm` searcher stays in the tree.** It is deliberately not deleted:

- it is a **baseline**, and removing it would silently change what published v0.2.0/v0.3.0
  results compared against;
- a negative result you can still reproduce is worth more than one you have to trust;
- re-running any historical matrix requires it to exist.

It is frozen at `minimal-colony-v1`. Do not extend it, and do not redefine it — the ablation
searchers were kept out of `main` precisely because they would have changed a published
algorithm's behaviour under its existing id. If a future searcher wants those mechanisms, it
should land as a **new algorithm id**, measured from scratch against these same controls.

## For anyone reading the code later

`src/searchers/swarm.ts` is live, exercised, and not dead code. It is a closed research arm
retained as a comparison baseline. Deleting it would break reproducibility of published results.
