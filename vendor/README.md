# Pinned upstream source

`sources.json` records the official source revisions and release identities.
The trees retain their upstream manifests, licenses and required source/resources.
Upstream Git/CI metadata, dependency directories, generated `dist` trees and tests
are not vendored. Original upstream locks are attribution/reference inputs;
the repository root npm lock supplies the actual Nix build's library/tool graph.
No OMO Slim or Billion Context npm release package is used.

`nix/prepare-source.mjs` copies these trees to the writable Nix build directory,
patches their readable configuration sources to merge the repository defaults at
lowest priority, and suppresses Billion's automatic empty-config creation.
User/project/environment precedence otherwise remains upstream's own.

Runtime build recipe (executed only during a future Nix package build):

- OMO: retain the committed version/build stamp via its generator, then run its
  `build:v2` Bun command, with host `@opencode/*` and Effect left for the final
  OpenCode workspace bundle. Only the official V1 `tool` schema helper is imported
  from `@opencode-ai/plugin/tool`; legacy SDK clients are not bundled or shipped.
- Billion: run kernel and pi-subagents' own tsup configurations, stage their
  resulting package artifacts locally, then run the upstream root tsup config
  and dist integrity gates. Declaration-only TypeScript emission is omitted:
  these are executable runtime assets, not published development libraries.
  Build identity is stamped with `sources.json`'s exact upstream revision.
- Billion's exact Zod 4.1.8 is staged below its package; OMO/personal code uses
  root Zod 4.6.7. Normal third-party dependencies are integrity-locked by npm.
- The final CLI statically imports the locally generated server entries. Billion's
  own `dist/index.js` proxy and the full required resource/dependency trees remain
  in the same package. Module URLs are rebased before the CLI's final bundle.
- Nix supplies ast-grep; ignored npm postinstall scripts never choose or fetch it.
  Host SDK/Effect copies used only as transitive build inputs are removed from
  installed assets, and compiled host imports resolve to the locked core workspace.

No build, tests, lint, typecheck or deployment was executed while preparing this
source snapshot. The dependency metadata was generated with npm's lock-only,
ignore-scripts mode.
