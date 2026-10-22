'use strict';

const test = require('node:test');
const assert = require('node:assert');
const core = require('../extension/lib/core');

test('normalizeDomain cleans URLs and rejects junk', () => {
  assert.strictEqual(core.normalizeDomain('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.strictEqual(core.normalizeDomain('reddit.com/r/all'), 'reddit.com');
  assert.strictEqual(core.normalizeDomain('  tiktok.com:443  '), 'tiktok.com');
  assert.strictEqual(core.normalizeDomain('localhost'), 'localhost');
  assert.strictEqual(core.normalizeDomain(''), null);
  assert.strictEqual(core.normalizeDomain('not a domain'), null);
  assert.strictEqual(core.normalizeDomain('-bad-.com'), null);
  assert.strictEqual(core.normalizeDomain(42), null);
});

test('domainMatches covers subdomains but not lookalikes', () => {
  assert.ok(core.domainMatches('youtube.com', 'youtube.com'));
  assert.ok(core.domainMatches('www.youtube.com', 'youtube.com'));
  assert.ok(core.domainMatches('m.youtube.com', 'youtube.com'));
  assert.ok(!core.domainMatches('notyoutube.com', 'youtube.com'));
  assert.ok(!core.domainMatches('youtube.com.evil.io', 'youtube.com'));
});

test('findSite prefers the most specific configured domain', () => {
  const sites = [
    { domain: 'google.com', limitMinutes: 60 },
    { domain: 'docs.google.com', limitMinutes: 5 },
  ];
  assert.strictEqual(core.findSite('docs.google.com', sites).limitMinutes, 5);
  assert.strictEqual(core.findSite('mail.google.com', sites).limitMinutes, 60);
  assert.strictEqual(core.findSite('example.com', sites), null);
});

test('computeBlocked blocks at the limit, and a 0 limit blocks always', () => {
  const sites = [
    { domain: 'a.com', limitMinutes: 10 },
    { domain: 'b.com', limitMinutes: 10 },
    { domain: 'c.com', limitMinutes: 0 },
  ];
  assert.deepStrictEqual(core.computeBlocked(sites, { 'a.com': 600, 'b.com': 599 }), ['a.com', 'c.com']);
  assert.deepStrictEqual(core.computeBlocked(sites, {}), ['c.com']);
});

test('addSite validates, normalizes, and updates existing limits', () => {
  let r = core.addSite([], 'https://www.youtube.com/', 30);
  assert.deepStrictEqual(r.sites, [{ domain: 'youtube.com', limitMinutes: 30 }]);
  r = core.addSite(r.sites, 'youtube.com', 15);
  assert.deepStrictEqual(r.sites, [{ domain: 'youtube.com', limitMinutes: 15 }]);
  assert.ok(core.addSite([], 'nope nope', 30).error);
  assert.ok(core.addSite([], 'a.com', -1).error);
  assert.ok(core.addSite([], 'a.com', 2000).error);
  assert.ok(core.addSite([], 'a.com', 1.5).error);
});

test('removeSite and formatDuration', () => {
  assert.deepStrictEqual(core.removeSite([{ domain: 'a.com', limitMinutes: 1 }], 'a.com'), []);
  assert.strictEqual(core.formatDuration(30), '30s');
  assert.strictEqual(core.formatDuration(720), '12m');
  assert.strictEqual(core.formatDuration(3900), '1h 5m');
  assert.strictEqual(core.formatDuration(3600), '1h');
});

test('dayKey uses local calendar date', () => {
  assert.strictEqual(core.dayKey(new Date(2026, 9, 5, 23, 59)), '2026-10-05');
});
