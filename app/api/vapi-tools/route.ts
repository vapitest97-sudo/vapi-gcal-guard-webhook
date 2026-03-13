// app/api/vapi-tools/route.ts

export async function GET() {
  return Response.json({
    ok: true,
    version: "guarded-create-v1",
    tools: ["calendar_conflict_check", "calendar_guarded_create_event"],
  });
}

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

      if (
        name !== "calendar_conflict_check" &&
        name !== "calendar_guarded_create_event"
      ) {
        results.push({
          toolCallId,
          result: { error: true, message: `Unknown tool: ${name}` },
        });
        continue;
      }

      const result =
        name === "calendar_conflict_check"
          ? await calendarConflictCheck(args)
          : await calendarGuardedCreateEvent(args);

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

  const calendarId = process.env.GCAL_CALENDAR_ID || "primary";

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events` +
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

async function calendarGuardedCreateEvent(args: any) {
  const {
    title,
    startDateTime,
    endDateTime,
    notes,
    address,
    customerName,
    customerPhone,
    customerEmail,
  } = args ?? {};

  if (!title || !startDateTime || !endDateTime) {
    return {
      error: true,
      message: "Missing title, startDateTime or endDateTime",
    };
  }

  // 1) Check conflicts (same calendar)
  const conflictResult = await calendarConflictCheck({
    startDateTime,
    endDateTime,
  });
  if (conflictResult?.error) return conflictResult;

  if (conflictResult?.conflict) {
    return {
      ...conflictResult,
      error: true,
      conflict: true,
      message: "Time slot already booked",
    };
  }

  // 2) Create event
  const accessToken = await getGoogleAccessToken();
  const calendarId = process.env.GCAL_CALENDAR_ID || "primary";

  const eventBody: any = {
    summary: title,
    description: [notes, address, customerName, customerPhone, customerEmail]
      .filter(Boolean)
      .join("\n"),
    start: { dateTime: new Date(startDateTime).toISOString() },
    end: { dateTime: new Date(endDateTime).toISOString() },
  };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(eventBody),
    }
  );

  const text = await res.text();
  if (!res.ok) {
    return { error: true, status: res.status, body: text };
  }

  const created = JSON.parse(text);

  return {
    created: true,
    eventId: created.id,
    htmlLink: created.htmlLink,
    start: created.start?.dateTime || created.start?.date,
    end: created.end?.dateTime || created.end?.date,
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

  const accessToken = data.access_token as string;

  // DEBUG: log token scopes to confirm we have write permissions
  const scopes = await getTokenScopes(accessToken);
  console.log("GCAL token scopes:", scopes);

  return accessToken;
}

async function getTokenScopes(accessToken: string) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(
      accessToken
    )}`
  );
  const data = await res.json().catch(() => ({}));
  return data.scope || null;
}