const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const outputDir = path.join(__dirname, "..", "supabase-import");

const groups = {
  A: [
    team("MEX", "Mexico"),
    team("RSA", "South Africa"),
    team("KOR", "Korea Republic"),
    team("CZE", "Czechia"),
  ],
  B: [
    team("CAN", "Canada"),
    team("BIH", "Bosnia and Herzegovina"),
    team("QAT", "Qatar"),
    team("SUI", "Switzerland"),
  ],
  C: [team("BRA", "Brazil"), team("MAR", "Morocco"), team("HAI", "Haiti"), team("SCO", "Scotland")],
  D: [team("USA", "USA"), team("PAR", "Paraguay"), team("AUS", "Australia"), team("TUR", "Turkiye")],
  E: [
    team("CIV", "Cote d'Ivoire"),
    team("ECU", "Ecuador"),
    team("GER", "Germany"),
    team("CUW", "Curacao"),
  ],
  F: [team("NED", "Netherlands"), team("JPN", "Japan"), team("SWE", "Sweden"), team("TUN", "Tunisia")],
  G: [team("IRN", "IR Iran"), team("NZL", "New Zealand"), team("BEL", "Belgium"), team("EGY", "Egypt")],
  H: [
    team("KSA", "Saudi Arabia"),
    team("URU", "Uruguay"),
    team("ESP", "Spain"),
    team("CPV", "Cabo Verde"),
  ],
  I: [team("FRA", "France"), team("SEN", "Senegal"), team("IRQ", "Iraq"), team("NOR", "Norway")],
  J: [team("ARG", "Argentina"), team("ALG", "Algeria"), team("AUT", "Austria"), team("JOR", "Jordan")],
  K: [team("POR", "Portugal"), team("COD", "Congo DR"), team("UZB", "Uzbekistan"), team("COL", "Colombia")],
  L: [team("GHA", "Ghana"), team("PAN", "Panama"), team("ENG", "England"), team("CRO", "Croatia")],
};

const venues = [
  "Mexico City Stadium",
  "Estadio Guadalajara",
  "Toronto Stadium",
  "Los Angeles Stadium",
  "Boston Stadium",
  "BC Place Vancouver",
  "New York New Jersey Stadium",
  "San Francisco Bay Area Stadium",
  "Philadelphia Stadium",
  "Houston Stadium",
  "Dallas Stadium",
  "Estadio Monterrey",
  "Miami Stadium",
  "Atlanta Stadium",
  "Seattle Stadium",
  "Kansas City Stadium",
];

const files = [
  {
    name: "profiles.csv",
    headers: ["id", "username", "display_name", "email", "avatar_url", "created_at"],
    rows: [],
  },
  {
    name: "fixtures.csv",
    headers: [
      "id",
      "fifa_match_id",
      "round",
      "group_code",
      "home_team",
      "away_team",
      "kickoff_at",
      "venue",
      "status",
      "home_score",
      "away_score",
      "winner_team",
      "updated_at",
    ],
    rows: buildFixtures(),
  },
  {
    name: "tournament_predictions.csv",
    headers: [
      "id",
      "user_id",
      "group_rankings",
      "third_place_qualifiers",
      "knockout_picks",
      "final_placements",
      "locked_at",
      "submitted_at",
      "updated_at",
    ],
    rows: [],
  },
  {
    name: "match_predictions.csv",
    headers: [
      "id",
      "user_id",
      "fixture_id",
      "predicted_home_score",
      "predicted_away_score",
      "predicted_outcome",
      "locked_at",
      "submitted_at",
      "updated_at",
    ],
    rows: [],
  },
  {
    name: "scores.csv",
    headers: [
      "id",
      "user_id",
      "bracket_score",
      "match_score",
      "total_score",
      "exact_scores_count",
      "correct_results_count",
      "updated_at",
    ],
    rows: [],
  },
  {
    name: "score_events.csv",
    headers: ["id", "user_id", "source_type", "source_id", "points", "reason", "created_at"],
    rows: [],
  },
  {
    name: "admin_audit_logs.csv",
    headers: ["id", "admin_user_id", "action", "details", "created_at"],
    rows: [],
  },
];

fs.mkdirSync(outputDir, { recursive: true });
files.forEach((file) => {
  const csv = [file.headers.join(","), ...file.rows.map((row) => file.headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
  fs.writeFileSync(path.join(outputDir, file.name), `${csv}\n`);
});

console.log(`Created ${files.length} Supabase CSV files in ${outputDir}`);

function buildFixtures() {
  return [...buildGroupFixtures(), ...buildKnockoutFixtures(73)];
}

function buildGroupFixtures() {
  const pairings = {
    group_1: [
      [0, 1],
      [2, 3],
    ],
    group_2: [
      [0, 2],
      [3, 1],
    ],
    group_3: [
      [3, 0],
      [1, 2],
    ],
  };
  const dates = {
    group_1: {
      A: "2026-06-11",
      B: "2026-06-12",
      C: "2026-06-13",
      D: "2026-06-13",
      E: "2026-06-14",
      F: "2026-06-14",
      G: "2026-06-15",
      H: "2026-06-15",
      I: "2026-06-16",
      J: "2026-06-16",
      K: "2026-06-17",
      L: "2026-06-17",
    },
    group_2: {
      A: "2026-06-18",
      B: "2026-06-18",
      C: "2026-06-19",
      D: "2026-06-19",
      E: "2026-06-20",
      F: "2026-06-20",
      G: "2026-06-21",
      H: "2026-06-21",
      I: "2026-06-22",
      J: "2026-06-22",
      K: "2026-06-23",
      L: "2026-06-23",
    },
    group_3: {
      A: "2026-06-24",
      B: "2026-06-24",
      C: "2026-06-24",
      D: "2026-06-25",
      E: "2026-06-25",
      F: "2026-06-25",
      G: "2026-06-26",
      H: "2026-06-26",
      I: "2026-06-26",
      J: "2026-06-27",
      K: "2026-06-27",
      L: "2026-06-27",
    },
  };
  const rows = [];
  let matchNumber = 1;
  Object.entries(pairings).forEach(([round, roundPairings]) => {
    Object.entries(groups).forEach(([groupCode, teams]) => {
      roundPairings.forEach(([homeIndex, awayIndex], pairIndex) => {
        const isOpener = matchNumber === 1;
        const kickoff = `${dates[round][groupCode]}T${isOpener ? "18:00:00Z" : pairIndex === 0 ? "17:00:00Z" : "22:00:00Z"}`;
        rows.push(fixtureRow(matchNumber, round, groupCode, teams[homeIndex].name, teams[awayIndex].name, kickoff));
        matchNumber += 1;
      });
    });
  });
  return rows;
}

function buildKnockoutFixtures(startNumber) {
  const rounds = [
    ["round_32", "2026-06-28", 16],
    ["round_16", "2026-07-04", 8],
    ["quarter_final", "2026-07-09", 4],
    ["semi_final", "2026-07-14", 2],
  ];
  const rows = [];
  let matchNumber = startNumber;
  rounds.forEach(([round, startDate, count]) => {
    for (let index = 0; index < count; index += 1) {
      const date = addDays(startDate, Math.floor(index / 4));
      const kickoff = `${date}T${index % 2 === 0 ? "19:00:00Z" : "00:00:00Z"}`;
      rows.push(fixtureRow(matchNumber, round, "", "TBD", "TBD", kickoff));
      matchNumber += 1;
    }
  });
  rows.push(fixtureRow(matchNumber, "third_place", "", "Semi-final loser", "Semi-final loser", "2026-07-18T21:00:00Z"));
  rows.push(fixtureRow(matchNumber + 1, "final", "", "Finalist", "Finalist", "2026-07-19T19:00:00Z"));
  return rows;
}

function fixtureRow(matchNumber, round, groupCode, homeTeam, awayTeam, kickoffAt) {
  return {
    id: uuidFor(`fixture-M${matchNumber}`),
    fifa_match_id: `M${matchNumber}`,
    round,
    group_code: groupCode,
    home_team: homeTeam,
    away_team: awayTeam,
    kickoff_at: kickoffAt,
    venue: venues[(matchNumber - 1) % venues.length],
    status: "scheduled",
    home_score: "",
    away_score: "",
    winner_team: "",
    updated_at: "2026-06-10T00:00:00Z",
  };
}

function team(code, name) {
  return { code, name };
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uuidFor(value) {
  const hash = crypto.createHash("sha1").update(value).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0")}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
