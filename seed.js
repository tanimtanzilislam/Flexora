const SAMPLE_CLASSES = [
  {
    name: "Sunrise Power Yoga",
    category: "Yoga",
    difficulty: "Beginner",
    duration: 45,
    schedule: [{ day: "Monday", time: "6:30 AM" }, { day: "Thursday", time: "6:30 AM" }],
    priceInMinorUnits: 1800,
    currency: "usd",
    description: "Open the day with breath-led strength, mobility, and a calm finish.",
    imageUrl: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=1200&q=80",
    status: "approved",
    trainerName: "Maya Chen"
  },
  {
    name: "Iron Pulse Strength",
    category: "Weights",
    difficulty: "Intermediate",
    duration: 55,
    schedule: [{ day: "Tuesday", time: "7:00 PM" }, { day: "Friday", time: "7:00 PM" }],
    priceInMinorUnits: 2500,
    currency: "usd",
    description: "Compound lifts, smart progression, and coaching that meets you where you are.",
    imageUrl: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1200&q=80",
    status: "approved",
    trainerName: "Jordan Hale"
  },
  {
    name: "Cardio Circuit Lab",
    category: "Cardio",
    difficulty: "All levels",
    duration: 40,
    schedule: [{ day: "Wednesday", time: "6:00 PM" }, { day: "Saturday", time: "9:00 AM" }],
    priceInMinorUnits: 2000,
    currency: "usd",
    description: "Intervals, heart-rate work, and a finish that leaves you lighter on your feet.",
    imageUrl: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80",
    status: "approved",
    trainerName: "Amina Cole"
  }
];

const SAMPLE_POSTS = [
  {
    title: "How to show up when motivation is quiet",
    content: "Consistency is a practice, not a mood. Start smaller than you think, keep the promise, and let the work compound.",
    imageUrl: "https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80",
    authorName: "Kinetra Admin",
    authorRole: "admin",
    status: "published",
    category: "ADMIN"
  },
  {
    title: "Strength cues that actually stick",
    content: "Brace, stack, then move. If a cue does not help you feel the position, swap it for one that does.",
    imageUrl: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=1200&q=80",
    authorName: "Jordan Hale",
    authorRole: "trainer",
    status: "published",
    category: "TRAINER"
  },
  {
    title: "Recovery is part of the program",
    content: "Sleep, protein, and easy movement are not extras. They are how your next session gets better.",
    imageUrl: "https://images.unsplash.com/photo-1518310383802-640c2de311b2?auto=format&fit=crop&w=1200&q=80",
    authorName: "Maya Chen",
    authorRole: "trainer",
    status: "published",
    category: "TRAINER"
  },
  {
    title: "Finding your people in the studio",
    content: "The best gyms feel like a neighborhood. Say hello, share a spot, and stay for the last five minutes of stretch.",
    imageUrl: "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?auto=format&fit=crop&w=1200&q=80",
    authorName: "Kinetra Admin",
    authorRole: "admin",
    status: "published",
    category: "ADMIN"
  }
];

async function ensureAdminAccount(auth, database) {
  const email = process.env.ADMIN_EMAIL || "admin@ironpulse.com";
  const existing = await database.collection("user").findOne({ email });
  if (existing) {
    await database.collection("user").updateOne({ _id: existing._id }, { $set: { role: "admin", isBlocked: false } });
    return;
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn("Admin bootstrap skipped: set ADMIN_PASSWORD to create the initial admin account.");
    return;
  }
  try {
    await auth.api.signUpEmail({
      body: {
        email,
        password,
        name: "Kinetra Admin"
      }
    });
  } catch (error) {
    console.warn("Admin sign-up skipped:", error.message);
  }
  await database.collection("user").updateOne({ email }, { $set: { role: "admin", isBlocked: false } });
}

async function ensureSampleContent(database) {
  const classes = database.collection("classes");
  const posts = database.collection("forumPosts");
  if (await classes.countDocuments() === 0) {
    const now = new Date();
    await classes.insertMany(SAMPLE_CLASSES.map(item => ({ ...item, createdAt: now, updatedAt: now })));
  }
  if (await posts.countDocuments() === 0) {
    const now = new Date();
    await posts.insertMany(SAMPLE_POSTS.map(item => ({ ...item, createdAt: now })));
  }
}

module.exports = { ensureAdminAccount, ensureSampleContent };
