import { getMigrations } from "better-auth/db/migration";
import { auth } from "../lib/auth";

// Run explicitly against the demo database; never during application import/build.
await (await getMigrations(auth.options)).runMigrations();
console.log("Demo database schema updated.");
process.exit(0);
