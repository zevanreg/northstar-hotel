# Northstar Hotel

A local-first boutique-hotel booking demo for a 90-minute, human-governed AI delivery workshop. Guests can search six rooms, book an available stay, review current bookings, and cancel a booking.

## Run locally

Prerequisites: .NET 10 SDK (reads `HotelBooking.slnx`), .NET 8 SDK/runtime (the API targets .NET 8), and Node.js 20.19+ with npm. Node.js 22.12+ is also supported.

From the repository root, start the API:

```powershell
dotnet run --project src\HotelBooking.Api --urls http://localhost:5050
```

In another terminal:

```powershell
cd src\hotel-booking-web
npm ci
npm run dev
```

Open <http://localhost:5173>. Expect six room cards and an availability search prefilled for a two-night stay next week. Choose a room, enter **fictional** guest details, book, and cancel from Current bookings.

If requests fail, check the API terminal and <http://localhost:5050/api/rooms>. Vite forwards `/api` to port 5050; restart the API on that port. If Vite reports a port conflict, stop your own existing server before retrying.

## Validate

From the repository root:

```powershell
dotnet test HotelBooking.slnx
dotnet build HotelBooking.slnx --configuration Release
node --test .github\scripts\issue-automation.test.js
cd src\hotel-booking-web
npm ci
npm run lint
npm run build
```

Expected evidence: passing API and automation tests, clean lint, and generated web assets in `src/hotel-booking-web/dist`. API integration tests use isolated in-memory SQLite databases, never the local guest database.

## Booking behavior

- Check-in is inclusive; check-out is exclusive. Adjacent stays are allowed.
- Dates use the UTC calendar. Check-in must be today or later; check-out must follow check-in.
- Availability is rechecked inside a SQLite write transaction when booking. Conflicting bookings return HTTP 409.
- Guest name, email, positive guest count, and room capacity are validated at the API boundary.
- Prices are USD. The decimal nightly rate times the number of nights is stored as the booking total. No payment is collected.
- Changing dates requires another search before a room can be chosen. Cancellation asks for confirmation and releases the room.
- Startup adds any missing seeded rooms without deleting or overwriting bookings.

## Architecture and API

| Layer | Location | Purpose |
|---|---|---|
| API | [HotelBooking.Api](src/HotelBooking.Api) | ASP.NET Core 8 minimal API, EF Core 8, SQLite |
| Browser | [hotel-booking-web](src/hotel-booking-web) | React, strict TypeScript, Vite; no UI or state framework |
| Tests | [HotelBooking.Api.Tests](tests/HotelBooking.Api.Tests) | xUnit integration tests through the in-memory HTTP host and SQLite |
| Automation | [workflows](.github/workflows) | Human-gated issue delivery and simulated release |

| Method | Route | Result |
|---|---|---|
| GET | `/api/rooms` | All rooms; `isAvailable` is null without dates |
| GET | `/api/rooms?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD` | All rooms with availability for that stay |
| GET | `/api/bookings` | Shared current bookings, sorted by check-in |
| GET | `/api/bookings/{id}` | Booking or 404 |
| POST | `/api/bookings` | Create with `roomId`, `guestName`, `email`, `guests`, `checkIn`, `checkOut`; returns 201 |
| DELETE | `/api/bookings/{id}` | Cancel with 204, or 404 if missing |

Invalid business input returns a validation problem (400); booking conflicts return 409. Malformed JSON or date values return 400.

The default SQLite file is `northstar.db` in the API working directory. It is ignored by Git. Set `ConnectionStrings__Hotel` to use another SQLite connection string. There are no external services or secrets needed for local use.

## Workshop boundaries

This is a shared, unauthenticated **local demo**, not a production reservation system. Everyone using the app can view guest names and cancel bookings. Emails are stored locally but not returned in booking responses. Use only fictional details; do not expose the API publicly.

Keep human approval, review, QA, and release gates in the existing workflows. A release remains a simulation, not deployment. Authentication, booking ownership, retention controls, payment handling, schema migrations, and public hosting are optional future production work, outside this baseline.
