namespace HotelBooking.Api.Contracts;

public sealed record RoomResponse(int Id, string Name, string Description, int Capacity, decimal NightlyRate, bool? IsAvailable);
public sealed record CreateBookingRequest(int RoomId, string? GuestName, string? Email, int Guests, DateOnly CheckIn, DateOnly CheckOut);
/// <summary>New check-in and check-out dates for an existing booking.</summary>
public sealed record UpdateBookingDatesRequest(DateOnly CheckIn, DateOnly CheckOut);
public sealed record BookingResponse(int Id, int RoomId, string RoomName, string GuestName, int Guests, DateOnly CheckIn, DateOnly CheckOut, decimal TotalPrice);
