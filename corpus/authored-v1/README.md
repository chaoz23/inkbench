# InkBench authored-project corpus v1

This corpus adds ecological-validity checks to InkBench's generated planted-bug fixtures. Its results are reported separately: authored stories have no planted-bug oracle, so empirical coverage or runtime findings must never be counted as planted-bug discoveries.

The files are copied from InkCheck's pinned authored promotion corpus. `manifest.json` records the InkCheck source commit, each upstream repository and commit, per-file SHA-256 digests, entrypoints, licenses, and structural measures. Packaging adds a final newline to `dog-ink-adventure/binary.ink` and `heresy2/agora.ink`; the Ink story content is otherwise unchanged.

Each project also contains `story.ink.json`, compiled with the official `inklecate` 1.2.1 release using count-all-visits (`-c`). InkBench verifies the artifact digest before loading it into the pinned `inkjs` runtime. This avoids treating `inkjs` compiler compatibility as a search-algorithm result—Heresy II uses valid floating-point syntax that `inkjs` 2.4.0's compiler rejects even though official `inklecate` accepts it. The compiled JSON's missing final newline is normalized for repository packaging and disclosed in the manifest.

## Attribution

- **Dog Ink Adventure**, Earok, upstream commit `402b47c004c40c599877ae9dc75cc0aad7db887c`, MIT. See `dog-ink-adventure/LICENSE`.
- **The Intercept**, inkle Ltd., upstream commit `2a816b56e61ce4bf02bec1c638074645bdd871e3`, MIT. See `the-intercept/LICENSE-AND-PROVENANCE.md`.
- **Heresy II**, Randall Frank, upstream commit `37b8a7804217bb40a9f69f6fd9c173f2017d550e`, Creative Commons Attribution 4.0. See `heresy2/LICENSE`. `item_globals.ink` is the upstream generated build output described in the manifest.

InkBench's only story-source modification is the two trailing-newline normalizations disclosed above. Its compilation, seed control, instrumentation, and search algorithms are separate code around those works. Inclusion does not imply endorsement by the original authors.
