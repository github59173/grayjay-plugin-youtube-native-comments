const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mutations = require("../comment_mutations.js");
const fixtureRoot = path.resolve(__dirname, "../fixtures");
const fixture = name => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));

test("extracts all owned-comment capabilities without credentials", () => {
  const renderer = fixture("comment-thread-owned.json").commentRenderer;
  const result = mutations.ytCommentExtractCommentActions(renderer);
  assert.equal(result.id, "SANITIZED_COMMENT_OWNED");
  assert.equal(result.isOwnedByUser, true);
  assert.deepEqual(new Set(result.capabilities), new Set([
    "COMMENTS_REPLY", "COMMENTS_EDIT", "COMMENTS_DELETE", "COMMENTS_LIKE", "COMMENTS_DISLIKE"
  ]));
  assert.ok(result.commands.edit);
  assert.ok(result.commands.delete);
});

test("never grants edit or delete to a non-owned comment", () => {
  const renderer = fixture("comment-thread-non-owned.json").commentRenderer;
  const result = mutations.ytCommentExtractCommentActions(renderer);
  assert.equal(result.isOwnedByUser, false);
  assert.equal(result.capabilities.includes("COMMENTS_EDIT"), false);
  assert.equal(result.capabilities.includes("COMMENTS_DELETE"), false);
});

test("keeps reply discoverable when MWEB omits the inline toolbar command", () => {
  const result = mutations.ytCommentExtractCommentActions({
    commentId: "SANITIZED_LAZY_REPLY_COMMENT",
    isCurrentUser: false,
    author: {displayName: "@fixture_handle"}
  });
  assert.equal(result.isOwnedByUser, false);
  assert.equal(result.commands.reply, null);
  assert.equal(result.capabilities.includes("COMMENTS_REPLY"), true);

  const anonymousShape = mutations.ytCommentExtractCommentActions({
    isCurrentUser: false,
    author: {displayName: "@fixture_handle"}
  });
  assert.equal(anonymousShape.capabilities.includes("COMMENTS_REPLY"), false);
});

test("marks an explicitly disabled reply thread as locked", () => {
  const definition = mutations.ytCommentEnrichCommentDef({
    contextUrl: "https://m.youtube.com/watch?v=SANITIZED_LOCKED_REPLY_VIDEO",
    context: {}
  }, {
    commentId: "SANITIZED_LOCKED_REPLY_COMMENT",
    isCurrentUser: false,
    replyButtonRenderer: {
      isDisabled: true,
      text: {simpleText: "Reply"}
    }
  });

  assert.equal(definition.capabilities.includes("COMMENTS_REPLY"), false);
  assert.equal(definition.context.replyLocked, "true");
  assert.equal(definition.context.replyLockReason, "Replies are locked");
});

test("keeps a readable MWEB reply continuation available when its compact toolbar omits Reply", () => {
  global.bridge = {isLoggedIn: () => true};
  try {
    const definition = mutations.ytCommentEnrichCommentDef({
      contextUrl: "https://m.youtube.com/watch?v=SANITIZED_READABLE_LOCKED_THREAD",
      replyCount: 961,
      context: {
        replyContinuation: "SANITIZED_LOCKED_REPLY_CONTINUATION",
        useLogin: "true",
        useMobile: "true"
      }
    }, {
      commentEntityPayload: {
        commentId: "SANITIZED_READABLE_LOCKED_PARENT",
        isCurrentUser: false
      },
      engagementToolbarSurfaceEntityPayload: {
        likeCommand: {
          innertubeCommand: {
            performCommentActionEndpoint: {action: "SANITIZED_LIKE_ACTION"}
          }
        },
        dislikeCommand: {
          innertubeCommand: {
            performCommentActionEndpoint: {action: "SANITIZED_DISLIKE_ACTION"}
          }
        }
      }
    });

    assert.equal(definition.replyCount, 961);
    assert.equal(definition.context.replyContinuation, "SANITIZED_LOCKED_REPLY_CONTINUATION");
    assert.equal(definition.capabilities.includes("COMMENTS_REPLY"), true);
    assert.equal(definition.context.replyLocked, undefined);

    const pager = {results: [], hasMore: true};
    assert.deepEqual(mutations.ytCommentReplyThreadState(definition, pager), {
      availability: "AVAILABLE",
      reason: null
    });
  } finally {
    delete global.bridge;
  }
});

test("does not infer a lock from a mobile reaction action sheet without Reply", () => {
  global.bridge = {isLoggedIn: () => true};
  try {
    const result = mutations.ytCommentExtractCommentActions({
      commentId: "SANITIZED_ACTION_SHEET_LOCKED_PARENT",
      isCurrentUser: false,
      actionMenu: {
        menuRenderer: {
          items: [
            {
              toggleMenuServiceItemRenderer: {
                defaultText: {simpleText: "Like"},
                toggledText: {simpleText: "Unlike"},
                defaultServiceEndpoint: {
                  performCommentActionEndpoint: {action: "SANITIZED_LIKE"}
                },
                toggledServiceEndpoint: {
                  performCommentActionEndpoint: {action: "SANITIZED_UNLIKE"}
                }
              }
            },
            {
              toggleMenuServiceItemRenderer: {
                defaultText: {simpleText: "Dislike"},
                toggledText: {simpleText: "Remove dislike"},
                defaultServiceEndpoint: {
                  performCommentActionEndpoint: {action: "SANITIZED_DISLIKE"}
                },
                toggledServiceEndpoint: {
                  performCommentActionEndpoint: {action: "SANITIZED_UNDISLIKE"}
                }
              }
            }
          ]
        }
      }
    });
    assert.equal(result.capabilities.includes("COMMENTS_REPLY"), true);
    assert.equal(result.replyLocked, false);
    assert.equal(result.capabilities.includes("COMMENTS_LIKE"), true);
    assert.equal(result.capabilities.includes("COMMENTS_DISLIKE"), true);
  } finally {
    delete global.bridge;
  }
});

test("does not infer a reply lock from comment text near its accessibility reply count", () => {
  const result = mutations.ytCommentExtractCommentActions({
    commentId: "SANITIZED_NATURAL_LANGUAGE_LOCK_COMMENT",
    isCurrentUser: false,
    accessibilityData: {
      label: "@fixture. 1 day ago. Sanders should have been locked up like 30 years ago. 504 likes. 17 replies"
    }
  });

  assert.equal(result.capabilities.includes("COMMENTS_REPLY"), true);
  assert.equal(result.replyLocked, false);
  assert.equal(result.replyLockReason, null);
});

test("reports page commenting availability from inspected YouTube commands", () => {
  global.bridge = {isLoggedIn: () => true};
  try {
    const availableUrl = "https://m.youtube.com/watch?v=SANITIZED_AVAILABLE_COMMENTS";
    mutations.ytCommentRememberPageCommands(availableUrl, {
      commandMetadata: {webCommandMetadata: {apiUrl: "/youtubei/v1/comment/create_comment"}},
      createCommentEndpoint: {createCommentParams: "SANITIZED_CREATE_PARAMS"}
    });
    assert.deepEqual(mutations.ytCommentCommentingState(availableUrl), {
      availability: "AVAILABLE",
      reason: null
    });

    const lockedUrl = "https://m.youtube.com/watch?v=SANITIZED_LOCKED_COMMENTS";
    mutations.ytCommentRememberPageCommands(lockedUrl, {contents: []});
    assert.deepEqual(mutations.ytCommentCommentingState(lockedUrl), {
      availability: "LOCKED",
      reason: "YouTube comments are locked for this video"
    });
    assert.equal(mutations.ytCommentIsLockedCommentingError(new Error("Comments turned off")), true);

    const pager = mutations.ytCommentDecorateCommentPager({results: [], hasMore: false}, mutations.ytCommentCommentingState(lockedUrl));
    assert.equal(pager.commentingAvailability, "LOCKED");
    assert.equal(pager.commentingLockReason, "YouTube comments are locked for this video");

    // Reply/comment continuations are partial surfaces and must not erase the
    // create action learned from the complete watch page.
    mutations.ytCommentRememberPageCommands(availableUrl, {contents: []}, false);
    assert.deepEqual(mutations.ytCommentCommentingState(availableUrl), {
      availability: "AVAILABLE",
      reason: null
    });
  } finally {
    delete global.bridge;
  }
});

test("a locked page marks its loaded comment threads reply-locked", () => {
  global.bridge = {isLoggedIn: () => true};
  try {
    const contextUrl = "https://m.youtube.com/watch?v=SANITIZED_PAUSED_COMMENTS";
    mutations.ytCommentRememberPageCommands(contextUrl, {contents: []});
    const definition = mutations.ytCommentEnrichCommentDef({contextUrl, context: {}}, {
      commentId: "SANITIZED_PAUSED_THREAD",
      isCurrentUser: false
    });
    assert.equal(definition.capabilities.includes("COMMENTS_REPLY"), false);
    assert.equal(definition.context.replyLocked, "true");
    assert.equal(definition.context.replyLockReason, "YouTube comments are locked for this video");
  } finally {
    delete global.bridge;
  }
});

test("does not infer ownership from one stray destructive command", () => {
  const result = mutations.ytCommentExtractCommentActions({
    commentId: "SANITIZED_OTHER_COMMENT",
    isCurrentUser: false,
    unrelatedAction: {
      text: "Delete",
      serviceEndpoint: {performCommentActionEndpoint: {action: "SANITIZED_STRAY_ACTION"}}
    },
    toolbar: {
      like: {tooltip: "Like", serviceEndpoint: {
        performCommentActionEndpoint: {action: "SANITIZED_LIKE_ACTION"}
      }}
    }
  });
  assert.equal(result.isOwnedByUser, false);
  assert.equal(result.capabilities.includes("COMMENTS_DELETE"), false);
  assert.equal(result.commands.delete !== null, true);
});

test("matches ownership to the selected YouTube channel id", () => {
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: "SANITIZED_CURRENT_CHANNEL",
    INNERTUBE_CONTEXT: {user: {}}
  });
  try {
    const result = mutations.ytCommentExtractCommentActions({
      commentId: "SANITIZED_CURRENT_USER_COMMENT",
      authorEndpoint: {browseEndpoint: {browseId: "SANITIZED_CURRENT_CHANNEL"}},
      actionMenu: {items: [{text: "Edit", serviceEndpoint: {
        updateCommentEndpoint: {updateCommentParams: "SANITIZED_EDIT_PARAMS"}
      }}]}
    });
    assert.equal(result.isOwnedByUser, true);
    assert.equal(result.capabilities.includes("COMMENTS_EDIT"), true);
    assert.equal(result.capabilities.includes("COMMENTS_DELETE"), false);
  } finally {
    delete global.getClientContext;
  }
});

test("re-derives ownership for a reopened comment from DATASYNC channel identity", () => {
  global.getClientContext = () => ({
    DATASYNC_ID: "SANITIZED_REOPENED_CHANNEL||SANITIZED_ACCOUNT",
    INNERTUBE_CONTEXT: {user: {}}
  });
  try {
    // This is a fresh renderer, with no preceding create mutation or local
    // ownership registration. Loading it again must still expose owner tools.
    const result = mutations.ytCommentExtractCommentActions({
      commentId: "SANITIZED_REOPENED_COMMENT",
      author: {
        channelId: "SANITIZED_REOPENED_CHANNEL",
        displayName: "Reopened Fixture"
      },
      actionMenu: {items: [
        {text: "Edit", serviceEndpoint: {
          updateCommentEndpoint: {updateCommentParams: "SANITIZED_REOPENED_EDIT"}
        }},
        {text: "Delete", serviceEndpoint: {
          performCommentActionEndpoint: {action: "SANITIZED_REOPENED_DELETE"}
        }}
      ]}
    });
    assert.equal(result.isOwnedByUser, true);
    assert.equal(result.capabilities.includes("COMMENTS_EDIT"), true);
    assert.equal(result.capabilities.includes("COMMENTS_DELETE"), true);
  } finally {
    delete global.getClientContext;
  }
});

test("matches a loaded comment by normalized channel handle when ids are absent", () => {
  global.getClientContext = () => ({
    CHANNEL_HANDLE: "@Fixture.Channel",
    INNERTUBE_CONTEXT: {user: {}}
  });
  try {
    const result = mutations.ytCommentExtractCommentActions({
      commentId: "SANITIZED_HANDLE_COMMENT",
      authorEndpoint: {
        commandMetadata: {webCommandMetadata: {url: "/@fixture.channel"}}
      },
      actionMenu: {items: [{text: "Edit", serviceEndpoint: {
        updateCommentEndpoint: {updateCommentParams: "SANITIZED_HANDLE_EDIT"}
      }}]}
    });
    assert.equal(result.isOwnedByUser, true);
    assert.equal(result.capabilities.includes("COMMENTS_EDIT"), true);
    assert.equal(result.capabilities.includes("COMMENTS_DELETE"), false);
  } finally {
    delete global.getClientContext;
  }
});

test("stable channel-id mismatch overrides an identical display name", () => {
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: "SANITIZED_SIGNED_IN_CHANNEL",
    LOGGED_IN_USER_NAME: "Duplicate Display Name",
    INNERTUBE_CONTEXT: {user: {}}
  });
  try {
    const result = mutations.ytCommentExtractCommentActions({
      commentId: "SANITIZED_DIFFERENT_ACCOUNT_COMMENT",
      author: {
        channelId: "SANITIZED_DIFFERENT_CHANNEL",
        displayName: "Duplicate Display Name"
      },
      actionMenu: {items: [{text: "Edit", serviceEndpoint: {
        updateCommentEndpoint: {updateCommentParams: "SANITIZED_STRAY_EDIT"}
      }}]}
    });
    assert.equal(result.isOwnedByUser, false);
    assert.equal(result.capabilities.includes("COMMENTS_EDIT"), false);
    assert.equal(result.capabilities.includes("COMMENTS_DELETE"), false);
  } finally {
    delete global.getClientContext;
  }
});

test("uses display-name ownership only when stronger identities are unavailable", () => {
  global.getClientContext = () => ({
    LOGGED_IN_USER_NAME: "Fixture Channel Name",
    INNERTUBE_CONTEXT: {user: {}}
  });
  try {
    const result = mutations.ytCommentExtractCommentActions({
      commentId: "SANITIZED_NAME_COMMENT",
      author: {displayName: "  fixture channel name  "},
      actionMenu: {items: [{text: "Edit", serviceEndpoint: {
        updateCommentEndpoint: {updateCommentParams: "SANITIZED_NAME_EDIT"}
      }}]}
    });
    assert.equal(result.isOwnedByUser, true);
    assert.equal(result.capabilities.includes("COMMENTS_EDIT"), true);
    assert.equal(result.capabilities.includes("COMMENTS_DELETE"), false);
  } finally {
    delete global.getClientContext;
  }
});

test("extracts authenticated mobile toggle pairs and owned menu actions", () => {
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: "SANITIZED_CURRENT_CHANNEL",
    INNERTUBE_CONTEXT: {user: {}}
  });
  try {
    const renderer = fixture("comment-thread-mobile-owned.json").commentRenderer;
    const result = mutations.ytCommentExtractCommentActions(renderer);
    assert.equal(result.isOwnedByUser, true);
    assert.equal(result.userReaction, "LIKE");
    assert.deepEqual(new Set(result.capabilities), new Set([
      "COMMENTS_REPLY", "COMMENTS_EDIT", "COMMENTS_DELETE", "COMMENTS_LIKE", "COMMENTS_DISLIKE"
    ]));
    assert.equal(JSON.parse(result.commands.like).payload.action, "SANITIZED_MOBILE_LIKE_ACTION");
    assert.equal(JSON.parse(result.commands.unlike).payload.action, "SANITIZED_MOBILE_UNLIKE_ACTION");
    assert.equal(JSON.parse(result.commands.dislike).payload.action, "SANITIZED_MOBILE_DISLIKE_ACTION");
    assert.equal(JSON.parse(result.commands.undislike).payload.action, "SANITIZED_MOBILE_UNDISLIKE_ACTION");
    assert.equal(JSON.parse(result.commands.edit).endpointKey, "updateCommentEndpoint");
    assert.equal(JSON.parse(result.commands.delete).endpointKey, "performCommentActionEndpoint");
  } finally {
    delete global.getClientContext;
  }
});

test("extracts current MWEB likeButtonRenderer actions and owner menu", () => {
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: "SANITIZED_CURRENT_CHANNEL",
    INNERTUBE_CONTEXT: {user: {}}
  });
  try {
    const renderer = fixture("comment-thread-mobile-like-button-owned.json").commentRenderer;
    const result = mutations.ytCommentExtractCommentActions(renderer);
    assert.equal(result.isOwnedByUser, true);
    assert.equal(result.userReaction, "LIKE");
    assert.deepEqual(new Set(result.capabilities), new Set([
      "COMMENTS_REPLY", "COMMENTS_EDIT", "COMMENTS_DELETE", "COMMENTS_LIKE", "COMMENTS_DISLIKE"
    ]));
    assert.equal(JSON.parse(result.commands.like).payload.action, "SANITIZED_MOBILE_LIKE_ACTION");
    assert.equal(JSON.parse(result.commands.unlike).payload.action, "SANITIZED_MOBILE_INDIFFERENT_ACTION");
    assert.equal(JSON.parse(result.commands.dislike).payload.action, "SANITIZED_MOBILE_DISLIKE_ACTION");
    assert.equal(JSON.parse(result.commands.undislike).payload.action, "SANITIZED_MOBILE_INDIFFERENT_ACTION");
    assert.equal(JSON.parse(result.commands.edit).endpointKey, "updateCommentEndpoint");
    assert.equal(JSON.parse(result.commands.delete).endpointKey, "performCommentActionEndpoint");
  } finally {
    delete global.getClientContext;
  }
});

test("extracts both directions of current MWEB action-menu reaction toggles", () => {
  const endpoint = action => ({
    commandMetadata: {webCommandMetadata: {apiUrl: "/youtubei/v1/comment/perform_comment_action"}},
    performCommentActionEndpoint: {action}
  });
  const toggle = (defaultText, toggledText, defaultAction, toggledAction, isToggled = false) => ({
    toggleMenuServiceItemRenderer: {
      defaultText: {runs: [{text: defaultText}]},
      toggledText: {runs: [{text: toggledText}]},
      defaultServiceEndpoint: endpoint(defaultAction),
      toggledServiceEndpoint: endpoint(toggledAction),
      isToggled
    }
  });
  const renderer = {
    commentId: "SANITIZED_CURRENT_MWEB_COMMENT",
    actionMenu: {menuRenderer: {items: [
      toggle("Like", "Unlike", "SANITIZED_LIKE_ACTION", "SANITIZED_UNLIKE_ACTION", true),
      toggle("Dislike", "Remove dislike", "SANITIZED_DISLIKE_ACTION", "SANITIZED_UNDISLIKE_ACTION")
    ]}}
  };

  const result = mutations.ytCommentExtractCommentActions(renderer);
  assert.equal(result.userReaction, "LIKE");
  assert.equal(result.capabilities.includes("COMMENTS_LIKE"), true);
  assert.equal(result.capabilities.includes("COMMENTS_DISLIKE"), true);
  assert.equal(JSON.parse(result.commands.like).payload.action, "SANITIZED_LIKE_ACTION");
  assert.equal(JSON.parse(result.commands.unlike).payload.action, "SANITIZED_UNLIKE_ACTION");
  assert.equal(JSON.parse(result.commands.dislike).payload.action, "SANITIZED_DISLIKE_ACTION");
  assert.equal(JSON.parse(result.commands.undislike).payload.action, "SANITIZED_UNDISLIKE_ACTION");
});

test("uses MWEB INDIFFERENT to clear a selected dislike", () => {
  const renderer = fixture("comment-thread-mobile-like-button-owned.json").commentRenderer;
  const likeButton = renderer.actionMenu.menuRenderer.items[1].likeButtonRenderer;
  renderer.voteStatus = "DISLIKE";
  likeButton.likeStatus = "DISLIKE";
  const result = mutations.ytCommentExtractCommentActions(renderer);
  assert.equal(result.userReaction, "DISLIKE");
  assert.equal(
    JSON.parse(result.commands.undislike).payload.action,
    "SANITIZED_MOBILE_INDIFFERENT_ACTION"
  );
});

test("joins current comment entities to toolbar actions and reaction state", () => {
  const data = fixture("comment-entity-actions.json");
  const entity = data.mutations[0].payload.commentEntityPayload;
  const source = mutations.ytCommentComposeCommentActionSource(entity, data.parent, data.mutations);
  const result = mutations.ytCommentExtractCommentActions(source);

  assert.equal(result.id, "SANITIZED_ENTITY_COMMENT");
  assert.equal(result.isOwnedByUser, true);
  assert.equal(result.userReaction, "LIKE");
  assert.deepEqual(new Set(result.capabilities), new Set([
    "COMMENTS_REPLY", "COMMENTS_EDIT", "COMMENTS_DELETE", "COMMENTS_LIKE", "COMMENTS_DISLIKE"
  ]));
  assert.equal(JSON.parse(result.commands.reply).endpointKey, "createCommentReplyDialogEndpoint");
  assert.equal(JSON.parse(result.commands.like).payload.action, "SANITIZED_LIKE_ACTION");
  assert.equal(JSON.parse(result.commands.dislike).payload.action, "SANITIZED_DISLIKE_ACTION");

  const replyParent = {
    commentViewModel: {
      commentViewModel: {
        toolbarSurfaceKey: "ENTITY_TOOLBAR_SURFACE"
      }
    }
  };
  const replySource = mutations.ytCommentComposeCommentActionSource(entity, replyParent, data.mutations);
  assert.equal(
    JSON.parse(mutations.ytCommentExtractCommentActions(replySource).commands.reply).endpointKey,
    "createCommentReplyDialogEndpoint"
  );
});

test("joins an adjacent toolbar when the parent omits its surface key", () => {
  const data = fixture("comment-entity-actions.json");
  const entity = data.mutations[0].payload.commentEntityPayload;
  const parentWithoutSurfaceKey = {
    commentViewModel: {commentViewModel: {commentKey: "ENTITY_COMMENT"}}
  };
  const source = mutations.ytCommentComposeCommentActionSource(entity, parentWithoutSurfaceKey, data.mutations);
  const result = mutations.ytCommentExtractCommentActions(source);

  assert.deepEqual(new Set(result.capabilities), new Set([
    "COMMENTS_REPLY", "COMMENTS_EDIT", "COMMENTS_DELETE", "COMMENTS_LIKE", "COMMENTS_DISLIKE"
  ]));
  assert.equal(JSON.parse(result.commands.like).payload.action, "SANITIZED_LIKE_ACTION");
  assert.equal(JSON.parse(result.commands.dislike).payload.action, "SANITIZED_DISLIKE_ACTION");
});

test("uses one create-command cache key for mobile, desktop, and short URLs", () => {
  assert.equal(
    mutations.ytCommentCommentCacheKey("https://www.youtube.com/watch?v=SANITIZED_VIDEO"),
    mutations.ytCommentCommentCacheKey("https://m.youtube.com/watch?v=SANITIZED_VIDEO")
  );
  assert.equal(
    mutations.ytCommentCommentCacheKey("https://youtu.be/SANITIZED_VIDEO"),
    "youtube-video:SANITIZED_VIDEO"
  );
});

test("omits null reply continuations from serializable comment context", () => {
  assert.deepEqual(mutations.ytCommentCommentContext(null, true, false), {
    useLogin: "true",
    useMobile: "false"
  });
  assert.deepEqual(mutations.ytCommentCommentContext("SANITIZED_CONTINUATION", true, false), {
    useLogin: "true",
    useMobile: "false",
    replyContinuation: "SANITIZED_CONTINUATION"
  });
});

test("targets a stable highlighted-comment URL for action refresh", () => {
  assert.equal(
    mutations.ytCommentCommentPermalink("https://www.youtube.com/watch?v=SANITIZED_VIDEO", "SANITIZED_COMMENT"),
    "https://www.youtube.com/watch?v=SANITIZED_VIDEO&lc=SANITIZED_COMMENT"
  );
  assert.equal(
    mutations.ytCommentCommentPermalink("https://www.youtube.com/watch?v=SANITIZED_VIDEO&lc=OLD", "NEW"),
    "https://www.youtube.com/watch?v=SANITIZED_VIDEO&lc=NEW"
  );
});

test("reacquires a missing inverse reaction command for repeated toggles", () => {
  const data = fixture("comment-entity-actions.json");
  delete data.mutations[1].payload.engagementToolbarSurfaceEntityPayload.unlikeCommand;
  data.mutations[1].payload.engagementToolbarSurfaceEntityPayload.likeCommand
    .innertubeCommand.performCommentActionEndpoint.action = "SANITIZED_CURRENT_UNLIKE_ACTION";
  global.requestInitialData = () => data;
  const comment = {
    id: "SANITIZED_ENTITY_COMMENT",
    contextUrl: "https://www.youtube.com/watch?v=SANITIZED_VIDEO",
    context: {likeCommand: "SANITIZED_EXISTING_LIKE"},
    capabilities: ["COMMENTS_LIKE"],
    isOwnedByUser: true,
    userReaction: "LIKE"
  };
  try {
    const unlike = mutations.ytCommentAcquireCommentCommand(comment, "unlike");
    assert.equal(JSON.parse(unlike).payload.action, "SANITIZED_CURRENT_UNLIKE_ACTION");
    assert.equal(comment.capabilities.includes("COMMENTS_DELETE"), true);
    assert.ok(comment.context.deleteCommand);
  } finally {
    delete global.requestInitialData;
  }
});

test("falls back to the normal comment pager when initial data omits toolbar actions", () => {
  const data = fixture("comment-entity-actions.json");
  delete data.mutations[1].payload.engagementToolbarSurfaceEntityPayload.unlikeCommand;
  data.mutations[1].payload.engagementToolbarSurfaceEntityPayload.likeCommand
    .innertubeCommand.performCommentActionEndpoint.action = "SANITIZED_PAGER_UNLIKE_ACTION";
  const entityOnly = {
    frameworkUpdates: {entityBatchUpdate: {mutations: [data.mutations[0]]}}
  };
  let initialPageRequests = 0;
  global.requestInitialData = () => { initialPageRequests++; return entityOnly; };
  global.source = {
    getComments: () => {
      const entity = data.mutations[0].payload.commentEntityPayload;
      const actionSource = mutations.ytCommentComposeCommentActionSource(entity, data.parent, data.mutations);
      mutations.ytCommentEnrichCommentDef({context: {}}, entity, actionSource);
    }
  };
  const comment = {
    id: "SANITIZED_ENTITY_COMMENT",
    contextUrl: "https://www.youtube.com/watch?v=SANITIZED_VIDEO",
    context: {},
    capabilities: ["COMMENTS_LIKE"],
    isOwnedByUser: true,
    userReaction: "LIKE"
  };
  try {
    const unlike = mutations.ytCommentAcquireCommentCommand(comment, "unlike");
    assert.equal(JSON.parse(unlike).payload.action, "SANITIZED_PAGER_UNLIKE_ACTION");
    assert.equal(initialPageRequests, 0);
  } finally {
    delete global.requestInitialData;
    delete global.source;
  }
});

test("refreshes a newly returned mobile comment before it is inserted", () => {
  const renderer = fixture("comment-thread-mobile-owned.json").commentRenderer;
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: "SANITIZED_CURRENT_CHANNEL",
    INNERTUBE_CONTEXT: {user: {}}
  });
  global.requestInitialData = () => ({commentRenderer: renderer});
  const comment = {
    id: "SANITIZED_MOBILE_COMMENT_OWNED",
    contextUrl: "https://m.youtube.com/watch?v=SANITIZED_VIDEO",
    context: {},
    capabilities: [],
    isOwnedByUser: false,
    userReaction: "NONE"
  };
  try {
    mutations.ytCommentRefreshCommentActions(comment);
    assert.equal(comment.isOwnedByUser, true);
    assert.equal(comment.userReaction, "LIKE");
    assert.deepEqual(new Set(comment.capabilities), new Set([
      "COMMENTS_REPLY", "COMMENTS_EDIT", "COMMENTS_DELETE", "COMMENTS_LIKE", "COMMENTS_DISLIKE"
    ]));
    assert.ok(comment.context.unlikeCommand);
    assert.ok(comment.context.undislikeCommand);
  } finally {
    delete global.getClientContext;
    delete global.requestInitialData;
  }
});

test("owned comments hide delete until YouTube supplies its command", () => {
  const result = mutations.ytCommentExtractCommentActions({
    commentId: "SANITIZED_OWNED_WITH_DEFERRED_MENU",
    isCurrentUser: true,
    actionMenu: {items: [{text: "Edit", serviceEndpoint: {
      updateCommentEndpoint: {updateCommentParams: "SANITIZED_EDIT_PARAMS"}
    }}]}
  });
  assert.equal(result.isOwnedByUser, true);
  assert.equal(result.capabilities.includes("COMMENTS_DELETE"), false);
});

test("extracts a current mobile edit-dialog command for lazy resolution", () => {
  const result = mutations.ytCommentExtractCommentActions({
    commentId: "SANITIZED_EDIT_DIALOG_COMMENT",
    isCurrentUser: true,
    actionMenu: {items: [{text: "Edit", serviceEndpoint: {
      commandMetadata: {webCommandMetadata: {
        apiUrl: "/youtubei/v1/comment/update_comment_dialog"
      }},
      updateCommentDialogEndpoint: {
        updateCommentParams: "SANITIZED_EDIT_DIALOG_PARAMS"
      }
    }}]}
  });
  assert.equal(result.isOwnedByUser, true);
  assert.equal(result.capabilities.includes("COMMENTS_EDIT"), true);
  assert.equal(JSON.parse(result.commands.edit).endpointKey, "updateCommentDialogEndpoint");
});

test("classifies the selected dislike toggle as an undislike command", () => {
  const data = fixture("comment-entity-actions.json");
  const surface = data.mutations[1].payload.engagementToolbarSurfaceEntityPayload;
  delete surface.undislikeCommand;
  surface.dislikeCommand.innertubeCommand.performCommentActionEndpoint.action =
    "SANITIZED_CURRENT_UNDISLIKE_ACTION";
  data.mutations[2].payload.engagementToolbarStateEntityPayload.likeState = "DISLIKE";
  const entity = data.mutations[0].payload.commentEntityPayload;
  const source = mutations.ytCommentComposeCommentActionSource(entity, data.parent, data.mutations);
  const result = mutations.ytCommentExtractCommentActions(source);

  assert.equal(result.userReaction, "DISLIKE");
  assert.equal(JSON.parse(result.commands.undislike).payload.action,
    "SANITIZED_CURRENT_UNDISLIKE_ACTION");
});

test("builds website create and reaction request bodies from emitted commands", () => {
  const commands = mutations.ytCommentCollectCommands(fixture("comment-page-create.json"));
  const create = commands.find(command => command.endpointKey === "createCommentEndpoint");
  const request = mutations.ytCommentBuildMutationRequest(create, "Unicode test: 👋");
  assert.equal(request.apiUrl, "/youtubei/v1/comment/create_comment");
  assert.equal(request.body.createCommentParams, "SANITIZED_CREATE_PARAMS");
  assert.equal(request.body.commentText, "Unicode test: 👋");

  const reaction = mutations.ytCommentBuildMutationRequest({
    endpointKey: "performCommentActionEndpoint",
    apiUrl: "/youtubei/v1/comment/perform_comment_action",
    payload: {action: "SANITIZED_LIKE_ACTION"}
  });
  assert.deepEqual(reaction.body.actions, ["SANITIZED_LIKE_ACTION"]);
});

test("builds reply, edit, and delete bodies independently", () => {
  const reply = mutations.ytCommentBuildMutationRequest({
    endpointKey: "createCommentReplyEndpoint",
    payload: {createReplyParams: "SANITIZED_REPLY_PARAMS"}
  }, "Reply fixture");
  assert.equal(reply.body.createReplyParams, "SANITIZED_REPLY_PARAMS");
  assert.equal("createCommentReplyParams" in reply.body, false);
  assert.equal(reply.body.commentText, "Reply fixture");
  assert.deepEqual(JSON.parse(JSON.stringify(reply.body)), {
    createReplyParams: "SANITIZED_REPLY_PARAMS",
    commentText: "Reply fixture"
  });

  const edit = mutations.ytCommentBuildMutationRequest({
    endpointKey: "updateCommentEndpoint",
    payload: {updateCommentParams: "SANITIZED_EDIT_PARAMS"}
  }, "Edited fixture");
  assert.equal(edit.body.updateCommentParams, "SANITIZED_EDIT_PARAMS");
  assert.equal(edit.body.commentText, "Edited fixture");
  assert.throws(() => mutations.ytCommentBuildMutationRequest({
    endpointKey: "updateCommentEndpoint",
    payload: {}
  }, "Edited fixture"), /Missing edit action metadata/);

  const replyEdit = mutations.ytCommentBuildMutationRequest({
    endpointKey: "updateCommentReplyEndpoint",
    payload: {updateReplyParams: "SANITIZED_REPLY_EDIT_PARAMS"}
  }, "Edited reply fixture");
  assert.deepEqual(replyEdit.body, {
    updateReplyParams: "SANITIZED_REPLY_EDIT_PARAMS",
    commentText: "Edited reply fixture"
  });

  const remove = mutations.ytCommentBuildMutationRequest({
    endpointKey: "deleteCommentEndpoint",
    payload: {deleteCommentParams: "SANITIZED_DELETE_PARAMS"}
  });
  assert.equal(remove.body.deleteCommentParams, "SANITIZED_DELETE_PARAMS");
});

test("resolves create and reply dialogs to their final submit commands", () => {
  const postedBodies = [];
  global.bridge = {isLoggedIn: () => true};
  global.getClientContext = () => ({
    INNERTUBE_API_KEY: "SANITIZED_API_KEY",
    INNERTUBE_CONTEXT: {client: {visitorData: "SANITIZED_VISITOR"}}
  });
  global.getAuthContextHeaders = () => ({});
  global.URL_BASE = "https://www.youtube.com";
  global.URL_BASE_M = "https://m.youtube.com";
  global.http = {
    POST: (_url, body) => {
      const parsed = JSON.parse(body);
      postedBodies.push(parsed);
      const isReply = Boolean(parsed.createReplyParams);
      return {
        isOk: true,
        body: JSON.stringify({
          dialog: {
            commandMetadata: {webCommandMetadata: {apiUrl: isReply
              ? "/youtubei/v1/comment/create_comment_reply"
              : "/youtubei/v1/comment/create_comment"}},
            ...(isReply
              ? {createCommentReplyEndpoint: {createReplyParams: "SANITIZED_FINAL_REPLY_PARAMS"}}
              : {createCommentEndpoint: {createCommentParams: "SANITIZED_FINAL_CREATE_PARAMS"}})
          }
        })
      };
    }
  };

  try {
    const create = mutations.ytCommentResolveDialogCommand({
      endpointKey: "createCommentDialogEndpoint",
      payload: {createCommentParams: "SANITIZED_CREATE_DIALOG_PARAMS"}
    });
    const reply = mutations.ytCommentResolveDialogCommand({
      endpointKey: "createCommentReplyDialogEndpoint",
      payload: {createReplyParams: "SANITIZED_REPLY_DIALOG_PARAMS"}
    });
    assert.equal(JSON.parse(create.command).endpointKey, "createCommentEndpoint");
    assert.equal(JSON.parse(reply.command).endpointKey, "createCommentReplyEndpoint");
    assert.equal(postedBodies[0].createCommentParams, "SANITIZED_CREATE_DIALOG_PARAMS");
    assert.equal(postedBodies[1].createReplyParams, "SANITIZED_REPLY_DIALOG_PARAMS");
  } finally {
    delete global.bridge;
    delete global.getClientContext;
    delete global.getAuthContextHeaders;
    delete global.URL_BASE;
    delete global.URL_BASE_M;
    delete global.http;
  }
});

test("prefers the mobile menu submit token over an Edit UI perform-action", () => {
  const result = mutations.ytCommentExtractCommentActions({
    commentEntityPayload: {
      commentId: "SANITIZED_OWNED_COMMENT",
      isCurrentUser: true
    },
    engagementToolbarSurfaceEntityPayload: {
      editCommand: {innertubeCommand: {
        performCommentActionEndpoint: {action: "SANITIZED_UI_EDIT_ACTION"}
      }},
      menuCommand: {
        innertubeCommand: {
          menuEndpoint: {
            menu: {
              menuRenderer: {
                items: [{
                  menuNavigationItemRenderer: {
                    navigationEndpoint: {
                      updateCommentDialogEndpoint: {
                        dialog: {
                          commentDialogRenderer: {
                            submitButton: {
                              buttonRenderer: {
                                serviceEndpoint: {
                                  commandMetadata: {webCommandMetadata: {
                                    apiUrl: "/youtubei/v1/comment/update_comment"
                                  }},
                                  updateCommentEndpoint: {
                                    updateCommentParams: "SANITIZED_FINAL_EDIT_PARAMS"
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }]
              }
            }
          }
        }
      }
    }
  });

  assert.equal(result.capabilities.includes("COMMENTS_EDIT"), true);
  assert.equal(JSON.parse(result.commands.edit).endpointKey, "updateCommentDialogEndpoint");
  const resolved = mutations.ytCommentResolveDialogCommand(result.commands.edit);
  assert.equal(JSON.parse(resolved.command).endpointKey, "updateCommentEndpoint");
  assert.equal(JSON.parse(resolved.command).payload.updateCommentParams,
    "SANITIZED_FINAL_EDIT_PARAMS");
  assert.equal(mutations.ytCommentIsEditSubmitCommand(result.commands.edit), true);
  assert.equal(mutations.ytCommentIsEditSubmitCommand(JSON.stringify({
    endpointKey: "performCommentActionEndpoint",
    payload: {action: "SANITIZED_UI_EDIT_ACTION"}
  })), false);
});

test("does not expose Edit when mobile only supplies a UI perform-action", () => {
  const result = mutations.ytCommentExtractCommentActions({
    commentId: "SANITIZED_PERFORM_ONLY_OWNER",
    isCurrentUser: true,
    actionMenu: {menuRenderer: {items: [{
      menuNavigationItemRenderer: {
        text: {runs: [{text: "Edit"}]},
        navigationEndpoint: {
          performCommentActionEndpoint: {action: "SANITIZED_UI_ONLY_ACTION"}
        }
      }
    }]}}
  });
  assert.equal(result.capabilities.includes("COMMENTS_EDIT"), false);
  assert.equal(result.commands.edit, null);
});

test("resolves final submit commands embedded in current dialog renderers", () => {
  const create = mutations.ytCommentResolveDialogCommand({
    endpointKey: "createCommentDialogEndpoint",
    payload: {
      dialog: {commentDialogRenderer: {submitButton: {buttonRenderer: {serviceEndpoint: {
        commandMetadata: {webCommandMetadata: {apiUrl: "/youtubei/v1/comment/create_comment"}},
        createCommentEndpoint: {createCommentParams: "SANITIZED_INLINE_CREATE_PARAMS"}
      }}}}}
    }
  });
  const reply = mutations.ytCommentResolveDialogCommand({
    endpointKey: "createCommentReplyDialogEndpoint",
    payload: {
      dialog: {commentReplyDialogRenderer: {replyButton: {buttonRenderer: {serviceEndpoint: {
        commandMetadata: {webCommandMetadata: {apiUrl: "/youtubei/v1/comment/create_comment_reply"}},
        createCommentReplyEndpoint: {createReplyParams: "SANITIZED_INLINE_REPLY_PARAMS"}
      }}}}}
    }
  });
  const edit = mutations.ytCommentResolveDialogCommand({
    endpointKey: "updateCommentDialogEndpoint",
    payload: {
      dialog: {commentDialogRenderer: {submitButton: {buttonRenderer: {serviceEndpoint: {
        commandMetadata: {webCommandMetadata: {apiUrl: "/youtubei/v1/comment/update_comment"}},
        updateCommentEndpoint: {updateCommentParams: "SANITIZED_INLINE_EDIT_PARAMS"}
      }}}}}
    }
  });

  assert.equal(JSON.parse(create.command).payload.createCommentParams, "SANITIZED_INLINE_CREATE_PARAMS");
  assert.equal(JSON.parse(reply.command).payload.createReplyParams, "SANITIZED_INLINE_REPLY_PARAMS");
  assert.equal(JSON.parse(edit.command).payload.updateCommentParams, "SANITIZED_INLINE_EDIT_PARAMS");
});

test("preserves the WEB client mode while resolving an edit dialog", () => {
  const edit = mutations.ytCommentResolveDialogCommand({
    endpointKey: "updateCommentDialogEndpoint",
    clientMode: "WEB",
    payload: {
      dialog: {commentDialogRenderer: {submitButton: {buttonRenderer: {serviceEndpoint: {
        commandMetadata: {webCommandMetadata: {apiUrl: "/youtubei/v1/comment/update_comment"}},
        updateCommentEndpoint: {updateCommentParams: "SANITIZED_WEB_EDIT_PARAMS"}
      }}}}}
    }
  });

  assert.equal(JSON.parse(edit.command).endpointKey, "updateCommentEndpoint");
  assert.equal(JSON.parse(edit.command).clientMode, "WEB");
});

test("finds current desktop comment continuations from both watch layouts", () => {
  const token = value => ({continuationItemRenderer: {
    continuationEndpoint: {continuationCommand: {token: value}}
  }});
  assert.equal(mutations.ytCommentFindCommentsContinuation({
    contents: {twoColumnWatchNextResults: {results: {results: {contents: [{
      itemSectionRenderer: {
        targetId: "comments-section",
        contents: [token("SANITIZED_DESKTOP_CONTINUATION")]
      }
    }]}}}}
  }), "SANITIZED_DESKTOP_CONTINUATION");

  assert.equal(mutations.ytCommentFindCommentsContinuation({
    engagementPanels: [{engagementPanelSectionListRenderer: {
      panelIdentifier: "engagement-panel-comments-section",
      content: {sectionListRenderer: {contents: [{itemSectionRenderer: {
        sectionIdentifier: "comment-item-section",
        contents: [token("SANITIZED_PANEL_CONTINUATION")]
      }}]}}
    }}]
  }), "SANITIZED_PANEL_CONTINUATION");
});

test("acquires an authenticated WEB edit command without replacing MWEB actions", () => {
  const account = "SANITIZED_WEB_EDIT_CHANNEL";
  const commentId = "SANITIZED_WEB_EDIT_COMMENT";
  const requestedPages = [];
  const posted = [];
  global.bridge = {isLoggedIn: () => true};
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: account,
    INNERTUBE_API_KEY: "SANITIZED_MWEB_KEY",
    INNERTUBE_CONTEXT: {client: {clientName: "MWEB", clientVersion: "MWEB_VERSION"}}
  });
  global.requestClientConfig = (useMobile, useAuth) => {
    assert.equal(useMobile, false);
    assert.equal(useAuth, false);
    return {
      DELEGATED_SESSION_ID: account,
      SESSION_INDEX: 2,
      INNERTUBE_API_KEY: "SANITIZED_WEB_KEY",
      INNERTUBE_CONTEXT: {client: {
        clientName: "WEB",
        clientVersion: "WEB_VERSION",
        visitorData: "SANITIZED_VISITOR"
      }}
    };
  };
  global.requestInitialData = (url, useMobile, useAuth) => {
    requestedPages.push({url, useMobile, useAuth});
    return {contents: {twoColumnWatchNextResults: {results: {results: {contents: [{
      itemSectionRenderer: {
        targetId: "comments-section",
        contents: [{continuationItemRenderer: {
          continuationEndpoint: {continuationCommand: {token: "SANITIZED_CONTINUATION"}}
        }}]
      }
    }]}}}}};
  };
  global.getAuthContextHeaders = useMobile => {
    assert.equal(useMobile, true);
    return {};
  };
  global.URL_BASE = "https://www.youtube.com";
  global.URL_BASE_M = "https://m.youtube.com";
  const editServiceEndpoint = {
    commandMetadata: {webCommandMetadata: {
      apiUrl: "/youtubei/v1/comment/update_comment"
    }},
    updateCommentEndpoint: {updateCommentParams: "SANITIZED_WEB_EDIT_PARAMS"}
  };
  const responseRenderer = {
    commentId,
    isCurrentUser: true,
    actionMenu: {menuRenderer: {items: [{menuNavigationItemRenderer: {
      text: {runs: [{text: "Edit"}]},
      navigationEndpoint: {updateCommentDialogEndpoint: {dialog: {
        commentDialogRenderer: {submitButton: {buttonRenderer: {
          serviceEndpoint: editServiceEndpoint
        }}}
      }}}
    }}]}}
  };
  global.http = {POST: (url, body, _headers, useAuth) => {
    posted.push({url, body: JSON.parse(body), useAuth});
    return {isOk: true, body: JSON.stringify({commentRenderer: responseRenderer})};
  }};

  try {
    const actions = mutations.ytCommentRefreshDesktopEditActions(
      "https://m.youtube.com/watch?v=SANITIZED_VIDEO&lc=" + commentId,
      commentId
    );
    const edit = JSON.parse(actions.commands.edit);
    assert.equal(edit.endpointKey, "updateCommentDialogEndpoint");
    assert.equal(edit.clientMode, "WEB");
    assert.deepEqual(requestedPages, [{
      url: "https://www.youtube.com/watch?v=SANITIZED_VIDEO&lc=" + commentId,
      useMobile: false,
      useAuth: true
    }]);
    assert.equal(posted[0].url.startsWith(
      "https://m.youtube.com/youtubei/v1/next?key=SANITIZED_WEB_KEY"
    ), true);
    assert.equal(posted[0].body.context.client.clientName, "WEB");
    assert.equal(posted[0].body.continuation, "SANITIZED_CONTINUATION");
    assert.equal(posted[0].useAuth, true);
  } finally {
    for (const name of [
      "bridge", "getClientContext", "requestClientConfig", "requestInitialData",
      "getAuthContextHeaders", "URL_BASE", "URL_BASE_M", "http"
    ]) delete global[name];
  }
});

test("resolves missing Edit from WEB before requesting the mobile comment pager", () => {
  const account = "SANITIZED_EDIT_FAST_CHANNEL";
  const commentId = "SANITIZED_EDIT_FAST_COMMENT";
  let pagerRequests = 0;
  const requestedPages = [];
  const refreshLogs = [];
  global.bridge = {isLoggedIn: () => true, log: value => refreshLogs.push(String(value))};
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: account,
    INNERTUBE_CONTEXT: {client: {clientName: "MWEB", clientVersion: "MWEB_VERSION"}}
  });
  global.requestClientConfig = () => ({
    DELEGATED_SESSION_ID: account,
    INNERTUBE_API_KEY: "SANITIZED_EDIT_FAST_KEY",
    INNERTUBE_CONTEXT: {client: {clientName: "WEB", clientVersion: "WEB_VERSION"}}
  });
  global.requestInitialData = (url, useMobile, useAuth) => {
    requestedPages.push({url, useMobile, useAuth});
    return {commentRenderer: {
      commentId,
      isCurrentUser: true,
      actionMenu: {items: [{text: "Edit", serviceEndpoint: {
        commandMetadata: {webCommandMetadata: {
          apiUrl: "/youtubei/v1/comment/update_comment"
        }},
        updateCommentEndpoint: {updateCommentParams: "SANITIZED_EDIT_FAST_PARAMS"}
      }}]}
    }};
  };
  global.http = {};
  global.source = {getComments: () => { pagerRequests++; }};

  const comment = {
    id: commentId,
    contextUrl: "https://m.youtube.com/watch?v=SANITIZED_VIDEO",
    context: {},
    capabilities: ["COMMENTS_EDIT"],
    isOwnedByUser: true,
    userReaction: "NONE"
  };
  try {
    const command = JSON.parse(mutations.ytCommentAcquireCommentCommand(comment, "edit"));
    assert.equal(command.endpointKey, "updateCommentEndpoint");
    assert.equal(command.clientMode, "WEB", JSON.stringify({command, requestedPages, pagerRequests, refreshLogs}));
    assert.equal(pagerRequests, 0);
    assert.deepEqual(requestedPages, [{
      url: "https://www.youtube.com/watch?v=SANITIZED_VIDEO&lc=" + commentId,
      useMobile: false,
      useAuth: true
    }]);
  } finally {
    for (const name of [
      "bridge", "getClientContext", "requestClientConfig", "requestInitialData", "http", "source"
    ]) delete global[name];
  }
});

test("refreshes stale WEB auth state and builds coherent MWEB mutation transport", () => {
  const stale = {
    DELEGATED_SESSION_ID: "SANITIZED_CURRENT_CHANNEL",
    SESSION_INDEX: 0,
    INNERTUBE_API_KEY: "SANITIZED_OLD_KEY",
    INNERTUBE_CONTEXT: {client: {
      clientName: "WEB",
      clientVersion: "2.20250927.00.01",
      platform: "DESKTOP"
    }}
  };
  const current = {
    DELEGATED_SESSION_ID: "SANITIZED_CURRENT_CHANNEL",
    SESSION_INDEX: 3,
    INNERTUBE_API_KEY: "SANITIZED_CURRENT_KEY",
    INNERTUBE_CONTEXT: {client: {
      clientName: "MWEB",
      clientVersion: "2.20260731.01.00",
      visitorData: "SANITIZED_VISITOR"
    }}
  };
  global.bridge = {isLoggedIn: () => true};
  global.getClientContext = () => stale;
  global.requestClientConfig = (useMobile, useAuth) => {
    assert.equal(useMobile, true);
    assert.equal(useAuth, true);
    return current;
  };
  global.getAuthContextHeaders = useMobile => {
    assert.equal(useMobile, true);
    return {};
  };
  global.URL_BASE = "https://www.youtube.com";
  global.URL_BASE_M = "https://m.youtube.com";

  try {
    const refreshed = mutations.ytCommentGetMutationClientConfig(true);
    const transport = mutations.ytCommentMutationTransport(refreshed);
    assert.equal(refreshed, current);
    assert.equal(transport.baseUrl, "https://m.youtube.com");
    assert.equal(transport.headers["x-origin"], "https://m.youtube.com");
    assert.equal(transport.headers["x-youtube-client-name"], "2");
    assert.equal(transport.headers["x-youtube-client-version"], "2.20260731.01.00");
    assert.equal(transport.headers["x-goog-authuser"], "3");
    assert.equal(transport.headers["x-goog-pageid"], "SANITIZED_CURRENT_CHANNEL");
  } finally {
    delete global.bridge;
    delete global.getClientContext;
    delete global.requestClientConfig;
    delete global.getAuthContextHeaders;
    delete global.URL_BASE;
    delete global.URL_BASE_M;
  }
});

test("reuses MWEB configuration warmed by comment-page HTML", () => {
  const current = {
    DELEGATED_SESSION_ID: "SANITIZED_WARM_CHANNEL",
    INNERTUBE_API_KEY: "SANITIZED_WARM_KEY",
    INNERTUBE_CONTEXT: {client: {
      clientName: "MWEB",
      clientVersion: "2.20260731.01.00"
    }}
  };
  let contextRequests = 0;
  global.getClientContext = () => current;
  global.requestClientConfig = () => { contextRequests++; return current; };
  try {
    assert.equal(mutations.ytCommentRememberMutationClientConfig(current), true);
    assert.equal(mutations.ytCommentGetMutationClientConfig(false), current);
    assert.equal(contextRequests, 0);
  } finally {
    delete global.getClientContext;
    delete global.requestClientConfig;
  }
});

test("marks a server-confirmed created comment owned with lazy Edit only", () => {
  const responseData = fixture("create-success.json");
  let metadataRefreshes = 0;
  const timing = [];
  global.bridge = {
    isLoggedIn: () => true,
    log: value => { if (String(value).startsWith("YT_COMMENT_TIMING ")) timing.push(value); }
  };
  global.getClientContext = () => ({
    DELEGATED_SESSION_ID: "SANITIZED_FAST_CHANNEL",
    INNERTUBE_API_KEY: "SANITIZED_FAST_KEY",
    INNERTUBE_CONTEXT: {client: {
      clientName: "MWEB",
      clientVersion: "2.20260731.01.00"
    }, user: {}}
  });
  global.getAuthContextHeaders = () => ({});
  global.URL_BASE = "https://www.youtube.com";
  global.URL_BASE_M = "https://m.youtube.com";
  global.PLATFORM = "YouTube";
  global.PLATFORM_CLAIMTYPE = 1;
  global.config = {id: "SANITIZED_PLUGIN"};
  global.PlatformID = class { constructor(platform, value) { this.platform = platform; this.value = value; } };
  global.PlatformAuthorLink = class { constructor(id, name, url, thumbnail) { Object.assign(this, {id, name, url, thumbnail}); } };
  global.RatingLikes = class { constructor(likes) { this.likes = likes; } };
  global.Comment = class { constructor(definition) { Object.assign(this, definition); } };
  global.requestInitialData = () => { metadataRefreshes++; return {}; };
  global.http = {
    POST: () => ({isOk: true, code: 200, body: JSON.stringify(responseData)})
  };

  try {
    const result = mutations.ytCommentSubmitCommand(
      "https://m.youtube.com/watch?v=SANITIZED_VIDEO",
      JSON.stringify({
        endpointKey: "createCommentEndpoint",
        apiUrl: "/youtubei/v1/comment/create_comment",
        payload: {createCommentParams: "SANITIZED_CREATE_PARAMS"}
      }),
      "Created fixture",
      "NONE",
      false
    );
    assert.equal(result.success, true);
    assert.equal(metadataRefreshes, 0);
    assert.equal(result.comment.isOwnedByUser, true);
    assert.equal(result.comment.capabilities.includes("COMMENTS_EDIT"), true);
    assert.equal(result.comment.capabilities.includes("COMMENTS_DELETE"), false);
    assert.equal(timing.length, 1);
  } finally {
    for (const name of [
      "bridge", "getClientContext", "getAuthContextHeaders", "URL_BASE", "URL_BASE_M",
      "PLATFORM", "PLATFORM_CLAIMTYPE", "config", "PlatformID", "PlatformAuthorLink",
      "RatingLikes", "Comment", "requestInitialData", "http"
    ]) delete global[name];
  }
});

test("reacquires reply metadata after installing a current mutation context", () => {
  const data = fixture("comment-entity-actions.json");
  global.requestInitialData = () => data;
  const comment = {
    id: "SANITIZED_ENTITY_COMMENT",
    contextUrl: "https://www.youtube.com/watch?v=SANITIZED_VIDEO",
    context: {replyCommand: JSON.stringify({
      endpointKey: "createCommentReplyEndpoint",
      payload: {createReplyParams: "SANITIZED_STALE_REPLY_PARAMS"}
    })},
    capabilities: ["COMMENTS_REPLY"],
    isOwnedByUser: false,
    userReaction: "NONE"
  };

  try {
    const command = mutations.ytCommentAcquireCommentCommand(comment, "reply", true);
    assert.notEqual(
      JSON.parse(command).payload.createReplyParams,
      "SANITIZED_STALE_REPLY_PARAMS"
    );
    assert.equal(JSON.parse(command).endpointKey, "createCommentReplyDialogEndpoint");
  } finally {
    delete global.requestInitialData;
  }
});

test("submits a cached comment command without refreshing", () => {
  let refreshes = 0;
  let submits = 0;
  const result = mutations.ytCommentSubmitWithSafeRefresh(
    "SANITIZED_CACHED_COMMAND",
    () => { refreshes++; return "SANITIZED_REFRESHED_COMMAND"; },
    command => {
      submits++;
      assert.equal(command, "SANITIZED_CACHED_COMMAND");
      return {success: true};
    }
  );
  assert.equal(result.success, true);
  assert.equal(refreshes, 0);
  assert.equal(submits, 1);
});

test("refreshes and retries exactly once after a definitive HTTP 400", () => {
  let refreshes = 0;
  const submitted = [];
  const result = mutations.ytCommentSubmitWithSafeRefresh(
    "SANITIZED_STALE_COMMAND",
    () => { refreshes++; return "SANITIZED_REFRESHED_COMMAND"; },
    command => {
      submitted.push(command);
      return command === "SANITIZED_STALE_COMMAND"
        ? {success: false, httpCode: 400}
        : {success: true};
    }
  );
  assert.equal(result.success, true);
  assert.equal(refreshes, 1);
  assert.deepEqual(submitted, ["SANITIZED_STALE_COMMAND", "SANITIZED_REFRESHED_COMMAND"]);
});

test("retries an HTTP 400 only once even when the refreshed command is unchanged", () => {
  let submits = 0;
  const result = mutations.ytCommentSubmitWithSafeRefresh(
    "SANITIZED_UNCHANGED_COMMAND",
    () => "SANITIZED_UNCHANGED_COMMAND",
    () => {
      submits++;
      return submits === 1
        ? {success: false, httpCode: 400}
        : {success: true};
    }
  );
  assert.equal(result.success, true);
  assert.equal(submits, 2);
});

test("parses sanitized successful response payload families", () => {
  for (const name of ["create-success.json", "reply-success.json", "edit-success.json"])
    assert.ok(mutations.ytCommentFindFirstPayload(fixture(name), "commentEntityPayload"));
  assert.equal(fixture("delete-success.json").command.deleteCommentAction.status, "STATUS_SUCCEEDED");
  assert.equal(fixture("reaction-success.json").actionResult.status, "STATUS_SUCCEEDED");
  assert.equal(mutations.ytCommentFindFirstPayload(fixture("schema-change.json"), "commentEntityPayload"), null);
});

test("extracts existing like and dislike states", () => {
  assert.equal(mutations.ytCommentExtractCommentActions(fixture("comment-liked.json").commentRenderer).userReaction, "LIKE");
  assert.equal(mutations.ytCommentExtractCommentActions(fixture("comment-disliked.json").commentRenderer).userReaction, "DISLIKE");
});

test("normalizes validation, authentication, rate limit, and moderation states", () => {
  assert.equal(mutations.ytCommentValidateText("   ").errorCode, "INVALID_TEXT");
  assert.equal(mutations.ytCommentValidateText("x".repeat(10001)).errorCode, "TEXT_TOO_LONG");
  assert.equal(mutations.ytCommentNormalizeHttpFailure(fixture("auth-failure.json").httpCode).errorCode, "SESSION_EXPIRED");
  assert.equal(mutations.ytCommentNormalizeHttpFailure(fixture("rate-limited.json").httpCode).retryable, true);
  assert.equal(mutations.ytCommentNormalizeHttpFailure(400).httpCode, 400);
  assert.equal(mutations.ytCommentResponseVisibility(fixture("moderation-hold.json")), "HELD_FOR_REVIEW");
});

test("sanitized fixture set contains no private authentication material", () => {
  const text = fs.readdirSync(fixtureRoot)
    .filter(name => name.endsWith(".json"))
    .map(name => fs.readFileSync(path.join(fixtureRoot, name), "utf8"))
    .join("\n");
  assert.doesNotMatch(text, /(?:SAPISID|Authorization|Cookie|HSID|SSID)=?/i);
});
