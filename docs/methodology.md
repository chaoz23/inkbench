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

## Interpretation rules

- Do not pool families into a single score without also publishing the family table.
- Do not call empirical state counts “percent coverage” unless the denominator is proven.
- Do not treat a missing adapter metric as zero.
- Separate transition-budget efficiency from wall/CPU efficiency.
- Publish regressions and exclusive discoveries for every strategy.
- Freeze evaluation seeds before changing strategy parameters.
- Repeat randomized strategies; one lucky trajectory is a witness, not comparative evidence.

## Suggested research matrix

Development: 11 families × 5 fixture seeds × 3 search seeds × 3 strategies × budgets 100/500.

Candidate evaluation: at least 30 paired repetitions per family/difficulty at logarithmic budgets selected before the run. Keep a held-out seed range and report package version, git commit, Node version, platform, runtime/compiler version, and full experiment configuration.
