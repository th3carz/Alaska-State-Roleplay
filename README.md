# Alaska Operations

Customer: Alaska State Roleplay  
Discord server: `1534042183559282819`  
Bot application: `1561501281355300895`  
Repository: [th3carz/Alaska-State-Roleplay](https://github.com/th3carz/Alaska-State-Roleplay)

[Invite Alaska Operations to Alaska State Roleplay](https://discord.com/oauth2/authorize?client_id=1561501281355300895&scope=bot%20applications.commands&permissions=335662096&guild_id=1534042183559282819&disable_guild_select=true)

This standalone Discord bot contains exactly three functional systems: welcome messages, ER:LC sessions, and private support tickets. The configuration, welcome-preview, and server-scan commands support those systems. It does not include payments, verification, moderation, orders, or a website.

## What is included

- Welcome messages: member mention, avatar, member count, customizable message and optional banner. Variables: `{user}`, `{username}`, `{server}`, `{memberCount}`. Bot accounts are skipped. `/welcome-test` previews the result privately.
- ER:LC sessions: `/session start`, `/session boost`, `/session full`, `/session end`; optional custom message on each announcement; server code, host, Quick Join button, optional session ping role and banner. Session staff or members with Manage Server can run these commands. State persists across restarts. This is a manual announcement system; there is no API integration, live player count, automatic detection, or voting.
- Tickets: a public Open Ticket panel, request form, private support channels, one open ticket per member, claim/unclaim buttons and commands, and closure with a required reason. The opener and support staff can close a ticket. Only staff can claim; members cannot claim their own ticket. A full HTML message transcript is uploaded to the configured private log channel before the ticket channel is deleted. If export or upload fails, the channel stays open. State and claims persist across restarts.

## Before first launch

1. Open application **1561501281355300895** in the [Discord Developer Portal](https://discord.com/developers/applications/1561501281355300895). Its requested bot name is **Alaska Operations**. Use this application's token; the bot refuses startup with another application's token.
2. On its Bot page, enable **Server Members Intent** and **Message Content Intent**. Members Intent supports joining-member welcomes. Message Content Intent allows readable message transcripts.
3. Use the invite link above to add that application to server `1534042183559282819` with scopes `bot` and `applications.commands`.
4. Grant the bot **View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, Manage Roles, and Change Nickname** in the relevant channels/category. Manage Roles is needed to update ticket permission overwrites while closing. The bot does not need Administrator. If your chosen session ping role is not mentionable, the bot also needs Mention Everyone in the sessions channel.
5. Create/select a welcome channel, sessions channel, ticket category, support role, and **private staff transcript channel**. Ensure the transcript channel is visible only to the intended staff. The bot rejects transcript channels visible to @everyone.
6. Install **Node.js 24**, then run `npm ci` in this project directory.
7. Copy `.env.example` to `.env` and enter the bot token locally, or set `DISCORD_TOKEN` privately in your host's environment settings. Never commit or post the token. No token is included in this package.
8. Run `npm start`. Commands register automatically in the customer's server after login and ticket recovery. No client ID environment variable is needed.

The bot refuses commands outside the fixed customer server. Command registration replaces this application's guild command list in this one server. On startup it applies **Alaska Operations** as the bot username and server nickname when Discord permits the changes. If a name change is rate limited or denied, the bot logs the issue and keeps its three systems running; the name can also be changed manually in the Developer Portal/server. Embed footers use the Alaska Operations name.

## First-time configuration

Run these as a member with **Manage Server**, choosing the actual channels and roles in Discord:

```text
/configure welcome channel:#welcome
/configure sessions channel:#sessions code:YOUR_ERLC_CODE staff-role:@SessionStaff
/configure tickets category:Support Tickets support-role:@Support logs:#ticket-transcripts
/ticket panel channel:#support
/welcome-test
```

Optional setup parameters:

- Welcome: `message`, `banner`, `enabled`.
- Sessions: `ping-role`, `banner`, `clear-ping`.
- Tickets: `banner`.
- Use `banner:none` to remove an image. Banners must use public HTTPS image URLs that Discord can load.
- Use `/configure view` to inspect saved channel/role IDs and the ER:LC server code privately.

Each configuration command preserves omitted optional settings. Changing the support role/log channel affects newly opened tickets; existing tickets retain their original support role and transcript destination.

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
| `/ticket panel [channel]` | Manage Server; post the ticket-opening panel |
| `/ticket claim` | Support staff; claim the current ticket |
| `/ticket unclaim` | Assigned staff or Manage Server; release current claim |
| `/ticket close reason:...` | Ticket opener or support staff; archive then delete |

Welcome messages mention only the joining member. Session announcements mention only the configured session ping role. Arbitrary @everyone text in a custom message does not create a mass ping. Old session announcement buttons are retired when a new session announcement is posted, when the bot can edit the earlier message.

## Exporting the server with /scan

Run `/scan` as a member with **Manage Server**. The response is private and includes a readable `.txt` file and a structured `.json` file. Download either file and attach it to your ChatGPT conversation to share the IDs needed for setup.

Each run fetches current channel, role, and emoji inventories from Discord. It exports channel names/types/IDs, category parent IDs, raw positions, and a numbered server-order hierarchy. Roles are listed from highest to lowest, including managed roles and @everyone. Every server custom emoji includes its name, ID, static/animated status, usable `<:name:id>` or `<a:name:id>` text, image URL, availability, and any role restrictions.

Channel order follows the server's category/type grouping and snowflake tie order, rather than a member's personal favorites or custom client layout. Threads/forum posts are outside this channel inventory, and only metadata Discord exposes to the bot can be exported. Missing parents are identified in the JSON. The command only reads server metadata; it does not modify the server or export message/member lists.

## Persistent hosting

Run **one instance / one replica**. SQLite holds settings, session state, ticket IDs, and claims. Set `DATABASE_PATH` to a file on persistent storage, for example `/data/alaska.sqlite`, and mount your host's persistent disk at `/data`. The default is `./data/alaska.sqlite`. Ephemeral container disks lose the database during redeploys. Back up the persistent disk/database regularly. A database loss can orphan existing ticket channels.

Keep the working directory at the project root and use `npm start`. The process needs a persistent Discord Gateway connection. This project is source code, not a running deployment; no Discord or ER:LC credentials are bundled.

## Transcript and recovery notes

- Enable Message Content Intent both in the Developer Portal and in code (already requested by the bot). Without the portal setting, login may fail; content-limited applications cannot produce complete transcripts.
- Transcripts include the fetched ticket-channel messages, embeds, and attachment names/URLs. They do not preserve deleted messages, edit history, reactions, thread replies, or the attached file bytes. Discord attachment URLs can expire.
- Normal ticket participants are prevented from sending while a closure is exported. Discord administrators bypass channel restrictions; messages they send during the final export/delete window may be outside the transcript snapshot.
- Exports above a conservative 8 MB limit leave the ticket open for a manual export. A failed fetch, upload, or channel deletion also preserves/reopens the ticket and attempts to restore sending permissions.
- After a restart, the bot reconciles pending channel creations, reopens interrupted closures, and frees ticket slots whose channels were deleted. If a network timeout prevents checking whether a channel was created, the reservation is retained until restart to avoid duplicate channels.
- Manual channel deletion outside the bot cannot capture a transcript. Use the Close Ticket flow whenever a transcript is needed.
- If a support role or log channel is deleted, restore it or repair the affected ticket configuration/permissions. Tickets keep the original staff role and log destination recorded at creation.
- A crash after a transcript upload but before channel deletion may leave an archive of that close attempt in the log. The surviving ticket is reopened on startup; a later close exports it again.

## Validation

```text
npm run check
npm test
```

Tests cover database restart persistence, duplicate-ticket prevention, repeated-click locks, authorization, private permission overwrites, claim rollback, session transitions, restricted mentions, transcript escaping/pagination, failed exports, safe closure order, and crash recovery. They run without credentials and do not contact Discord. A live welcome/join, session announcement, and ticket open/claim/close test is still required after installing the customer's bot.

Reference documentation: [discord.js](https://discord.js.org/docs), [Discord Gateway intents](https://docs.discord.com/developers/events/gateway#gateway-intents), [Discord permissions](https://docs.discord.com/developers/topics/permissions). ER:LC Quick Join links use `https://erlc.gg/join/CODE`.
