# Modification Record

## Upstream base

- Repository: `https://gitlab.futo.org/videostreaming/plugins/youtube`
- Commit: `36ae88e34905545d5eaa8c8152fd09a48461d756`
- Published version at import: `353`
- License: GNU Affero General Public License v3

## Functional changes

The reference implementation adds optional source methods for comment
creation, reply, edit, delete, comment reactions, commenting identity,
commenting-state discovery, and video reactions. YouTube command metadata is
collected from authenticated website responses and is refreshed only when an
action is missing or definitively stale.

The official plugin name, IDs, Browser package declaration, URLs, and version
are intentionally retained. FUTO should choose any future version and signing
metadata if the implementation is accepted upstream.

## Generated file

`YoutubeScript.js` contains a generated section composed from
`comment_mutations.js` and `video_reactions.js`. Run `npm run build` after
editing either module and `npm run verify` before committing.
