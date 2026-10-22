# Focus Forward

A web app that helps teenagers beat procrastination with structured daily schedules, a task manager, and interactive focus timers.

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
public/              frontend (HTML, CSS, JS)
test/                unit and API tests
```

## Ideas for next steps

- Real accounts and authentication
- Swap the JSON store for SQLite or PostgreSQL
- Reminders / browser notifications
- Weekly progress charts
- Recurring tasks

## License

MIT
