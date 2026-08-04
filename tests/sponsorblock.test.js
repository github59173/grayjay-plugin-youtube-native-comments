const test = require("node:test");
const assert = require("node:assert/strict");
const sponsorBlock = require("../sponsorblock.js");

test("uses official ARGB defaults for all supported categories", () => {
    assert.equal(sponsorBlock.getSponsorBlockTimelineColor("sponsor", {}), "#B300D400");
    assert.equal(sponsorBlock.getSponsorBlockTimelineColor("selfpromo", {}), "#B3FFFF00");
    assert.equal(sponsorBlock.getSponsorBlockTimelineColor("filler", {}), "#E67300FF");
    assert.equal(sponsorBlock.getSponsorBlockTimelineColor("interaction", {}), null);
});

test("preserves custom alpha and falls back from malformed colors", () => {
    assert.equal(sponsorBlock.getSponsorBlockTimelineColor("sponsor", {sponsorBlockColor_Sponsor: "#40010203"}), "#40010203");
    assert.equal(sponsorBlock.getSponsorBlockTimelineColor("sponsor", {sponsorBlockColor_Sponsor: "green"}), "#B300D400");
});

test("only enables categories configured for manual or automatic skipping", () => {
    assert.deepEqual(sponsorBlock.getEnabledSponsorBlockCategories({
        sponsor: 1,
        intro: "2",
        outro: 0,
        filler: "not-a-number"
    }), ["sponsor", "intro"]);
});

test("preserves timeline colors while merging SponsorBlock and video chapters", () => {
    const sponsor = {name: "sponsor", timeStart: 10, timeEnd: 20, type: 5, timelineColor: "#B300D400"};
    const merged = sponsorBlock.mergeSBChapters(
        [{name: "Chapter", timeStart: 0, timeEnd: 30, type: 0}],
        [sponsor]
    );
    assert.equal(merged.length, 3);
    assert.equal(merged[1].timelineColor, "#B300D400");
    assert.equal(merged[0].timelineColor, undefined);
    assert.equal(merged[2].timelineColor, undefined);
});
