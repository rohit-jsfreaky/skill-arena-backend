# Test Routes Documentation

This document describes the test routes available for testing TDM functionality without authentication.

## TDM Test Routes

### Base URL: `/api/test/tdm`

### 1. Create Dummy TDM Match

**POST** `/api/test/tdm/create-dummy-match`

Creates a new TDM match with empty team slots for testing.

**Request Body:**
```json
{
  "game_name": "Free Fire",     // Optional, default: "Free Fire"
  "entry_fee": 50,              // Optional, default: 50
  "team_size": 4,               // Optional, default: 4 (can be 4, 6, or 8)
  "match_type": "public"        // Optional, default: "public"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Dummy TDM match created successfully",
  "data": {
    "match_id": 123,
    "game_name": "Free Fire",
    "entry_fee": 50,
    "prize_pool": 400,
    "team_size": 4,
    "status": "waiting"
  }
}
```

### 2. Populate TDM Match with Players

**POST** `/api/test/tdm/populate-tdm/:match_id`

Populates a TDM match with random players and makes user ID 20 the captain of Team A.

**URL Parameters:**
- `match_id`: The ID of the match to populate

**Request Body:**
```json
{
  "captainId": 20  // Optional, default: 20 (will be captain of Team A)
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully populated TDM match 123 with 4v4 teams",
  "data": {
    "match_id": 123,
    "team_a": {
      "name": "Team Alpha",
      "members": 4,
      "captain": "Captain"
    },
    "team_b": {
      "name": "Team Beta",
      "members": 4,
      "captain": "TestPlayer1"
    },
    "status": "confirmed"
  }
}
```

**What this route does:**
- Sets team names to "Team Alpha" and "Team Beta"
- Makes user ID 20 the captain of Team A
- Assigns random users to fill both teams
- Sets all payments to "completed"
- Marks teams as ready
- Updates match status to "confirmed"

### 4. Set Room Details

**POST** `/api/test/tdm/set-room-details/:match_id`

Sets room ID and password for a confirmed match (bypasses creator check for testing).

**URL Parameters:**
- `match_id`: The ID of the match to set room details for

**Request Body:**
```json
{
  "room_id": "TDM_123_456789",    // Optional, auto-generated if not provided
  "room_password": "ABC12345",   // Optional, auto-generated if not provided  
  "user_id": 20                  // Optional, default: 20
}
```

**Response:**
```json
{
  "success": true,
  "message": "Room details set successfully",
  "data": {
    "match_id": 123,
    "room_id": "TDM_123_456789",
    "room_password": "ABC12345",
    "game_name": "Free Fire",
    "status": "confirmed",
    "created_by": 1
  }
}
```

### 5. Start Match

**POST** `/api/test/tdm/start-match/:match_id`

Starts a match by changing status from "confirmed" to "in_progress" (bypasses captain check).

**URL Parameters:**
- `match_id`: The ID of the match to start

**Request Body:**
```json
{
  "user_id": 20  // Optional, default: 20
}
```

**Response:**
```json
{
  "success": true,
  "message": "Match started successfully",
  "data": {
    "match_id": 123,
    "status": "in_progress",
    "room_id": "TDM_123_456789",
    "room_password": "ABC12345",
    "game_name": "Free Fire",
    "start_time": "2025-08-05T10:30:00.000Z"
  }
}
```

### 6. Check Match Data

**GET** `/api/test/tdm/check-match/:match_id`

Retrieves detailed information about a TDM match including team composition and payment status.

**URL Parameters:**
- `match_id`: The ID of the match to check

**Response:**
```json
{
  "success": true,
  "message": "Match data retrieved",
  "data": {
    "match_details": {
      "id": 123,
      "game_name": "Free Fire",
      "status": "confirmed",
      "team_size": 4,
      "team_a": {
        "id": 456,
        "team_name": "Team Alpha",
        "members": [
          {
            "user_id": 20,
            "username": "captain_user",
            "is_captain": true,
            "payment_status": "completed"
          }
          // ... more members
        ]
      },
      "team_b": {
        "id": 457,
        "team_name": "Team Beta",
        "members": [
          // ... team B members
        ]
      }
    },
    "team_stats": {
      "team_a": {
        "name": "Team Alpha",
        "members": 4,
        "paid": 4,
        "ready": true
      },
      "team_b": {
        "name": "Team Beta",
        "members": 4,
        "paid": 4,
        "ready": true
      }
    },
    "required_team_size": 4
  }
}
```

## Usage Examples

### Complete Testing Flow

1. **Create a match:**
```bash
curl -X POST http://localhost:3000/api/test/tdm/create-dummy-match \
  -H "Content-Type: application/json" \
  -d '{"game_name": "Free Fire", "entry_fee": 100, "team_size": 4}'
```

2. **Populate the match (replace 123 with actual match_id):**
```bash
curl -X POST http://localhost:3000/api/test/tdm/populate-tdm/123 \
  -H "Content-Type: application/json" \
  -d '{"captainId": 20}'
```

3. **Set room details:**
```bash
curl -X POST http://localhost:3000/api/test/tdm/set-room-details/123 \
  -H "Content-Type: application/json" \
  -d '{"room_id": "CUSTOM_ROOM", "room_password": "PASSWORD123"}'
```

4. **Start the match:**
```bash
curl -X POST http://localhost:3000/api/test/tdm/start-match/123 \
  -H "Content-Type: application/json" \
  -d '{"user_id": 20}'
```

5. **Check the match data:**
```bash
curl -X GET http://localhost:3000/api/test/tdm/check-match/123
```

6. **Access match in frontend:**
   - Go to: `http://localhost:5173/tdm/match/123`
   - Login as user ID 20 to see captain view
   - Check Teams tab to see both Team A and Team B populated
   - Check Match Info tab to see room details
   - Use Actions tab to start the match or upload screenshots

## Troubleshooting

### Common Issues:

1. **"Not enough users in database"**
   - Ensure you have at least 7 users in your database (for 4v4 match: 8 total users - 1 captain = 7 needed)
   - Check users table: `SELECT COUNT(*) FROM users;`

2. **"Match not found"**
   - Verify the match ID exists in tdm_matches table
   - Use the check-match endpoint to verify match data

3. **"Match must be in 'confirmed' status"**
   - Run populate-tdm endpoint first to set match status to confirmed
   - Check current status with check-match endpoint

4. **"Room details must be set before starting"**
   - Use set-room-details endpoint before trying to start the match
   - Room details are required for matches to progress to in_progress status

5. **Teams tab not showing Team B**
   - Use check-match endpoint to verify team_b data exists
   - Check that team_b has team_name set and members populated
   - Verify frontend is calling the correct API endpoint

### Database Verification:

```sql
-- Check match exists
SELECT * FROM tdm_matches WHERE id = 123;

-- Check teams
SELECT * FROM tdm_teams WHERE match_id = 123;

-- Check team members
SELECT tm.*, u.username 
FROM tdm_team_members tm 
JOIN users u ON tm.user_id = u.id 
JOIN tdm_teams t ON tm.team_id = t.id 
WHERE t.match_id = 123;
```

## Notes

- These routes bypass authentication for testing purposes
- All generated users get 1000 wallet balance automatically
- Match status progression: waiting → confirmed → in_progress → completed
- Team captains are automatically set (first member of each team)
- All payments are marked as completed automatically
- Room details are auto-generated if not provided in the request
- Only the match creator can set room details in normal operation, but test routes bypass this check
- Room details are required before a match can be started
