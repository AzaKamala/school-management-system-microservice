import express from 'express';
import dotenv from 'dotenv';
import authRouter from './routes/authRouter';
import oauthRouter from './routes/oauthRouter';
import { connectRabbitMQ } from './utils/rabbitmq';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

connectRabbitMQ().catch(err => {
  console.error("Failed to connect to RabbitMQ:", err);
});

app.use(express.json());

app.use('/auth', authRouter);
app.use('/auth/oauth', oauthRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'auth-service' });
});

app.listen(port, () => {
  console.log(`Auth service running at http://localhost:${port}`);
});