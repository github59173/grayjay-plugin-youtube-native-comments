# Contributing

This repository is a reference implementation derived from FUTO's official
YouTube plugin. Keep changes suitable for eventual upstream review.

## Required checks

```bash
npm run build
npm run verify
git diff --check
```

## Engineering rules

- Keep Android UI and Polycentric behavior out of this repository.
- Use only Grayjay's existing authentication and package model.
- Treat YouTube commands and continuation tokens as opaque, short-lived data.
- Never log or commit cookies, authorization headers, visitor/session values,
  comment text, or complete authenticated responses.
- Do not automatically retry comment creation or replies after an ambiguous
  transport failure; doing so can duplicate user content.
- Require explicit ownership and current action metadata for edit/delete.
- Add sanitized tests for every newly supported renderer or command family.
- Rebuild `YoutubeScript.js` after changing either reviewable module.

Contributions intended for FUTO must additionally follow the official
[Grayjay contribution guide](https://github.com/futo-org/grayjay-android/blob/master/CONTRIBUTION.md)
and sign the [FUTO CLA](https://cla.futo.tech/).
