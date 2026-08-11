# InkBench authored-planted corpus v1

This tier places disclosed, deterministic defects into realistic authored Ink structure. It does not replace or modify the clean authored-project corpus, and its results must not be described as defects in the upstream work.

`the-intercept-20` is derived from inkle Ltd.'s **The Intercept** at upstream commit `2a816b56e61ce4bf02bec1c638074645bdd871e3`. The source is MIT licensed; the complete license and modification notice are retained in `the-intercept-20/LICENSE-AND-PROVENANCE.md`.

`heresy2-30` is derived from Randall Frank, Andrew Florance, and Marina Galvagni's **Heresy II** at upstream commit `37b8a7804217bb40a9f69f6fd9c173f2017d550e`. The source is CC BY 4.0; attribution, the license, and the modification notice are retained in `heresy2-30/LICENSE-AND-PROVENANCE.md`. Its 30 mutations occupy 30 locations across the debrief, base, workshop, garden, and temple source files within the complete 21-file story bundle.

The build scripts start from checksum-pinned clean sources and apply exactly 20 or 30 mutations. Official `inklecate` 1.2.1 then produces each `story.ink.json` artifact with count-all-visits enabled. The Heresy builder first maps deterministic story reachability with build-only seed 101, exposes eight control defects, and gives the remaining 22 defects exact rolling-history preconditions. The rolling history is ordinary observable state; only the oracle values remain private. Evaluation presets use untouched seeds 301–303. The build rejects the corpus unless every generated root-replay witness reaches its own oracle, and the checked manifest records every source and artifact digest.

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

Each derivative's `witnesses.json` contains one exact choice-index and choice-text replay for every planted bug. Tests replay all 50 witnesses against their pinned compiled artifacts. A mutation is rejected if its witness no longer reaches its own oracle.

Search strategies do not receive the manifest, witness paths, or oracle definitions. They receive the same ordinary Ink observation contract. The controller alone evaluates oracle variables after a transition. Exact paths remain report evidence after discovery, not search guidance.

The history-qualified mutations are intentionally adversarial but disclosed: they test rare order, revisit, and false-novelty behavior in a realistic 21-file runtime. They are not statistical claims about how frequently those bug preconditions occur in human-authored Ink projects.

## Commands

```sh
inkbench mutants verify
inkbench mutants run --story the-intercept-20 --algorithm coverage --budget 10000
inkbench mutants experiment --preset development --out artifacts/intercept-20
inkbench mutants experiment --preset mature --out artifacts/intercept-20-mature --resume
inkbench mutants run --story heresy2-30 --algorithm coverage --budget 10000
inkbench mutants experiment --preset heresy-marathon-20m --out artifacts/heresy2-30-marathon-20m --resume
inkbench mutants experiment --preset heresy-ablation-20m --out artifacts/heresy2-30-ablation-20m --resume
```

The mature preset uses isolated workers, 30 paired seeds, budgets through 10,000,000 native work units, a 1,536 MiB heap watermark, and a 30-minute per-cell guard. Its inclusion of InkCheck requires an installed `inkcheck` command or `--inkcheck-command`; unavailable adapter cells remain explicit in raw results.
