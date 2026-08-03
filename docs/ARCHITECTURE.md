# Architecture

## Read path

The official plugin loads the watch page, obtains comment continuations, and
maps YouTube renderer/entity data into `PlatformComment` objects. The native
mutation implementation observes the action commands already attached to
those authenticated response surfaces.

## Mutation path

1. The authenticated mobile watch/comment response is inspected recursively.
2. Create, reply, edit, delete, like, unlike, dislike, and remove-dislike
   commands are classified by their endpoint payload and API path.
3. Only the minimum command payload required for a later action is retained in
   the comment's opaque string context.
4. At mutation time the current MWEB Innertube context is attached and the
   request is sent using Grayjay's authenticated `Http` bridge.
5. The response is normalized into the host's mutation result model.
6. Missing or definitively stale actions can be refreshed once from a stable
   highlighted-comment URL. Create/reply are not retried after an ambiguous
   network outcome.

WEB metadata is used only where current MWEB surfaces provide an edit dialog
launcher but not its final submit command. The mutation remains within
Grayjay's existing source authentication model.

## Ownership

Ownership is derived on every load from stable channel IDs when available,
then normalized handles, with display-name matching used only as a final weak
fallback. A stable ID mismatch overrides a matching display name. Edit and
delete remain hidden until both ownership and the corresponding action command
are established.

## Locked state

Readable reply continuations are independent from reply availability. A thread
may expose replies while its action surface explicitly omits or disables reply
creation. The plugin reports that distinction rather than suppressing the
existing replies.

## Video reactions

Video reactions are separate from Polycentric opinions. The plugin exposes
YouTube's current like/dislike state and action commands; the Android host
decides how to render the two independent stores. Return YouTube Dislike is
used only for an estimated video dislike count, not comment dislike counts.
