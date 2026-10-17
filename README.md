# Kinetra

Kinetra is a fitness platform served by a small Node.js API. Member accounts, trainer applications, paid class bookings, featured classes, and community previews use MongoDB Atlas.

## Run locally

1. Install Node.js 18 or later.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env` and set `MONGODB_URI` to your MongoDB Atlas connection string. For payments, add your Stripe `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and public `APP_BASE_URL`. Keep `.env` private; it is excluded from Git.
4. Start the app with `npm start`.
5. Open `http://localhost:3000`.

The API uses the `flexora` database. Accounts and sessions use `members` and `sessions`; trainer applications use `trainerApplications`; and payment-backed bookings use `bookings`. Both the homepage and class discovery read only approved class documents from `classes` (the status comparison is case-insensitive). The homepage also reads the latest forum documents from `forumPosts` (set `status` to `published` or `approved` when present).

Class documents should include `name`, `trainerName`, `category`, `price`, `duration`, `schedule`, and `description`, with an optional HTTPS `imageUrl`. For Stripe Checkout, configure either a Stripe `stripePriceId` on the class or both `priceInMinorUnits` (an integer in the currency's smallest unit) and a three-letter `currency` code. Class booking counts are computed from non-cancelled, non-rejected documents in `bookings`; the homepage shows the top three classes sorted by that count.

The frontend uses Motion for scroll-triggered entrance animations and is bundled when `npm start` runs. `GET /api/home` returns the featured classes and latest four forum posts; `GET /api/health` checks the MongoDB connection.

Open `http://localhost:3000/classes` to browse approved classes. A class details route (`/classes/:id`) requires a signed-in member. Passwords are scrypt-hashed; session tokens are stored hashed in MongoDB and sent as HttpOnly, SameSite cookies. Booking state is checked against the logged-in member and class before creating Checkout, and checked again by the server during Checkout creation.

Configure a Stripe webhook endpoint at `https://<your-host>/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`. The webhook signature is verified with `STRIPE_WEBHOOK_SECRET`; a booking is confirmed only after Stripe reports successful payment. In production, use HTTPS and configure `APP_BASE_URL` to the exact public origin. Account email verification and password recovery are not implemented yet.
