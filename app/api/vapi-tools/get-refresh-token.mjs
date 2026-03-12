import http from "http";
import open from "open";
import { google } from "googleapis";

const CLIENT_ID = process.env.GCAL_CLIENT_ID;
const CLIENT_SECRET = process.env.GCAL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GCAL_CLIENT_ID / GCAL_CLIENT_SECRET in env");
  process.exit(1);
}

const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith("/oauth2callback")) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const url = new URL(req.url, "http://localhost:3000");
    const code = url.searchParams.get("code");

    if (!code) {
      res.end("No code provided");
      return;
    }

    const { tokens } = await oauth2Client.getToken(code);

    res.end("Success. Check your terminal for REFRESH_TOKEN. You can close this tab.");
    console.log("REFRESH_TOKEN:", tokens.refresh_token);
    console.log("TOKENS (debug):", tokens);

    server.close();
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end("Error");
    server.close();
  }
});

server.listen(3000, async () => {
  console.log("Opening browser for consent...");
  await open(authUrl);
});