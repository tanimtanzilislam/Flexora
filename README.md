# Kinetra

Kinetra is a static fitness-platform UI served by a small Node.js API. Member registrations, trainer applications, and class booking requests are stored in MongoDB Atlas.

## Run locally

1. Install Node.js 18 or later.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI` to your MongoDB Atlas connection string. Keep `.env` private; it is excluded from Git.
4. Start the app with `npm start`.
5. Open `http://localhost:3000`.

The API uses the `flexora` database and creates `members`, `trainerApplications`, and `bookings` collections as needed. `GET /api/health` checks the MongoDB connection.

Authentication and admin workflows are not implemented yet. Class booking creates a request record; it does not confirm a reserved spot.
