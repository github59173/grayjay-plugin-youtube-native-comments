"use strict";

// Native video reactions are intentionally separate from Polycentric opinions.
// The Android host combines the two stores in the selector; this module only
// discovers and executes the authenticated platform action emitted by YouTube.

const YVR_CACHE_TTL_MS = 2 * 60 * 1000;
const yvrCache = Object.create(null);

function yvrVideoId(value) {
    const text = String(value ?? "");
    if (typeof extractVideoIDFromUrl === "function") {
        try {
            const extracted = extractVideoIDFromUrl(text);
            if (extracted) return extracted;
        } catch (_) { }
    }
    const match = text.match(/[?&]v=([A-Za-z0-9_-]{6,})/) ??
        text.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) ??
        text.match(/^([A-Za-z0-9_-]{6,})$/);
    return match?.[1] ?? null;
}

function yvrWatchUrl(value) {
    const id = yvrVideoId(value);
    return id ? "https://m.youtube.com/watch?v=" + encodeURIComponent(id) : String(value ?? "");
}

function yvrPayloadVideoId(payload) {
    return payload?.target?.videoId ?? payload?.videoId ??
        payload?.target?.watchEndpoint?.videoId ?? null;
}

function yvrApiUrl(value) {
    return value?.commandMetadata?.webCommandMetadata?.apiUrl ??
        value?.innertubeCommand?.commandMetadata?.webCommandMetadata?.apiUrl ?? null;
}

function yvrClassifyCommand(endpointKey, payload, apiUrl) {
    const api = String(apiUrl ?? "").toLowerCase();
    const status = String(payload?.status ?? "").toUpperCase();
    if (api.includes("/like/removelike") || status === "INDIFFERENT") return "remove";
    if (api.includes("/like/dislike") || status === "DISLIKE") return "dislike";
    if (api.endsWith("/like/like") || status === "LIKE") return "like";
    if (endpointKey === "removeLikeEndpoint") return "remove";
    if (endpointKey === "dislikeEndpoint") return "dislike";
    if (endpointKey === "likeEndpoint") return "like";
    return null;
}

function yvrInspect(root, expectedVideoId) {
    const commands = {like: null, dislike: null, remove: null};
    const seen = new Set();
    let reaction = "NONE";
    let explicitReaction = false;

    function reactionFromTogglePath(path) {
        for (let index = path.length - 1; index >= 0; index--) {
            const key = String(path[index] ?? "").toLowerCase();
            if (key.startsWith("dislikebutton")) return "DISLIKE";
            if (key.startsWith("likebutton")) return "LIKE";
        }
        return null;
    }

    function visit(value, path, inheritedApiUrl) {
        if (!value || typeof value !== "object" || seen.has(value)) return;
        seen.add(value);
        const apiUrl = yvrApiUrl(value) ?? inheritedApiUrl;
        const pathText = path.join(".").toLowerCase();
        const videoActionPath = pathText.includes("videoactions") ||
            pathText.includes("slimvideoactionbar") ||
            pathText.includes("segmentedlikedislike");

        const status = String(value.likeStatus ?? "").toUpperCase();
        if (videoActionPath && ["LIKE", "DISLIKE", "INDIFFERENT"].includes(status)) {
            reaction = status === "INDIFFERENT" ? "NONE" : status;
            explicitReaction = true;
        }
        if (videoActionPath && value.isToggled === true) {
            const toggledReaction = reactionFromTogglePath(path);
            if (toggledReaction) {
                reaction = toggledReaction;
                explicitReaction = true;
            }
        }

        for (const endpointKey of ["likeEndpoint", "dislikeEndpoint", "removeLikeEndpoint"]) {
            const payload = value[endpointKey];
            if (!payload || typeof payload !== "object") continue;
            const targetId = yvrPayloadVideoId(payload);
            if (expectedVideoId && targetId && targetId !== expectedVideoId) continue;
            const action = yvrClassifyCommand(endpointKey, payload, apiUrl);
            if (!action) continue;
            commands[action] = {
                endpointKey,
                payload,
                apiUrl: apiUrl ?? (action === "like"
                    ? "/youtubei/v1/like/like"
                    : action === "dislike"
                        ? "/youtubei/v1/like/dislike"
                        : "/youtubei/v1/like/removelike")
            };
        }

        for (const key of Object.keys(value))
            visit(value[key], path.concat(key), apiUrl);
    }

    visit(root, [], null);
    return {
        reaction: explicitReaction ? reaction : "NONE",
        commands,
        canLike: Boolean(commands.like && commands.remove),
        canDislike: Boolean(commands.dislike && commands.remove)
    };
}

function yvrStateResult(entry, options) {
    options = options ?? {};
    return {
        available: Boolean(entry?.canLike || entry?.canDislike),
        reaction: entry?.reaction ?? "NONE",
        canLike: Boolean(entry?.canLike),
        canDislike: Boolean(entry?.canDislike),
        message: options.message ?? null,
        errorCode: options.errorCode ?? null
    };
}

function yvrMutationResult(options) {
    options = options ?? {};
    return {
        success: Boolean(options.success),
        reaction: options.reaction ?? "NONE",
        retryable: Boolean(options.retryable),
        message: options.message ?? null,
        errorCode: options.errorCode ?? null
    };
}

function yvrFetchState(contentUrl, forceRefresh) {
    const videoId = yvrVideoId(contentUrl);
    if (!videoId)
        return {error: yvrStateResult(null, {
            errorCode: "ACTION_NOT_SUPPORTED",
            message: "This is not a supported YouTube video URL"
        })};
    if (typeof bridge !== "undefined" && !bridge.isLoggedIn())
        return {error: yvrStateResult(null, {
            errorCode: "AUTH_REQUIRED",
            message: "Sign in to YouTube to use YouTube reactions"
        })};

    const cached = yvrCache[videoId];
    if (!forceRefresh && cached && Date.now() - cached.fetchedAt < YVR_CACHE_TTL_MS)
        return {entry: cached};
    try {
        if (typeof requestInitialData !== "function")
            return {error: yvrStateResult(null, {
                errorCode: "ACTION_NOT_SUPPORTED",
                message: "YouTube reaction metadata is unavailable"
            })};
        const initialData = requestInitialData(yvrWatchUrl(contentUrl), true, true);
        const inspected = yvrInspect(initialData, videoId);
        const entry = Object.assign(inspected, {videoId, fetchedAt: Date.now()});
        if (!entry.canLike && !entry.canDislike)
            return {error: yvrStateResult(entry, {
                errorCode: "ACTION_NOT_SUPPORTED",
                message: "YouTube did not provide usable video reaction actions"
            })};
        yvrCache[videoId] = entry;
        return {entry};
    } catch (_) {
        return {error: yvrStateResult(null, {
            errorCode: "NETWORK_ERROR",
            message: "The YouTube reaction state could not be loaded"
        })};
    }
}

function yvrNormalizeHttpFailure(code) {
    if (code === 401 || code === 403)
        return yvrMutationResult({errorCode: "AUTH_REQUIRED", message: "YouTube did not authorize this reaction"});
    if (code === 429)
        return yvrMutationResult({errorCode: "RATE_LIMITED", retryable: true, message: "YouTube temporarily rate limited reactions"});
    if (code >= 500)
        return yvrMutationResult({errorCode: "NETWORK_ERROR", retryable: true, message: "YouTube temporarily rejected the reaction"});
    return yvrMutationResult({errorCode: "UNKNOWN", message: "YouTube rejected the reaction"});
}

function yvrSubmit(entry, desiredReaction) {
    const command = desiredReaction === "LIKE" ? entry.commands.like :
        desiredReaction === "DISLIKE" ? entry.commands.dislike : entry.commands.remove;
    if (!command)
        return yvrMutationResult({
            errorCode: "ACTION_NOT_SUPPORTED",
            message: "YouTube did not provide the required reaction action"
        });
    try {
        if (typeof ytCommentGetMutationClientConfig !== "function" ||
            typeof ytCommentMutationTransport !== "function" || typeof http === "undefined")
            return yvrMutationResult({
                errorCode: "ACTION_NOT_SUPPORTED",
                message: "YouTube reaction transport is unavailable"
            });
        const clientConfig = ytCommentGetMutationClientConfig(false);
        if (!clientConfig?.INNERTUBE_CONTEXT || !clientConfig?.INNERTUBE_API_KEY)
            return yvrMutationResult({
                errorCode: "AUTH_REQUIRED",
                message: "Select a YouTube channel before reacting"
            });
        const transport = ytCommentMutationTransport(clientConfig, true);
        const separator = command.apiUrl.includes("?") ? "&" : "?";
        const url = transport.baseUrl + command.apiUrl + separator + "key=" +
            encodeURIComponent(clientConfig.INNERTUBE_API_KEY) + "&prettyPrint=false";
        const body = Object.assign({}, command.payload, {context: clientConfig.INNERTUBE_CONTEXT});
        const response = http.POST(url, JSON.stringify(body), transport.headers, true);
        if (!response?.isOk) {
            if (typeof ytCommentLogHttpFailure === "function")
                ytCommentLogHttpFailure(response, command.apiUrl, transport, body);
            return yvrNormalizeHttpFailure(response?.code ?? 0);
        }
        entry.reaction = desiredReaction;
        entry.fetchedAt = Date.now();
        return yvrMutationResult({success: true, reaction: desiredReaction});
    } catch (_) {
        return yvrMutationResult({
            errorCode: "NETWORK_ERROR",
            retryable: true,
            message: "The YouTube reaction request did not complete"
        });
    }
}

function yvrSetReaction(contentUrl, desiredReaction) {
    desiredReaction = String(desiredReaction ?? "NONE").toUpperCase();
    if (!["NONE", "LIKE", "DISLIKE"].includes(desiredReaction))
        return yvrMutationResult({errorCode: "ACTION_NOT_SUPPORTED", message: "Unknown video reaction"});

    let acquired = yvrFetchState(contentUrl, false);
    if (acquired.error) return yvrMutationResult({
        errorCode: acquired.error.errorCode,
        message: acquired.error.message
    });
    if (acquired.entry.reaction === desiredReaction)
        return yvrMutationResult({success: true, reaction: desiredReaction});

    let result = yvrSubmit(acquired.entry, desiredReaction);
    if (!result.success && (result.errorCode === "AUTH_REQUIRED" ||
        result.errorCode === "UPSTREAM_RESPONSE_CHANGED")) {
        acquired = yvrFetchState(contentUrl, true);
        if (!acquired.error)
            result = yvrSubmit(acquired.entry, desiredReaction);
    }
    return result;
}

if (typeof source !== "undefined") {
    source.getVideoReactionState = function(contentUrl) {
        // Reopening a video must reflect changes made in another YouTube
        // client. Keep the cache only for the immediate follow-up mutation.
        const result = yvrFetchState(contentUrl, true);
        return result.error ?? yvrStateResult(result.entry);
    };
    source.setVideoReaction = yvrSetReaction;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        yvrVideoId,
        yvrClassifyCommand,
        yvrInspect,
        yvrStateResult,
        yvrMutationResult
    };
}
