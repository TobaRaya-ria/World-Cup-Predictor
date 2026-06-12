module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  try {
    const result = await saveSupabaseSubmission(body);
    return response.status(200).json(result);
  } catch (error) {
    return response.status(error.status || 500).json({ error: error.message || "Supabase save failed." });
  }
};

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

async function upsertSupabaseProfile(supabaseUrl, serviceRoleKey, userId, username) {
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
    method: "POST",
    headers: supabaseJsonHeaders(serviceRoleKey, "resolution=merge-duplicates"),
    body: JSON.stringify({
      id: userId,
      username,
      display_name: username,
      email: null,
      avatar_url: "",
    }),
  });
  await assertSupabaseOk(response);
}

async function upsertTournamentPrediction(supabaseUrl, serviceRoleKey, userId, submission) {
  const payload = {
    user_id: userId,
    group_rankings: submission.groups || {},
    third_place_qualifiers: submission.thirdQualifiers || [],
    knockout_picks: submission.knockoutPicks || {},
    final_placements: submission.finalPlacements || {},
    locked_at: submission.bracketFinalizedAt || null,
    updated_at: new Date().toISOString(),
  };
  await writeSingleByFilters(supabaseUrl, serviceRoleKey, "tournament_predictions", { user_id: userId }, payload);
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
  for (const entry of entries) {
    await writeSingleByFilters(
      supabaseUrl,
      serviceRoleKey,
      "match_predictions",
      { user_id: userId, fixture_id: entry.fixture_id },
      entry
    );
  }
  return entries.length;
}

async function upsertScoreSnapshot(supabaseUrl, serviceRoleKey, userId, submission) {
  const payload = {
    user_id: userId,
    bracket_score: Number(submission.bracketScore || 0),
    match_score: Number(submission.matchScore || 0),
    total_score: Number(submission.totalScore || 0),
    exact_scores_count: 0,
    correct_results_count: 0,
    updated_at: new Date().toISOString(),
  };
  await writeSingleByFilters(supabaseUrl, serviceRoleKey, "scores", { user_id: userId }, payload);
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
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  return headers;
}

async function writeSingleByFilters(supabaseUrl, serviceRoleKey, table, filters, payload) {
  const query = Object.entries(filters)
    .map(([key, value]) => `${encodeURIComponent(key)}=eq.${encodeURIComponent(value)}`)
    .join("&");
  const existingResponse = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&${query}&limit=1`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  await assertSupabaseOk(existingResponse);
  const existing = await existingResponse.json();

  const writeResponse = existing.length
    ? await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(existing[0].id)}`, {
        method: "PATCH",
        headers: supabaseJsonHeaders(serviceRoleKey, ""),
        body: JSON.stringify(payload),
      })
    : await fetch(`${supabaseUrl}/rest/v1/${table}`, {
        method: "POST",
        headers: supabaseJsonHeaders(serviceRoleKey, ""),
        body: JSON.stringify(payload),
      });
  await assertSupabaseOk(writeResponse);
}

async function assertSupabaseOk(response) {
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  const error = new Error(normalizeSupabaseError(body));
  error.status = response.status;
  throw error;
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

function normalizeSupabaseError(body) {
  const message = String(body.msg || body.message || body.error_description || body.error || "Supabase save failed.");
  if (/duplicate|unique/i.test(message)) return "That username is already taken.";
  return message;
}
