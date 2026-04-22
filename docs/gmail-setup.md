# Gmail integration — setup guide

Maket can turn a document into a Gmail draft with PDF attachments. The feature is **opt-in**: setup takes about 10 minutes and requires you to register Maket as your own OAuth application with Google.

Why the setup friction? Maket is free and open source. Removing the "unverified app" warning from Google's consent screen would require an annual CASA audit that costs $500–$4500 per year — not a cost the project is willing to carry. Each user registers their own OAuth client instead, which stays on their machine and is never shared.

## What Maket does (and doesn't) do

- **Creates drafts** in your Gmail. That's the whole surface. Maket never calls `users.messages.send` or `users.drafts.send`. You review every draft and click Send yourself, from Gmail's UI.
- **Optionally reads your inbox** if you pass `with_read=true` at connect time. The default is drafts only — Google's consent screen asks for *"Manage drafts and send emails"* and nothing else.
- **Stores credentials locally** under `$MAKET_DATA_DIR/` with owner-only (0600) file permissions. Nothing leaves your machine.

You are the OAuth application owner. That means:

- You create the project in **your own** Google Cloud account.
- You enable the Gmail API on that project.
- You add your email as a test user so the flow can complete.
- You own the client_id / client_secret that Maket uses to talk to Google.

## Setup — step by step

### 1. Create a Google Cloud project

1. Open the [Google Cloud Console](https://console.cloud.google.com).
2. In the top bar, click the project selector → **New project**.
3. Name it `Maket` (or whatever). Create.

### 2. Enable the Gmail API

1. Go to the project's [Gmail API page](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
2. Click **Enable**.
3. Propagation is usually instant but Google warns it can take a few minutes.

### 3. Configure the OAuth consent screen

Recent Google Cloud Console versions split this into four quick wizard steps:

1. [Open the OAuth consent screen](https://console.cloud.google.com/auth/overview).
2. Step 1 — **App Information**: app name `Maket`, user support email = your email.
3. Step 2 — **Audience**: select **External** (required unless the Google account is part of a Workspace organization you want to scope to).
4. Step 3 — **Contact Information**: developer contact email = your email.
5. Step 4 — **Finish**: accept the terms and create.

### 4. Add yourself as a test user

Until the app is published and verified by Google, only explicitly-listed test users can authenticate. Your own email is not on that list by default.

1. Open [Audience](https://console.cloud.google.com/auth/audience).
2. Publishing status should read **Testing** — leave it there. Moving to Production without a CASA audit will get the Gmail scopes silently blocked.
3. In the **Test users** section, click **Add users** and paste your email address (and any other email you want to test with — up to 100 total).
4. Save.

### 5. Create the OAuth client

1. Open [Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Desktop app**. (Don't pick Web app — Desktop accepts any `http://localhost:*` redirect without explicit URL registration, which makes port changes painless later.)
4. Name: `Maket desktop`.
5. Click **Create**.
6. The popup shows your `client_id` and `client_secret`. Click **Download JSON** — you'll paste this into Maket in a moment. Keep the file local.

### 6. Hand the credentials to Maket

Start Maket locally (`npx -y @ng-galien/maket start`, or `npm run dev` in a clone).

The easy path — form:

1. Open `http://localhost:24842/setup/gmail` in your browser (replace the port if you changed `MAKET_PORT`).
2. Paste the full JSON from the file Google gave you.
3. Tick *"also request inbox reading"* if you want the AI to search and read your mail. Leave it unchecked for the default draft-only mode.
4. Click **Save credentials**.

Alternatives:

- **Drop the file**: rename the downloaded JSON to `google-credentials.json` and place it at `$MAKET_DATA_DIR/google-credentials.json` (defaults to `~/.maket/google-credentials.json`). Make sure permissions are 0600.
- **Env vars**: set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your `.env`. Lower friction for dev workflows.

### 7. Run the OAuth flow

From your AI assistant (Claude Desktop, Claude Code, Codex, etc.):

```
maket_gmail action=connect
```

Add `with_read=true` to also request inbox read access.

The browser opens Google's consent screen. You'll see:

1. A red **"Google hasn't verified this app"** warning. This is expected for any unverified OAuth app — your own project in Testing mode is unverified by design.
2. Click **Advanced → Go to Maket (unsafe)**.
3. Grant the requested scopes (`gmail.compose`, and optionally `gmail.readonly`).
4. The browser confirms "Gmail connected" and you can close the tab.

From this point, `maket_gmail action=draft doc=<name> page=<n>` turns any document into a Gmail draft.

## Where credentials live

Maket persists two files in `$MAKET_DATA_DIR/` (default `~/.maket/`):

| File | Contents | Permissions |
|------|----------|-------------|
| `google-credentials.json` | Your OAuth Desktop client (client_id + client_secret) | 0600 |
| `google-token.json` | Refresh token + `with_read` flag | 0600 |

Both files are owner-only. Maket never uploads them anywhere. Deleting either file logs you out — the next `maket_gmail connect` will re-run the OAuth flow.

## CLI helpers

```bash
maket gmail status   # show whether credentials and refresh token exist
maket gmail reset    # delete both files (asks for confirmation)
maket gmail reset --force   # delete without prompting
```

## Limits of Testing mode

Testing mode is the right choice for a free open-source tool, but it comes with constraints:

- **100 test users max.** You must add every email that should be able to connect.
- **Refresh tokens expire after 7 days.** Users re-run `maket_gmail connect` weekly. Google enforces this unconditionally in Testing mode.
- **The "unverified app" warning stays visible.** There is no way to remove it without verification.
- **Do not click "Publish app"** in the OAuth consent screen. For Gmail scopes, publishing without a CASA security assessment causes Google to block new sign-ins. The scopes are classified as *restricted*, which triggers mandatory verification for non-Testing apps.

If Maket someday needs to serve thousands of users without CASA, the realistic alternatives are (a) a hosted auth proxy or (b) a third-party provider like Nylas. Both change the architecture meaningfully — today's design targets individuals and small teams running their own instance.

## Troubleshooting

**`Error 403: access_denied` on the Google consent screen**
Your email is not in the Test users list for the OAuth project. Add it at [Audience → Test users](https://console.cloud.google.com/auth/audience).

**`Gmail API has not been used in project N before or it is disabled`**
You skipped step 2. Open the URL Google gave you (or the [Gmail API library page](https://console.cloud.google.com/apis/library/gmail.googleapis.com)) and click Enable. Allow a minute or two for propagation.

**`Gmail credentials not configured`**
Maket couldn't find `google-credentials.json`. Use the setup form at `http://localhost:24842/setup/gmail`, drop the JSON manually at `~/.maket/google-credentials.json`, or set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`.

**Refresh token expired (`invalid_grant`)**
Expected in Testing mode after 7 days. Run `maket_gmail action=connect` again.

**Start over from scratch**
`maket gmail reset` removes both credential files. Re-run the setup form to reconnect.

**Unsure what state you're in**
`maket gmail status` prints which files exist and their permissions.
