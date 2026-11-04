using Microsoft.EntityFrameworkCore;

namespace HotelBooking.Api.Data;

public sealed class HotelDbContext(DbContextOptions<HotelDbContext> options) : DbContext(options)
{
    public DbSet<Room> Rooms => Set<Room>();
    public DbSet<Booking> Bookings => Set<Booking>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<Room>().HasIndex(room => room.Name).IsUnique();
        model.Entity<Room>().Property(room => room.NightlyRate).HasPrecision(10, 2);
        model.Entity<Booking>().Property(booking => booking.TotalPrice).HasPrecision(10, 2);
        model.Entity<Booking>().HasOne<Room>().WithMany().HasForeignKey(booking => booking.RoomId);
        model.Entity<Booking>().HasIndex(booking => new { booking.RoomId, booking.CheckIn, booking.CheckOut });
    }
}

public sealed class Room
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Description { get; set; }
    public int Capacity { get; set; }
    public decimal NightlyRate { get; set; }
}

public sealed class Booking
{
    public int Id { get; set; }
    public int RoomId { get; set; }
    public required string GuestName { get; set; }
    public required string Email { get; set; }
    public int Guests { get; set; }
    public DateOnly CheckIn { get; set; }
    public DateOnly CheckOut { get; set; }
    public decimal TotalPrice { get; set; }
}
