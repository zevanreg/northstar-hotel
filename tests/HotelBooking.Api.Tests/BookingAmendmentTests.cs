using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using HotelBooking.Api.Contracts;
using HotelBooking.Api.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace HotelBooking.Api.Tests;

public sealed class BookingAmendmentTests
{
    private static async Task<BookingResponse> CreateBooking(HttpClient client, string checkIn, string checkOut, int roomId = 2)
    {
        var response = await client.PostAsJsonAsync("/api/bookings", new CreateBookingRequest(
            roomId, "Sample Guest", "guest@example.test", 2, DateOnly.Parse(checkIn), DateOnly.Parse(checkOut)));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var booking = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.NotNull(booking);
        return booking;
    }

    [Fact]
    public async Task Amendment_excludes_its_own_stay_and_recalculates_using_current_room_rate()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var original = await CreateBooking(client, "2099-06-10", "2099-06-12");
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<HotelDbContext>();
            var room = await db.Rooms.SingleAsync(room => room.Id == original.RoomId);
            room.NightlyRate = 147.25m;
            await db.SaveChangesAsync();
        }

        var response = await client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new
        {
            checkIn = "2099-06-11", checkOut = "2099-06-14", roomId = 1, guestName = "Changed"
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var amended = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.NotNull(amended);
        Assert.Equal(original.Id, amended.Id);
        Assert.Equal(original.RoomId, amended.RoomId);
        Assert.Equal(original.GuestName, amended.GuestName);
        Assert.Equal(original.Guests, amended.Guests);
        Assert.Equal(new DateOnly(2099, 6, 11), amended.CheckIn);
        Assert.Equal(new DateOnly(2099, 6, 14), amended.CheckOut);
        Assert.Equal(441.75m, amended.TotalPrice);
        Assert.Equal(amended, await client.GetFromJsonAsync<BookingResponse>($"/api/bookings/{original.Id}"));

        var released = await client.GetFromJsonAsync<RoomResponse[]>("/api/rooms?checkIn=2099-06-10&checkOut=2099-06-11");
        var occupied = await client.GetFromJsonAsync<RoomResponse[]>("/api/rooms?checkIn=2099-06-13&checkOut=2099-06-14");
        Assert.NotNull(released);
        Assert.NotNull(occupied);
        Assert.True(released.Single(room => room.Id == original.RoomId).IsAvailable);
        Assert.False(occupied.Single(room => room.Id == original.RoomId).IsAvailable);
    }

    [Theory]
    [InlineData("2099-01-01", "2099-01-02")]
    [InlineData("2099-06-10", "2099-06-12")]
    public async Task Amendment_allows_today_and_unchanged_dates(string checkIn, string checkOut)
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var original = await CreateBooking(client, "2099-06-10", "2099-06-12");

        var response = await client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new { checkIn, checkOut });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var amended = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.NotNull(amended);
        Assert.Equal(DateOnly.Parse(checkIn), amended.CheckIn);
        Assert.Equal(DateOnly.Parse(checkOut), amended.CheckOut);
        Assert.Equal(145m * (amended.CheckOut.DayNumber - amended.CheckIn.DayNumber), amended.TotalPrice);
    }

    [Theory]
    [InlineData("2099-06-13", "2099-06-15")]
    [InlineData("2099-06-15", "2099-06-17")]
    [InlineData("2099-06-14", "2099-06-16")]
    [InlineData("2099-06-13", "2099-06-17")]
    [InlineData("2099-06-14", "2099-06-15")]
    public async Task Conflicting_amendment_reports_conflict_without_changing_either_booking(string checkIn, string checkOut)
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var original = await CreateBooking(client, "2099-06-10", "2099-06-12");
        var other = await CreateBooking(client, "2099-06-14", "2099-06-16");

        var response = await client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new { checkIn, checkOut });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains("not changed", body.GetProperty("detail").GetString());
        Assert.Equal(original, await client.GetFromJsonAsync<BookingResponse>($"/api/bookings/{original.Id}"));
        Assert.Equal(other, await client.GetFromJsonAsync<BookingResponse>($"/api/bookings/{other.Id}"));
    }

    [Theory]
    [InlineData("2099-06-12", "2099-06-14")]
    [InlineData("2099-06-16", "2099-06-18")]
    public async Task Adjacent_amendments_are_allowed_and_bookings_in_other_rooms_do_not_conflict(string checkIn, string checkOut)
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var original = await CreateBooking(client, "2099-06-10", "2099-06-12");
        await CreateBooking(client, "2099-06-14", "2099-06-16");
        await CreateBooking(client, checkIn, checkOut, roomId: 3);

        var response = await client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new { checkIn, checkOut });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var amended = await response.Content.ReadFromJsonAsync<BookingResponse>();
        Assert.NotNull(amended);
        Assert.Equal(DateOnly.Parse(checkIn), amended.CheckIn);
        Assert.Equal(DateOnly.Parse(checkOut), amended.CheckOut);
    }

    [Theory]
    [InlineData("2098-12-31", "2099-01-02")]
    [InlineData("2099-06-10", "2099-06-10")]
    [InlineData("2099-06-12", "2099-06-10")]
    public async Task Invalid_amendment_dates_are_rejected_without_changing_booking(string checkIn, string checkOut)
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var original = await CreateBooking(client, "2099-06-10", "2099-06-12");
        var response = await client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new { checkIn, checkOut });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(original, await client.GetFromJsonAsync<BookingResponse>($"/api/bookings/{original.Id}"));
    }

    [Fact]
    public async Task Amendment_handles_missing_booking_missing_dates_and_malformed_json()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var original = await CreateBooking(client, "2099-06-10", "2099-06-12");
        Assert.Equal(HttpStatusCode.NotFound, (await client.PatchAsJsonAsync("/api/bookings/999", new
        {
            checkIn = "2099-06-10", checkOut = "2099-06-12"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new
        {
            checkIn = "2099-06-10"
        })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new
        {
            checkOut = "2099-06-12"
        })).StatusCode);
        using var malformed = new StringContent("{ invalid", System.Text.Encoding.UTF8, "application/json");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PatchAsync($"/api/bookings/{original.Id}", malformed)).StatusCode);
        Assert.Equal(original, await client.GetFromJsonAsync<BookingResponse>($"/api/bookings/{original.Id}"));
    }

    [Fact]
    public async Task Concurrent_amendments_cannot_move_two_bookings_into_the_same_stay()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var first = await CreateBooking(client, "2099-06-01", "2099-06-03");
        var second = await CreateBooking(client, "2099-06-05", "2099-06-07");
        var dates = new { checkIn = "2099-06-10", checkOut = "2099-06-12" };

        var results = await Task.WhenAll(
            client.PatchAsJsonAsync($"/api/bookings/{first.Id}", dates),
            client.PatchAsJsonAsync($"/api/bookings/{second.Id}", dates));

        Assert.Single(results, response => response.StatusCode == HttpStatusCode.OK);
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict);
        var bookings = await client.GetFromJsonAsync<BookingResponse[]>("/api/bookings");
        Assert.NotNull(bookings);
        Assert.Equal(2, bookings.Length);
        Assert.Single(bookings, booking => booking.CheckIn == new DateOnly(2099, 6, 10));
        var rejected = results[0].StatusCode == HttpStatusCode.Conflict ? first : second;
        Assert.Equal(rejected, bookings.Single(booking => booking.Id == rejected.Id));
    }

    [Fact]
    public async Task Concurrent_amendment_and_creation_cannot_double_book()
    {
        using var factory = new HotelFactory();
        using var client = factory.CreateClient();
        var original = await CreateBooking(client, "2099-06-01", "2099-06-03");
        var amendment = client.PatchAsJsonAsync($"/api/bookings/{original.Id}", new
        {
            checkIn = "2099-06-10", checkOut = "2099-06-12"
        });
        var creation = client.PostAsJsonAsync("/api/bookings", new CreateBookingRequest(
            2, "Another Guest", "other@example.test", 2, new DateOnly(2099, 6, 10), new DateOnly(2099, 6, 12)));

        var results = await Task.WhenAll(amendment, creation);

        Assert.Single(results, response => response.StatusCode is HttpStatusCode.OK or HttpStatusCode.Created);
        Assert.Single(results, response => response.StatusCode == HttpStatusCode.Conflict);
        var bookings = await client.GetFromJsonAsync<BookingResponse[]>("/api/bookings");
        Assert.NotNull(bookings);
        Assert.Single(bookings, booking => booking.CheckIn == new DateOnly(2099, 6, 10));
    }
}
