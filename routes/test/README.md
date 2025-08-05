# Test API Endpoints Documentation

These test endpoints are designed to help you quickly populate tournaments and TDM matches with dummy data for testing purposes. **NO AUTHENTICATION REQUIRED** for these endpoints.

## Base URL
`http://localhost:3000/api/test`

## TDM Test Endpoints

### 1. Populate Existing TDM Match
**POST** `/api/test/tdm/populate-match/:match_id`

Populates an existing TDM match with random players and makes user ID 20 the captain of Team A.

**Parameters:**
- `match_id` (URL parameter) - The ID of the existing TDM match

**Features:**
- Creates test users with sufficient wallet balance
- Makes user ID 20 captain of Team A
- Fills both teams based on the match's team_size
- Marks all payments as completed
- Deducts entry fees from wallets

**Example:**
```bash
curl -X POST http://localhost:3000/api/test/tdm/populate-match/1
```

### 2. Create and Populate New TDM Match
**POST** `/api/test/tdm/create-and-populate`

Creates a new TDM match and populates it with random players.

**Body (optional):**
```json
{
  "team_size": 4,
  "match_type": "private",
  "game_name": "Test Game"
}
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/test/tdm/create-and-populate \
  -H "Content-Type: application/json" \
  -d '{"team_size": 6, "game_name": "PUBG"}'
```

### 3. Get TDM Match Details
**GET** `/api/test/tdm/match-details/:match_id`

Retrieves detailed information about a TDM match including teams and players.

**Example:**
```bash
curl http://localhost:3000/api/test/tdm/match-details/1
```

### 4. Clear TDM Test Data
**DELETE** `/api/test/tdm/clear-test-data`

Removes all test users (emails ending with @test.com) and related data.

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/test/tdm/clear-test-data
```

## Tournament Test Endpoints

### 1. Populate Existing Tournament
**POST** `/api/test/tournament/populate-tournament/:tournament_id`

Populates an existing tournament with random players and makes user ID 20 the captain.

**Parameters:**
- `tournament_id` (URL parameter) - The ID of the existing tournament

**Features:**
- Creates teams based on tournament's team_mode and max_participants
- Makes user ID 20 captain of the first team
- Fills all teams with test players
- Marks all payments as completed

**Example:**
```bash
curl -X POST http://localhost:3000/api/test/tournament/populate-tournament/1
```

### 2. Create and Populate New Tournament
**POST** `/api/test/tournament/create-and-populate`

Creates a new tournament and populates it with random players.

**Body (optional):**
```json
{
  "name": "Test Tournament",
  "game_name": "Test Game",
  "team_mode": "4v4",
  "max_participants": 32,
  "entry_fee_normal": 100,
  "prize_pool": 3000
}
```

**Team Modes:**
- `solo` - 1 player per team
- `duo` - 2 players per team
- `4v4` - 4 players per team
- `6v6` - 6 players per team
- `8v8` - 8 players per team

**Example:**
```bash
curl -X POST http://localhost:3000/api/test/tournament/create-and-populate \
  -H "Content-Type: application/json" \
  -d '{"team_mode": "duo", "max_participants": 20}'
```

### 3. Get Tournament Details
**GET** `/api/test/tournament/tournament-details/:tournament_id`

Retrieves detailed information about a tournament including teams and players.

**Example:**
```bash
curl http://localhost:3000/api/test/tournament/tournament-details/1
```

### 4. Clear Tournament Test Data
**DELETE** `/api/test/tournament/clear-test-data`

Removes all test users and related tournament data.

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/test/tournament/clear-test-data
```

## Test User Details

All test users are created with:
- **Wallet Balance:** 1000.00 (sufficient for multiple tournaments)
- **Email Pattern:** `testplayer{n}@test.com` or `tournamentplayer{n}@test.com`
- **Name Pattern:** `TestPlayer{n}` or `TournamentPlayer{n}`
- **Referral Code:** Auto-generated unique codes

## Captain User (ID: 20)

- User ID 20 is automatically made captain in all populated matches/tournaments
- If user ID 20 doesn't exist, the endpoints will return an error
- The captain's wallet is automatically topped up to 1000.00 if needed

## Notes

1. **No Authentication:** These endpoints bypass all authentication for easy testing
2. **Database Cleanup:** Use the clear-test-data endpoints to remove test users
3. **Wallet Management:** Entry fees are automatically deducted from wallets
4. **Payment Status:** All payments are marked as 'completed' for testing
5. **Team Assignment:** Players are distributed evenly across teams
6. **Error Handling:** Proper error messages for missing matches/tournaments

## Quick Test Flow

1. Create/populate a tournament:
   ```bash
   curl -X POST http://localhost:3000/api/test/tournament/create-and-populate
   ```

2. Create/populate a TDM match:
   ```bash
   curl -X POST http://localhost:3000/api/test/tdm/create-and-populate
   ```

3. Check the data:
   ```bash
   curl http://localhost:3000/api/test/tournament/tournament-details/1
   curl http://localhost:3000/api/test/tdm/match-details/1
   ```

4. Clean up when done:
   ```bash
   curl -X DELETE http://localhost:3000/api/test/tournament/clear-test-data
   ```
