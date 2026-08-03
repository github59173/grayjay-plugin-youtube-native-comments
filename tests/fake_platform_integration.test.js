const test = require("node:test");
const assert = require("node:assert/strict");
const {source, comments} = require("../../fixtures/fake-platform-plugin.js");

test("fake source implements all six optional mutation methods", () => {
  for (const method of ["createComment", "replyToComment", "editComment", "deleteComment", "likeComment", "dislikeComment"])
    assert.equal(typeof source[method], "function");
});

test("fake source deterministically exercises create, reply, edit, reactions, and delete", () => {
  const created = source.createComment("https://fake.invalid/watch/fixture", "hello").comment;
  assert.ok(comments.has(created.id));
  const reply = source.replyToComment(created, "reply").comment;
  assert.equal(reply.parentId, created.id);
  const edited = source.editComment(created, "edited").comment;
  assert.equal(edited.isEdited, true);
  assert.equal(source.likeComment(edited, true).reaction, "LIKE");
  assert.equal(source.dislikeComment(edited, true).reaction, "DISLIKE");
  assert.equal(source.dislikeComment(edited, false).reaction, "NONE");
  assert.equal(source.deleteComment(edited).deleted, true);
  assert.equal(comments.has(edited.id), false);
});
