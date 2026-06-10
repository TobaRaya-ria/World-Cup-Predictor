const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 5186);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const USERS_FILE = path.join(DATA_DIR, "world-cup-users.csv");
const PREDICTIONS_FILE = path.join(DATA_DIR, "world-cup-predictor-data.csv");

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
  const email = normalizeEmail(body.email);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const provider = String(body.provider || "email");
  if (!email || !username || password.length < 6) {
    return sendJson(response, 400, { error: "Username, email, and a 6+ character password are required." });
  }

  const users = readCsv(USERS_FILE);
  if (users.some((user) => normalizeEmail(user.email) === email)) {
    return sendJson(response, 409, { error: "That email already has an account. Please log in." });
  }

  users.push({
    created_at: new Date().toISOString(),
    username,
    email,
    provider,
    password_hash: hashPassword(password),
  });
  writeCsv(USERS_FILE, userHeaders, users);
  return sendJson(response, 200, { user: { username, email, provider } });
}

async function handleLogin(request, response) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const users = readCsv(USERS_FILE);
  const user = users.find((item) => normalizeEmail(item.email) === email);
  if (!user || user.password_hash !== hashPassword(password)) {
    return sendJson(response, 401, { error: "Email or password is wrong." });
  }
  return sendJson(response, 200, {
    user: {
      username: user.username,
      email: user.email,
      provider: user.provider || "email",
    },
  });
}

async function handleSave(request, response) {
  const body = await readJson(request);
  const user = body.user || {};
  const email = normalizeEmail(user.email);
  if (!email) return sendJson(response, 400, { error: "Log in before saving predictions." });

  const rows = readCsv(PREDICTIONS_FILE);
  const next = {
    saved_at: new Date().toISOString(),
    username: user.username || email.split("@")[0],
    email,
    provider: user.provider || "email",
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
  const existingIndex = rows.findIndex((row) => normalizeEmail(row.email) === email);
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

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}
