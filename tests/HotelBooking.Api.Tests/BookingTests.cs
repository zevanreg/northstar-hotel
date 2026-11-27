using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using HotelBooking.Api.Contracts;
using HotelBooking.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Xunit;

namespace HotelBooking.Api.Tests;

public sealed class HotelFactory : WebApplicationFactory<Program>
{
    private readonly SqliteConnection connection = new($"Data Source=hotel-{Guid.NewGuid():N};Mode=Memory;Cache=Shared");
    public BookingLogProvider BookingLogs { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        connection.Open();
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<HotelDbContext>>();
            services.AddDbContext<HotelDbContext>(options => options.UseSqlite(connection.ConnectionString));
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(new HotelClock());
            services.AddSingleton<ILoggerProvider>(BookingLogs);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) connection.Dispose();
    }

    private sealed class HotelClock : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(2099, 1, 1, 12, 0, 0, TimeSpan.Zero);
    }
}

public sealed class BookingLogProvider : ILoggerProvider
{
    public ConcurrentQueue<BookingLog> Entries { get; } = new();

    public ILogger CreateLogger(string categoryName) => new CaptureLogger(categoryName, Entries);
    public void Dispose() { }

    private sealed class CaptureLogger(string categoryName, ConcurrentQueue<BookingLog> entries) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (categoryName == typeof(Program).FullName)
                entries.Enqueue(new BookingLog(logLevel,
                    Assert.IsAssignableFrom<IEnumerable<KeyValuePair<string, object?>>>(state).ToArray(),
                    formatter(state, exception), exception));
        }
    }
}

public sealed record BookingLog(LogLevel Level, KeyValuePair<string, object?>[] State, string Message, Exception? Exception);

public sealed class BookingTests
{
    private static CreateBookingRequest Request(string start = "2099-06-10", string end = "2099-06-12", int roomId = 2, int guests = 2) =>
        new(roomId, "Sample Guest", "guest@example.test", guests, DateOnly.Parse(start), DateOnly.Parse(end));

    [Fact]
    public async Task Cancellation_logs_only_booking_and_room_ids_after_persisting()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/bookings", Request());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var booking = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.NotNull(booking);
        factory.BookingLogs.Entries.Clear();

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/bookings/{booking.Id}")).StatusCode);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
        Assert.False(await db.Bookings.AnyAsync(existing => existing.Id == booking.Id));

        var log = Assert.Single(factory.BookingLogs.Entries);
        Assert.Equal(LogLevel.Information, log.Level);
        Assert.Equal(
            [
                new KeyValuePair<string, object?>("BookingId", booking.Id),
                new KeyValuePair<string, object?>("RoomId", booking.RoomId),
                new KeyValuePair<string, object?>("{OriginalFormat}", "Cancelled booking {BookingId} for room {RoomId}.")
            ], log.State);
        Assert.Equal($"Cancelled booking {booking.Id} for room {booking.RoomId}.", log.Message);
        Assert.Null(log.Exception);
    }

    [Fact]
    public async Task Missing_cancellation_logs_only_requested_booking_id_as_warning()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        factory.BookingLogs.Entries.Clear();

        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("/api/bookings/999")).StatusCode);

        var log = Assert.Single(factory.BookingLogs.Entries);
        Assert.Equal(LogLevel.Warning, log.Level);
        Assert.Equal(
            [
                new KeyValuePair<string, object?>("BookingId", 999),
                new KeyValuePair<string, object?>("{OriginalFormat}", "Cannot cancel missing booking {BookingId}.")
            ], log.State);
        Assert.Equal("Cannot cancel missing booking 999.", log.Message);
        Assert.Null(log.Exception);
    }

    [Fact]
    public async Task Failed_cancellation_save_does_not_log_success()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/bookings", Request());
        var booking = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.NotNull(booking);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
            await db.Database.ExecuteSqlRawAsync(
                "CREATE TRIGGER reject_cancellation BEFORE DELETE ON Bookings BEGIN SELECT RAISE(ABORT, 'Synthetic save failure'); END;");
        }
        factory.BookingLogs.Entries.Clear();

        Assert.Equal(HttpStatusCode.InternalServerError, (await client.DeleteAsync($"/api/bookings/{booking.Id}")).StatusCode);
        using var verificationScope = factory.Services.CreateScope();
        var verificationDb = verificationScope.ServiceProvider.GetRequiredService<HotelDbContext>();
        Assert.True(await verificationDb.Bookings.AnyAsync(existing => existing.Id == booking.Id));
        Assert.Empty(factory.BookingLogs.Entries);
    }

    [Fact]
    public async Task Guest_can_search_book_read_and_cancel_with_exact_decimal_price()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var rooms = await client.GetFromJsonAsync<RoomResponse[]>("/api/rooms");
        Assert.Equal(6, rooms!.Length);
        Assert.All(rooms, room => Assert.Null(room.IsAvailable));
        var response = await client.PostAsJsonAsync("/api/bookings", Request());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var booking = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.Equal(290m, booking!.TotalPrice);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(response.Headers.Location)).StatusCode);
        Assert.Single((await client.GetFromJsonAsync<BookingResponse[]>("/api/bookings"))!);
        var searched = await client.GetFromJsonAsync<RoomResponse[]>("/api/rooms?checkIn=2099-06-10&checkOut=2099-06-12");
        Assert.NotNull(searched);
        Assert.False(searched.Single(room => room.Id == 2).IsAvailable);
        Assert.True(searched.Single(room => room.Id == 1).IsAvailable);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/bookings/{booking.Id}")).StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<BookingResponse[]>("/api/bookings"))!);
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/bookings", Request())).StatusCode);
    }

    [Theory]
    [InlineData("2099-06-09", "2099-06-11")]
    [InlineData("2099-06-11", "2099-06-13")]
    [InlineData("2099-06-10", "2099-06-12")]
    [InlineData("2099-06-09", "2099-06-13")]
    [InlineData("2099-06-10", "2099-06-11")]
    public async Task Overlapping_stays_are_rejected(string start, string end)
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/bookings", Request())).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/bookings", Request(start, end))).StatusCode);
    }

    [Theory]
    [InlineData("2099-06-08", "2099-06-10")]
    [InlineData("2099-06-12", "2099-06-14")]
    public async Task Adjacent_stays_are_allowed(string start, string end)
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        await client.PostAsJsonAsync("/api/bookings", Request());
        Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync("/api/bookings", Request(start, end))).StatusCode);
    }

    [Theory]
    [InlineData("2098-12-31", "2099-01-02")]
    [InlineData("2099-06-10", "2099-06-10")]
    [InlineData("2099-06-12", "2099-06-10")]
    public async Task Invalid_dates_are_rejected_at_both_boundaries(string start, string end)
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/bookings", Request(start, end))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync($"/api/rooms?checkIn={start}&checkOut={end}")).StatusCode);
    }

    [Fact]
    public async Task Invalid_guest_details_capacity_missing_dates_and_missing_resources_are_rejected()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        CreateBookingRequest[] invalid =
        [
            Request() with { GuestName = " " }, Request() with { GuestName = new string('a', 101) },
            Request() with { Email = "invalid" }, Request() with { Email = null },
            Request(guests: 0), Request(guests: 3), Request() with { CheckIn = default }
        ];
        foreach (var request in invalid)
            Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/bookings", request)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/rooms?checkIn=2099-06-10")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.GetAsync("/api/rooms?checkIn=not-a-date&checkOut=2099-06-12")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/bookings", Request(roomId: 999))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/bookings/999")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.DeleteAsync("/api/bookings/999")).StatusCode);
    }

    [Fact]
    public async Task Reseeding_preserves_bookings_and_exactly_six_rooms()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        await client.PostAsJsonAsync("/api/bookings", Request());
        using var scope = factory.Services.CreateScope();
        await Seeder.SeedAsync(scope.ServiceProvider.GetRequiredService<HotelDbContext>());
        Assert.Equal(6, (await client.GetFromJsonAsync<RoomResponse[]>("/api/rooms"))!.Length);
        Assert.Single((await client.GetFromJsonAsync<BookingResponse[]>("/api/bookings"))!);
    }

    [Fact]
    public async Task Concurrent_requests_cannot_double_book()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var results = await Task.WhenAll(Enumerable.Range(0, 2)
            .Select(_ => client.PostAsJsonAsync("/api/bookings", Request())));
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Fractional_currency_is_preserved_and_other_rooms_remain_bookable()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
            var room = await db.Rooms.SingleAsync(room => room.Id == 2);
            room.NightlyRate = 145.25m;
            await db.SaveChangesAsync();
        }
        var response = await client.PostAsJsonAsync("/api/bookings", Request());
        var booking = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.NotNull(booking);
        Assert.Equal(290.50m, booking.TotalPrice);
        Assert.Equal(HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/api/bookings", Request(roomId: 3))).StatusCode);
    }

    [Fact]
    public async Task Today_is_allowed_and_malformed_or_missing_body_fields_return_bad_request()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Created,
            (await client.PostAsJsonAsync("/api/bookings", Request("2099-01-01", "2099-01-02"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsJsonAsync("/api/bookings", new { roomId = 2 })).StatusCode);
        using var malformed = new StringContent("{ invalid", System.Text.Encoding.UTF8, "application/json");
        Assert.Equal(HttpStatusCode.BadRequest,
            (await client.PostAsync("/api/bookings", malformed)).StatusCode);
    }
}
