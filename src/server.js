const express = require('express');
const path = require('path');
function createServer() {
  const app = express();

  // Cache the raw (expensive, I/O-bound) parse. Date-range filtering and
  // aggregation are cheap and run per request from this cache.
  let rawCache = null; // { sessions, warnings, fullRange }

  function friendlyError(err) {
    const msg = err.message || String(err);
    if (err.code === 'ENOENT') return { error: 'Claude Code data directory not found. Have you used Claude Code yet?', code: 'ENOENT' };
    if (err.code === 'EPERM' || err.code === 'EACCES') return { error: 'Permission denied reading Claude Code data. Try running with elevated permissions.', code: err.code };
    return { error: msg };
  }

  async function getRaw() {
    if (!rawCache) {
      const parser = require('./parser');
      const { sessions, warnings } = await parser.parseRawSessions();
      rawCache = { sessions, warnings, fullRange: parser.computeRange(sessions) };
    }
    return rawCache;
  }

  // Validate a YYYY-MM-DD query param; ignore anything else.
  function cleanDate(d) {
    return (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? d : null;
  }

  app.get('/api/data', async (req, res) => {
    try {
      const parser = require('./parser');
      const raw = await getRaw();
      const from = cleanDate(req.query.from);
      const to = cleanDate(req.query.to);
      const filter = (from || to) ? { from, to } : null;
      const data = parser.aggregate(raw.sessions, filter);
      data.warnings = raw.warnings;
      data.fullRange = raw.fullRange;
      data.appliedRange = filter
        ? { from: from || (raw.fullRange && raw.fullRange.from), to: to || (raw.fullRange && raw.fullRange.to) }
        : null;
      res.json(data);
    } catch (err) {
      res.status(500).json(friendlyError(err));
    }
  });

  app.get('/api/refresh', async (req, res) => {
    try {
      delete require.cache[require.resolve('./parser')];
      rawCache = null;
      const raw = await getRaw();
      res.json({ ok: true, sessions: raw.sessions.length });
    } catch (err) {
      res.status(500).json(friendlyError(err));
    }
  });

  // Serve static dashboard
  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}

module.exports = { createServer };
