---
applyTo: "src/HotelBooking.Api/**/*.cs,tests/HotelBooking.Api.Tests/**/*.cs"
---

# .NET API instructions

- Target .NET 8 and use the existing minimal API, EF Core, and dependency injection patterns.
- Keep endpoint contracts explicit records in `Contracts`; do not expose EF entities directly.
- Use async EF Core APIs and pass cancellation tokens.
- Return specific HTTP results: validation problem for invalid input, 404 for missing resources, and 409 for booking conflicts.
- Keep nullable reference types enabled and do not suppress warnings with broad null-forgiving operators.
- Add API integration coverage for success, validation, conflict, and not-found behavior that changes.
- Use the existing in-memory test host; production remains SQLite.
