using Microsoft.EntityFrameworkCore;

namespace HotelBooking.Api.Data;

public static class Seeder
{
    public static async Task SeedAsync(HotelDbContext db, CancellationToken cancellationToken = default)
    {
        await db.Database.EnsureCreatedAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        Room[] rooms =
        [
            new() { Name = "Harbour Single", Description = "A quiet retreat with a reading nook and a harbour outlook.", Capacity = 1, NightlyRate = 115m },
            new() { Name = "Courtyard Double", Description = "Soft linen, a generous double bed, and courtyard calm.", Capacity = 2, NightlyRate = 145m },
            new() { Name = "Garden Twin", Description = "Two comfortable beds beside our sheltered garden.", Capacity = 2, NightlyRate = 155m },
            new() { Name = "Harbour King", Description = "A king-size bed and room to unwind above the waterfront.", Capacity = 2, NightlyRate = 185m },
            new() { Name = "Family Studio", Description = "An easy-going base with a double bed and two single beds.", Capacity = 4, NightlyRate = 225m },
            new() { Name = "Northstar Suite", Description = "Our most spacious stay, with a separate lounge and harbour views.", Capacity = 3, NightlyRate = 295m }
        ];
        foreach (var room in rooms)
        {
            if (!await db.Rooms.AnyAsync(existing => existing.Name == room.Name, cancellationToken))
                db.Rooms.Add(room);
        }
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
