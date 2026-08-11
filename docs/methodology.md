# Benchmark methodology

InkBench's question is not “which strategy reports the largest state count?” It asks whether a strategy improves planted-bug yield per fixed work/compute budget or makes repeatable discoveries that the other strategies miss.

## Required comparisons

Run matched cells over fixture family, fixture seed, search seed/repetition, budget, runtime seed, and tool version. Preserve the raw cell even when compilation or an adapter fails.

Primary outcomes:

- probability of discovery by a fixed transition budget;
- transitions and elapsed/CPU time to first discovery;
- empirical location, choice, edge, semantic-state, variable-value, and transition coverage;
- family-level performance and difficulty coordinates;
- paired exclusive discoveries and union yield; and
- survival/time-to-discovery curves with undiscovered runs right-censored at budget.

Secondary outcomes include launches, episodes, raw save diversity, warnings/errors, and replay validity.

## Cold-start and mature resource regimes

InkSwarm has a warm-up cost: colonies must be created, selected again, and reinforced before population allocation can differ meaningfully from short random walks. Report two regimes instead of treating one small budget as universal:

- **cold-start:** 100–1,000 transitions, measuring immediate efficiency;
- **mature:** logarithmic budgets from 1,000 through 10,000,000 native work units, with memory/time stops retained as partial evidence. Ten million matches InkCheck's current local CLI default; it is a ceiling for a paired cell, not a requirement that an exhaustive story waste the entire grant.

Run mature cells in isolated processes under identical memory and time caps. Record requested versus consumed transitions, stop reason, peak process heap/RSS, peak runtime snapshot bytes, peak explicitly retained checkpoint bytes, and findings before the stop. A memory- or time-stopped cell is valid partial resource evidence but not a completed fixed-transition trial, so exclude it from probability-at-requested-budget denominators.

Cross-tool work units remain distinct. Compare InkCheck states and InkBench choice transitions through separate native-work curves plus common wall-time, CPU, peak-memory, and finding outcomes; do not manufacture a state-to-transition conversion.

The large ladder is there to expose warm-up, crossover, diminishing-return, and resource-bound behavior. It does not make the biological metaphor evidence: the minimal swarm is promoted only through paired family-level results and ablations against random, systematic, and coverage-guided controls.

## Authored-project tier

Run real stories as a separate ecological-validity analysis. Match story, search seed, runtime seed, transition budget, runtime/artifact version, and algorithm. Report empirical coverage counts, runtime findings, terminal episodes, CPU/wall cost, and paired exclusive locations/edges.

Authored stories do not have planted oracles. Do not put them in discovery-probability or survival curves, infer that coverage is bug yield, or combine their scores with the generated-fixture tier. A real-story runtime finding can become a bug result only after a story-specific oracle and expected-behavior review are added explicitly.

## Interpretation rules

- Do not pool families into a single score without also publishing the family table.
- Do not call empirical state counts “percent coverage” unless the denominator is proven.
- Do not treat a missing adapter metric as zero.
- Separate transition-budget efficiency from wall/CPU efficiency.
- Publish regressions and exclusive discoveries for every strategy.
- Freeze evaluation seeds before changing strategy parameters.
- Repeat randomized strategies; one lucky trajectory is a witness, not comparative evidence.
- Treat one-seed authored corpus smokes as plumbing checks, not comparative claims.

## Suggested research matrix

Development: 11 families × 5 fixture seeds × 3 search seeds × 3 strategies × budgets 100/500.

Candidate evaluation: at least 30 paired repetitions per family/difficulty at logarithmic budgets selected before the run. The `mature` preset supplies 30 held-out fixture/search pairs per generated family and 30 held-out search seeds per authored story. Keep the seed range frozen and report package version, git commit, Node version, platform, runtime/compiler version, resource caps, stop reasons, and full experiment configuration.

For the authored tier, repeat every randomized strategy across the same search seeds and story seed(s), retain source/compiler artifact hashes, and publish the per-story competence and complementarity tables. Expand the corpus before making community-wide generalization claims.
