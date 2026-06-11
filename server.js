const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5186);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "world-cup-users.csv");
const PREDICTIONS_FILE = path.join(DATA_DIR, "world-cup-predictor-data.csv");
const INTERNAL_AUTH_DOMAIN = "worldcup-predictor.invalid";

const userHeaders = ["created_at", "username", "email", "provider", "password_hash"];
const predictionHeaders = [
  "saved_at",
  "username",
  "email",
  "provider",
  "has_predictions",
  "has_results",
  "bracket_score",
  "match_score",
  "total_score",
  "groups_json",
  "third_qualifiers_json",
  "knockout_picks_json",
  "match_predictions_json",
];

ensureCsv(USERS_FILE, userHeaders);
ensureCsv(PREDICTIONS_FILE, predictionHeaders);

const server = http.createServer(async (request, response) => {
  try {
    if (request.url === "/api/signup" && request.method === "POST") {
      return handleSignup(request, response);
    }
    if (request.url === "/api/supabase-signup" && request.method === "POST") {
      return handleSupabaseSignup(request, response);
    }
    if (request.url === "/api/supabase-profile" && request.method === "POST") {
      return handleSupabaseProfile(request, response);
    }
    if (request.url === "/api/supabase-save" && request.method === "POST") {
      return handleSupabaseSave(request, response);
    }
    if (request.url === "/api/login" && request.method === "POST") {
      return handleLogin(request, response);
    }
    if (request.url === "/api/save" && request.method === "POST") {
      return handleSave(request, response);
    }
    if (request.url === "/api/export" && request.method === "GET") {
      return sendFile(response, PREDICTIONS_FILE, "text/csv; charset=utf-8", "world-cup-predictor-data.csv");
    }
    if (request.url === "/api/health" && request.method === "GET") {
      return sendJson(response, 200, { ok: true });
    }
    if (request.url === "/api/config" && request.method === "GET") {
      return sendJson(response, 200, {
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
        supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        hasServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      });
    }
    return serveStatic(request, response);
  } catch (error) {
    return sendJson(response, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`World Cup Predictor running at http://127.0.0.1:${PORT}`);
});

async function handleSignup(request, response) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const provider = String(body.provider || "username");
  if (!isValidUsername(username) || password.length < 6) {
    return sendJson(response, 400, { error: "Use a valid username and a 6+ character password." });
  }

  const users = readCsv(USERS_FILE);
  if (users.some((user) => normalizeUsername(user.username) === username)) {
    return sendJson(response, 409, { error: "That username already has an account. Please log in." });
  }

  users.push({
    created_at: new Date().toISOString(),
    username,
    email: "",
    provider,
    password_hash: hashPassword(password),
  });
  writeCsv(USERS_FILE, userHeaders, users);
  return sendJson(response, 200, { user: { username, email: "", provider } });
}

async function handleSupabaseSignup(request, response) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  if (!isValidUsername(username) || password.length < 6) {
    return sendJson(response, 400, { error: "Use a valid username and a 6+ character password." });
  }

  try {
    const { user, profile } = await createSupabaseUser(username, password);
    return sendJson(response, 200, {
      user: {
        id: user.id,
        username,
        email: "",
        provider: "supabase",
        profile,
      },
    });
  } catch (error) {
    return sendJson(response, error.status || 500, { error: error.message || "Signup failed" });
  }
}

async function handleSupabaseSave(request, response) {
  const body = await readJson(request);
  try {
    const result = await saveSupabaseSubmission(body);
    return sendJson(response, 200, result);
  } catch (error) {
    return sendJson(response, error.status || 500, { error: error.message || "Supabase save failed." });
  }
}

async function handleSupabaseProfile(request, response) {
  const body = await readJson(request);
  const userId = String(body.userId || "").trim();
  const username = normalizeUsername(body.username);
  if (!isUuid(userId) || !isValidUsername(username)) {
    return sendJson(response, 400, { error: "Valid user id and username are required." });
  }

  try {
    const profile = await repairSupabaseProfile(userId, username);
    return sendJson(response, 200, { profile });
  } catch (error) {
    return sendJson(response, error.status || 500, { error: error.message || "Profile could not be created." });
  }
}

async function handleLogin(request, response) {
  const body = await readJson(request);
  const username = normalizeUsername(body.username);
  const password = String(body.password || "");
  const users = readCsv(USERS_FILE);
  const user = users.find((item) => normalizeUsername(item.username) === username);
  if (!user || user.password_hash !== hashPassword(password)) {
    return sendJson(response, 401, { error: "Username or password is wrong." });
  }
  return sendJson(response, 200, {
    user: {
      username: user.username,
      email: user.email || "",
      provider: user.provider || "username",
    },
  });
}

async function handleSave(request, response) {
  const body = await readJson(request);
  const user = body.user || {};
  const username = normalizeUsername(user.username);
  const email = normalizeEmail(user.email);
  if (!username && !email) return sendJson(response, 400, { error: "Log in before saving predictions." });

  const rows = readCsv(PREDICTIONS_FILE);
  const next = {
    saved_at: new Date().toISOString(),
    username: username || email.split("@")[0],
    email,
    provider: user.provider || "username",
    has_predictions: String(Boolean(body.hasPredictions)),
    has_results: String(Boolean(body.hasResults)),
    bracket_score: String(Number(body.bracketScore || 0).toFixed(1)),
    match_score: String(Number(body.matchScore || 0).toFixed(1)),
    total_score: String(Number(body.totalScore || 0).toFixed(1)),
    groups_json: JSON.stringify(body.groups || {}),
    third_qualifiers_json: JSON.stringify(body.thirdQualifiers || []),
    knockout_picks_json: JSON.stringify(body.knockoutPicks || {}),
    match_predictions_json: JSON.stringify(body.matchPredictions || {}),
  };
  const existingIndex = rows.findIndex((row) =>
    email ? normalizeEmail(row.email) === email : normalizeUsername(row.username) === username
  );
  if (existingIndex >= 0) {
    rows[existingIndex] = next;
  } else {
    rows.push(next);
  }
  writeCsv(PREDICTIONS_FILE, predictionHeaders, rows);
  return sendJson(response, 200, { ok: true, file: PREDICTIONS_FILE });
}

function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${PORT}`).pathname);
  const safePath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(ROOT, safePath));
  if (!filePath.startsWith(ROOT)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
  }[path.extname(filePath)] || "application/octet-stream";
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendJson(response, 404, { error: "Not found" });
  }
  return sendFile(response, filePath, contentType);
}

function sendFile(response, filePath, contentType, downloadName) {
  response.writeHead(200, {
    "Content-Type": contentType,
    ...(downloadName ? { "Content-Disposition": `attachment; filename="${downloadName}"` } : {}),
  });
  fs.createReadStream(filePath).pipe(response);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 5_000_000) reject(new Error("Request body too large"));
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function ensureCsv(filePath, headers) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${headers.join(",")}\n`);
  }
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  const lines = parseCsv(text);
  const headers = lines[0] || [];
  return lines.slice(1).map((line) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = line[index] || "";
    });
    return row;
  });
}

function writeCsv(filePath, headers, rows) {
  const text = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
  fs.writeFileSync(filePath, `${text}\n`);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "").trim().toLowerCase();
}

function isValidUsername(username) {
  return /^[a-z0-9_]{3,24}$/.test(username);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function authEmailForUsername(username) {
  return `${normalizeUsername(username)}@${INTERNAL_AUTH_DOMAIN}`;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

async function createSupabaseUser(username, password) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    const error = new Error("Supabase service role key is missing on the server.");
    error.status = 500;
    throw error;
  }

  const email = authEmailForUsername(username);
  await assertSupabaseUsernameAvailable(supabaseUrl, serviceRoleKey, username);
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        display_name: username,
        auth_type: "username",
      },
    }),
  });
  const user = await userResponse.json().catch(() => ({}));
  if (!userResponse.ok) {
    const error = new Error(normalizeSupabaseError(user));
    error.status = userResponse.status === 422 ? 409 : userResponse.status;
    throw error;
  }

  const profile = await upsertSupabaseProfile(supabaseUrl, serviceRoleKey, user.id, username);
  return { user, profile };
}

async function repairSupabaseProfile(userId, username) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    const error = new Error("Supabase service role key is missing on the server.");
    error.status = 500;
    throw error;
  }
  return upsertSupabaseProfile(supabaseUrl, serviceRoleKey, userId, username);
}

async function saveSupabaseSubmission(submission) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl || !serviceRoleKey) {
    const error = new Error("Supabase service role key is missing on the server.");
    error.status = 500;
    throw error;
  }

  const user = submission.user || {};
  const userId = String(user.id || "").trim();
  const username = normalizeUsername(user.username);
  if (!isUuid(userId) || !isValidUsername(username)) {
    const error = new Error("Log in with a Supabase account before saving.");
    error.status = 400;
    throw error;
  }

  await upsertSupabaseProfile(supabaseUrl, serviceRoleKey, userId, username);
  await upsertTournamentPrediction(supabaseUrl, serviceRoleKey, userId, submission);
  const matchCount = await upsertMatchPredictions(supabaseUrl, serviceRoleKey, userId, submission.matchPredictions || {});
  await upsertScoreSnapshot(supabaseUrl, serviceRoleKey, userId, submission);
  return { ok: true, matchCount };
}

async function upsertTournamentPrediction(supabaseUrl, serviceRoleKey, userId, submission) {
  const response = await fetch(`${supabaseUrl}/rest/v1/tournament_predictions?on_conflict=user_id`, {
    method: "POST",
    headers: supabaseJsonHeaders(serviceRoleKey, "resolution=merge-duplicates"),
    body: JSON.stringify({
      user_id: userId,
      group_rankings: submission.groups || {},
      third_place_qualifiers: submission.thirdQualifiers || [],
      knockout_picks: submission.knockoutPicks || {},
      final_placements: submission.finalPlacements || {},
      locked_at: submission.bracketFinalizedAt || null,
      updated_at: new Date().toISOString(),
    }),
  });
  await assertSupabaseOk(response);
}

async function upsertMatchPredictions(supabaseUrl, serviceRoleKey, userId, matchPredictions) {
  const fixtureMap = await loadSupabaseFixtureMap(supabaseUrl, serviceRoleKey);
  const entries = [];
  Object.entries(matchPredictions).forEach(([matchId, prediction]) => {
    if (prediction.home === "" || prediction.away === "") return;
    const fixtureId = fixtureMap[matchId];
    if (!fixtureId) {
      if (prediction.finalizedAt) throw new Error(`Fixture ${matchId} is not synced to Supabase.`);
      return;
    }
    entries.push({
      user_id: userId,
      fixture_id: fixtureId,
      predicted_home_score: Number(prediction.home),
      predicted_away_score: Number(prediction.away),
      predicted_outcome: String(prediction.outcome || "").toLowerCase(),
      locked_at: prediction.finalizedAt || null,
      updated_at: new Date().toISOString(),
    });
  });
  if (!entries.length) return 0;
  const response = await fetch(`${supabaseUrl}/rest/v1/match_predictions?on_conflict=user_id,fixture_id`, {
    method: "POST",
    headers: supabaseJsonHeaders(serviceRoleKey, "resolution=merge-duplicates"),
    body: JSON.stringify(entries),
  });
  await assertSupabaseOk(response);
  return entries.length;
}

async function upsertScoreSnapshot(supabaseUrl, serviceRoleKey, userId, submission) {
  const response = await fetch(`${supabaseUrl}/rest/v1/scores?on_conflict=user_id`, {
    method: "POST",
    headers: supabaseJsonHeaders(serviceRoleKey, "resolution=merge-duplicates"),
    body: JSON.stringify({
      user_id: userId,
      bracket_score: Number(submission.bracketScore || 0),
      match_score: Number(submission.matchScore || 0),
      total_score: Number(submission.totalScore || 0),
      exact_scores_count: 0,
      correct_results_count: 0,
      updated_at: new Date().toISOString(),
    }),
  });
  await assertSupabaseOk(response);
}

async function loadSupabaseFixtureMap(supabaseUrl, serviceRoleKey) {
  const response = await fetch(`${supabaseUrl}/rest/v1/fixtures?select=id,fifa_match_id`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  await assertSupabaseOk(response);
  const fixtures = await response.json();
  return Object.fromEntries(fixtures.map((fixture) => [fixture.fifa_match_id, fixture.id]));
}

function supabaseJsonHeaders(serviceRoleKey, prefer) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: prefer,
  };
}

async function assertSupabaseOk(response) {
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  const error = new Error(normalizeSupabaseError(body));
  error.status = response.status;
  throw error;
}

async function assertSupabaseUsernameAvailable(supabaseUrl, serviceRoleKey, username) {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=id&username=eq.${encodeURIComponent(username)}&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(normalizeSupabaseError(body));
    error.status = response.status;
    throw error;
  }
  const rows = await response.json().catch(() => []);
  if (rows.length) {
    const error = new Error("That username is already taken.");
    error.status = 409;
    throw error;
  }
}

async function upsertSupabaseProfile(supabaseUrl, serviceRoleKey, userId, username) {
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id: userId,
      username,
      display_name: username,
      email: null,
      avatar_url: "",
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(normalizeSupabaseError(body));
    error.status = response.status;
    throw error;
  }
  const rows = await response.json().catch(() => []);
  return rows[0] || {
    id: userId,
    username,
    display_name: username,
    email: null,
    avatar_url: "",
  };
}

function normalizeSupabaseError(body) {
  const message = String(body.msg || body.message || body.error_description || body.error || "Signup failed");
  if (/already|registered|duplicate|unique/i.test(message)) return "That username is already taken.";
  return message;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (process.env[key]) return;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  });
}
