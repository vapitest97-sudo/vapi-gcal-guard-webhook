export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  console.log("Incoming:", JSON.stringify(body)?.slice(0, 2000));

  try {
    const message: any = (body as any).message ?? body;
    const toolCallList: any[] = message.toolCallList ?? [];

    const results: any[] = [];

    for (const tc of toolCallList) {
      const toolCallId = tc.id;
      const name = tc.function?.name;
      const argsRaw = tc.function?.arguments;

      const args =
        typeof argsRaw === "string" ? JSON.parse(argsRaw) : (argsRaw ?? {});

      if (name !== "calendar_conflict_check") {
        results.push({
          toolCallId,
          result: { error: true, message: `Unknown tool: ${name}` },
        });
        continue;
      }

      const result = await calendarConflictCheck(args);
      results.push({ toolCallId, result });
    }

    return Response.json({ results });
  } catch (err: any) {
    console.error("Webhook error:", err);
    return Response.json(
      { error: true, message: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}

async function calendarConflictCheck(args: any) {
  const { startDateTime, endDateTime } = args ?? {};
  if (!startDateTime || !endDateTime) {
    return { error: true, message: "Missing startDateTime or endDateTime" };
  }

  const accessToken = await getGoogleAccessToken();

  const timeMin = new Date(startDateTime).toISOString();
  const timeMax = new Date(endDateTime).toISOString();

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?timeMin=${encodeURIComponent(timeMin)}` +
    `&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  if (!res.ok) {
    return { error: true, status: res.status, body: text };
  }

  const data = JSON.parse(text);
  const items = (data.items ?? []).filter((e: any) => e.status !== "cancelled");

  return {
    conflict: items.length > 0,
    count: items.length,
    events: items.map((e: any) => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
    })),
  };
}

async function getGoogleAccessToken() {
  const clientId = process.env.GCAL_CLIENT_ID;
  const clientSecret = process.env.GCAL_CLIENT_SECRET;
  const refreshToken = process.env.GCAL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing GCAL_CLIENT_ID / GCAL_CLIENT_SECRET / GCAL_REFRESH_TOKEN"
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  return data.access_token as string;
}