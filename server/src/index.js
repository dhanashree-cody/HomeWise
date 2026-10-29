import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { migrate, get } from './db.js';
import { attachUser } from './auth.js';
import { HttpError } from './lib/validate.js';

import { router as authRoutes } from './routes/auth.js';
import { router as patientRoutes } from './routes/patients.js';
import { router as assessmentRoutes } from './routes/assessments.js';
import { router as inventoryRoutes } from './routes/inventory.js';
import { router as donorRoutes } from './routes/donors.js';
import { router as campRoutes } from './routes/camps.js';
import { router as requestRoutes } from './routes/requests.js';
import { router as ruleSetRoutes } from './routes/rulesets.js';
import { router as dashboardRoutes } from './routes/dashboard.js';
import { router as auditRoutes } from './routes/audit.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

migrate();

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));
app.use(attachUser);

app.get('/api/health', (_req, res) => {
  const ruleSet = get('SELECT version, title FROM rule_sets WHERE is_active = 1');
  res.json({
    ok: true,
    service: 'HemoWise',
    build: 'academic prototype',
    activeRuleSet: ruleSet || null,
    notice: 'All patient, donor and inventory data in this system is synthetic. Not for clinical use.',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/assessments', assessmentRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/donors', donorRoutes);
app.use('/api/camps', campRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/rulesets', ruleSetRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit', auditRoutes);

// Serve the built front end when it exists, so `npm start` runs the whole app.
const dist = join(here, '..', '..', 'web', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  console.error('[hemowise]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log('HemoWise API listening on http://localhost:' + PORT);
  if (!get('SELECT 1 FROM rule_sets WHERE is_active = 1')) {
    console.warn('No active rule set found. Run: npm run seed');
  }
});
