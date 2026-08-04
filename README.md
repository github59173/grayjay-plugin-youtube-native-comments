# Grayjay YouTube Native Platform Comments Reference

This repository is an unofficial, review-oriented extension of FUTO's
YouTube plugin. It demonstrates the plugin half of native platform comments
and video reactions for Grayjay. It is not an official FUTO release and is not
signed by FUTO.

The branch starts at upstream YouTube plugin commit
`36ae88e34905545d5eaa8c8152fd09a48461d756` (published plugin version 353).
The corresponding Grayjay host implementation is maintained in the companion
`grayjay-native-platform-comments` repository.

## Implemented capabilities

- authenticated top-level comment creation;
- replies, including `@handle` mention-prefill support from the host;
- owned-comment editing and deletion;
- comment like, unlike, dislike, and remove-dislike actions;
- ownership recovery after a video is reopened;
- explicit comments-disabled and reply-locked state;
- authenticated video like/dislike state and mutation;
- Return YouTube Dislike count availability for the host's platform row;
- configurable SponsorBlock timeline colors and opacity for the existing seven
  skip categories;
- sanitized action metadata and normalized mutation failures;
- current MWEB command extraction with limited WEB fallback for edit metadata.

The implementation uses Grayjay's existing `Http` and optional `Browser`
packages. It does not add a Google developer API, OAuth client, proxy, or
credential store.

## Repository layout

- `YoutubeScript.js` – installable generated plugin script;
- `comment_mutations.js` – reviewable comment command and transport module;
- `video_reactions.js` – reviewable video reaction module;
- `sponsorblock.js` – SponsorBlock category colors, filtering, and chapter merging;
- `scripts/embed-modules.mjs` – embeds all reviewable modules in the installable script;
- `tests/` – deterministic, sanitized Node tests;
- `fixtures/` – self-contained sanitized responses and a fake source used by
  tests; no parent development workspace is required;
- `YoutubeConfig.json` and `YoutubeUnstableConfig.json` – official source
  identities with a source accent color added.

## Build and test

Node.js 20 or newer is required.

```bash
npm run build
npm run verify
```

`npm run verify` fails if `YoutubeScript.js` is stale and then runs all unit
tests. No live account mutation is performed by the automated test suite.

## Live validation

Live testing must use a dedicated test account. Record the source commit,
Grayjay commit, Android API level, account type, and test video. Remove every
temporary comment and reaction when testing is complete. Never commit cookies,
authorization headers, visitor/session values, raw authenticated responses, or
real test-account identifiers.

See [CONTRIBUTING.md](CONTRIBUTING.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and
[docs/TESTING.md](docs/TESTING.md).

## Licensing and upstream status

The plugin remains licensed under AGPL-3.0; see [LICENSE](LICENSE). FUTO's
official source is at
<https://gitlab.futo.org/videostreaming/plugins/youtube>. Contributions intended
for FUTO must follow its contribution process and contributor license
agreement. This repository does not claim FUTO endorsement.
