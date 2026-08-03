/*
 * Grayjay native platform comments reference implementation, 2026-07-30.
 * Authenticated website/Innertube comment mutations. AGPL-3.0 applies.
 * This file intentionally contains no credentials and never logs request
 * headers, cookies, action tokens, comment text, or full upstream payloads.
 */

const YT_COMMENT_CAPABILITIES = Object.freeze({
    CREATE: "COMMENTS_CREATE",
    REPLY: "COMMENTS_REPLY",
    EDIT: "COMMENTS_EDIT",
    DELETE: "COMMENTS_DELETE",
    LIKE: "COMMENTS_LIKE",
    DISLIKE: "COMMENTS_DISLIKE"
});

const ytCommentPageCommandCache = Object.create(null);
const ytCommentCommentActionCache = Object.create(null);
const ytCommentDiagnosticShapeFingerprints = new Set();
const ytCommentOwnerActionShapeFingerprints = new Set();
const ytCommentDesktopShapeFingerprints = new Set();
const YT_COMMENT_MUTATION_CLIENT_TTL_MS = 10 * 60 * 1000;
let ytCommentMutationClientConfigCache = null;
let ytCommentMutationClientConfigCachedAt = 0;
let ytCommentDesktopMutationClientConfigCache = null;
let ytCommentDesktopMutationClientConfigCachedAt = 0;
let ytCommentDesktopMutationClientAccountKey = null;

function ytCommentSafeStringify(value) {
    try { return JSON.stringify(value); } catch (_) { return ""; }
}

function ytCommentFirstString() {
    for (let i = 0; i < arguments.length; i++) {
        if (typeof arguments[i] === "string" && arguments[i].length > 0)
            return arguments[i];
    }
    return null;
}

// Emits structure only: never values, tokens, ids, comment text, cookies, or
// headers. This is intentionally useful in release builds because YouTube can
// roll out a new renderer shape to a subset of accounts without warning.
function ytCommentStructuralKeyPaths(root, maximumPaths) {
    const paths = [];
    const seen = new Set();
    const limit = maximumPaths ?? 160;
    function visit(value, path, depth) {
        if (!value || typeof value !== "object" || seen.has(value) || depth > 10 || paths.length >= limit)
            return;
        seen.add(value);
        if (Array.isArray(value)) {
            if (value.length > 0)
                visit(value[0], path + "[]", depth + 1);
            return;
        }
        const keys = Object.keys(value).sort();
        for (const key of keys) {
            const childPath = path ? path + "." + key : key;
            if (/(Command|Endpoint|Renderer|ViewModel|Payload|SurfaceKey|StateKey)$/i.test(key))
                paths.push(childPath);
            visit(value[key], childPath, depth + 1);
            if (paths.length >= limit)
                break;
        }
    }
    visit(root, "", 0);
    return paths;
}

function ytCommentLogIncompleteActionShape(renderer, result) {
    if (typeof bridge === "undefined" || typeof bridge.log !== "function")
        return;
    if (result?.commands?.like && result?.commands?.unlike &&
        result?.commands?.dislike && result?.commands?.undislike)
        return;

    const surface = renderer?.engagementToolbarSurfaceEntityPayload ?? {};
    const state = renderer?.engagementToolbarStateEntityPayload ?? {};
    const entity = renderer?.commentEntityPayload ?? {};
    const menuItems = (renderer?.actionMenu?.menuRenderer?.items ?? []).map(item => {
        const rendererKey = Object.keys(item ?? {}).find(key => /Renderer$/.test(key)) ?? null;
        const itemRenderer = rendererKey ? item[rendererKey] : item;
        return {
            rendererKey,
            keys: Object.keys(itemRenderer ?? {}).sort(),
            label: {
                text: itemRenderer?.text,
                title: itemRenderer?.title,
                defaultText: itemRenderer?.defaultText,
                toggledText: itemRenderer?.toggledText,
                tooltip: itemRenderer?.tooltip,
                defaultTooltip: itemRenderer?.defaultTooltip,
                toggledTooltip: itemRenderer?.toggledTooltip,
                iconType: itemRenderer?.icon?.iconType
            },
            commands: ytCommentCollectCommands(itemRenderer).map(command => ({
                endpointKey: command.endpointKey,
                apiUrl: command.apiUrl,
                payloadKeys: Object.keys(command.payload ?? {}).sort(),
                status: command.payload?.status ?? null
            })),
            structuralPaths: ytCommentStructuralKeyPaths(itemRenderer, 60)
        };
    });
    const summary = {
        schema: 1,
        rootKeys: Object.keys(renderer ?? {}).sort(),
        entityKeys: Object.keys(entity).sort(),
        surfaceKeys: Object.keys(surface).sort(),
        stateKeys: Object.keys(state).sort(),
        structuralPaths: ytCommentStructuralKeyPaths(renderer, 160),
        presentCommands: Object.keys(result?.commands ?? {}).filter(key => Boolean(result.commands[key])).sort(),
        reaction: result?.userReaction ?? "NONE",
        menuItems,
        mutationPayloadKinds: renderer?.ytCommentDiagnosticMutationShape?.mutationPayloadKinds ?? [],
        parentStructuralPaths: renderer?.ytCommentDiagnosticMutationShape?.parentStructuralPaths ?? []
    };
    const fingerprint = ytCommentSafeStringify(summary);
    if (!fingerprint || ytCommentDiagnosticShapeFingerprints.has(fingerprint) || ytCommentDiagnosticShapeFingerprints.size >= 8)
        return;
    ytCommentDiagnosticShapeFingerprints.add(fingerprint);
    bridge.log("YT_COMMENT_ACTION_SHAPE " + fingerprint);
}

function ytCommentCollectCommands(root) {
    const results = [];
    const seen = new Set();

    function visit(value, path) {
        if (!value || typeof value !== "object" || seen.has(value))
            return;
        seen.add(value);

        if (!Array.isArray(value)) {
            const metadata = value.commandMetadata?.webCommandMetadata ?? {};
            for (const key of Object.keys(value)) {
                if (!key.endsWith("Endpoint") || !value[key] || typeof value[key] !== "object")
                    continue;
                results.push({
                    endpointKey: key,
                    payload: value[key],
                    apiUrl: ytCommentFirstString(metadata.apiUrl, value[key]?.commandMetadata?.webCommandMetadata?.apiUrl),
                    path,
                    hint: (path + " " + ytCommentSafeStringify(value)).toLowerCase()
                });
            }
        }

        if (Array.isArray(value)) {
            for (let i = 0; i < value.length; i++)
                visit(value[i], path + "[" + i + "]");
        } else {
            for (const key of Object.keys(value))
                visit(value[key], path + "." + key);
        }
    }

    visit(root, "root");
    return results;
}

function ytCommentFindCommand(commands, endpointKeys, positiveHints, negativeHints) {
    const keys = new Set(endpointKeys);
    const positives = positiveHints ?? [];
    const negatives = negativeHints ?? [];
    return commands.find(command => {
        if (!keys.has(command.endpointKey))
            return false;
        if (negatives.some(hint => command.hint.includes(hint)))
            return false;
        return positives.length === 0 || positives.some(hint => command.hint.includes(hint));
    }) ?? null;
}

function ytCommentFindLabeledCommand(root, endpointKeys, positiveHints, negativeHints) {
    const seen = new Set();
    const positives = positiveHints ?? [];
    const negatives = negativeHints ?? [];
    function visit(value) {
        if (!value || typeof value !== "object" || seen.has(value))
            return null;
        seen.add(value);

        if (!Array.isArray(value)) {
            const label = ytCommentSafeStringify({
                text: value.text,
                title: value.title,
                tooltip: value.tooltip,
                accessibility: value.accessibility,
                accessibilityData: value.accessibilityData
            }).toLowerCase();
            if (positives.some(hint => label.includes(hint)) &&
                !negatives.some(hint => label.includes(hint))) {
                const command = ytCommentFindCommand(ytCommentCollectCommands(value), endpointKeys, [], []);
                if (command)
                    return command;
            }
        }

        for (const key of Object.keys(value)) {
            const found = visit(value[key]);
            if (found)
                return found;
        }
        return null;
    }
    return visit(root);
}

function ytCommentFindLegacyReactionToggle(root, kind) {
    const seen = new Set();
    function visit(value, path) {
        if (!value || typeof value !== "object" || seen.has(value))
            return null;
        seen.add(value);

        const toggle = value?.toggleButtonRenderer;
        if (toggle) {
            const label = ytCommentSafeStringify({
                path,
                defaultTooltip: toggle.defaultTooltip,
                toggledTooltip: toggle.toggledTooltip,
                accessibility: toggle.accessibility,
                defaultText: toggle.defaultText,
                toggledText: toggle.toggledText
            }).toLowerCase();
            const matches = kind === "dislike" ? label.includes("dislike") :
                label.includes("like") && !label.includes("dislike");
            if (matches) {
                const endpointKeys = ["performCommentActionEndpoint"];
                const defaultCommand = ytCommentFindCommand(ytCommentCollectCommands(
                    toggle.defaultServiceEndpoint ?? toggle.defaultNavigationEndpoint
                ), endpointKeys, [], []);
                const toggledCommand = ytCommentFindCommand(ytCommentCollectCommands(
                    toggle.toggledServiceEndpoint ?? toggle.toggledNavigationEndpoint
                ), endpointKeys, [], []);
                if (defaultCommand || toggledCommand)
                    return { defaultCommand, toggledCommand };
            }
        }

        for (const key of Object.keys(value)) {
            const found = visit(value[key], path + "." + key);
            if (found)
                return found;
        }
        return null;
    }
    return visit(root, "root");
}

function ytCommentFindMobileMenuReactionToggle(root, kind) {
    const seen = new Set();
    function visit(value) {
        if (!value || typeof value !== "object" || seen.has(value))
            return null;
        seen.add(value);

        const toggle = value?.toggleMenuServiceItemRenderer;
        if (toggle) {
            const label = ytCommentSafeStringify({
                defaultText: toggle.defaultText,
                toggledText: toggle.toggledText,
                defaultIcon: toggle.defaultIcon,
                toggledIcon: toggle.toggledIcon
            }).toLowerCase();
            const matches = kind === "dislike" ? label.includes("dislike") :
                label.includes("like") && !label.includes("dislike");
            if (matches) {
                const endpointKeys = ["performCommentActionEndpoint"];
                const defaultCommand = ytCommentFindCommand(
                    ytCommentCollectCommands(toggle.defaultServiceEndpoint),
                    endpointKeys,
                    [],
                    []
                );
                const toggledCommand = ytCommentFindCommand(
                    ytCommentCollectCommands(toggle.toggledServiceEndpoint),
                    endpointKeys,
                    [],
                    []
                );
                if (defaultCommand || toggledCommand) {
                    return {
                        defaultCommand,
                        toggledCommand,
                        isToggled: Boolean(toggle.isToggled)
                    };
                }
            }
        }

        for (const key of Object.keys(value)) {
            const found = visit(value[key]);
            if (found)
                return found;
        }
        return null;
    }
    return visit(root);
}

function ytCommentFindMobileLikeButtonCommands(root) {
    const seen = new Set();
    function visit(value) {
        if (!value || typeof value !== "object" || seen.has(value))
            return null;
        seen.add(value);

        const renderer = value?.likeButtonRenderer;
        if (renderer) {
            const result = {
                likeStatus: String(renderer.likeStatus ?? "").toUpperCase(),
                like: ytCommentFindCommand(
                    ytCommentCollectCommands(renderer.likeCommand),
                    ["performCommentActionEndpoint"],
                    [],
                    []
                ),
                dislike: ytCommentFindCommand(
                    ytCommentCollectCommands(renderer.dislikeNavigationEndpoint),
                    ["performCommentActionEndpoint"],
                    [],
                    []
                ),
                indifferent: null
            };
            for (const endpoint of renderer.serviceEndpoints ?? []) {
                const command = ytCommentFindCommand(
                    ytCommentCollectCommands(endpoint),
                    ["performCommentActionEndpoint"],
                    [],
                    []
                );
                const status = String(command?.payload?.status ?? "").toUpperCase();
                if (status === "LIKE") result.like = command;
                else if (status === "DISLIKE") result.dislike = command;
                else if (status === "INDIFFERENT") result.indifferent = command;
            }
            if (result.like || result.dislike || result.indifferent)
                return result;
        }

        for (const key of Object.keys(value)) {
            const found = visit(value[key]);
            if (found)
                return found;
        }
        return null;
    }
    return visit(root);
}

// Reply commands can be omitted from compact MWEB entity batches and lazily
// recovered from a highlighted-comment refresh. Only explicit disabled state
// should mark a thread as locked; command absence alone is not enough.
function ytCommentFindReplyLock(root) {
    const seen = new Set();
    const lockPattern = /(?:repl(?:y|ies|ying).{0,40}(?:disabled|locked|turned off|not available)|(?:disabled|locked|turned off|not available).{0,40}repl(?:y|ies|ying))/i;

    function visit(value, path) {
        if (!value || typeof value !== "object" || seen.has(value))
            return null;
        seen.add(value);

        if (!Array.isArray(value)) {
            for (const key of Object.keys(value)) {
                const normalizedKey = key.toLowerCase();
                const child = value[key];
                if ((normalizedKey === "replydisabled" || normalizedKey === "isreplydisabled" ||
                    normalizedKey === "replyingdisabled" || normalizedKey === "isreplyingdisabled" ||
                    normalizedKey === "replylocked" || normalizedKey === "isreplylocked") && child === true) {
                    return "Replies are locked";
                }
                if (path.toLowerCase().includes("reply") &&
                    (normalizedKey === "disabled" || normalizedKey === "isdisabled") && child === true) {
                    return "Replies are locked";
                }
                if (path.toLowerCase().includes("reply") && normalizedKey === "enabled" && child === false)
                    return "Replies are locked";
            }

            const label = ytCommentSafeStringify({
                text: value.text,
                title: value.title,
                message: value.message,
                tooltip: value.tooltip,
                accessibility: value.accessibility,
                accessibilityData: value.accessibilityData
            });
            if (lockPattern.test(label))
                return "Replies are locked";
        }

        for (const key of Object.keys(value)) {
            const found = visit(value[key], path + "." + key);
            if (found)
                return found;
        }
        return null;
    }

    return visit(root, "root");
}

// MWEB represents the comment action sheet as a complete toolbar surface.
// A signed-in surface containing reaction/menu actions but no Reply action is
// not an incomplete parser result: it is how YouTube represents a readable
// thread whose reply creation is locked. Reply continuations remain valid.
function ytCommentHasCompleteReplyActionSurface(root) {
    const surface = root?.engagementToolbarSurfaceEntityPayload ??
        ytCommentFindFirstPayload(root, "engagementToolbarSurfaceEntityPayload");
    if (surface && typeof surface === "object") {
        const keys = Object.keys(surface);
        const commands = ytCommentCollectCommands(surface);
        if (keys.some(key => /(?:like|dislike|menu|report|reply|edit|delete)command/i.test(key)) ||
            commands.some(command => command.endpointKey === "performCommentActionEndpoint" ||
                command.endpointKey === "flagEndpoint" ||
                command.endpointKey === "reportEndpoint")) {
            return true;
        }
    }

    // Legacy renderers expose the same complete surface through replyButton
    // plus toolbar/actionMenu fields instead of an entity payload.
    if (root && typeof root === "object" &&
        Object.prototype.hasOwnProperty.call(root, "replyButton")) {
        return true;
    }
    return false;
}

function ytCommentSerializeCommand(command) {
    if (!command)
        return null;
    return JSON.stringify({
        endpointKey: command.endpointKey,
        apiUrl: command.apiUrl,
        payload: command.payload,
        clientMode: command.clientMode
    });
}

function ytCommentFindNamedString(root, names) {
    const wanted = new Set(names);
    const seen = new Set();
    function visit(value) {
        if (!value || typeof value !== "object" || seen.has(value))
            return null;
        seen.add(value);
        if (!Array.isArray(value)) {
            for (const key of Object.keys(value)) {
                if (wanted.has(key) && typeof value[key] === "string" && value[key].length > 0)
                    return value[key];
            }
        }
        for (const key of Object.keys(value)) {
            const found = visit(value[key]);
            if (found) return found;
        }
        return null;
    }
    return visit(root);
}

function ytCommentCollectNamedStrings(root, names, maximumDepth) {
    const wanted = new Set(names);
    const found = new Set();
    const seen = new Set();
    const depthLimit = maximumDepth ?? 8;
    function visit(value, depth) {
        if (!value || typeof value !== "object" || seen.has(value) || depth > depthLimit)
            return;
        seen.add(value);
        if (!Array.isArray(value)) {
            for (const key of Object.keys(value)) {
                if (wanted.has(key) && typeof value[key] === "string" && value[key].trim().length > 0)
                    found.add(value[key].trim());
            }
        }
        for (const key of Object.keys(value))
            visit(value[key], depth + 1);
    }
    visit(root, 0);
    return found;
}

function ytCommentAddSplitIdentityValue(target, value) {
    if (typeof value !== "string")
        return;
    // DATASYNC_ID commonly contains the selected channel and account ids as
    // one `channel||account` value. Either component can appear independently
    // in a comment author endpoint, so compare both without persisting either.
    for (const part of value.split("||")) {
        const normalized = part.trim();
        if (normalized.length > 0)
            target.add(normalized);
    }
}

function ytCommentAddChannelIdFromUrl(target, value) {
    if (typeof value !== "string")
        return;
    const match = value.match(/(?:^|\/)channel\/([^/?#]+)/i);
    if (match)
        ytCommentAddSplitIdentityValue(target, match[1]);
}

function ytCommentNormalizeIdentityText(value) {
    if (typeof value !== "string")
        return null;
    let normalized = value.trim();
    if (normalized.length === 0)
        return null;
    try { normalized = normalized.normalize("NFKC"); }
    catch (_) { }
    return normalized.toLowerCase();
}

function ytCommentNormalizeHandle(value) {
    const normalized = ytCommentNormalizeIdentityText(value);
    if (!normalized)
        return null;
    const pathMatch = normalized.match(/(?:^|\/)@([^/?#\s]+)/);
    if (pathMatch)
        return "@" + pathMatch[1];
    if (normalized.startsWith("@") && !/\s/.test(normalized))
        return normalized;
    return null;
}

function ytCommentTextValues(value) {
    const values = [];
    if (typeof value === "string")
        values.push(value);
    else if (value && typeof value === "object") {
        for (const candidate of [value.simpleText, value.content, value.label]) {
            if (typeof candidate === "string")
                values.push(candidate);
        }
        for (const run of value.runs ?? []) {
            if (typeof run?.text === "string")
                values.push(run.text);
        }
    }
    return values;
}

function ytCommentCommentAuthorRoots(entity) {
    return [
        entity?.author,
        entity?.authorEndpoint,
        entity?.authorButton,
        entity?.properties?.author,
        entity?.properties?.authorButton
    ].filter(Boolean);
}

function ytCommentCommentAuthorIds(entity) {
    const ids = new Set();
    const values = [
        entity?.author?.channelId,
        entity?.author?.channelCommand?.innertubeCommand?.browseEndpoint?.browseId,
        entity?.authorEndpoint?.browseEndpoint?.browseId
    ];
    for (const value of values)
        ytCommentAddSplitIdentityValue(ids, value);
    for (const root of ytCommentCommentAuthorRoots(entity)) {
        for (const value of ytCommentCollectNamedStrings(root, ["channelId", "externalChannelId", "browseId"]))
            ytCommentAddSplitIdentityValue(ids, value);
        for (const value of ytCommentCollectNamedStrings(root, ["url", "canonicalBaseUrl"]))
            ytCommentAddChannelIdFromUrl(ids, value);
    }
    return ids;
}

function ytCommentCurrentChannelIds(context) {
    const ids = new Set();
    for (const value of [
        context?.DELEGATED_SESSION_ID,
        context?.DATASYNC_ID,
        context?.PAGE_ID,
        context?.CHANNEL_ID,
        context?.INNERTUBE_CONTEXT?.user?.onBehalfOfUser,
        context?.INNERTUBE_CONTEXT?.user?.delegationContext?.externalChannelId,
        context?.INNERTUBE_CONTEXT?.user?.externalChannelId,
        context?.INNERTUBE_CONTEXT?.user?.channelId
    ]) ytCommentAddSplitIdentityValue(ids, value);
    for (const value of ytCommentCollectNamedStrings(
        context?.INNERTUBE_CONTEXT?.user,
        ["onBehalfOfUser", "externalChannelId", "channelId"]
    )) ytCommentAddSplitIdentityValue(ids, value);
    return ids;
}

function ytCommentCurrentChannelHandles(context) {
    const handles = new Set();
    for (const value of [
        context?.CHANNEL_HANDLE,
        context?.INNERTUBE_CONTEXT?.user?.channelHandle,
        context?.INNERTUBE_CONTEXT?.user?.handle,
        context?.LOGGED_IN_USER_NAME,
        context?.ACCOUNT_NAME
    ]) {
        const handle = ytCommentNormalizeHandle(value);
        if (handle) handles.add(handle);
    }
    return handles;
}

function ytCommentCommentAuthorHandles(entity) {
    const handles = new Set();
    for (const root of ytCommentCommentAuthorRoots(entity)) {
        for (const value of ytCommentCollectNamedStrings(
            root,
            ["handle", "channelHandle", "canonicalBaseUrl", "url", "displayName"]
        )) {
            const handle = ytCommentNormalizeHandle(value);
            if (handle) handles.add(handle);
        }
    }
    for (const value of ytCommentTextValues(entity?.authorText)) {
        const handle = ytCommentNormalizeHandle(value);
        if (handle) handles.add(handle);
    }
    return handles;
}

function ytCommentCurrentChannelNames(context) {
    const names = new Set();
    for (const value of [
        context?.LOGGED_IN_USER_NAME,
        context?.ACCOUNT_NAME,
        context?.INNERTUBE_CONTEXT?.user?.accountName,
        context?.INNERTUBE_CONTEXT?.user?.displayName,
        context?.INNERTUBE_CONTEXT?.user?.name
    ]) {
        const name = ytCommentNormalizeIdentityText(value);
        if (name && !name.startsWith("@")) names.add(name);
    }
    return names;
}

function ytCommentCommentAuthorNames(entity) {
    const names = new Set();
    const candidates = [
        entity?.author?.displayName,
        entity?.properties?.author?.displayName,
        entity?.properties?.authorButton?.displayName,
        ...ytCommentTextValues(entity?.authorText)
    ];
    for (const value of candidates) {
        const name = ytCommentNormalizeIdentityText(value);
        if (name && !name.startsWith("@")) names.add(name);
    }
    return names;
}

function ytCommentSetsIntersect(left, right) {
    for (const value of left) {
        if (right.has(value))
            return true;
    }
    return false;
}

function ytCommentMatchesCurrentChannel(entity) {
    if (typeof getClientContext !== "function")
        return false;
    let context;
    try { context = getClientContext(true) ?? {}; }
    catch (_) { return false; }
    const currentIds = ytCommentCurrentChannelIds(context);
    const authorIds = ytCommentCommentAuthorIds(entity);
    if (currentIds.size > 0 && authorIds.size > 0)
        return ytCommentSetsIntersect(currentIds, authorIds);

    const currentHandles = ytCommentCurrentChannelHandles(context);
    const authorHandles = ytCommentCommentAuthorHandles(entity);
    if (currentHandles.size > 0 && authorHandles.size > 0)
        return ytCommentSetsIntersect(currentHandles, authorHandles);

    // Display names are not unique. Use them only when neither side supplied
    // a comparable stable channel id or handle. Edit/Delete still remain
    // fail-closed below unless YouTube emitted the owner-only action command.
    const currentNames = ytCommentCurrentChannelNames(context);
    const authorNames = ytCommentCommentAuthorNames(entity);
    return currentNames.size > 0 && authorNames.size > 0 &&
        ytCommentSetsIntersect(currentNames, authorNames);
}

function ytCommentFindMutationPayload(mutations, entityKey, payloadKey) {
    if (!entityKey)
        return null;
    return mutations.find(item => {
        const payload = item?.payload?.[payloadKey];
        return payload && (item?.entityKey === entityKey || payload?.key === entityKey);
    })?.payload?.[payloadKey] ?? null;
}

function ytCommentFindAdjacentToolbarSurface(mutations, entity, entityKey) {
    const commentId = ytCommentFirstString(entity?.commentId, entity?.properties?.commentId);
    const entityIndex = mutations.findIndex(item => {
        const candidate = item?.payload?.commentEntityPayload;
        if (!candidate)
            return false;
        if (candidate === entity || (entityKey && (item?.entityKey === entityKey || candidate?.key === entityKey)))
            return true;
        return Boolean(commentId && ytCommentFirstString(candidate?.commentId, candidate?.properties?.commentId) === commentId);
    });
    if (entityIndex < 0)
        return null;

    // Entity batches currently place one toolbar surface after its comment
    // entity. Stop at the next comment entity so an upstream reorder cannot
    // accidentally grant another comment's actions.
    const candidates = [];
    for (let index = entityIndex + 1; index < mutations.length; index++) {
        const item = mutations[index];
        if (item?.payload?.commentEntityPayload)
            break;
        const surface = item?.payload?.engagementToolbarSurfaceEntityPayload;
        if (surface)
            candidates.push(surface);
    }
    return candidates.length === 1 ? candidates[0] : null;
}

function ytCommentComposeCommentActionSource(commentEntity, parent, mutations) {
    const entity = commentEntity?.commentEntityPayload ?? commentEntity ?? {};
    const surfaceKey = parent?.commentThreadRenderer?.commentViewModel?.commentViewModel?.toolbarSurfaceKey ??
        parent?.commentViewModel?.commentViewModel?.toolbarSurfaceKey ??
        parent?.commentViewModel?.toolbarSurfaceKey ??
        entity?.properties?.toolbarSurfaceKey ??
        ytCommentFindNamedString(parent, ["toolbarSurfaceKey", "toolbarSurfaceEntityKey"]);
    const stateKey = entity?.properties?.toolbarStateKey ??
        ytCommentFindNamedString(parent, ["toolbarStateKey", "toolbarStateEntityKey"]);
    const entityKey = ytCommentFirstString(
        entity?.key,
        parent?.commentThreadRenderer?.commentViewModel?.commentViewModel?.commentKey,
        parent?.commentViewModel?.commentViewModel?.commentKey,
        parent?.commentViewModel?.commentKey,
        ytCommentFindNamedString(parent, ["commentKey"])
    );
    const mutationList = Array.isArray(mutations) ? mutations : [];
    const surface = ytCommentFindMutationPayload(mutationList, surfaceKey, "engagementToolbarSurfaceEntityPayload") ??
        ytCommentFindAdjacentToolbarSurface(mutationList, entity, entityKey);
    const state = ytCommentFindMutationPayload(mutationList, stateKey, "engagementToolbarStateEntityPayload");
    const mutationPayloadKinds = Array.from(new Set(mutationList.flatMap(item =>
        item?.payload && typeof item.payload === "object" ? Object.keys(item.payload) : []
    ))).sort();

    return {
        commentEntityPayload: entity,
        commentThreadRenderer: parent?.commentThreadRenderer ?? parent,
        engagementToolbarSurfaceEntityPayload: surface,
        engagementToolbarStateEntityPayload: state,
        ytCommentDiagnosticMutationShape: {
            mutationPayloadKinds,
            parentStructuralPaths: ytCommentStructuralKeyPaths(parent, 100)
        }
    };
}

function ytCommentExtractCommentActions(renderer) {
    const commands = ytCommentCollectCommands(renderer);
    const surface = renderer?.engagementToolbarSurfaceEntityPayload ??
        ytCommentFindFirstPayload(renderer, "engagementToolbarSurfaceEntityPayload") ?? {};
    const fieldCommand = (field, keys) =>
        ytCommentFindCommand(ytCommentCollectCommands(surface?.[field]), keys, [], []);
    const reply = fieldCommand("replyCommand", ["createCommentReplyDialogEndpoint", "createCommentReplyEndpoint"]) ??
        ytCommentFindCommand(commands, ["createCommentReplyEndpoint", "createCommentReplyDialogEndpoint"], [], []);
    const entity = renderer?.commentEntityPayload ?? ytCommentFindFirstPayload(renderer, "commentEntityPayload") ?? renderer;
    const toolbarState = renderer?.engagementToolbarStateEntityPayload ??
        ytCommentFindFirstPayload(renderer, "engagementToolbarStateEntityPayload");
    const mobileLikeButton = ytCommentFindMobileLikeButtonCommands(renderer);
    const mobileMenuLikeToggle = ytCommentFindMobileMenuReactionToggle(renderer, "like");
    const mobileMenuDislikeToggle = ytCommentFindMobileMenuReactionToggle(renderer, "dislike");
    let reaction = "NONE";
    const serialized = ytCommentSafeStringify(renderer).toLowerCase();
    const likeState = String(toolbarState?.likeState ?? "").toLowerCase();
    const voteStatus = String(entity?.voteStatus ?? "").toLowerCase();
    const mobileLikeStatus = String(mobileLikeButton?.likeStatus ?? "").toLowerCase();
    if (mobileMenuDislikeToggle?.isToggled || likeState.includes("dislike") || voteStatus.includes("dislike") || mobileLikeStatus === "dislike" ||
        serialized.includes('"isdisliked":true') || serialized.includes('"likestatus":"dislike"'))
        reaction = "DISLIKE";
    else if (mobileMenuLikeToggle?.isToggled ||
        (likeState.includes("like") && !likeState.includes("indifferent") && !likeState.includes("none")) ||
        (voteStatus.includes("like") && !voteStatus.includes("dislike")) ||
        mobileLikeStatus === "like" ||
        serialized.includes('"isliked":true') || serialized.includes('"likestatus":"like"'))
        reaction = "LIKE";

    // The owner toolbar may contain an `editCommand` perform-action used only
    // by YouTube's UI state/attestation machinery. It does not carry the new
    // text and its response has no submit token. The actual mutation command
    // lives inside menuCommand -> update*DialogEndpoint -> submitButton.
    // Prefer only those text-bearing submit/dialog commands and fail closed if
    // YouTube does not emit one.
    const editEndpointKeys = [
        "updateCommentEndpoint",
        "updateCommentDialogEndpoint",
        "updateCommentReplyEndpoint",
        "updateCommentReplyDialogEndpoint"
    ];
    const edit = ytCommentFindCommand(commands, editEndpointKeys, [], []) ??
        fieldCommand("editCommand", editEndpointKeys);
    const remove = fieldCommand("deleteCommand", ["deleteCommentEndpoint", "performCommentActionEndpoint"]) ??
        ytCommentFindCommand(commands, ["deleteCommentEndpoint"], [], []) ??
        ytCommentFindLabeledCommand(renderer, ["performCommentActionEndpoint"], ["delete", "remove comment"], ["dislike", "like"]);
    const legacyLikeToggle = mobileMenuLikeToggle ?? ytCommentFindLegacyReactionToggle(renderer, "like");
    const legacyDislikeToggle = mobileMenuDislikeToggle ?? ytCommentFindLegacyReactionToggle(renderer, "dislike");
    const likeToggle = fieldCommand("likeCommand", ["performCommentActionEndpoint"]) ??
        legacyLikeToggle?.defaultCommand ?? mobileLikeButton?.like;
    const unlikeNamed = fieldCommand("unlikeCommand", ["performCommentActionEndpoint"]) ??
        legacyLikeToggle?.toggledCommand ?? mobileLikeButton?.indifferent;
    const dislikeToggle = fieldCommand("dislikeCommand", ["performCommentActionEndpoint"]) ??
        legacyDislikeToggle?.defaultCommand ?? mobileLikeButton?.dislike;
    const undislikeNamed = fieldCommand("undislikeCommand", ["performCommentActionEndpoint"]) ??
        legacyDislikeToggle?.toggledCommand ?? mobileLikeButton?.indifferent;
    const labeledLike = ytCommentFindLabeledCommand(renderer, ["performCommentActionEndpoint"], ["like"], ["unlike", "dislike"]);
    const labeledUnlike = ytCommentFindLabeledCommand(renderer, ["performCommentActionEndpoint"], ["unlike", "remove like"], ["dislike"]);
    const labeledDislike = ytCommentFindLabeledCommand(renderer, ["performCommentActionEndpoint"], ["dislike"], ["undislike", "remove dislike"]);
    const labeledUndislike = ytCommentFindLabeledCommand(renderer, ["performCommentActionEndpoint"], ["undislike", "remove dislike"], []);

    // YouTube's current entity schema reuses likeCommand/dislikeCommand for
    // the action the visible toggle performs. Once selected, that same field
    // carries the inverse action instead of moving to an *unlikeCommand field.
    let like = labeledLike;
    let unlike = unlikeNamed ?? labeledUnlike;
    let dislike = labeledDislike;
    let undislike = undislikeNamed ?? labeledUndislike;
    if (reaction === "LIKE") {
        unlike = unlike ?? likeToggle;
        if (unlikeNamed)
            like = like ?? likeToggle;
        dislike = dislike ?? dislikeToggle;
    } else if (reaction === "DISLIKE") {
        undislike = undislike ?? dislikeToggle;
        if (undislikeNamed)
            dislike = dislike ?? dislikeToggle;
        like = like ?? likeToggle;
    } else {
        like = like ?? likeToggle;
        dislike = dislike ?? dislikeToggle;
    }

    const commentId = ytCommentFirstString(entity?.commentId, entity?.properties?.commentId, renderer?.entityKey);
    const canEvaluateReplyAvailability = typeof bridge === "undefined" ||
        typeof bridge.isLoggedIn !== "function" || bridge.isLoggedIn();
    const completeReplyActionSurface = ytCommentHasCompleteReplyActionSurface(renderer) ||
        Boolean(mobileMenuLikeToggle && mobileMenuDislikeToggle);
    const replyLockReason = ytCommentFindReplyLock(renderer) ??
        (canEvaluateReplyAvailability && !reply && completeReplyActionSurface
            ? "Replies are locked"
            : null);
    const replyLocked = Boolean(replyLockReason);
    const ownerFlags = [entity?.isCurrentUser, entity?.author?.isCurrentUser, entity?.properties?.isCurrentUser]
        .filter(value => typeof value === "boolean");
    const explicitOwner = ownerFlags.some(value => value === true);
    const explicitNonOwner = ownerFlags.some(value => value === false);
    const currentChannelAuthor = ytCommentMatchesCurrentChannel(entity);
    // Owner-only menu commands are a useful legacy signal only as a pair.
    // Treating either command as ownership allowed an unrelated action found
    // elsewhere in a payload to expose Delete on other people's comments.
    const owned = Boolean(explicitOwner || currentChannelAuthor || (!explicitNonOwner && edit && remove));

    const capabilities = [];
    // Some current MWEB entity batches omit the toolbar surface containing
    // replyCommand even though the highlighted-comment refresh still returns
    // the parent-bound command. A stable comment id is sufficient for the
    // existing lazy refresh path to reacquire that exact YouTube command.
    if (!replyLocked && (reply || commentId)) capabilities.push(YT_COMMENT_CAPABILITIES.REPLY);
    if (owned && edit) capabilities.push(YT_COMMENT_CAPABILITIES.EDIT);
    // Destructive UI is fail-closed: identity matching alone does not prove
    // that YouTube supplied a delete action for the signed-in author.
    if (owned && remove)
        capabilities.push(YT_COMMENT_CAPABILITIES.DELETE);
    if (like || unlike) capabilities.push(YT_COMMENT_CAPABILITIES.LIKE);
    if (dislike || undislike) capabilities.push(YT_COMMENT_CAPABILITIES.DISLIKE);

    if (owned && typeof bridge !== "undefined" && typeof bridge.log === "function") {
        const ownerShape = ytCommentSafeStringify({
            schema: 1,
            commandEndpointKeys: Array.from(new Set(commands.map(command => command.endpointKey))).sort(),
            commands: commands.map(command => ({
                endpointKey: command.endpointKey,
                apiUrl: command.apiUrl ?? null,
                payloadKeys: Object.keys(command.payload ?? {}).sort(),
                path: command.path
            })).slice(0, 30),
            surfaceKeys: Object.keys(surface ?? {}).sort(),
            surfaceStructuralPaths: ytCommentStructuralKeyPaths(surface, 160),
            hasEditSubmit: Boolean(edit),
            hasDeleteSubmit: Boolean(remove)
        });
        if (ownerShape && !ytCommentOwnerActionShapeFingerprints.has(ownerShape) &&
            ytCommentOwnerActionShapeFingerprints.size < 8) {
            ytCommentOwnerActionShapeFingerprints.add(ownerShape);
            bridge.log("YT_COMMENT_OWNER_ACTIONS " + ownerShape);
        }
    }

    const result = {
        id: commentId,
        isOwnedByUser: owned,
        isEdited: Boolean(entity?.isEdited || entity?.properties?.isEdited || /\(edited\)/i.test(serialized)),
        replyLocked,
        replyLockReason,
        userReaction: reaction,
        capabilities,
        commands: {
            reply: ytCommentSerializeCommand(reply),
            edit: ytCommentSerializeCommand(edit),
            delete: ytCommentSerializeCommand(remove),
            like: ytCommentSerializeCommand(like),
            unlike: ytCommentSerializeCommand(unlike),
            dislike: ytCommentSerializeCommand(dislike),
            undislike: ytCommentSerializeCommand(undislike)
        }
    };
    ytCommentLogIncompleteActionShape(renderer, result);
    return result;
}

function ytCommentMarkMutationCommentOwned(comment, responseData) {
    if (!comment)
        return null;
    const entity = ytCommentFindFirstPayload(responseData, "commentEntityPayload") ??
        ytCommentFindFirstPayload(responseData, "commentRenderer");
    const commentId = ytCommentFirstString(
        comment?.id,
        comment?.context?.commentId,
        entity?.commentId,
        entity?.properties?.commentId
    );
    if (!commentId)
        return comment;

    comment.context = Object.assign({}, comment.context ?? {}, { commentId });
    comment.isOwnedByUser = true;
    // A create response proves ownership but can omit the owner menu. Keep
    // Edit discoverable so selecting it can lazily load the highlighted
    // comment; edit still fails closed unless that refresh yields update data.
    const capabilities = new Set(comment.capabilities ?? []);
    capabilities.add(YT_COMMENT_CAPABILITIES.EDIT);
    comment.capabilities = Array.from(capabilities);
    return comment;
}

function ytCommentCarryMutationOwnedState(target, source) {
    if (!target || !source?.isOwnedByUser)
        return target;
    target.context = Object.assign({}, source.context ?? {}, target.context ?? {});
    target.isOwnedByUser = true;
    target.capabilities = Array.from(new Set([
        ...(source.capabilities ?? []),
        ...(target.capabilities ?? [])
    ]));
    const commentId = ytCommentFirstString(target?.id, target?.context?.commentId, source?.id, source?.context?.commentId);
    if (commentId)
        target.context.commentId = commentId;
    return target;
}

function ytCommentRememberCommentActions(actions) {
    if (actions?.id)
        ytCommentCommentActionCache[actions.id] = actions;
}

function ytCommentApplyCommentActions(comment, actions) {
    if (!comment || !actions)
        return null;
    comment.context = Object.assign({}, comment.context ?? {});
    for (const key of Object.keys(actions.commands ?? {})) {
        if (actions.commands[key])
            comment.context[key + "Command"] = actions.commands[key];
    }
    const capabilities = new Set([...(comment.capabilities ?? []), ...(actions.capabilities ?? [])]);
    const pageLocksReplies = ytCommentCommentingState(comment.contextUrl).availability === "LOCKED";
    if (actions.replyLocked || pageLocksReplies) {
        capabilities.delete(YT_COMMENT_CAPABILITIES.REPLY);
        delete comment.context.replyCommand;
        comment.context.replyLocked = "true";
        comment.context.replyLockReason = actions.replyLockReason ??
            (pageLocksReplies ? "YouTube comments are locked for this video" : "Replies are locked");
    } else {
        delete comment.context.replyLocked;
        delete comment.context.replyLockReason;
    }
    if (!actions.isOwnedByUser) {
        capabilities.delete(YT_COMMENT_CAPABILITIES.EDIT);
        capabilities.delete(YT_COMMENT_CAPABILITIES.DELETE);
        delete comment.context.editCommand;
        delete comment.context.deleteCommand;
    }
    comment.capabilities = Array.from(capabilities);
    comment.isOwnedByUser = Boolean(actions.isOwnedByUser);
    comment.userReaction = actions.userReaction;
    return actions;
}

function ytCommentEnrichCommentDef(definition, renderer, container) {
    const actionSource = container ?? renderer;
    const actions = ytCommentExtractCommentActions(actionSource);
    const pageLocksReplies = ytCommentCommentingState(definition?.contextUrl).availability === "LOCKED";
    if (pageLocksReplies) {
        actions.replyLocked = true;
        actions.replyLockReason = "YouTube comments are locked for this video";
        actions.capabilities = (actions.capabilities ?? [])
            .filter(capability => capability !== YT_COMMENT_CAPABILITIES.REPLY);
        actions.commands.reply = null;
    }
    definition.id = actions.id ?? definition.id ?? null;
    definition.isOwnedByUser = actions.isOwnedByUser;
    definition.isEdited = actions.isEdited;
    definition.userReaction = actions.userReaction;
    definition.capabilities = actions.capabilities;
    definition.visibility = "VISIBLE";
    definition.context = Object.assign({}, definition.context ?? {});
    if (definition.id)
        definition.context.commentId = definition.id;
    if (actions.replyLocked) {
        definition.context.replyLocked = "true";
        definition.context.replyLockReason = actions.replyLockReason ?? "Replies are locked";
    }
    for (const key of Object.keys(actions.commands)) {
        if (actions.commands[key])
            definition.context[key + "Command"] = actions.commands[key];
    }
    ytCommentRememberCommentActions(actions);
    return definition;
}

function ytCommentCommentCacheKey(contextUrl) {
    const value = String(contextUrl ?? "");
    const videoMatch = value.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/)([^&#?/]+)/i);
    if (videoMatch)
        return "youtube-video:" + videoMatch[1];
    return value.replace(/:\/\/(?:www\.|m\.)?youtube\.com/i, "://youtube.com");
}

function ytCommentCommentContext(replyContinuation, useLogin, useMobile) {
    const context = { useLogin: String(useLogin), useMobile: String(useMobile) };
    if (typeof replyContinuation === "string" && replyContinuation.length > 0)
        context.replyContinuation = replyContinuation;
    return context;
}

function ytCommentCommentPermalink(contextUrl, commentId) {
    const url = String(contextUrl ?? "");
    const id = String(commentId ?? "");
    if (!url || !id)
        return null;
    const encoded = encodeURIComponent(id);
    if (/[?&]lc=/i.test(url))
        return url.replace(/([?&]lc=)[^&#]*/i, "$1" + encoded);
    return url + (url.includes("?") ? "&" : "?") + "lc=" + encoded;
}

function ytCommentFindCommentActionSource(root, commentId) {
    const wantedId = String(commentId ?? "");
    if (!root || !wantedId)
        return null;

    const seen = new Set();
    let legacyRenderer = null;
    let entityRecord = null;
    let entityMutations = null;

    function commentIdOf(value) {
        return ytCommentFirstString(value?.commentId, value?.properties?.commentId);
    }

    function visit(value) {
        if (!value || typeof value !== "object" || seen.has(value))
            return;
        seen.add(value);

        const renderer = value?.commentRenderer;
        if (!legacyRenderer && renderer && commentIdOf(renderer) === wantedId)
            legacyRenderer = renderer;

        if (Array.isArray(value)) {
            const match = value.find(item => commentIdOf(item?.payload?.commentEntityPayload) === wantedId);
            if (match && !entityRecord) {
                entityRecord = match;
                entityMutations = value;
            }
            for (const item of value)
                visit(item);
            return;
        }
        for (const key of Object.keys(value))
            visit(value[key]);
    }

    visit(root);
    if (entityRecord) {
        const entity = entityRecord.payload.commentEntityPayload;
        const entityKey = entityRecord.entityKey;
        const parentSeen = new Set();
        let parent = null;
        function findParent(value) {
            if (parent || !value || typeof value !== "object" || parentSeen.has(value))
                return;
            parentSeen.add(value);
            const key = value?.commentThreadRenderer?.commentViewModel?.commentViewModel?.commentKey ??
                value?.commentViewModel?.commentViewModel?.commentKey ??
                value?.commentViewModel?.commentKey;
            if (key === entityKey) {
                parent = value;
                return;
            }
            for (const childKey of Object.keys(value))
                findParent(value[childKey]);
        }
        findParent(root);
        return ytCommentComposeCommentActionSource(entity, parent, entityMutations);
    }
    return legacyRenderer;
}

function ytCommentRefreshCommentActions(comment, requiredKey) {
    const commentId = ytCommentFirstString(comment?.id, comment?.context?.commentId);
    const permalink = ytCommentCommentPermalink(comment?.contextUrl, commentId);
    if (!permalink || typeof requestInitialData !== "function")
        return null;

    delete ytCommentCommentActionCache[commentId];
    let actions = null;
    let desktopAttempted = false;

    // MWEB currently omits Edit from its owner menu. Resolve edit metadata from
    // the authenticated WEB renderer first instead of downloading the same
    // mobile watch page and comments page before inevitably falling back to
    // WEB. Cached edit commands still bypass this entire refresh in
    // ytCommentAcquireCommentCommand.
    if (requiredKey === "edit") {
        desktopAttempted = true;
        const desktopStartedAt = Date.now();
        let desktopActions = null;
        try { desktopActions = ytCommentRefreshDesktopEditActions(permalink, commentId); }
        catch (_) { }
        ytCommentLogCommentRefresh("desktop", {
            requiredKey,
            elapsedMs: Date.now() - desktopStartedAt,
            foundComment: Boolean(desktopActions),
            presentCommands: Object.keys(desktopActions?.commands ?? {})
                .filter(key => Boolean(desktopActions.commands[key])).sort()
        });
        if (desktopActions?.commands?.edit)
            actions = desktopActions;
    }
    if (!actions && typeof source !== "undefined" && typeof source.getComments === "function") {
        // The normal pager performs its own watch-page request and then the
        // comments /next request. Use it first; requesting initial data before
        // it duplicated the same watch-page download on every refresh.
        const pagerStartedAt = Date.now();
        try { source.getComments(permalink); }
        catch (_) { }
        const pagerActions = ytCommentCommentActionCache[commentId] ?? null;
        ytCommentLogCommentRefresh("pager", {
            requiredKey: requiredKey ?? null,
            elapsedMs: Date.now() - pagerStartedAt,
            foundComment: Boolean(pagerActions),
            presentCommands: Object.keys(pagerActions?.commands ?? {})
                .filter(key => Boolean(pagerActions.commands[key])).sort()
        });
        if (pagerActions && (!requiredKey || pagerActions.commands?.[requiredKey]))
            actions = pagerActions;
    }
    if (!actions) {
        // Compatibility fallback for sources/tests whose initial page embeds
        // the highlighted comment directly and do not expose a pager path.
        let data = null;
        const initialStartedAt = Date.now();
        try { data = requestInitialData(permalink, true, true); }
        catch (_) { }
        const actionSource = ytCommentFindCommentActionSource(data, commentId);
        actions = actionSource ? ytCommentExtractCommentActions(actionSource) : null;
        ytCommentLogCommentRefresh("initial", {
            requiredKey: requiredKey ?? null,
            elapsedMs: Date.now() - initialStartedAt,
            foundComment: Boolean(actions),
            presentCommands: Object.keys(actions?.commands ?? {})
                .filter(key => Boolean(actions.commands[key])).sort()
        });
    }
    // YouTube's current authenticated MWEB owner menu deliberately omits
    // Edit, even though WEB still exposes the real update-comment dialog.
    // Keep MWEB authoritative for every other action and use the authenticated
    // WEB surface only to acquire edit metadata when mobile could not supply
    // it. Both surfaces use Grayjay's existing cookie-backed HTTP client.
    if (requiredKey === "edit" && !actions?.commands?.edit && !desktopAttempted) {
        const desktopStartedAt = Date.now();
        let desktopActions = null;
        try { desktopActions = ytCommentRefreshDesktopEditActions(permalink, commentId); }
        catch (_) { }
        ytCommentLogCommentRefresh("desktop", {
            requiredKey,
            elapsedMs: Date.now() - desktopStartedAt,
            foundComment: Boolean(desktopActions),
            presentCommands: Object.keys(desktopActions?.commands ?? {})
                .filter(key => Boolean(desktopActions.commands[key])).sort()
        });
        if (desktopActions?.commands?.edit)
            actions = desktopActions;
    }
    if (!actions)
        return null;
    if (actions.id && actions.id !== commentId)
        return null;
    ytCommentRememberCommentActions(actions);
    return ytCommentApplyCommentActions(comment, actions);
}

function ytCommentAcquireCommentCommand(comment, key, refreshExisting) {
    const existing = ytCommentContextCommand(comment, key);
    if (existing && !refreshExisting)
        return existing;
    try { ytCommentRefreshCommentActions(comment, key); }
    catch (_) { }
    return ytCommentContextCommand(comment, key) ?? existing;
}

// Creation is not retried after ambiguous transport failures. A completed HTTP
// 400 is different: YouTube rejected the request before creation, so refreshing
// its opaque command once and resubmitting cannot duplicate a successful post.
function ytCommentSubmitWithSafeRefresh(initialCommand, refreshCommand, submitCommand) {
    let command = initialCommand;
    if (!command)
        command = refreshCommand();
    if (!command)
        return null;

    const first = submitCommand(command);
    if (first?.httpCode !== 400)
        return first;

    const refreshed = refreshCommand();
    if (!refreshed)
        return first;
    return submitCommand(refreshed);
}

function ytCommentRememberPageCommands(contextUrl, data, completeInspection) {
    const commands = ytCommentCollectCommands(data);
    const create = ytCommentFindCommand(commands, ["createCommentEndpoint", "createCommentDialogEndpoint"], [], []);
    const key = ytCommentCommentCacheKey(contextUrl);
    if (create) {
        ytCommentPageCommandCache[key] = {
            create: ytCommentSerializeCommand(create),
            inspected: true
        };
    } else if (completeInspection !== false) {
        ytCommentPageCommandCache[key] = { create: null, inspected: true };
    }
}

function ytCommentCommentingState(contextUrl) {
    const cached = ytCommentPageCommandCache[ytCommentCommentCacheKey(contextUrl)];
    const loggedIn = typeof bridge !== "undefined" && typeof bridge.isLoggedIn === "function" && bridge.isLoggedIn();
    if (!loggedIn)
        return { availability: "UNKNOWN", reason: null };
    if (cached?.create)
        return { availability: "AVAILABLE", reason: null };
    if (cached?.inspected)
        return { availability: "LOCKED", reason: "YouTube comments are locked for this video" };
    return { availability: "UNKNOWN", reason: null };
}

function ytCommentDecorateCommentPager(pager, state) {
    if (!pager || typeof pager !== "object")
        return pager;
    pager.commentingAvailability = state?.availability ?? "UNKNOWN";
    pager.commentingLockReason = state?.reason ?? null;
    return pager;
}

function ytCommentReplyThreadState(parentComment, pager) {
    if (parentComment?.context?.replyLocked === "true") {
        return {
            availability: "LOCKED",
            reason: parentComment.context.replyLockReason ?? "Replies are locked"
        };
    }
    if ((parentComment?.capabilities ?? []).includes(YT_COMMENT_CAPABILITIES.REPLY) ||
        parentComment?.context?.replyCommand) {
        return { availability: "AVAILABLE", reason: null };
    }

    const results = Array.isArray(pager?.results) ? pager.results : [];
    if (results.some(comment =>
        (comment?.capabilities ?? []).includes(YT_COMMENT_CAPABILITIES.REPLY) ||
        comment?.context?.replyCommand)) {
        return { availability: "AVAILABLE", reason: null };
    }
    if (results.length > 0 && results.every(comment => comment?.context?.replyLocked === "true")) {
        return {
            availability: "LOCKED",
            reason: results.find(comment => comment?.context?.replyLockReason)?.context?.replyLockReason ??
                "Replies are locked"
        };
    }
    return { availability: "UNKNOWN", reason: null };
}

function ytCommentIsLockedCommentingError(error) {
    const message = String(error?.message ?? error ?? "");
    return /comments?.{0,32}(?:turned off|disabled|locked|not available)|(?:turned off|disabled|locked).{0,32}comments?/i.test(message);
}

function ytCommentMutationResult(options) {
    return Object.assign({
        success: false,
        deleted: false,
        reaction: "NONE",
        retryable: false,
        visibility: "UNKNOWN"
    }, options ?? {});
}

function ytCommentLogMutationTiming(timing) {
    if (typeof bridge === "undefined" || typeof bridge.log !== "function")
        return;
    bridge.log("YT_COMMENT_TIMING " + JSON.stringify(timing));
}

function ytCommentLogCommentRefresh(stage, details) {
    if (typeof bridge === "undefined" || typeof bridge.log !== "function")
        return;
    bridge.log("YT_COMMENT_REFRESH " + JSON.stringify(Object.assign({ stage }, details ?? {})));
}

function ytCommentValidateText(message) {
    if (typeof message !== "string" || message.trim().length === 0)
        return ytCommentMutationResult({ errorCode: "INVALID_TEXT", message: "Comment text cannot be empty" });
    if (message.length > 10000)
        return ytCommentMutationResult({ errorCode: "TEXT_TOO_LONG", message: "Comment text is too long" });
    return null;
}

function ytCommentNormalizeHttpFailure(code) {
    if (code === 401)
        return ytCommentMutationResult({ httpCode: code, errorCode: "SESSION_EXPIRED", message: "The YouTube session expired" });
    if (code === 403)
        return ytCommentMutationResult({ httpCode: code, errorCode: "NOT_AUTHORIZED", message: "YouTube did not authorize this comment action" });
    if (code === 404)
        return ytCommentMutationResult({ httpCode: code, errorCode: "COMMENT_NOT_FOUND", message: "The comment no longer exists" });
    if (code === 429)
        return ytCommentMutationResult({ httpCode: code, errorCode: "RATE_LIMITED", retryable: true, message: "YouTube temporarily rate limited comment actions" });
    if (code >= 500)
        return ytCommentMutationResult({ httpCode: code, errorCode: "NETWORK_ERROR", retryable: true, message: "YouTube temporarily rejected the request" });
    return ytCommentMutationResult({ httpCode: code, errorCode: "UNKNOWN", message: "YouTube rejected the comment action" });
}

function ytCommentIsMobileWebClient(clientConfig) {
    const client = clientConfig?.INNERTUBE_CONTEXT?.client ?? {};
    // Current authenticated m.youtube.com ytcfg responses identify the client
    // as MWEB but do not consistently include the optional `platform` field.
    // Requiring that hint misclassifies a valid MWEB context as desktop and
    // mixes an MWEB request body with www.youtube.com/client-name 1 headers.
    return String(client.clientName ?? "").toUpperCase() === "MWEB";
}

function ytCommentIsDesktopWebClient(clientConfig) {
    const client = clientConfig?.INNERTUBE_CONTEXT?.client ?? {};
    return String(client.clientName ?? "").toUpperCase() === "WEB";
}

function ytCommentCurrentAccountKey(clientConfig) {
    return ytCommentFirstString(
        clientConfig?.DELEGATED_SESSION_ID,
        clientConfig?.DATASYNC_ID,
        clientConfig?.INNERTUBE_CONTEXT?.user?.onBehalfOfUser,
        clientConfig?.INNERTUBE_CONTEXT?.user?.delegationContext?.externalChannelId
    );
}

// Authenticated mobile pages already contain the current ytcfg. Remember that
// configuration while comments load so a later mutation does not download and
// parse m.youtube.com again on the user's submit path.
function ytCommentRememberMutationClientConfig(clientConfig) {
    if (!clientConfig?.INNERTUBE_CONTEXT || !clientConfig?.INNERTUBE_API_KEY ||
        !ytCommentIsMobileWebClient(clientConfig))
        return false;
    ytCommentMutationClientConfigCache = clientConfig;
    ytCommentMutationClientConfigCachedAt = Date.now();
    if (typeof _clientContextAuth !== "undefined")
        _clientContextAuth = clientConfig;
    return true;
}

// Grayjay persists plugin save-state between starts. That state is useful for
// fast reads, but YouTube rotates its website client version frequently and
// rejects mutations when a saved WEB context is sent to an MWEB endpoint.
// Refresh the authenticated mobile ytcfg lazily, cache it briefly, and update
// the in-memory auth context used by the plugin's existing request helpers.
function ytCommentGetMutationClientConfig(forceRefresh) {
    let current = null;
    try { current = getClientContext(true) ?? null; }
    catch (_) { }

    const now = Date.now();
    const currentAccount = ytCommentCurrentAccountKey(current);
    const cachedAccount = ytCommentCurrentAccountKey(ytCommentMutationClientConfigCache);
    if (!forceRefresh && ytCommentMutationClientConfigCache &&
        now - ytCommentMutationClientConfigCachedAt < YT_COMMENT_MUTATION_CLIENT_TTL_MS &&
        currentAccount === cachedAccount) {
        return ytCommentMutationClientConfigCache;
    }

    try {
        if (typeof requestClientConfig === "function" &&
            (typeof bridge === "undefined" || bridge.isLoggedIn())) {
            const refreshed = requestClientConfig(true, true);
            if (ytCommentRememberMutationClientConfig(refreshed)) {
                return refreshed;
            }
        }
    } catch (_) { }

    return current;
}

function ytCommentRememberDesktopMutationClientConfig(clientConfig, accountKey) {
    if (!clientConfig?.INNERTUBE_CONTEXT || !clientConfig?.INNERTUBE_API_KEY ||
        !ytCommentIsDesktopWebClient(clientConfig))
        return false;
    ytCommentDesktopMutationClientConfigCache = clientConfig;
    ytCommentDesktopMutationClientConfigCachedAt = Date.now();
    ytCommentDesktopMutationClientAccountKey = accountKey ?? ytCommentCurrentAccountKey(clientConfig);
    return true;
}

// WEB is an edit-only compatibility surface. Do not replace
// `_clientContextAuth`: normal Grayjay reads and all non-edit mutations remain
// on the authenticated MWEB context selected by the plugin.
function ytCommentGetDesktopMutationClientConfig(forceRefresh) {
    let current = null;
    try { current = getClientContext(true) ?? null; }
    catch (_) { }

    const now = Date.now();
    const currentAccount = ytCommentCurrentAccountKey(current);
    const cachedAccountMatches = currentAccount && ytCommentDesktopMutationClientAccountKey
        ? currentAccount === ytCommentDesktopMutationClientAccountKey
        : !currentAccount && !ytCommentDesktopMutationClientAccountKey;
    if (!forceRefresh && ytCommentDesktopMutationClientConfigCache && cachedAccountMatches &&
        now - ytCommentDesktopMutationClientConfigCachedAt < YT_COMMENT_MUTATION_CLIENT_TTL_MS) {
        return ytCommentDesktopMutationClientConfigCache;
    }

    try {
        if (typeof requestClientConfig === "function" &&
            (typeof bridge === "undefined" || bridge.isLoggedIn())) {
            // Grayjay captures the authenticated MWEB authorization header.
            // A WEB ytcfg is public client metadata, so fetch it without
            // attaching that origin-bound header; authenticated edit requests
            // are sent through the mobile origin below.
            const refreshed = requestClientConfig(false, false);
            if (ytCommentRememberDesktopMutationClientConfig(refreshed, currentAccount))
                return refreshed;
        }
    } catch (_) { }
    return null;
}

function ytCommentFirstContinuationToken(itemSection) {
    for (const item of itemSection?.contents ?? []) {
        const token = item?.continuationItemRenderer?.continuationEndpoint
            ?.continuationCommand?.token ??
            item?.continuationItemRenderer?.button?.buttonRenderer?.command
                ?.continuationCommand?.token;
        if (typeof token === "string" && token.length > 0)
            return token;
    }
    return null;
}

function ytCommentFindCommentsContinuation(initialData) {
    const contents = initialData?.contents ?? {};
    const results = contents?.twoColumnWatchNextResults?.results?.results?.contents ??
        contents?.singleColumnWatchNextResults?.results?.results?.contents ?? [];
    for (const item of results) {
        const section = item?.itemSectionRenderer;
        if (section?.targetId === "comments-section") {
            const token = ytCommentFirstContinuationToken(section);
            if (token)
                return token;
        }
    }

    const panels = initialData?.engagementPanels ?? [];
    for (const panel of panels) {
        const renderer = panel?.engagementPanelSectionListRenderer;
        if (renderer?.panelIdentifier !== "engagement-panel-comments-section")
            continue;
        const sections = renderer?.content?.sectionListRenderer?.contents ?? [];
        for (const item of sections) {
            const section = item?.itemSectionRenderer;
            if (section?.sectionIdentifier !== "comment-item-section")
                continue;
            const token = ytCommentFirstContinuationToken(section);
            if (token)
                return token;
        }
    }
    return null;
}

function ytCommentTagActionsClientMode(actions, clientMode) {
    if (!actions?.commands)
        return actions;
    for (const key of Object.keys(actions.commands)) {
        const serialized = actions.commands[key];
        if (!serialized)
            continue;
        try {
            const command = typeof serialized === "string" ? JSON.parse(serialized) : serialized;
            command.clientMode = clientMode;
            actions.commands[key] = ytCommentSerializeCommand(command);
        } catch (_) { }
    }
    return actions;
}

function ytCommentDesktopWatchUrl(permalink) {
    const value = String(permalink ?? "");
    if (value.includes("://m.youtube.com"))
        return value.replace("://m.youtube.com", "://www.youtube.com");
    return value;
}

function ytCommentLogDesktopCommentShape(root, commentId) {
    if (typeof bridge === "undefined" || typeof bridge.log !== "function")
        return;
    const seen = new Set();
    const counts = {
        commentRenderer: 0,
        commentViewModel: 0,
        commentEntityPayload: 0,
        engagementToolbarSurfaceEntityPayload: 0
    };
    let matchedLegacy = false;
    let matchedEntity = false;
    function visit(value) {
        if (!value || typeof value !== "object" || seen.has(value))
            return;
        seen.add(value);
        if (value.commentRenderer) {
            counts.commentRenderer++;
            matchedLegacy = matchedLegacy ||
                ytCommentFirstString(value.commentRenderer?.commentId,
                    value.commentRenderer?.properties?.commentId) === commentId;
        }
        if (value.commentViewModel)
            counts.commentViewModel++;
        if (value.commentEntityPayload) {
            counts.commentEntityPayload++;
            matchedEntity = matchedEntity ||
                ytCommentFirstString(value.commentEntityPayload?.commentId,
                    value.commentEntityPayload?.properties?.commentId) === commentId;
        }
        if (value.engagementToolbarSurfaceEntityPayload)
            counts.engagementToolbarSurfaceEntityPayload++;
        for (const key of Object.keys(value))
            visit(value[key]);
    }
    visit(root);
    const mutations = root?.frameworkUpdates?.entityBatchUpdate?.mutations ?? [];
    const targetIndex = mutations.findIndex(item =>
        ytCommentFirstString(item?.payload?.commentEntityPayload?.commentId,
            item?.payload?.commentEntityPayload?.properties?.commentId) === commentId
    );
    const targetRecord = targetIndex >= 0 ? mutations[targetIndex] : null;
    const targetEntity = targetRecord?.payload?.commentEntityPayload ?? null;
    const neighborhood = targetIndex < 0 ? [] : mutations
        .slice(Math.max(0, targetIndex - 4), Math.min(mutations.length, targetIndex + 7))
        .map((item, index) => ({
            offset: Math.max(0, targetIndex - 4) + index - targetIndex,
            recordKeys: Object.keys(item ?? {}).sort(),
            payloadKinds: Object.keys(item?.payload ?? {}).sort(),
            structuralPaths: ytCommentStructuralKeyPaths(item?.payload, 100)
        }));
    const summary = {
        schema: 1,
        rootKeys: Object.keys(root ?? {}).sort(),
        counts,
        matchedLegacy,
        matchedEntity,
        targetRecordKeys: Object.keys(targetRecord ?? {}).sort(),
        targetEntityKeys: Object.keys(targetEntity ?? {}).sort(),
        targetPropertyKeys: Object.keys(targetEntity?.properties ?? {}).sort(),
        targetStructuralPaths: ytCommentStructuralKeyPaths(targetEntity, 140),
        neighborhood,
        endpointKeys: Array.from(new Set(ytCommentCollectCommands(root)
            .map(command => command.endpointKey))).sort(),
        structuralPaths: ytCommentStructuralKeyPaths(root, 180)
    };
    const fingerprint = ytCommentSafeStringify(summary);
    if (!fingerprint || ytCommentDesktopShapeFingerprints.has(fingerprint) ||
        ytCommentDesktopShapeFingerprints.size >= 4)
        return;
    ytCommentDesktopShapeFingerprints.add(fingerprint);
    bridge.log("YT_COMMENT_DESKTOP_SHAPE " + fingerprint);
}

function ytCommentRefreshDesktopEditActions(permalink, commentId) {
    if (typeof requestInitialData !== "function" || typeof http === "undefined")
        return null;
    const clientConfig = ytCommentGetDesktopMutationClientConfig(false);
    if (!clientConfig)
        return null;

    const initialData = requestInitialData(ytCommentDesktopWatchUrl(permalink), false, true);
    let actionSource = ytCommentFindCommentActionSource(initialData, commentId);
    let actions = actionSource ? ytCommentExtractCommentActions(actionSource) : null;
    if (!actions?.commands?.edit) {
        const continuation = ytCommentFindCommentsContinuation(initialData);
        if (!continuation)
            return null;
        const transport = ytCommentMutationTransport(clientConfig, true);
        const url = transport.baseUrl + "/youtubei/v1/next?key=" +
            encodeURIComponent(clientConfig.INNERTUBE_API_KEY) + "&prettyPrint=false";
        const response = http.POST(url, JSON.stringify({
            context: clientConfig.INNERTUBE_CONTEXT,
            continuation
        }), transport.headers, true);
        if (!response?.isOk) {
            ytCommentLogHttpFailure(response, "/youtubei/v1/next", transport, { continuation: true });
            return null;
        }
        let data = null;
        try { data = response.body ? JSON.parse(response.body) : {}; }
        catch (_) { return null; }
        actionSource = ytCommentFindCommentActionSource(data, commentId);
        actions = actionSource ? ytCommentExtractCommentActions(actionSource) : null;
        if (!actions?.commands?.edit)
            ytCommentLogDesktopCommentShape(data, commentId);
    }
    if (!actions)
        return null;
    if (actions?.id && actions.id !== commentId)
        return null;
    return ytCommentTagActionsClientMode(actions, "WEB");
}

function ytCommentMutationTransport(clientConfig, useMobileAuthOrigin) {
    const useMobile = ytCommentIsMobileWebClient(clientConfig);
    const mobileOrigin = useMobile || Boolean(useMobileAuthOrigin);
    const client = clientConfig?.INNERTUBE_CONTEXT?.client ?? {};
    const headers = getAuthContextHeaders(mobileOrigin, "application/json");
    headers["x-origin"] = mobileOrigin ? URL_BASE_M : URL_BASE;
    headers["x-youtube-client-name"] = useMobile ? "2" : "1";
    if (client.clientVersion)
        headers["x-youtube-client-version"] = String(client.clientVersion);
    if (clientConfig?.SESSION_INDEX !== undefined && clientConfig?.SESSION_INDEX !== null)
        headers["x-goog-authuser"] = String(clientConfig.SESSION_INDEX);
    if (clientConfig?.DELEGATED_SESSION_ID)
        headers["x-goog-pageid"] = clientConfig.DELEGATED_SESSION_ID;
    if (client.visitorData)
        headers["X-Goog-Visitor-Id"] = client.visitorData;
    return {
        baseUrl: mobileOrigin ? URL_BASE_M : URL_BASE,
        headers,
        clientName: String(client.clientName ?? "UNKNOWN"),
        clientVersion: String(client.clientVersion ?? "UNKNOWN")
    };
}

function ytCommentLogHttpFailure(response, apiUrl, transport, requestBody) {
    if (typeof bridge === "undefined" || typeof bridge.log !== "function")
        return;
    let upstreamCode = null;
    let upstreamStatus = null;
    let upstreamReasons = [];
    try {
        const body = response?.body ? JSON.parse(response.body) : null;
        upstreamCode = body?.error?.code ?? null;
        upstreamStatus = body?.error?.status ?? null;
        upstreamReasons = (body?.error?.errors ?? [])
            .map(error => error?.reason)
            .filter(reason => typeof reason === "string")
            .slice(0, 4);
    } catch (_) { }
    bridge.log("YT_COMMENT_HTTP_FAILURE " + JSON.stringify({
        httpCode: response?.code ?? 0,
        apiUrl,
        clientName: transport?.clientName ?? "UNKNOWN",
        clientVersion: transport?.clientVersion ?? "UNKNOWN",
        requestFields: Object.keys(requestBody ?? {}).sort(),
        hasReplyParams: typeof requestBody?.createReplyParams === "string" && requestBody.createReplyParams.length > 0,
        upstreamCode,
        upstreamStatus,
        upstreamReasons
    }));
}

function ytCommentFallbackApiUrl(endpointKey) {
    // Isolated compatibility fallback. Metadata-emitted apiUrl always wins.
    switch (endpointKey) {
        case "createCommentEndpoint": return "/youtubei/v1/comment/create_comment";
        case "createCommentReplyEndpoint": return "/youtubei/v1/comment/create_comment_reply";
        case "updateCommentEndpoint": return "/youtubei/v1/comment/update_comment";
        case "updateCommentReplyEndpoint": return "/youtubei/v1/comment/update_comment_reply";
        case "deleteCommentEndpoint":
        case "performCommentActionEndpoint": return "/youtubei/v1/comment/perform_comment_action";
        default: return null;
    }
}

function ytCommentBuildMutationRequest(serializedCommand, message) {
    const command = typeof serializedCommand === "string" ? JSON.parse(serializedCommand) : serializedCommand;
    if (!command?.endpointKey || !command?.payload)
        throw new Error("Missing comment action metadata");

    const body = {};
    switch (command.endpointKey) {
        case "createCommentEndpoint":
            body.createCommentParams = command.payload.createCommentParams;
            body.commentText = message;
            break;
        case "createCommentReplyEndpoint":
            // YouTube names the parent-bound token `createReplyParams` in both
            // current MWEB entity toolbars and legacy reply-dialog renderers.
            // `createCommentReplyParams` is not a recognized request field;
            // JSON.stringify silently omitted its undefined value and caused
            // an INVALID_ARGUMENT response with no reply token in the body.
            body.createReplyParams = ytCommentFirstString(
                command.payload.createReplyParams,
                command.payload.createCommentReplyParams
            );
            if (!body.createReplyParams)
                throw new Error("Missing reply action metadata");
            body.commentText = message;
            break;
        case "updateCommentEndpoint":
            body.updateCommentParams = command.payload.updateCommentParams;
            if (!body.updateCommentParams)
                throw new Error("Missing edit action metadata");
            body.commentText = message;
            break;
        case "updateCommentReplyEndpoint":
            body.updateReplyParams = command.payload.updateReplyParams;
            if (!body.updateReplyParams)
                throw new Error("Missing reply edit action metadata");
            body.commentText = message;
            break;
        case "deleteCommentEndpoint":
            body.deleteCommentParams = command.payload.deleteCommentParams;
            break;
        case "performCommentActionEndpoint":
            body.actions = [command.payload.action];
            break;
        default:
            throw new Error("Unsupported comment endpoint metadata");
    }
    return {
        apiUrl: command.apiUrl ?? ytCommentFallbackApiUrl(command.endpointKey),
        body
    };
}

function ytCommentResolveDialogCommand(serializedCommand, mutationClientConfig) {
    let command;
    try {
        command = typeof serializedCommand === "string" ? JSON.parse(serializedCommand) : serializedCommand;
    } catch (_) {
        return { error: ytCommentMutationResult({ errorCode: "UPSTREAM_RESPONSE_CHANGED", message: "YouTube provided unreadable comment action metadata" }) };
    }
    if (command?.endpointKey === "createCommentEndpoint" || command?.endpointKey === "createCommentReplyEndpoint" ||
        command?.endpointKey === "updateCommentEndpoint" || command?.endpointKey === "updateCommentReplyEndpoint")
        return { command: ytCommentSerializeCommand(command) };

    const dialogMap = {
        createCommentDialogEndpoint: ["createCommentParams", "createCommentEndpoint", "/youtubei/v1/comment/create_comment_dialog"],
        createCommentReplyDialogEndpoint: ["createReplyParams", "createCommentReplyEndpoint", "/youtubei/v1/comment/create_comment_reply_dialog"],
        updateCommentDialogEndpoint: ["updateCommentParams", "updateCommentEndpoint", "/youtubei/v1/comment/update_comment_dialog"],
        updateCommentReplyDialogEndpoint: ["updateReplyParams", "updateCommentReplyEndpoint", "/youtubei/v1/comment/update_comment_reply_dialog"]
    };
    const dialog = dialogMap[command?.endpointKey];
    if (!dialog)
        return { command: serializedCommand };

    // Current web responses often embed the final submit command directly in
    // the dialog renderer. Prefer it over a second dialog request; the outer
    // dialog endpoint does not necessarily carry *CommentParams anymore.
    const inlineSubmit = ytCommentFindCommand(ytCommentCollectCommands(command?.payload), [dialog[1]], [], []);
    if (inlineSubmit) {
        inlineSubmit.clientMode = command.clientMode;
        return { command: ytCommentSerializeCommand(inlineSubmit) };
    }

    try {
        if (typeof bridge === "undefined" || !bridge.isLoggedIn())
            return { error: ytCommentMutationResult({ errorCode: "AUTH_REQUIRED", message: "Sign in to YouTube before commenting" }) };
        const clientConfig = mutationClientConfig ?? ytCommentGetMutationClientConfig(false);
        if (!clientConfig?.INNERTUBE_CONTEXT || !clientConfig?.INNERTUBE_API_KEY)
            return { error: ytCommentMutationResult({ errorCode: "ACCOUNT_OR_CHANNEL_NOT_SELECTED", message: "Select a YouTube channel before commenting" }) };

        const parameterKey = dialog[0];
        const body = { context: clientConfig.INNERTUBE_CONTEXT };
        body[parameterKey] = command?.payload?.[parameterKey];
        if (!body[parameterKey])
            return { error: ytCommentMutationResult({ errorCode: "UPSTREAM_RESPONSE_CHANGED", message: "YouTube did not provide usable comment dialog metadata" }) };
        const transport = ytCommentMutationTransport(clientConfig, command.clientMode === "WEB");
        const apiUrl = command.apiUrl ?? dialog[2];
        const separator = apiUrl.includes("?") ? "&" : "?";
        const url = transport.baseUrl + apiUrl + separator + "key=" + encodeURIComponent(clientConfig.INNERTUBE_API_KEY) + "&prettyPrint=false";
        const response = http.POST(url, JSON.stringify(body), transport.headers, true);
        if (!response?.isOk) {
            ytCommentLogHttpFailure(response, apiUrl, transport, body);
            return { error: ytCommentNormalizeHttpFailure(response?.code ?? 0) };
        }
        const data = response.body ? JSON.parse(response.body) : {};
        const submit = ytCommentFindCommand(ytCommentCollectCommands(data), [dialog[1]], [], []);
        if (!submit)
            return { error: ytCommentMutationResult({ errorCode: "UPSTREAM_RESPONSE_CHANGED", message: "YouTube did not provide the final comment action" }) };
        submit.clientMode = command.clientMode;
        return { command: ytCommentSerializeCommand(submit) };
    } catch (_) {
        return { error: ytCommentMutationResult({ errorCode: "NETWORK_ERROR", message: "The YouTube comment dialog request did not complete" }) };
    }
}

function ytCommentFindFirstPayload(root, key) {
    const seen = new Set();
    function visit(value) {
        if (!value || typeof value !== "object" || seen.has(value))
            return null;
        seen.add(value);
        if (value[key])
            return value[key];
        for (const childKey of Object.keys(value)) {
            const found = visit(value[childKey]);
            if (found) return found;
        }
        return null;
    }
    return visit(root);
}

function ytCommentResponseVisibility(data) {
    const text = ytCommentSafeStringify(data).toLowerCase();
    if (text.includes("held for review") || text.includes("pending moderation"))
        return "HELD_FOR_REVIEW";
    return "ACKNOWLEDGED";
}

function ytCommentParseResponseComment(contextUrl, data) {
    const renderer = ytCommentFindFirstPayload(data, "commentRenderer");
    if (renderer && typeof extractCommentRenderer_Comment === "function")
        return extractCommentRenderer_Comment(contextUrl, renderer, renderer.replyCount ?? 0, null, true, true);

    const entity = ytCommentFindFirstPayload(data, "commentEntityPayload");
    if (!entity || typeof Comment === "undefined")
        return null;
    let definition = {
        contextUrl,
        author: new PlatformAuthorLink(
            new PlatformID(PLATFORM, entity?.author?.channelId ?? null, config.id, PLATFORM_CLAIMTYPE),
            entity?.author?.displayName ?? "",
            entity?.author?.channelCommand?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url ?? "",
            entity?.author?.avatarThumbnailUrl ?? null
        ),
        message: entity?.properties?.content?.content ?? "",
        rating: new RatingLikes(0),
        date: 0,
        replyCount: 0,
        context: {}
    };
    definition = ytCommentEnrichCommentDef(definition, entity, data);
    return new Comment(definition);
}

function ytCommentSubmitCommand(contextUrl, serializedCommand, message, desiredReaction, deleted) {
    const startedAt = Date.now();
    let endpointKey = "UNKNOWN";
    let requestStartedAt = startedAt;
    let responseReceivedAt = startedAt;
    try {
        if (typeof bridge === "undefined" || !bridge.isLoggedIn())
            return ytCommentMutationResult({ errorCode: "AUTH_REQUIRED", message: "Sign in to YouTube before commenting" });
        let requestedClientMode = null;
        try {
            requestedClientMode = (typeof serializedCommand === "string" ?
                JSON.parse(serializedCommand) : serializedCommand)?.clientMode ?? null;
        } catch (_) { }
        const clientConfig = requestedClientMode === "WEB"
            ? ytCommentGetDesktopMutationClientConfig(false)
            : ytCommentGetMutationClientConfig(false);
        if (!clientConfig?.INNERTUBE_CONTEXT || !clientConfig?.INNERTUBE_API_KEY)
            return ytCommentMutationResult({ errorCode: "ACCOUNT_OR_CHANNEL_NOT_SELECTED", message: "Select a YouTube channel before commenting" });
        const primaryClientConfig = requestedClientMode === "WEB"
            ? ytCommentGetMutationClientConfig(false)
            : clientConfig;
        const activeChannel = ytCommentFirstString(
            clientConfig.DELEGATED_SESSION_ID,
            clientConfig.DATASYNC_ID,
            clientConfig.INNERTUBE_CONTEXT?.user?.onBehalfOfUser,
            clientConfig.INNERTUBE_CONTEXT?.user?.delegationContext?.externalChannelId,
            primaryClientConfig?.DELEGATED_SESSION_ID,
            primaryClientConfig?.DATASYNC_ID,
            primaryClientConfig?.INNERTUBE_CONTEXT?.user?.onBehalfOfUser,
            primaryClientConfig?.INNERTUBE_CONTEXT?.user?.delegationContext?.externalChannelId
        );
        if (!activeChannel)
            return ytCommentMutationResult({ errorCode: "ACCOUNT_OR_CHANNEL_NOT_SELECTED", message: "Select a YouTube channel before commenting" });

        const resolved = ytCommentResolveDialogCommand(serializedCommand, clientConfig);
        if (resolved.error)
            return resolved.error;
        try {
            endpointKey = JSON.parse(resolved.command)?.endpointKey ?? "UNKNOWN";
        } catch (_) { }
        const request = ytCommentBuildMutationRequest(resolved.command, message);
        if (!request.apiUrl)
            return ytCommentMutationResult({ errorCode: "UPSTREAM_RESPONSE_CHANGED", message: "YouTube did not provide usable comment action metadata" });
        request.body.context = clientConfig.INNERTUBE_CONTEXT;
        const transport = ytCommentMutationTransport(clientConfig, requestedClientMode === "WEB");
        const separator = request.apiUrl.includes("?") ? "&" : "?";
        const url = transport.baseUrl + request.apiUrl + separator + "key=" + encodeURIComponent(clientConfig.INNERTUBE_API_KEY) + "&prettyPrint=false";
        requestStartedAt = Date.now();
        const response = http.POST(url, JSON.stringify(request.body), transport.headers, true);
        responseReceivedAt = Date.now();
        if (!response?.isOk) {
            ytCommentLogHttpFailure(response, request.apiUrl, transport, request.body);
            return ytCommentNormalizeHttpFailure(response?.code ?? 0);
        }

        let data = {};
        try { data = response.body ? JSON.parse(response.body) : {}; }
        catch (_) {
            return ytCommentMutationResult({ errorCode: "UPSTREAM_RESPONSE_CHANGED", message: "YouTube returned an unreadable comment response" });
        }
        const visibility = deleted ? "DELETED" : ytCommentResponseVisibility(data);
        const parsedComment = deleted ? null : ytCommentParseResponseComment(contextUrl, data);
        const createsComment = endpointKey === "createCommentEndpoint" ||
            endpointKey === "createCommentReplyEndpoint";
        if (createsComment && parsedComment)
            ytCommentMarkMutationCommentOwned(parsedComment, data);
        const completedAt = Date.now();
        ytCommentLogMutationTiming({
            endpointKey,
            success: true,
            totalMs: completedAt - startedAt,
            preparationMs: requestStartedAt - startedAt,
            httpMs: responseReceivedAt - requestStartedAt,
            responseProcessingMs: completedAt - responseReceivedAt,
            returnedComment: Boolean(parsedComment),
            returnedOwned: Boolean(parsedComment?.isOwnedByUser)
        });
        return ytCommentMutationResult({
            success: true,
            comment: parsedComment,
            deleted: Boolean(deleted),
            reaction: desiredReaction ?? "NONE",
            visibility,
            message: visibility === "HELD_FOR_REVIEW" ? "YouTube held the comment for review" : null
        });
    } catch (_) {
        const completedAt = Date.now();
        ytCommentLogMutationTiming({
            endpointKey,
            success: false,
            totalMs: completedAt - startedAt,
            preparationMs: requestStartedAt - startedAt,
            httpMs: Math.max(0, responseReceivedAt - requestStartedAt),
            responseProcessingMs: Math.max(0, completedAt - responseReceivedAt)
        });
        return ytCommentMutationResult({
            errorCode: "NETWORK_ERROR",
            retryable: false,
            message: "The YouTube comment request did not complete"
        });
    }
}

function ytCommentContextCommand(comment, key) {
    return comment?.context?.[key + "Command"] ?? null;
}

function ytCommentIsEditSubmitCommand(serializedCommand) {
    try {
        const endpointKey = (typeof serializedCommand === "string" ?
            JSON.parse(serializedCommand) : serializedCommand)?.endpointKey;
        return endpointKey === "updateCommentEndpoint" ||
            endpointKey === "updateCommentDialogEndpoint" ||
            endpointKey === "updateCommentReplyEndpoint" ||
            endpointKey === "updateCommentReplyDialogEndpoint";
    } catch (_) {
        return false;
    }
}

function ytCommentAcquireCreateCommand(contextUrl, refreshExisting) {
    const cacheKey = ytCommentCommentCacheKey(contextUrl);
    const cached = ytCommentPageCommandCache[cacheKey]?.create;
    if (cached && !refreshExisting)
        return cached;
    if (refreshExisting)
        delete ytCommentPageCommandCache[cacheKey];
    try {
        if (typeof source !== "undefined" && typeof source.getComments === "function")
            source.getComments(contextUrl);
        if (!ytCommentPageCommandCache[cacheKey]?.create) {
            const initialData = requestInitialData(contextUrl, true, true);
            ytCommentRememberPageCommands(contextUrl, initialData);
        }
    } catch (_) { }
    return ytCommentPageCommandCache[cacheKey]?.create ?? cached ?? null;
}

function ytCommentGetCommentingIdentity() {
    if (typeof bridge === "undefined" || !bridge.isLoggedIn())
        return null;
    const context = getClientContext(true) ?? {};
    return ytCommentFirstString(
        context.LOGGED_IN_USER_NAME,
        context.ACCOUNT_NAME,
        context.CHANNEL_HANDLE,
        context.INNERTUBE_CONTEXT?.user?.onBehalfOfUser,
        context.INNERTUBE_CONTEXT?.user?.delegationContext?.externalChannelId,
        "YouTube channel"
    );
}

if (typeof source !== "undefined") {
    const ytCommentOriginalGetComments = source.getComments;
    if (typeof ytCommentOriginalGetComments === "function") {
        source.getComments = function(contentUrl) {
            try {
                const pager = ytCommentOriginalGetComments.call(source, contentUrl);
                return ytCommentDecorateCommentPager(pager, ytCommentCommentingState(contentUrl));
            } catch (error) {
                if (!ytCommentIsLockedCommentingError(error) || typeof CommentPager !== "function")
                    throw error;
                return ytCommentDecorateCommentPager(
                    new CommentPager([], false),
                    { availability: "LOCKED", reason: "YouTube comments are locked for this video" }
                );
            }
        };
    }

    const ytCommentOriginalGetSubComments = source.getSubComments;
    if (typeof ytCommentOriginalGetSubComments === "function") {
        source.getSubComments = function(comment) {
            const parsedComment = typeof comment === "string" ? JSON.parse(comment) : comment;
            const pager = ytCommentOriginalGetSubComments.call(source, parsedComment);
            return ytCommentDecorateCommentPager(pager, ytCommentReplyThreadState(parsedComment, pager));
        };
    }

    source.getCommentingIdentity = ytCommentGetCommentingIdentity;

    source.createComment = function(contentUrl, message) {
        const invalid = ytCommentValidateText(message);
        if (invalid) return invalid;
        if (!bridge.isLoggedIn())
            return ytCommentMutationResult({ errorCode: "AUTH_REQUIRED", message: "Sign in to YouTube before commenting" });
        const result = ytCommentSubmitWithSafeRefresh(
            ytCommentAcquireCreateCommand(contentUrl, false),
            () => ytCommentAcquireCreateCommand(contentUrl, true),
            command => ytCommentSubmitCommand(contentUrl, command, message, "NONE", false)
        );
        if (!result)
            return ytCommentMutationResult({ errorCode: "ACTION_NOT_SUPPORTED", message: "YouTube did not provide a comment creation action for this video" });
        return result;
    };

    source.replyToComment = function(comment, message) {
        const invalid = ytCommentValidateText(message);
        if (invalid) return invalid;
        const result = ytCommentSubmitWithSafeRefresh(
            ytCommentAcquireCommentCommand(comment, "reply", false),
            () => ytCommentAcquireCommentCommand(comment, "reply", true),
            command => ytCommentSubmitCommand(comment.contextUrl, command, message, "NONE", false)
        );
        if (!result)
            return ytCommentMutationResult({ errorCode: "ACTION_NOT_SUPPORTED", message: "Reply metadata is no longer available" });
        return result;
    };

    source.editComment = function(comment, message) {
        const invalid = ytCommentValidateText(message);
        if (invalid) return invalid;
        if (!comment?.isOwnedByUser)
            return ytCommentMutationResult({ errorCode: "NOT_AUTHORIZED", message: "Only the owner can edit this comment" });
        const acquiredCommand = ytCommentAcquireCommentCommand(comment, "edit", false);
        // A missing command already caused one complete lazy refresh inside
        // ytCommentAcquireCommentCommand. Do not repeat that expensive lookup. Only
        // force an additional refresh when an older plugin left a non-submit
        // UI command cached on the comment.
        const initialCommand = ytCommentIsEditSubmitCommand(acquiredCommand)
            ? acquiredCommand
            : (acquiredCommand ? ytCommentAcquireCommentCommand(comment, "edit", true) : null);
        if (!ytCommentIsEditSubmitCommand(initialCommand))
            return ytCommentMutationResult({ errorCode: "ACTION_NOT_SUPPORTED", message: "Edit metadata is no longer available" });
        const result = ytCommentSubmitWithSafeRefresh(
            initialCommand,
            () => {
                const refreshed = ytCommentAcquireCommentCommand(comment, "edit", true);
                return ytCommentIsEditSubmitCommand(refreshed) ? refreshed : null;
            },
            command => ytCommentSubmitCommand(comment.contextUrl, command, message, comment.userReaction, false)
        );
        if (!result)
            return ytCommentMutationResult({ errorCode: "ACTION_NOT_SUPPORTED", message: "Edit metadata is no longer available" });
        // The host updates the existing JSComment only after this acknowledged
        // success. Avoid returning YouTube's frequently partial edit renderer,
        // which can omit author/rating fields required by the host model.
        if (result?.success)
            result.comment = null;
        return result;
    };

    source.deleteComment = function(comment) {
        if (!comment?.isOwnedByUser)
            return ytCommentMutationResult({ errorCode: "NOT_AUTHORIZED", message: "Only the owner can delete this comment" });
        const command = ytCommentAcquireCommentCommand(comment, "delete");
        if (!command)
            return ytCommentMutationResult({ errorCode: "ACTION_NOT_SUPPORTED", message: "Delete metadata is no longer available" });
        return ytCommentSubmitCommand(comment.contextUrl, command, null, "NONE", true);
    };

    source.likeComment = function(comment, enabled) {
        const command = ytCommentAcquireCommentCommand(comment, enabled ? "like" : "unlike");
        if (!command)
            return ytCommentMutationResult({ errorCode: "ACTION_NOT_SUPPORTED", message: "Like action metadata is no longer available" });
        return ytCommentSubmitCommand(comment.contextUrl, command, null, enabled ? "LIKE" : "NONE", false);
    };

    source.dislikeComment = function(comment, enabled) {
        const command = ytCommentAcquireCommentCommand(comment, enabled ? "dislike" : "undislike");
        if (!command)
            return ytCommentMutationResult({ errorCode: "ACTION_NOT_SUPPORTED", message: "Dislike action metadata is no longer available" });
        return ytCommentSubmitCommand(comment.contextUrl, command, null, enabled ? "DISLIKE" : "NONE", false);
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        YT_COMMENT_CAPABILITIES,
        ytCommentCollectCommands,
        ytCommentFindLabeledCommand,
        ytCommentFindLegacyReactionToggle,
        ytCommentFindMobileMenuReactionToggle,
        ytCommentFindMobileLikeButtonCommands,
        ytCommentFindReplyLock,
        ytCommentHasCompleteReplyActionSurface,
        ytCommentCommentAuthorIds,
        ytCommentCurrentChannelIds,
        ytCommentMatchesCurrentChannel,
        ytCommentComposeCommentActionSource,
        ytCommentCommentCacheKey,
        ytCommentCommentContext,
        ytCommentCommentPermalink,
        ytCommentFindCommentActionSource,
        ytCommentRefreshCommentActions,
        ytCommentAcquireCommentCommand,
        ytCommentSubmitWithSafeRefresh,
        ytCommentRememberPageCommands,
        ytCommentCommentingState,
        ytCommentDecorateCommentPager,
        ytCommentReplyThreadState,
        ytCommentIsLockedCommentingError,
        ytCommentIsEditSubmitCommand,
        ytCommentIsMobileWebClient,
        ytCommentIsDesktopWebClient,
        ytCommentRememberMutationClientConfig,
        ytCommentGetMutationClientConfig,
        ytCommentRememberDesktopMutationClientConfig,
        ytCommentGetDesktopMutationClientConfig,
        ytCommentFindCommentsContinuation,
        ytCommentTagActionsClientMode,
        ytCommentRefreshDesktopEditActions,
        ytCommentMutationTransport,
        ytCommentMarkMutationCommentOwned,
        ytCommentCarryMutationOwnedState,
        ytCommentApplyCommentActions,
        ytCommentExtractCommentActions,
        ytCommentEnrichCommentDef,
        ytCommentBuildMutationRequest,
        ytCommentResolveDialogCommand,
        ytCommentSubmitCommand,
        ytCommentFindFirstPayload,
        ytCommentNormalizeHttpFailure,
        ytCommentResponseVisibility,
        ytCommentValidateText
    };
}
