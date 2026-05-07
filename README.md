# express-telescope

A Telescope-style debugging dashboard for **Express + TypeScript**, inspired by [Laravel Telescope](https://laravel.com/docs/13.x/telescope).

Captures and displays:

- **Requests** — method, URL, status, duration, headers, payload, response body
- **Exceptions** — class, message, file/line, full stack trace
- **Queries** — SQL, bindings, duration, slow-query tagging
- **Logs** — `console.log/info/warn/error` capture
- **HTTP Client** — outbound `fetch` and `axios` calls
- **Dumps** — `dump(t, ...)` for ad-hoc value inspection
- *(extensible)* cache, mail, jobs

All entries within a single HTTP request are grouped into a **batch** so you can see every query and log line tied to a specific request.

## Quick start

```bash
npm install express-telescope
```

```ts
import express from 'express';
import { installTelescope, attachErrorHandler } from 'express-telescope';

const app = express();
app.use(express.json());

const t = installTelescope(app, { path: '/telescope' });

app.get('/', (_, res) => res.json({ ok: true }));

// Error handler must be registered AFTER your routes
attachErrorHandler(t, app);

app.listen(3000);
```

Open the dashboard at **http://localhost:3000/telescope**.

## Options

```ts
installTelescope(app, {
  enabled: true,                            // master switch
  path: '/telescope',                       // dashboard mount path
  storagePath: './.telescope.sqlite',       // SQLite file
  maxEntries: 10_000,                       // ring buffer size
  recordRequestBody: true,
  recordResponseBody: true,
  ignoreRoutes: ['/health', /^\/metrics/],
  slowQueryThreshold: 100,                  // ms — queries above are tagged "slow"
  captureConsole: true,                     // hook console.*
  captureProcessErrors: true,               // hook uncaughtException + unhandledRejection
  authorize: (req) => req.user?.isAdmin,    // dashboard auth
});
```

## Recording queries

Two ways to feed the query watcher:

**1. Manual wrap** — works with any driver/ORM:

```ts
import { trackQuery } from 'express-telescope';

const rows = await trackQuery(t, 'main', sql, params, () => pool.query(sql, params));
```

**2. better-sqlite3 auto-patch:**

```ts
import Database from 'better-sqlite3';
import { patchBetterSqlite } from 'express-telescope';

const db = new Database('app.sqlite');
patchBetterSqlite(t, db as never);
// every prepare/run/get/all is now recorded
```

**3. Prisma** — one-liner:

```ts
import { PrismaClient } from '@prisma/client';
import { installPrismaWatcher } from 'express-telescope';

const prisma = new PrismaClient({
  log: [{ emit: 'event', level: 'query' }],
});
installPrismaWatcher(t, prisma);
```

**4. TypeORM** — pass the logger:

```ts
import { TelescopeTypeOrmLogger } from 'express-telescope';
new DataSource({ /* ... */, logger: new TelescopeTypeOrmLogger(t) });
```

## Outbound HTTP

`installTelescope()` patches global `fetch` by default. To opt out: `captureFetch: false`.

For axios:

```ts
import axios from 'axios';
import { attachAxiosInterceptor } from 'express-telescope';
attachAxiosInterceptor(t, axios);
```

## Ad-hoc dumps

```ts
import { dump } from 'express-telescope';
dump(t, 'current user', user);
dump(t, { someState });
```

## Auth in production

Telescope exposes request bodies and headers — never ship it open. Always pass `authorize`:

```ts
installTelescope(app, {
  authorize: (req) => req.user?.role === 'admin',
});
```

Or simply don't install it when `NODE_ENV === 'production'`.

## Run the example

```bash
git clone <this repo>
cd express-telescope
npm install
npm run example
# open http://localhost:3000/telescope
```

The example exposes `/users`, `/slow`, `/log`, `/boom`, `/echo` so you can see each watcher in action.

## Architecture

```
┌──────────────┐
│  Express app │
└──────┬───────┘
       │
       │  request middleware ──▶ RequestWatcher
       │  error handler     ──▶ ExceptionWatcher
       │  console patch     ──▶ LogWatcher
       │  driver wrap       ──▶ QueryWatcher
       │
       ▼
   ┌──────────┐      ┌──────────────┐
   │ Telescope│ ───▶ │ SqliteStorage│ ──▶ ./.telescope.sqlite
   └──────────┘      └──────────────┘
       ▲
       │
   ┌──────────────────┐
   │  Dashboard UI    │  GET /telescope/*
   │  (HTML + vanilla │
   │   JS, no build)  │
   └──────────────────┘
```

## License

MIT
