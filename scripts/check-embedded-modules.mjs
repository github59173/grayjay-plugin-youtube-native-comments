import { readFile } from "node:fs/promises";

const outputPath = new URL("../YoutubeScript.js", import.meta.url);
const commentModulePath = new URL("../comment_mutations.js", import.meta.url);
const reactionModulePath = new URL("../video_reactions.js", import.meta.url);
const sponsorBlockModulePath = new URL("../sponsorblock.js", import.meta.url);
const marker = "// BEGIN GENERATED NATIVE PLATFORM COMMENT MODULES";

const output = await readFile(outputPath, "utf8");
const markerIndex = output.indexOf(marker);
if (markerIndex < 0) {
    throw new Error("YoutubeScript.js does not contain the generated module marker");
}

const commentModule = (await readFile(commentModulePath, "utf8")).trim();
const reactionModule = (await readFile(reactionModulePath, "utf8")).trim();
const sponsorBlockModule = (await readFile(sponsorBlockModulePath, "utf8")).trim();
const generatedSection = output.slice(markerIndex);

if (!generatedSection.includes(commentModule) || !generatedSection.includes(reactionModule) || !generatedSection.includes(sponsorBlockModule)) {
    throw new Error("YoutubeScript.js is stale; run npm run build");
}
