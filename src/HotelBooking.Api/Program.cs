using System.Net.Mail;
using HotelBooking.Api.Contracts;
using HotelBooking.Api.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddDbContext<HotelDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Hotel") ?? "Data Source=northstar.db"));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddProblemDetails();
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(options => options.ThrowOnBadRequest = false);
var app = builder.Build();
app.UseExceptionHandler();

await using (var scope = app.Services.CreateAsyncScope())
{
    await Seeder.SeedAsync(scope.ServiceProvider.GetRequiredService<HotelDbContext>());
}

app.MapGet("/api/rooms", async (DateOnly? checkIn, DateOnly? checkOut, HotelDbContext db, TimeProvider clock, CancellationToken ct) =>
{
    if (checkIn.HasValue || checkOut.HasValue)
    {
        var errors = ValidateStay(checkIn ?? default, checkOut ?? default, clock);
        if (errors.Count > 0) return Results.ValidationProblem(errors);
    }
    var rooms = await db.Rooms.AsNoTracking().OrderBy(room => room.Id)
        .Select(room => new RoomResponse(room.Id, room.Name, room.Description, room.Capacity, room.NightlyRate,
            checkIn == null ? null : !db.Bookings.Any(booking => booking.RoomId == room.Id &&
                checkIn < booking.CheckOut && checkOut > booking.CheckIn)))
        .ToListAsync(ct);
    return Results.Ok(rooms);
});

app.MapGet("/api/bookings", async (HotelDbContext db, CancellationToken ct) =>
    Results.Ok(await BookingQuery(db).ToListAsync(ct)));

app.MapGet("/api/bookings/{id:int}", async (int id, HotelDbContext db, CancellationToken ct) =>
{
    var booking = await BookingQuery(db, id).SingleOrDefaultAsync(ct);
    return booking is null ? Results.NotFound() : Results.Ok(booking);
});

app.MapPost("/api/bookings", async (CreateBookingRequest request, HotelDbContext db, TimeProvider clock, CancellationToken ct) =>
{
    var errors = ValidateStay(request.CheckIn, request.CheckOut, clock);
    var guestName = request.GuestName?.Trim() ?? "";
    var email = request.Email ?? "";
    if (string.IsNullOrWhiteSpace(guestName) || guestName.Length > 100)
        errors["guestName"] = ["Enter a guest name of 1 to 100 characters."];
    if (string.IsNullOrWhiteSpace(email) || email.Length > 254 ||
        !MailAddress.TryCreate(email, out var address) || address.Address != email)
        errors["email"] = ["Enter a valid email address (maximum 254 characters)."];
    if (request.Guests < 1) errors["guests"] = ["Choose at least one guest."];
    if (errors.Count > 0) return Results.ValidationProblem(errors);

    // SQLite's immediate write transaction serializes the availability check and insert.
    await using var transaction = await db.Database.BeginTransactionAsync(ct);
    var room = await db.Rooms.SingleOrDefaultAsync(room => room.Id == request.RoomId, ct);
    if (room is null) return Results.NotFound();
    if (request.Guests > room.Capacity)
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["guests"] = [$"This room accommodates up to {room.Capacity} guests."] });
    if (await OverlappingBookings(db, room.Id, request.CheckIn, request.CheckOut).AnyAsync(ct))
        return Results.Conflict(new { detail = "This room is no longer available for these dates. Search again to choose another room." });

    var booking = new Booking
    {
        RoomId = room.Id, GuestName = guestName, Email = email,
        Guests = request.Guests, CheckIn = request.CheckIn, CheckOut = request.CheckOut,
        TotalPrice = StayPrice(room.NightlyRate, request.CheckIn, request.CheckOut)
    };
    db.Bookings.Add(booking);
    await db.SaveChangesAsync(ct);
    await transaction.CommitAsync(ct);
    return Results.Created($"/api/bookings/{booking.Id}", ToBookingResponse(booking, room));
});

app.MapPatch("/api/bookings/{id:int}", async (int id, UpdateBookingDatesRequest request, HotelDbContext db, TimeProvider clock, CancellationToken ct) =>
{
    var errors = ValidateStay(request.CheckIn, request.CheckOut, clock);
    if (errors.Count > 0) return Results.ValidationProblem(errors);

    await using var transaction = await db.Database.BeginTransactionAsync(ct);
    var booking = await db.Bookings.SingleOrDefaultAsync(existing => existing.Id == id, ct);
    if (booking is null)
        return Results.NotFound(new { detail = "This booking no longer exists. Refresh the bookings list." });
    var room = await db.Rooms.SingleAsync(existing => existing.Id == booking.RoomId, ct);
    if (await OverlappingBookings(db, room.Id, request.CheckIn, request.CheckOut)
        .AnyAsync(existing => existing.Id != id, ct))
        return Results.Conflict(new { detail = "These dates conflict with another booking for this room. Your existing booking has not changed. Choose different dates." });

    booking.CheckIn = request.CheckIn;
    booking.CheckOut = request.CheckOut;
    booking.TotalPrice = StayPrice(room.NightlyRate, request.CheckIn, request.CheckOut);
    await db.SaveChangesAsync(ct);
    await transaction.CommitAsync(ct);
    return Results.Ok(ToBookingResponse(booking, room));
})
    .WithName("UpdateBookingDates")
    .WithSummary("Change the dates of an existing booking")
    .Produces<BookingResponse>(StatusCodes.Status200OK)
    .ProducesValidationProblem()
    .Produces(StatusCodes.Status404NotFound)
    .Produces(StatusCodes.Status409Conflict);

app.MapDelete("/api/bookings/{id:int}", async (int id, HotelDbContext db, ILogger<Program> logger, CancellationToken ct) =>
{
    var booking = await db.Bookings.FindAsync([id], ct);
    if (booking is null)
    {
        logger.LogWarning("Cannot cancel missing booking {BookingId}.", id);
        return Results.NotFound();
    }
    db.Bookings.Remove(booking);
    await db.SaveChangesAsync(ct);
    logger.LogInformation("Cancelled booking {BookingId} for room {RoomId}.", booking.Id, booking.RoomId);
    return Results.NoContent();
});

app.Run();

static Dictionary<string, string[]> ValidateStay(DateOnly checkIn, DateOnly checkOut, TimeProvider clock)
{
    var errors = new Dictionary<string, string[]>();
    if (checkIn == default || checkIn < DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime))
        errors["checkIn"] = ["Check-in must be today or later (hotel dates use UTC)."];
    if (checkOut == default || checkOut <= checkIn)
        errors["checkOut"] = ["Check-out must be after check-in."];
    return errors;
}

static IQueryable<Booking> OverlappingBookings(HotelDbContext db, int roomId, DateOnly checkIn, DateOnly checkOut) =>
    db.Bookings.Where(booking => booking.RoomId == roomId && checkIn < booking.CheckOut && checkOut > booking.CheckIn);

static decimal StayPrice(decimal nightlyRate, DateOnly checkIn, DateOnly checkOut) =>
    nightlyRate * (checkOut.DayNumber - checkIn.DayNumber);

static BookingResponse ToBookingResponse(Booking booking, Room room) =>
    new(booking.Id, room.Id, room.Name, booking.GuestName, booking.Guests, booking.CheckIn, booking.CheckOut, booking.TotalPrice);

static IQueryable<BookingResponse> BookingQuery(HotelDbContext db, int? id = null) =>
    from booking in db.Bookings.AsNoTracking()
    join room in db.Rooms on booking.RoomId equals room.Id
    where id == null || booking.Id == id
    orderby booking.CheckIn, booking.Id
    select new BookingResponse(booking.Id, room.Id, room.Name, booking.GuestName, booking.Guests,
        booking.CheckIn, booking.CheckOut, booking.TotalPrice);

public partial class Program { }
