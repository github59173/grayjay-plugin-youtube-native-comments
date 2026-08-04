const SB_CATEGORY_COLORS = Object.freeze({
    sponsor: {setting: "sponsorBlockColor_Sponsor", defaultColor: "#B300D400"},
    intro: {setting: "sponsorBlockColor_Intro", defaultColor: "#B300FFFF"},
    outro: {setting: "sponsorBlockColor_Outro", defaultColor: "#B30202ED"},
    selfpromo: {setting: "sponsorBlockColor_Self", defaultColor: "#B3FFFF00"},
    music_offtopic: {setting: "sponsorBlockColor_Offtopic", defaultColor: "#B3FF9900"},
    preview: {setting: "sponsorBlockColor_Preview", defaultColor: "#B3008FD6"},
    filler: {setting: "sponsorBlockColor_Filler", defaultColor: "#E67300FF"}
});

function normalizeSponsorBlockColor(value, fallback) {
    const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
    return /^#[0-9A-F]{8}$/.test(normalized) ? normalized : fallback;
}

function getSponsorBlockTimelineColor(category, settings) {
    const config = SB_CATEGORY_COLORS[category];
    if(!config) return null;
    return normalizeSponsorBlockColor(settings?.[config.setting], config.defaultColor);
}

function getEnabledSponsorBlockCategories(categoryTypes) {
    return Object.keys(SB_CATEGORY_COLORS).filter(category => {
        const value = Number(categoryTypes?.[category]);
        return Number.isFinite(value) && value >= 1;
    });
}

function mergeSBChapters(videoChapters, sbChapters) {
    let newChapters = [];
    for(let videoChapter of videoChapters) {
        const sponsors = sbChapters.filter(x =>
            x.timeStart >= videoChapter.timeStart &&
            x.timeStart <= videoChapter.timeEnd);
        if(sponsors.length > 0) {
            let startTime = videoChapter.timeStart;
            let skip = false;
            for(let sponsorI = 0; sponsorI < sponsors.length && !skip; sponsorI++) {
                const sponsor = sponsors[sponsorI];
                const nextSponsor = (sponsorI + 1 < sponsors.length) ? sponsors[sponsorI + 1] : null;
                const videoChapterBefore = {
                    name: videoChapter.name,
                    timeStart: startTime,
                    timeEnd: sponsor.timeStart,
                    type: videoChapter.type
                };
                const videoChapterAfter = {
                    name: videoChapter.name,
                    timeStart: sponsor.timeEnd,
                    timeEnd: (nextSponsor != null) ? nextSponsor.timeStart : videoChapter.timeEnd,
                    type: videoChapter.type
                };

                if(sponsor.timeStart <= startTime && sponsor.timeEnd <= videoChapter.timeEnd) {
                    newChapters.push(sponsor);
                    skip = true;
                }
                else if(sponsor.timeStart <= startTime) {
                    newChapters.push(sponsor);
                    newChapters.push(videoChapterAfter);
                    startTime = videoChapterAfter.timeEnd;
                }
                else {
                    newChapters.push(videoChapterBefore);
                    newChapters.push(sponsor);
                    if(videoChapterAfter.timeStart < videoChapterAfter.timeEnd) {
                        newChapters.push(videoChapterAfter);
                        startTime = videoChapterAfter.timeEnd;
                    }
                    else startTime = videoChapterAfter.timeStart;
                }
            }
        }
        else newChapters.push(videoChapter);
    }
    return newChapters;
}

if(typeof module !== "undefined") {
    module.exports = {
        SB_CATEGORY_COLORS,
        normalizeSponsorBlockColor,
        getSponsorBlockTimelineColor,
        getEnabledSponsorBlockCategories,
        mergeSBChapters
    };
}
