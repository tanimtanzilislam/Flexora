# Kinetra

Kinetra is a fitness-platform UI served by a small Node.js API. Member registrations, trainer applications, class booking requests, featured classes, and community previews use MongoDB Atlas.

## Run locally

1. Install Node.js 18 or later.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI` to your MongoDB Atlas connection string. Keep `.env` private; it is excluded from Git.
4. Start the app with `npm start`.
5. Open `http://localhost:3000`.

The API uses the `flexora` database. Member and booking requests use the `members`, `trainerApplications`, and `bookings` collections. The homepage reads class documents from `classes` (set `status` to `approved` or `active` when present) and the latest forum documents from `forumPosts` (set `status` to `published` or `approved` when present). The public `/classes` page and `GET /api/classes` show only documents whose `status` is `Approved` (case-insensitive). Class documents should include `name`, `trainerName`, `category`, `price`, `duration`, `description`, and optionally an HTTPS `imageUrl`. Forum documents should include `title`, `content`, `authorName`, `category`, and `createdAt`. Class booking counts are computed from non-cancelled, non-rejected documents in `bookings`; the homepage shows the top three classes sorted by that count.

The frontend uses Motion for scroll-triggered entrance animations and is bundled when `npm start` runs. `GET /api/home` returns the featured classes and latest four forum posts; `GET /api/health` checks the MongoDB connection.

Open `http://localhost:3000/classes` to browse approved classes. `GET /api/classes` filters the `classes` collection to `status: "Approved"` (case-insensitive) and returns trainer, category, price, duration, booking count, and details for each class.

Authentication and admin workflows are not implemented yet. Class booking creates a request record; it does not confirm a reserved spot.
