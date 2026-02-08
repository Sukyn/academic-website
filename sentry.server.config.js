import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: process.env.PUBLIC_SENTRY_DSN,
  sendDefaultPii: false,
});
