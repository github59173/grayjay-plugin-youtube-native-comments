/* Deterministic fake platform mutation source for contract/integration tests. */
const comments = new Map();
let sequence = 0;

function result(overrides) {
  return Object.assign({success: true, deleted: false, reaction: "NONE", retryable: false, visibility: "VISIBLE"}, overrides);
}

function makeComment(message, parentId = null) {
  const id = `FAKE_${++sequence}`;
  const comment = {
    contextUrl: "https://fake.invalid/watch/fixture",
    id,
    message,
    parentId,
    isOwnedByUser: true,
    isEdited: false,
    userReaction: "NONE",
    capabilities: ["COMMENTS_REPLY", "COMMENTS_EDIT", "COMMENTS_DELETE", "COMMENTS_LIKE", "COMMENTS_DISLIKE"],
    context: {commentId: id}
  };
  comments.set(id, comment);
  return comment;
}

const source = {
  createComment(_contentUrl, message) {
    return result({comment: makeComment(message), visibility: "ACKNOWLEDGED"});
  },
  replyToComment(parent, message) {
    return result({comment: makeComment(message, parent.id), visibility: "ACKNOWLEDGED"});
  },
  editComment(comment, message) {
    const updated = Object.assign({}, comment, {message, isEdited: true});
    comments.set(comment.id, updated);
    return result({comment: updated, reaction: updated.userReaction});
  },
  deleteComment(comment) {
    comments.delete(comment.id);
    return result({deleted: true, visibility: "DELETED"});
  },
  likeComment(comment, enabled) {
    comment.userReaction = enabled ? "LIKE" : "NONE";
    return result({comment, reaction: comment.userReaction});
  },
  dislikeComment(comment, enabled) {
    comment.userReaction = enabled ? "DISLIKE" : "NONE";
    return result({comment, reaction: comment.userReaction});
  }
};

if (typeof module !== "undefined") module.exports = {source, comments};
