import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const archive = await readFile(new URL('../public/outreach/les-chevaliers-du-quantique-nanscinum-2025-04-04.html', import.meta.url), 'utf8');
const article = archive.match(/<article>([\s\S]*?)<\/article>/)?.[1];
const originalUrl = 'https://iww.inria.fr/NanSciNum/les-chevaliers-du-quantique-1er-prix-de-la-scientific-game-jam/';
const photoUrl = id => `https://iww.inria.fr/NanSciNum/files/2025/04/SCIENTIFIC_GAME_JAM_AU_FERU_DES_SCIENCES__${id}_preview.jpg`;

test('the archive preserves the original article text, links, photographs, author, and publication date', () => {
  assert(article);
  // Fingerprint of the original entry-content text, allowing only whitespace/markup changes.
  const text = article.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(createHash('sha256').update(text).digest('hex'), 'e1198b33e87d2d32dad84f8d99cb86d8f572cca90fdd3e3b084bf5be086bc8b5');
  assert.deepEqual([...article.matchAll(/href="([^"]+)"/g)].map(match => match[1]), [
    photoUrl('0190'), 'https://mocqua.loria.fr/', 'https://www.leferudessciences.eu/accueil',
    'https://sukyn.itch.io/les-chevaliers-du-quantique', photoUrl('0026'),
  ]);
  const photos = [...article.matchAll(/<img[^>]+>/g)].map(match => match[0]);
  assert.equal(photos.length, 2);
  for (const [index, photo] of photos.entries()) {
    assert(photo.includes(`src="${photoUrl(index ? '0026' : '0190')}"`));
    assert(photo.includes('width="800" height="533"'));
    assert(photo.includes('srcset='));
    assert(photo.includes('sizes="(max-width: 800px) 100vw, 800px"'));
  }
  assert(archive.includes('POIREL Veronique'));
  assert(archive.includes('<time datetime="2025-04-04">'));
  assert(archive.includes(`<link rel="canonical" href="${originalUrl}">`));
  assert(archive.includes('Lire l’article original sur NanSciNum'));
});

test('the archive has no copied active runtime, forms, remote styles, tracking, or cookie interface', () => {
  assert(!/<(?:script|iframe|object|embed|form|input|button|nav)\b/i.test(archive));
  assert(!/\bon[a-z]+\s*=|(?:javascript|data|vbscript):/i.test(archive));
  assert(!/<link\b[^>]*rel=["'](?:stylesheet|preload|dns-prefetch)/i.test(archive));
  assert(!/addthis|gravatar|twitter-timeline|moove_gdpr|wp-content\/plugins|wp-includes/i.test(archive));
  assert(Buffer.byteLength(archive) < 12_000, 'The archived article should not regain the copied website runtime.');
});

test('the standalone archive blocks scripts and narrows remote images to the article source', () => {
  const policy = archive.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert(policy);
  const directives = new Map(policy.split(';').map(directive => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values];
  }));
  assert.deepEqual(directives.get('script-src'), ["'none'"]);
  assert.deepEqual(directives.get('default-src'), ["'none'"]);
  assert.deepEqual(directives.get('img-src'), ['https://iww.inria.fr']);
  assert.deepEqual(directives.get('base-uri'), ["'none'"]);
  assert.deepEqual(directives.get('form-action'), ["'none'"]);
  assert(archive.includes('<meta name="referrer" content="no-referrer">'));
});

test('the archive remains a French, responsive, keyboard-readable document', () => {
  assert(archive.includes('<html lang="fr">'));
  assert.equal((archive.match(/<h1>/g) ?? []).length, 1);
  assert.equal((archive.match(/<main\b/g) ?? []).length, 1);
  assert(archive.includes('<main id="main-content" tabindex="-1">'));
  assert(archive.includes('<a class="skip-link" href="#main-content">'));
  assert(archive.includes('<meta name="viewport" content="width=device-width, initial-scale=1">'));
  assert(archive.includes('<meta name="description"'));
  assert(archive.includes('<meta name="robots" content="noindex, follow">'));
  assert.equal((article.match(/aria-label="Photographie de la Scientific Game Jam \(\d\)"/g) ?? []).length, 2);
});
