import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,

  // Recommandé pour un site perso/academique: ne pas envoyer IP/headers par défaut
  // Passe à true uniquement si tu as une bonne raison + mention RGPD/confidentialité.
  sendDefaultPii: false,
});
