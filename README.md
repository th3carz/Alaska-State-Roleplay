# Alaska Operations

Customer: Alaska State Roleplay  
Discord server: `1534042183559282819`  
Bot application: `1561501281355300895`  
Repository: [th3carz/Alaska-State-Roleplay](https://github.com/th3carz/Alaska-State-Roleplay)

[Invite Alaska Operations to Alaska State Roleplay](https://discord.com/oauth2/authorize?client_id=1561501281355300895&scope=bot%20applications.commands&permissions=2251800149347344&guild_id=1534042183559282819&disable_guild_select=true)

This standalone Discord bot contains exactly three functional systems: welcome messages, ER:LC sessions, and private support tickets. The configuration, welcome-preview, and server-scan commands support those systems. It does not include payments, verification, moderation, orders, or a website.

## What is included

- Welcome messages: a compact Components V2 card with quoted welcome text, the joining member's mention, a disabled member-count button, and a Dashboard link. It posts in **#general**, with no avatar, banner, title, or footer. Variables: `{user}`, `{username}`, `{server}`, `{memberCount}`. Bot accounts are skipped. `/welcome-test` previews the result privately.
- ER:LC sessions: banner-first status card, player/max-player, queue and in-game staff counts, Online/Offline status, Quick Join, and a self-service Session Notification role button. `/session vote votes:N` opens a vote with one vote per member, a counter, and View Voters. Reaching the target ends voting; staff still choose when to start. Startup, boost, full, and shutdown announcements include the host and game information. Staff control the session state; API counts do not automatically start or end sessions.
- Tickets: a support banner, assistance-type dropdown (General Support, Internal Affairs Support, Management Support), and Ticket FAQ. General/management forms ask for an inquiry; Internal Affairs asks for the staff member and reason. Private channels have pinned information where permitted, claim/unclaim controls, red/green status names, user/role access controls, renaming, transcript export, closure requests with Close/Keep Open, and closure with a required reason. One active ticket per member is enforced. A full HTML transcript is uploaded to the private log channel before deletion; export/upload failure keeps the ticket open.
- Supplied Dashboard, Sessions, Support, and Affiliations PNGs are bundled unchanged in `assets/banners/`. Discord Components V2 places each banner above the card text and controls. Affiliations is an information card linking to support.
- Every rich bot message uses Components V2 with plain containers and no colored sidebar. No custom emojis are used in the UI unless the customer explicitly requests them later. Configuration views and transcript archives also use V2; archive files are exposed through File components so they stay downloadable.

## Before first launch

1. Open application **1561501281355300895** in the [Discord Developer Portal](https://discord.com/developers/applications/1561501281355300895). Its requested bot name is **Alaska Operations**. Use this application's token; the bot refuses startup with another application's token.
2. On its Bot page, enable **Server Members Intent** and **Message Content Intent**. Members Intent supports joining-member welcomes. Message Content Intent allows readable message transcripts.
3. Use the invite link above to add that application to server `1534042183559282819` with scopes `bot` and `applications.commands`.
4. Grant the bot **View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, Manage Roles, Pin Messages, and Change Nickname** in the relevant channels/category. Put the bot's highest role above the Sessions notification role so it can assign/remove that role. Pin Messages is optional for pinning ticket headers. The bot does not need Administrator. If your chosen session ping role is not mentionable, the bot also needs Mention Everyone in the sessions channel.
5. Create/select a welcome channel, sessions channel, ticket category, support role, and **private staff transcript channel**. Ensure the transcript channel is visible only to the intended staff. The bot rejects transcript channels visible to @everyone.
6. Install **Node.js 24**, then run `npm ci` in this project directory.
7. Copy `.env.example` to `.env` and enter the bot token locally, or set `DISCORD_TOKEN` privately in your host's environment settings. Never commit or post the token. No token is included in this package.
8. Run `npm start`. Commands register automatically in the customer's server after login and ticket recovery. No client ID environment variable is needed.

The bot refuses commands outside the fixed customer server. Command registration replaces this application's guild command list in this one server. On startup it applies **Alaska Operations** as the bot username and server nickname when Discord permits the changes. If a name change is rate limited or denied, the bot logs the issue and keeps its three systems running; the name can also be changed manually in the Developer Portal/server. Panel footers use the Alaska Operations name.

## First-time configuration

The customer's 2026-10-18 scan now supplies the missing channel and role settings automatically on first startup:

| Purpose | Destination |
| --- | --- |
| New-member welcome messages | `#general` (`1560914979354583191`) |
| Home / welcome panel | `#home` (`1560914196898643969`) |
| Permanent session status panel and session announcements | `#sessions` (`1560914589066072074`) |
| Support / Open Ticket panel | `#support` (`1560914284979167252`) |
| Affiliations information panel | `#affiliations` (`1560915371865935882`) |
| New private tickets | Tickets category (`1553703456055763115`) |
| Ticket transcripts | `#ticket-transcripts` (`1553703567314002021`) |
| Session and ticket staff | Staff team (`1560951618361499718`) |
| Session announcement ping | Sessions (`1560951687429099552`) |
| Internal Affairs reports | Management Team (`1553703181282709506`) |
| Management support | Oversight (`1553703178023997493`) |
| Additional ticket leadership access | Ownership (`1560949789141766184`), Oversight (`1553703178023997493`) |

Existing non-empty settings are preserved, and these seeds run once. The supplied session reference provides the default code **Alaskasrp**, display name **Alaska State Roleplay | VC Only**, and owner label **AEMeoow**. Change them through `/configure sessions` if needed. With an API key, a valid live join code takes precedence.

The bot automatically posts/updates the Home, Session Status, Support, and Affiliations panels on startup, after configuration changes, and every minute. It restores deleted tracked panels. It keeps each panel message ID and checks existing bot-owned panel messages before creating one, including after local database loss. Member welcome messages are sent only when a human member joins; startup does not fabricate member joins or announce a session startup.

Use `/configure panels enabled:false` to stop automatic panel maintenance, or set `home`/`support`/`affiliations` to move their destinations. `/ticket panel` and `/session panel` reuse their panels. Channel history must be readable for duplicate checks. The permanent session panel updates after session announcements and on its refresh timer.

Run these as a member with **Manage Server**, choosing the actual channels and roles in Discord:

```text
/configure welcome channel:#welcome
/configure sessions channel:#sessions code:YOUR_ERLC_CODE staff-role:@SessionStaff
/configure tickets category:Support Tickets support-role:@Support logs:#ticket-transcripts
/ticket panel channel:#support
/welcome-test
```

Optional setup parameters:

- Welcome: `message`, `enabled`.
- Sessions: `ping-role`, `banner`, `clear-ping`, `server-name`, `owner-name`.
- Tickets: `banner`, `report-role`, `management-role`.
- Use public HTTPS image URLs for custom banners. `banner:none` clears a custom override, restoring the supplied Sessions/Support banner.
- Use `/configure view` to inspect saved channel/role IDs and the ER:LC server code privately.

Each configuration command preserves omitted optional settings. Changing the support role/log channel affects newly opened tickets; existing tickets retain their original support role and transcript destination.

Internal Affairs tickets route to the configured report role and leadership; they exclude the general Staff team role. The reported staff member gets an explicit View Channel denial. Discord administrators still bypass channel permission restrictions. Management tickets route to the senior management role and leadership. General tickets use the support role and leadership.

## Live ER:LC counts

Set **ERLC_API_KEY** privately in the Railway service variables (or local `.env`) to enable player/max-player, queue, and in-game staff counts. The bot calls the official combined ER:LC v2 server endpoint at most once per minute, shares concurrent requests, respects rate-limit delays, and stops retrying rejected credentials until restart. Staff counts include players whose in-game permission is Server Owner, Server Administrator, or Server Moderator.

Without a key, the notification button, voting, Quick Join, announcements, and tickets work normally; live metrics display **Unavailable**. Failed or malformed requests also display Unavailable rather than invented zero counts. The key and player list are never included in panels or `/scan`.

## Everyday commands

| Command | Access / result |
| --- | --- |
| `/welcome-test` | Manage Server; private welcome preview |
| `/configure ...` | Manage Server; settings for the three systems |
| `/scan` | Manage Server; private JSON and TXT exports of channel/role order, IDs, and every server custom emoji |
| `/session start [message]` | Session staff or Manage Server; start an inactive session |
| `/session boost [message]` | Session staff or Manage Server; boost an active session |
| `/session full [message]` | Session staff or Manage Server; mark active session full |
| `/session end [message]` | Session staff or Manage Server; end active session |
| `/session startup` / `/session shutdown` | Aliases for start/end |
| `/session panel` | Session staff or Manage Server; refresh the permanent panel |
| `/session vote votes:N` | Session staff or Manage Server; open a vote while offline |
| `/session cancel-vote` | Session staff or Manage Server; cancel an open vote |
| `/ticket panel [channel]` | Manage Server; post the ticket-opening panel |
| `/ticket claim` | Support staff; claim the current ticket |
| `/ticket unclaim` | Assigned staff or Manage Server; release current claim |
| `/ticket close reason:...` | Ticket opener or support staff; archive then delete |
| `/ticket request-close reason:...` | Opener or authorized support staff; ask to close |
| `/ticket transcript` | Opener or authorized support staff; export without deletion |
| `/ticket rename name:...` | Authorized support staff; preserve type/status prefix |
| `/ticket add target:...` / `/ticket remove target:...` | Authorized support staff; change user/role access |

Welcome messages mention only the joining member. Session announcements mention only the configured session ping role. Arbitrary @everyone text does not create a mass ping. Earlier announcements retain their Quick Join/notification controls as in the reference. Old vote buttons validate the stored message and voting state; repeated votes do not increase the count. Only the assigned staff member or a server manager can release a claim. Repeated Claim clicks cannot unclaim a ticket.

## Exporting the server with /scan

Run `/scan` as a member with **Manage Server**. The response is private and includes a readable `.txt` file and a structured `.json` file. Download either file and attach it to your ChatGPT conversation to share the IDs needed for setup.

Each run fetches current channel, role, and emoji inventories from Discord. It exports channel names/types/IDs, category parent IDs, raw positions, and a numbered server-order hierarchy. Roles are listed from highest to lowest, including managed roles and @everyone. Every server custom emoji includes its name, ID, static/animated status, usable `<:name:id>` or `<a:name:id>` text, image URL, availability, and any role restrictions.

Channel order follows the server's category/type grouping and snowflake tie order, rather than a member's personal favorites or custom client layout. Threads/forum posts are outside this channel inventory, and only metadata Discord exposes to the bot can be exported. Missing parents are identified in the JSON. The command only reads server metadata; it does not modify the server or export message/member lists.

## Persistent hosting

Run **one instance / one replica**. SQLite holds settings, panel IDs, session state, votes/voters, ticket IDs, claims, participants, and closure requests. On Railway the app automatically uses `RAILWAY_VOLUME_MOUNT_PATH/alaska.sqlite` when a persistent volume is mounted. `PERSISTENT_DATABASE_PATH` can explicitly override that path. Otherwise it uses `DATABASE_PATH`, falling back to `./data/alaska.sqlite`. Mount a persistent disk and back it up regularly; ephemeral container disks lose their data during redeploys. `DATABASE_URL` is not used by this SQLite application.

Keep the working directory at the project root and use `npm start`. The process needs a persistent Discord Gateway connection. No Discord or ER:LC credentials are bundled.

## Transcript and recovery notes

- Enable Message Content Intent both in the Developer Portal and in code (already requested by the bot). Without the portal setting, login may fail; content-limited applications cannot produce complete transcripts.
- Transcripts include the fetched ticket-channel messages, embeds, Components V2 text, and attachment names/URLs. They do not preserve deleted messages, edit history, reactions, thread replies, or the attached file bytes. Discord attachment URLs can expire.
- Normal ticket participants are prevented from sending while a closure is exported. Discord administrators bypass channel restrictions; messages they send during the final export/delete window may be outside the transcript snapshot.
- Exports above a conservative 8 MB limit leave the ticket open for a manual export. A failed fetch, upload, or channel deletion also preserves/reopens the ticket and attempts to restore sending permissions.
- After a restart, the bot reconciles pending channel creations, reopens interrupted closures, and frees ticket slots whose channels were deleted. If a network timeout prevents checking whether a channel was created, the reservation is retained until restart to avoid duplicate channels.
- After database loss, active ticket channels can be adopted only when their bot-specific topic and this application's own original ticket message agree. Existing channel access permissions are retained. This does not recreate historic votes, settings, closed-ticket records, or all ticket metadata; durable storage is still required.
- Vote display failures are retried on the refresh timer, including after the goal was reached. A restart does not reset saved voters or reopen a finished vote.
- A one-time style migration updates this application's existing rich messages in its configured channels and active tickets. It removes custom emoji icons and accents, converts old embeds to V2, preserves controls and existing attachments, suppresses mentions during edits, and never edits another author's messages.
- Manual channel deletion outside the bot cannot capture a transcript. Use the Close Ticket flow whenever a transcript is needed.
- If a support role or log channel is deleted, restore it or repair the affected ticket configuration/permissions. Tickets keep the original staff role and log destination recorded at creation.
- A crash after a transcript upload but before channel deletion may leave an archive of that close attempt in the log. The surviving ticket is reopened on startup; a later close exports it again.

## Validation

```text
npm run check
npm test
```

Tests cover database restart persistence, unique votes, API caching/rate limits, V2 card serialization, notification-role checks, ticket-type permissions, duplicate-ticket prevention, repeated-click locks, authorization, claim rollback, closure-request state, session transitions, restricted mentions, transcript escaping/pagination, failed exports, safe closure order, and crash recovery. They run without credentials and do not contact Discord. Exercise a welcome/join, session announcement, and ticket open/claim/close in the customer's server after installation.

Reference documentation: [discord.js](https://discord.js.org/docs), [Discord components](https://docs.discord.com/developers/components/reference), [Discord Gateway intents](https://docs.discord.com/developers/events/gateway#gateway-intents), [Discord permissions](https://docs.discord.com/developers/topics/permissions), [ER:LC API](https://apidocs.erlc.gg/api-reference/fetch-server-information). ER:LC Quick Join links use `https://erlc.gg/join/CODE`.
