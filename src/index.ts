import express, { Express } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authenticateToken } from './middleware/auth';
import { validateApiKey } from './middleware/apiKey';
import authRoutes from './routes/auth.routes';
import ticketRoutes from './routes/ticket.routes';
import path from 'path';
import fs from 'fs';

const app: Express = express();

// Middlewares globales
app.use(cors({
  origin: env.ALLOWED_ORIGINS,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));
app.use(express.json());

// Servir archivos estáticos de la carpeta uploads
const uploadsPath = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use('/uploads', express.static(uploadsPath));

// Health check (público)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Seguridad de API Key para todas las rutas siguientes
app.use(validateApiKey);

// Rutas protegidas (autenticación JWT)
app.use('/api/auth', authRoutes);
app.use('/api/tickets', authenticateToken, ticketRoutes);

// Iniciar servidor
app.listen(env.PORT, () => {
  console.log(`🚀 API Tickets corriendo en http://localhost:${env.PORT}`);
  console.log(`📋 Endpoints disponibles:`);
  console.log(`   POST   /api/auth/token`);
  console.log(`   POST   /api/tickets`);
  console.log(`   POST   /api/tickets/:id/attachments`);
  console.log(`   GET    /api/tickets`);
  console.log(`   GET    /api/tickets/export`);
  console.log(`   GET    /api/tickets/code/:code`);
  console.log(`   GET    /api/tickets/user/:id`);
  console.log(`   GET    /api/tickets/:id`);
  console.log(`   PATCH  /api/tickets/:id`);
  console.log(`   POST   /api/tickets/:id/comments`);
});


export default app;
