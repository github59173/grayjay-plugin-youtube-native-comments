# Testing

## Automated tests

```bash
npm run verify
```

The suite covers:

- capability extraction and fail-closed ownership;
- MWEB and legacy reaction command families;
- comments-disabled and reply-locked state;
- reopened-comment identity matching;
- create/reply/edit/delete body construction;
- edit dialog command resolution;
- stale-action refresh and bounded retry;
- mutation result and HTTP error normalization;
- current video reaction command extraction;
- fixture credential scanning;
- a fake source implementing all optional host methods.

## Live acceptance matrix

Use a dedicated test account and test each case on a normal channel and, when
available, a Brand Account:

1. create a top-level comment;
2. reply with and without an `@handle` mention;
3. edit the created comment and verify the existing text is prefilled;
4. like/unlike and dislike/remove-dislike another comment;
5. close and reopen the video, then edit/delete the owned comment;
6. open a locked thread and confirm replies remain visible while reply is
   disabled;
7. confirm comments-disabled and expired-session errors;
8. exercise video like, unlike, dislike, and removal;
9. delete every temporary comment and clear reactions.

Record request and refresh timings separately. Never add live mutation tests to
ordinary CI because they have external side effects.
