# OptiTime

A web app that helps teenagers beat procrastination with structured daily schedules, a task manager, and interactive focus timers.

## Chrome extension: site blocker

OptiTime includes a Chrome extension (in `extension/`) that blocks distracting websites once your daily time limit is used up.

- **Per-site daily limits** – add a site (e.g. `youtube.com`) and a limit in minutes. A limit of `0` blocks the site entirely.
- **Real blocking** – when time is up, the browser itself redirects the site (and its subdomains) to a "Time's up" page, using Chrome's `declarativeNetRequest` API. Tabs that are already open on the site are moved to the block page too.
- **Fair timing** – time only counts while Chrome is the focused window, the site is the active tab, and you aren't idle.
- **Resets at midnight** – usage is tracked per day, in your local time.
- **On/off switch** and a toolbar badge showing how many sites are currently blocked.
- All data stays in your browser (`chrome.storage.local`). Nothing is sent anywhere.

### Install it in Chrome

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder from this project.
4. Pin OptiTime from the puzzle-piece menu, click its icon, and add your first site.

The extension asks for access to all sites because Chrome requires that permission to redirect a page the extension doesn't own. It only acts on sites in your list.

> OptiTime is a self-discipline tool: anyone can turn it off or remove it from `chrome://extensions`.

## Features

- **Schedule generation** – turns your task list into a realistic plan for the day. Urgent tasks come first, big tasks are split into focus-sized chunks, and short breaks are added automatically (a longer one every 4th block). When nothing is urgent, it starts with a "quick win" to build momentum.
- **Task management** – add tasks with an estimated time, due date, and priority; check them off; delete them. Time spent is tracked against each estimate.
- **Interactive daily timer** – Pomodoro-style focus/break timer tied to a selected task. Finished sessions are saved and update your progress automatically.
- **Progress stats** – minutes focused today, tasks completed today, and a day streak.
- **Persistent data** – stored server-side in a JSON file, keyed by an anonymous per-browser ID (no sign-up needed).

## Tech stack

- Node.js + Express (REST API)
- JSON-file data store (no database setup, no native dependencies)
- Vanilla HTML/CSS/JS frontend served by Express
- Node's built-in test runner

## Getting started

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:3000>.

For auto-restart during development: `npm run dev`.

### Configuration

| Variable    | Default          | Description                  |
|-------------|------------------|------------------------------|
| `PORT`      | `3000`           | Port the server listens on   |
| `DATA_FILE` | `data/db.json`   | Where user data is stored    |

### Tests

```bash
npm test
```

## API overview

All `/api` requests need an `x-user-id` header (the frontend generates one automatically).

| Method & path            | Purpose                                              |
|--------------------------|------------------------------------------------------|
| `GET /api/tasks`         | List tasks                                           |
| `POST /api/tasks`        | Create a task `{ title, estimateMinutes, dueDate?, priority? }` |
| `PATCH /api/tasks/:id`   | Update a task (including `done`)                     |
| `DELETE /api/tasks/:id`  | Delete a task                                        |
| `GET /api/schedule`      | Generate today's schedule                            |
| `GET/PUT /api/settings`  | Day window, focus and break lengths                  |
| `POST /api/sessions`     | Log a finished timer interval `{ minutes, type, taskId? }` |
| `GET /api/stats`         | Today's focus minutes, tasks done, streak            |

## Project structure

```
server.js            entry point
src/app.js           Express app and routes
src/scheduler.js     schedule generation logic
src/store.js         JSON-file persistence
src/validate.js      request validation
public/              web app frontend (HTML, CSS, JS)
extension/           Chrome extension (Manifest V3)
  manifest.json      permissions and entry points
  background.js      service worker: time tracking + blocking rules
  lib/core.js        pure logic shared by the extension and the tests
  popup.*            toolbar popup (sites, limits, on/off)
  blocked.*          the "Time's up" page
test/                unit and API tests
```

## Ideas for next steps

- Sync the extension's limits and usage with the web app
- A "focus session" mode that blocks every listed site for a set time
- Publish the extension to the Chrome Web Store
- Real accounts and authentication
- Swap the JSON store for SQLite or PostgreSQL
- Reminders / browser notifications
- Weekly progress charts
- Recurring tasks

## License

MIT
