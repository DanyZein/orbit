// Generates fictional sample data so the app can be run and screenshotted
// without exposing anyone's real ledger.
//
//   node scripts/seed-demo.mjs            # writes demo/config.json + demo/entries.json
//   ORBIT_DATA=demo node server/server.mjs
//
// Deterministic: same output every run.

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "demo");

// mulberry32: small seeded PRNG so the sample is reproducible
function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20261004);

const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ids are opaque 13-char strings, same shape the app generates
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function makeId() {
  let s = "";
  for (let i = 0; i < 13; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

const groups = [
  { id: makeId(), name: "Roommates", color: "#5EEAD4" },
  { id: makeId(), name: "College friends", color: "#c0c737" },
  { id: makeId(), name: "Family", color: "#52c4ff" },
  { id: makeId(), name: "Climbing crew", color: "#F472B6" },
  { id: makeId(), name: "Neighbors", color: "#ff9045" },
  { id: makeId(), name: "Book club", color: "#7CD992" },
];

const activityTypes = [
  { id: "t1", name: "coffee / quick hang", tier: "light" },
  { id: "t2", name: "eat out", tier: "light" },
  { id: "t3", name: "call", tier: "light" },
  { id: "t4", name: "nature", tier: "light" },
  { id: "t5", name: "movie night", tier: "light" },
  { id: "t6", name: "day out (activity + food)", tier: "medium" },
  { id: "t7", name: "overnight", tier: "heavy" },
  { id: "t8", name: "camping", tier: "heavy" },
  { id: "t9", name: "road trip", tier: "heavy" },
];

const byTier = {
  light: activityTypes.filter((t) => t.tier === "light"),
  medium: activityTypes.filter((t) => t.tier === "medium"),
  heavy: activityTypes.filter((t) => t.tier === "heavy"),
};

const NOTES = [
  "", "", "", "", "",
  "same place as always",
  "long overdue",
  "good to catch up properly",
  "ended up staying way later than planned",
  "second time this month",
  "needed that",
  "quiet one, just the two of us",
  "bigger group than expected",
  "first time trying that spot",
];

const DURATION = { light: [1, 4], medium: [3, 7], heavy: [8, 26] };

// weighted so most hangouts land at 3-5, with the occasional flat one
function enjoyment() {
  const r = rand();
  if (r < 0.04) return 2;
  if (r < 0.28) return 3;
  if (r < 0.72) return 4;
  return 5;
}

function energy() {
  const r = rand();
  if (r < 0.42) return "energized";
  if (r < 0.84) return "neutral";
  return "drained";
}

const entries = [];
const start = new Date("2026-06-15T00:00:00Z");
const days = 110;

for (let d = 0; d < days; d++) {
  const date = new Date(start.getTime() + d * 86400000);
  const dow = date.getUTCDay();
  // weekends are busier, some weekdays are dead
  const roll = rand();
  const weekend = dow === 0 || dow === 6;
  const count = weekend ? (roll < 0.35 ? 2 : roll < 0.8 ? 1 : 0) : roll < 0.45 ? 1 : 0;

  for (let k = 0; k < count; k++) {
    const tierRoll = rand();
    const tier = tierRoll < 0.6 ? "light" : tierRoll < 0.87 ? "medium" : "heavy";
    const type = pick(byTier[tier]);
    const [lo, hi] = DURATION[tier];

    // 1-3 groups, weighted toward a single group
    const nGroups = rand() < 0.58 ? 1 : rand() < 0.85 ? 2 : 3;
    const chosen = [];
    while (chosen.length < nGroups) {
      const g = pick(groups).id;
      if (!chosen.includes(g)) chosen.push(g);
    }

    entries.push({
      date: date.toISOString().slice(0, 10),
      groupIds: chosen,
      activityTypeId: type.id,
      duration: between(lo, hi),
      initiator: rand() < 0.55 ? "me" : "them",
      enjoyment: enjoyment(),
      energy: energy(),
      notes: pick(NOTES),
      id: makeId(),
    });
  }
}

entries.sort((a, b) => (a.date < b.date ? -1 : 1));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "config.json"), JSON.stringify({ groups, activityTypes }, null, 2));
writeFileSync(join(OUT, "entries.json"), JSON.stringify(entries, null, 2));

console.log(`wrote ${join(OUT, "config.json")}  (${groups.length} groups, ${activityTypes.length} types)`);
console.log(`wrote ${join(OUT, "entries.json")}  (${entries.length} entries)`);
