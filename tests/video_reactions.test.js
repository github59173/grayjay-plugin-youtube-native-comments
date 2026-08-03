const test = require("node:test");
const assert = require("node:assert/strict");

const reactions = require("../video_reactions.js");

function command(apiUrl, endpointKey, videoId = "SANITIZED_VIDEO") {
  return {
    commandMetadata: {webCommandMetadata: {apiUrl}},
    [endpointKey]: {target: {videoId}}
  };
}

test("normalizes desktop, mobile, and short YouTube video URLs", () => {
  assert.equal(reactions.yvrVideoId("https://www.youtube.com/watch?v=SANITIZED_VIDEO"), "SANITIZED_VIDEO");
  assert.equal(reactions.yvrVideoId("https://m.youtube.com/watch?app=desktop&v=SANITIZED_VIDEO"), "SANITIZED_VIDEO");
  assert.equal(reactions.yvrVideoId("https://youtu.be/SANITIZED_VIDEO"), "SANITIZED_VIDEO");
});

test("extracts legacy YouTube like, dislike, and remove commands", () => {
  const inspected = reactions.yvrInspect({
    videoActions: {
      segmentedLikeDislikeButtonRenderer: {
        likeButton: {
          toggleButtonRenderer: {
            isToggled: true,
            defaultServiceEndpoint: command("/youtubei/v1/like/like", "likeEndpoint"),
            toggledServiceEndpoint: command("/youtubei/v1/like/removelike", "removeLikeEndpoint")
          }
        },
        dislikeButton: {
          toggleButtonRenderer: {
            isToggled: false,
            defaultServiceEndpoint: command("/youtubei/v1/like/dislike", "dislikeEndpoint"),
            toggledServiceEndpoint: command("/youtubei/v1/like/removelike", "removeLikeEndpoint")
          }
        }
      }
    }
  }, "SANITIZED_VIDEO");

  assert.equal(inspected.reaction, "LIKE");
  assert.equal(inspected.canLike, true);
  assert.equal(inspected.canDislike, true);
  assert.equal(inspected.commands.like.apiUrl, "/youtubei/v1/like/like");
  assert.equal(inspected.commands.dislike.apiUrl, "/youtubei/v1/like/dislike");
  assert.equal(inspected.commands.remove.apiUrl, "/youtubei/v1/like/removelike");
});

test("extracts current mobile view-model actions and selected dislike state", () => {
  const inspected = reactions.yvrInspect({
    slimVideoActionBarRenderer: {
      buttons: [{
        slimMetadataButtonRenderer: {
          button: {
            segmentedLikeDislikeButtonViewModel: {
              likeButtonViewModel: {
                toggleButtonViewModel: {
                  isToggled: false,
                  defaultButtonViewModel: {
                    buttonViewModel: {
                      onTap: {innertubeCommand: command("/youtubei/v1/like/like", "likeEndpoint")}
                    }
                  },
                  toggledButtonViewModel: {
                    buttonViewModel: {
                      onTap: {innertubeCommand: command("/youtubei/v1/like/removelike", "removeLikeEndpoint")}
                    }
                  }
                }
              },
              dislikeButtonViewModel: {
                toggleButtonViewModel: {
                  isToggled: true,
                  defaultButtonViewModel: {
                    buttonViewModel: {
                      onTap: {innertubeCommand: command("/youtubei/v1/like/dislike", "dislikeEndpoint")}
                    }
                  },
                  toggledButtonViewModel: {
                    buttonViewModel: {
                      onTap: {innertubeCommand: command("/youtubei/v1/like/removelike", "removeLikeEndpoint")}
                    }
                  }
                }
              }
            }
          }
        }
      }]
    }
  }, "SANITIZED_VIDEO");

  assert.equal(inspected.reaction, "DISLIKE");
  assert.equal(inspected.canLike, true);
  assert.equal(inspected.canDislike, true);
});

test("ignores reaction commands explicitly targeting a different video", () => {
  const inspected = reactions.yvrInspect({
    videoActions: {
      like: command("/youtubei/v1/like/like", "likeEndpoint", "OTHER_VIDEO"),
      dislike: command("/youtubei/v1/like/dislike", "dislikeEndpoint", "OTHER_VIDEO"),
      remove: command("/youtubei/v1/like/removelike", "removeLikeEndpoint", "OTHER_VIDEO")
    }
  }, "SANITIZED_VIDEO");

  assert.equal(inspected.canLike, false);
  assert.equal(inspected.canDislike, false);
});
