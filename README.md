# Kinetra

Kinetra is a fitness and gym management platform for members, trainers, and administrators. Members can browse and book classes, save favorites, and join trainer-led discussions. Trainers can submit classes and forum posts; admins review submissions, manage roles, moderate content, and view payment records.

**Live URL:** https://b13-a10-frontend.vercel.app/ (provided in the project brief; deployment was not verified as part of this source change).

## Key features

- Role-based member, trainer, and admin dashboards.
- Approved-class discovery with server-side name search, category filtering, and pagination.
- Server-side pagination for the public community forum.
- Private class details, favorites, Stripe Checkout, and payment confirmation by webhook.
- Trainer applications, class moderation, attendee lists, and forum-post moderation.
- Forum reactions, nested comments, and owner-only comment editing/deletion.
- Better Auth email/password authentication, optional Google sign-in, and JWT-backed HttpOnly cookies.
- Responsive layouts, Motion entrance animations, and a custom 404 page.

## Packages

- `better-auth` — account and session authentication.
- `mongodb` — MongoDB Atlas persistence and queries.
- `stripe` — Checkout sessions and signed webhook verification.
- `motion` — homepage and card animations.
- `esbuild` — browser bundle generation.
- `dotenv` — local environment loading.
- `jsonwebtoken` — signed access tokens.

## Run locally

1. Install Node.js 18 or later.
2. Install dependencies with `npm install`.
3. Copy `.env.example` to `.env`, set `MONGODB_URI` to your MongoDB Atlas connection string, and set `BETTER_AUTH_SECRET` to a random secret of at least 32 characters. Set `ADMIN_PASSWORD` to a strong password to bootstrap the configured `ADMIN_EMAIL` on first start. Add Stripe `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and public `APP_BASE_URL` to enable payments. Set `IMGBB_API_KEY` to enable trainer/admin image uploads. Keep `.env` private; it is excluded from Git.
4. Start the app with `npm start`.
5. Open `http://localhost:3000`.

The API uses the `flexora` database. Better Auth manages the user and session collections; trainer applications use `trainerApplications`; paid class bookings use `bookings`; and saved classes use `favorites`. Unique indexes prevent duplicate favorites, votes, and bookings. Both the homepage and class discovery read only approved class documents from `classes` (the status comparison is case-insensitive).

Class documents should include `name`, `trainerName`, `category`, `price`, `duration`, `schedule`, and `description`, with an optional HTTPS `imageUrl`. For Stripe Checkout, configure either a Stripe `stripePriceId` on the class or both `priceInMinorUnits` (an integer in the currency's smallest unit) and a three-letter `currency` code. Class booking counts are computed from non-cancelled, non-rejected documents in `bookings`; the homepage shows the top three classes sorted by that count.

Forum posts are read from `forumPosts`; publish them with `status: "published"` (or `"approved"`) and an author role of `trainer` or `admin` in `authorRole`, `authorType`, `createdByRole`, `role`, or `author.role`. Include `title`, `content`, `authorName`, and optionally an `imageUrl` and `category`. The public `/community` page lists these posts and `/community/:id` displays an individual post.

The frontend uses Motion for scroll-triggered entrance animations and is bundled when `npm start` runs. `GET /api/home` returns the featured classes and latest four forum posts; `GET /api/health` checks the MongoDB connection. The browse and forum pages use the paginated API responses and show six entries per page.

Open `http://localhost:3000/classes` to browse approved classes. A class details route (`/classes/:id`), payment page (`/payment`), and member dashboard (`/dashboard`) require a signed-in member. Passwords are scrypt-hashed; session tokens are stored hashed in MongoDB and sent as HttpOnly, SameSite cookies. Booking state is checked against the logged-in member and class before creating Checkout, and checked again by the server during Checkout creation. Successful payment is confirmed on return from Stripe or by the signed webhook; the dashboard lists the member's saved favorite classes.

Email/password registration and login use Better Auth. New accounts receive the `member` role; trainer and admin roles must be assigned by a trusted administrator and cannot be selected during registration. The private dashboard includes member bookings, favorites, and trainer applications; trainer class and forum-post management; and admin pages for users, applications, trainers, classes, transactions, and forum moderation. Trainer-created classes remain pending until approved. Trainer class and forum images are uploaded through the server to ImgBB, so configure `IMGBB_API_KEY` to enable uploads.

Configure a Stripe webhook endpoint at `https://<your-host>/api/stripe/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.expired`. The webhook signature is verified with `STRIPE_WEBHOOK_SECRET`; a booking is confirmed only after Stripe reports successful payment. In production, use HTTPS and configure `APP_BASE_URL` to the exact public origin. Account email verification and password recovery are not implemented yet.
