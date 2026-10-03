# Local release artifacts

This directory holds desktop release archives produced by the repository's release tooling. Generated archives are ignored by Git.

Use `npm run release:desktop` when a local desktop archive is needed. For a complete browser/project-page/desktop release, follow the root [RELEASING.md](../RELEASING.md) procedure and use the assembled `dist/` output.

Publish a qualified archive through the chosen release host. Do not commit generated binaries as part of routine maintenance.
