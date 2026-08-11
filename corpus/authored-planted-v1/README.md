# InkBench authored-planted corpus v1

This tier places disclosed, deterministic defects into realistic authored Ink structure. It does not replace or modify the clean authored-project corpus, and its results must not be described as defects in the upstream work.

`the-intercept-20` is derived from inkle Ltd.'s **The Intercept** at upstream commit `2a816b56e61ce4bf02bec1c638074645bdd871e3`. The source is MIT licensed; the complete license and modification notice are retained in `the-intercept-20/LICENSE-AND-PROVENANCE.md`.

The build script `scripts/build-intercept-20.mjs` starts from the checksum-pinned clean source and applies exactly 20 mutations. The official `inklecate` 1.2.1 compiler then produces `story.ink.json` with count-all-visits enabled. The checked manifest records every source and artifact digest.

## Mutation distribution

The 20 sites span 16 knots or stitches from the opening through the endgame. Both the mutated narrative code and its private oracle declarations are distributed across four phase files, included by a fifth entrypoint file.

| Phase | Bugs | Representative fault types |
| --- | ---: | --- |
| opening/early state | 4 | duplicate choice, inventory alias, missing choice, numeric sign corruption |
| interrogation | 9 | unrelated side effect, stale reset, state contamination, wrong divert, condition bypass, impossible inventory, premature commit |
| escape/revisit | 5 | lost write, revisit side effect, loop off-by-one, irrelevant-state coupling, choice inversion |
| endgame | 2 | compound state corruption, delayed missing choice |

`manifest.json` is authoritative for each mutation's ID, bug family, fault type, trigger, observable effect, upstream line, source knot, difficulty coordinates, and variable oracle. Nineteen distinct fault-type labels are used; choice-effect inversion appears twice at substantially different depths.

## Witnesses and fairness

`witnesses.json` contains one exact choice-index and choice-text replay for every planted bug. Tests replay all 20 against the pinned compiled artifact. A mutation is rejected if its witness no longer reaches its own oracle.

Search strategies do not receive the manifest, witness paths, or oracle definitions. They receive the same ordinary Ink observation contract. The controller alone evaluates oracle variables after a transition. Exact paths remain report evidence after discovery, not search guidance.

## Commands

```sh
inkbench mutants verify
inkbench mutants run --story the-intercept-20 --algorithm coverage --budget 10000
inkbench mutants experiment --preset development --out artifacts/intercept-20
inkbench mutants experiment --preset mature --out artifacts/intercept-20-mature --resume
```

The mature preset uses isolated workers, 30 paired seeds, budgets through 10,000,000 native work units, a 1,536 MiB heap watermark, and a 30-minute per-cell guard. Its inclusion of InkCheck requires an installed `inkcheck` command or `--inkcheck-command`; unavailable adapter cells remain explicit in raw results.
